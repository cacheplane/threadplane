import {
  createDatabaseExecutor,
  dispatchGrowthLeasedJob,
  enqueueInstallDigestJob,
  enqueueLinkedInDigestJob,
  deferLeasedJob,
  failLeasedJob,
  isMailboxRecoveryPaused,
  leaseDueJobs,
  materializeCampaignEnrollment,
  pacificCalendarDate,
  processInstallRuntimeActivations,
  processObservations,
  projectFormObservations,
  readLinkedInDigestContext,
  reconcilePendingResendMessageIds,
  renewJobLease,
  scrubLinkedInReceipts,
  type GrowthAppJobHandlers,
  type GrowthDispatchDependencies,
  type GrowthDispatchResult,
  type GrowthJob,
  type SqlExecutor,
} from './growth.js';

import { createLifecycleAppJobHandlers } from './campaign/send.js';
import { DeterministicLifecycleJobError } from './job-errors.js';
import { loadEmailHmacKeyring } from './email-keyring.js';
import {
  createMarketingDispatch,
  type MarketingDispatchResult,
} from './marketing.js';

export { DeterministicLifecycleJobError } from './job-errors.js';

const MAX_BATCH_SIZE = 25;
// Leave time for a bounded provider request and durable outcome writes.
const TICK_JOB_START_BUDGET_MS = 30_000;
const TICK_DEADLINE_MS = 50_000;
// The marketing step gets its own slice so it cannot starve email jobs.
const MARKETING_STEP_BUDGET_MS = 15_000;
const OBSERVATION_PROJECTION_MAX_LIMIT = 100;

/** `alertErrors` entries are `<key>: <message>`; keys never contain ': '. */
function marketingAlertKey(entry: string): string {
  const end = entry.indexOf(': ');
  return end === -1 ? entry : entry.slice(0, end);
}

const LEASE_DURATION_MS = 60_000;
const LEASE_RENEWAL_INTERVAL_MS = 20_000;
const LEASED_KINDS = [
  'fulfill',
  'enrich',
  'notify',
  'send_step',
  'reply_reconcile',
  'research_cleanup',
  'digest',
] as const;

export interface LifecycleDispatcherInput {
  batchSize: number;
  campaignEnabled: boolean;
  campaignEnrollmentEnabled?: boolean;
  installRuntimeHelloEnabled?: boolean;
  installDigestEnabled?: boolean;
  linkedInIngestEnabled?: boolean;
  observationProcessingEnabled?: boolean;
  marketingPostingEnabled?: boolean;
  campaignEnrollmentStartAt?: Date;
  signal: AbortSignal;
}

export type LifecycleOperatorAlert =
  | 'mailbox_recovery_required'
  | 'observation_projection_failed'
  | 'marketing_dispatch_failed'
  | 'linkedin_ingest_failed'
  | 'linkedin_forward_failed';

export interface LifecycleDispatcherResult {
  leased: number;
  dispatched: number;
  recoveryPaused: boolean;
  operatorAlerts: LifecycleOperatorAlert[];
}

export interface LifecycleDispatcherDependencies {
  appHandlers: GrowthAppJobHandlers;
  createDatabase: () => SqlExecutor;
  dispatchLeasedJob: (
    executor: SqlExecutor,
    job: GrowthJob,
    dependencies: GrowthDispatchDependencies
  ) => Promise<GrowthDispatchResult>;
  isRecoveryPaused: typeof isMailboxRecoveryPaused;
  leaseDueJobs: typeof leaseDueJobs;
  materializeCampaignEnrollment: typeof materializeCampaignEnrollment;
  enqueueInstallDigestJob: typeof enqueueInstallDigestJob;
  enqueueLinkedInDigestJob: typeof enqueueLinkedInDigestJob;
  readLinkedInDigestContext: typeof readLinkedInDigestContext;
  scrubLinkedInReceipts: typeof scrubLinkedInReceipts;
  processInstallRuntimeActivations: typeof processInstallRuntimeActivations;
  processObservations: typeof processObservations;
  projectFormObservations: typeof projectFormObservations;
  dispatchMarketing: (
    executor: SqlExecutor,
    signal: AbortSignal
  ) => Promise<MarketingDispatchResult>;
  reconcileMessageIds?: typeof reconcilePendingResendMessageIds;
  loadEmailKeyring: typeof loadEmailHmacKeyring;
  now: () => Date;
  renewJobLease: typeof renewJobLease;
  quarantineJob: typeof failLeasedJob;
  deferJob?: typeof deferLeasedJob;
  clearTimeout: typeof globalThis.clearTimeout;
  setTimeout: typeof globalThis.setTimeout;
}

const defaultDependencies: LifecycleDispatcherDependencies = {
  appHandlers: createLifecycleAppJobHandlers(),
  createDatabase: () => createDatabaseExecutor(),
  dispatchLeasedJob: dispatchGrowthLeasedJob,
  isRecoveryPaused: isMailboxRecoveryPaused,
  leaseDueJobs,
  materializeCampaignEnrollment,
  enqueueInstallDigestJob,
  enqueueLinkedInDigestJob,
  readLinkedInDigestContext,
  scrubLinkedInReceipts,
  processInstallRuntimeActivations,
  processObservations,
  projectFormObservations,
  dispatchMarketing: createMarketingDispatch(process.env),
  reconcileMessageIds: reconcilePendingResendMessageIds,
  loadEmailKeyring: loadEmailHmacKeyring,
  now: () => new Date(),
  renewJobLease,
  quarantineJob: failLeasedJob,
  deferJob: deferLeasedJob,
  clearTimeout: globalThis.clearTimeout,
  setTimeout: globalThis.setTimeout,
};

interface LeaseHeartbeat {
  stop: () => Promise<void>;
}

function startLeaseHeartbeat(
  executor: SqlExecutor,
  job: GrowthJob,
  dependencies: LifecycleDispatcherDependencies,
  onFailure: (error: Error) => void
): LeaseHeartbeat {
  if (!job.leaseToken) {
    throw new Error('Lifecycle leased job is missing its lease token');
  }
  let stopped = false;
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  let inFlight: Promise<void> = Promise.resolve();

  const arm = (): void => {
    timer = dependencies.setTimeout(() => {
      inFlight = (async () => {
        const renewed = await dependencies.renewJobLease(executor, {
          jobId: job.id,
          leaseDurationMs: LEASE_DURATION_MS,
          leaseToken: job.leaseToken as string,
          now: dependencies.now(),
        });
        if (!stopped && renewed === null) {
          throw new Error('Lifecycle job lease renewal failed');
        }
      })()
        .catch((error: unknown) => {
          if (!stopped) {
            stopped = true;
            onFailure(
              error instanceof Error
                ? error
                : new Error('Lifecycle job lease renewal failed')
            );
          }
        })
        .finally(() => {
          if (!stopped) arm();
        });
    }, LEASE_RENEWAL_INTERVAL_MS);
  };

  arm();
  return {
    async stop(): Promise<void> {
      stopped = true;
      if (timer !== undefined) dependencies.clearTimeout(timer);
      await inFlight;
    },
  };
}

function validBatchSize(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > MAX_BATCH_SIZE) {
    throw new Error(
      `batchSize must be an integer between 1 and ${MAX_BATCH_SIZE}`
    );
  }
  return value;
}

export async function dispatchLifecycleJobs(
  input: LifecycleDispatcherInput,
  dependencies: LifecycleDispatcherDependencies = defaultDependencies
): Promise<LifecycleDispatcherResult> {
  const startedAt = dependencies.now().getTime();
  const budgetSpent = () =>
    dependencies.now().getTime() - startedAt >= TICK_JOB_START_BUDGET_MS;
  const batchSize = validBatchSize(input.batchSize);
  input.signal.throwIfAborted();
  const tickSignal = AbortSignal.any([
    input.signal,
    AbortSignal.timeout(TICK_DEADLINE_MS),
  ]);
  const executor = dependencies.createDatabase();
  try {
    await dependencies.reconcileMessageIds?.(executor, {
      now: dependencies.now(),
      signal: tickSignal,
    });
    tickSignal.throwIfAborted();
    const operatorAlerts: LifecycleOperatorAlert[] = [];
    if (input.observationProcessingEnabled === true) {
      // The projection cap is 100; the dispatcher batch is already <= 25.
      const limit = Math.min(batchSize, OBSERVATION_PROJECTION_MAX_LIMIT);
      let projectionFailed = false;
      try {
        await dependencies.processObservations(executor, {
          enabled: true,
          limit,
          now: dependencies.now,
        });
      } catch {
        projectionFailed = true;
      }
      tickSignal.throwIfAborted();
      try {
        await dependencies.projectFormObservations(executor, {
          enabled: true,
          limit,
          now: dependencies.now,
        });
      } catch {
        projectionFailed = true;
      }
      tickSignal.throwIfAborted();
      if (projectionFailed) {
        operatorAlerts.push('observation_projection_failed');
      }
    }
    if (input.marketingPostingEnabled === true) {
      // Contained like projection: a marketing failure never blocks leasing.
      try {
        const marketing = await dependencies.dispatchMarketing(
          executor,
          AbortSignal.any([
            tickSignal,
            AbortSignal.timeout(MARKETING_STEP_BUDGET_MS),
          ])
        );
        // A failed alert email leaves the operator log as the only signal.
        if (marketing.alertErrors.length > 0) {
          operatorAlerts.push('marketing_dispatch_failed');
          // Keys only: messages can carry upstream response text.
          console.error(
            `[marketing] alert delivery failed: ${marketing.alertErrors
              .map(marketingAlertKey)
              .join(', ')}`
          );
        }
      } catch {
        operatorAlerts.push('marketing_dispatch_failed');
      }
      tickSignal.throwIfAborted();
    }
    if (input.campaignEnrollmentEnabled) {
      if (
        !(input.campaignEnrollmentStartAt instanceof Date) ||
        Number.isNaN(input.campaignEnrollmentStartAt.getTime())
      ) {
        throw new Error(
          'campaignEnrollmentStartAt is required when enrollment is enabled'
        );
      }
      if (input.installRuntimeHelloEnabled === true) {
        await dependencies.processInstallRuntimeActivations(executor, {
          enabled: true,
          limit: batchSize,
          now: dependencies.now(),
          keyring: dependencies.loadEmailKeyring(),
        });
        tickSignal.throwIfAborted();
      }
      await dependencies.materializeCampaignEnrollment(executor, {
        enrollmentEnabled: true,
        enrollmentStartAt: input.campaignEnrollmentStartAt,
        now: dependencies.now(),
        batchSize,
      });
    }
    if (input.installDigestEnabled === true) {
      const now = dependencies.now();
      const calendar = pacificCalendarDate(now);
      if (calendar.weekday) {
        await dependencies.enqueueInstallDigestJob(executor, {
          now,
          idempotencyKey: `install_digest:${calendar.date}`,
          businessDate: calendar.date,
          keyring: dependencies.loadEmailKeyring(),
        });
        tickSignal.throwIfAborted();
      }
    }
    // Retention scrubbing runs on every tick, even with ingest switched off, so
    // raw receipt bodies never outlive 30 days. Contained like marketing: a
    // LinkedIn failure never blocks leasing.
    try {
      await dependencies.scrubLinkedInReceipts(executor, {
        now: dependencies.now(),
      });
    } catch {
      operatorAlerts.push('linkedin_ingest_failed');
    }
    tickSignal.throwIfAborted();
    if (input.linkedInIngestEnabled === true) {
      try {
        const now = dependencies.now();
        const context = await dependencies.readLinkedInDigestContext(executor, {
          now,
        });
        if (context.forwardBacklog > 0) {
          operatorAlerts.push('linkedin_forward_failed');
        }
        const calendar = pacificCalendarDate(now);
        if (calendar.weekday) {
          await dependencies.enqueueLinkedInDigestJob(executor, {
            now,
            idempotencyKey: `linkedin_digest:${calendar.date}`,
            businessDate: calendar.date,
          });
        }
      } catch {
        if (!operatorAlerts.includes('linkedin_ingest_failed'))
          operatorAlerts.push('linkedin_ingest_failed');
      }
      tickSignal.throwIfAborted();
    }
    const recoveryWasPaused = await dependencies.isRecoveryPaused(executor);
    tickSignal.throwIfAborted();
    if (budgetSpent())
      return {
        leased: 0,
        dispatched: 0,
        recoveryPaused: recoveryWasPaused,
        operatorAlerts: recoveryWasPaused
          ? [...operatorAlerts, 'mailbox_recovery_required']
          : operatorAlerts,
      };
    const jobs = await dependencies.leaseDueJobs(executor, {
      kinds: [...LEASED_KINDS],
      now: dependencies.now(),
      batchSize,
      leaseDurationMs: LEASE_DURATION_MS,
      campaignEnabled: input.campaignEnabled,
    });
    const leaseFailure = new AbortController();
    let leaseFailureReason: Error | null = null;
    const failLease = (error: Error): void => {
      if (leaseFailureReason) return;
      leaseFailureReason = error;
      leaseFailure.abort(error);
    };
    const dispatchSignal = AbortSignal.any([tickSignal, leaseFailure.signal]);
    const heartbeats = new Map(
      jobs.map((job) => [
        job.id,
        startLeaseHeartbeat(executor, job, dependencies, failLease),
      ])
    );
    let dispatched = 0;
    let budgetExhausted = false;
    let recoveryPaused = recoveryWasPaused;
    try {
      for (const job of jobs) {
        dispatchSignal.throwIfAborted();
        if (budgetExhausted || budgetSpent()) {
          budgetExhausted = true;
          const heartbeat = heartbeats.get(job.id);
          heartbeats.delete(job.id);
          await heartbeat?.stop();
          const now = dependencies.now();
          await (dependencies.deferJob ?? deferLeasedJob)(executor, {
            jobId: job.id,
            leaseToken: job.leaseToken as string,
            now,
            availableAt: now,
            errorCode: 'tick_budget_exhausted',
          });
          continue;
        }
        try {
          try {
            const result = await dependencies.dispatchLeasedJob(executor, job, {
              appHandlers: dependencies.appHandlers,
              signal: dispatchSignal,
            });
            dispatchSignal.throwIfAborted();
            dispatched += 1;
            recoveryPaused ||= result === 'recovery_paused';
          } catch (error) {
            dispatchSignal.throwIfAborted();
            if (!(error instanceof DeterministicLifecycleJobError)) {
              throw error;
            }
            await dependencies.quarantineJob(executor, {
              errorCode: 'deterministic_job_poison',
              jobId: job.id,
              leaseToken: job.leaseToken as string,
              now: dependencies.now(),
            });
            dispatched += 1;
          }
        } finally {
          const heartbeat = heartbeats.get(job.id);
          heartbeats.delete(job.id);
          await heartbeat?.stop();
        }
      }
    } finally {
      await Promise.all([...heartbeats.values()].map(({ stop }) => stop()));
    }
    if (leaseFailureReason) {
      throw leaseFailureReason;
    }
    return {
      leased: jobs.length,
      dispatched,
      recoveryPaused,
      operatorAlerts: recoveryPaused
        ? [...operatorAlerts, 'mailbox_recovery_required']
        : operatorAlerts,
    };
  } finally {
    await executor.close?.();
  }
}
