import {
  createDatabaseExecutor,
  dispatchGrowthLeasedJob,
  enqueueInstallDigestJob,
  failLeasedJob,
  isGoogleMailboxRecoveryPaused,
  leaseDueJobs,
  materializeCampaignEnrollment,
  pacificCalendarDate,
  processInstallRuntimeActivations,
  processObservations,
  projectFormObservations,
  reconcilePendingResendMessageIds,
  renewJobLease,
  type GrowthAppJobHandlers,
  type GrowthDispatchDependencies,
  type GrowthDispatchResult,
  type GrowthJob,
  type SqlExecutor,
} from './growth.js';

import { createLifecycleAppJobHandlers } from './campaign/send.js';
import { DeterministicLifecycleJobError } from './job-errors.js';
import { loadEmailHmacKeyring } from './email-keyring.js';

export { DeterministicLifecycleJobError } from './job-errors.js';

const MAX_BATCH_SIZE = 25;
const OBSERVATION_PROJECTION_MAX_LIMIT = 100;
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
  observationProcessingEnabled?: boolean;
  campaignEnrollmentStartAt?: Date;
  signal: AbortSignal;
}

export type LifecycleOperatorAlert =
  | 'mailbox_recovery_required'
  | 'observation_projection_failed';

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
  isRecoveryPaused: typeof isGoogleMailboxRecoveryPaused;
  leaseDueJobs: typeof leaseDueJobs;
  materializeCampaignEnrollment: typeof materializeCampaignEnrollment;
  enqueueInstallDigestJob: typeof enqueueInstallDigestJob;
  processInstallRuntimeActivations: typeof processInstallRuntimeActivations;
  processObservations: typeof processObservations;
  projectFormObservations: typeof projectFormObservations;
  reconcileMessageIds?: typeof reconcilePendingResendMessageIds;
  loadEmailKeyring: typeof loadEmailHmacKeyring;
  now: () => Date;
  renewJobLease: typeof renewJobLease;
  quarantineJob: typeof failLeasedJob;
  clearTimeout: typeof globalThis.clearTimeout;
  setTimeout: typeof globalThis.setTimeout;
}

const defaultDependencies: LifecycleDispatcherDependencies = {
  appHandlers: createLifecycleAppJobHandlers(),
  createDatabase: () => createDatabaseExecutor(),
  dispatchLeasedJob: dispatchGrowthLeasedJob,
  isRecoveryPaused: isGoogleMailboxRecoveryPaused,
  leaseDueJobs,
  materializeCampaignEnrollment,
  enqueueInstallDigestJob,
  processInstallRuntimeActivations,
  processObservations,
  projectFormObservations,
  reconcileMessageIds: reconcilePendingResendMessageIds,
  loadEmailKeyring: loadEmailHmacKeyring,
  now: () => new Date(),
  renewJobLease,
  quarantineJob: failLeasedJob,
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
  const batchSize = validBatchSize(input.batchSize);
  input.signal.throwIfAborted();
  const executor = dependencies.createDatabase();
  try {
    await dependencies.reconcileMessageIds?.(executor, {
      now: dependencies.now(),
      signal: input.signal,
    });
    input.signal.throwIfAborted();
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
      input.signal.throwIfAborted();
      try {
        await dependencies.projectFormObservations(executor, {
          enabled: true,
          limit,
          now: dependencies.now,
        });
      } catch {
        projectionFailed = true;
      }
      input.signal.throwIfAborted();
      if (projectionFailed) {
        operatorAlerts.push('observation_projection_failed');
      }
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
        input.signal.throwIfAborted();
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
        input.signal.throwIfAborted();
      }
    }
    const recoveryWasPaused = await dependencies.isRecoveryPaused(executor);
    input.signal.throwIfAborted();
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
    const dispatchSignal = AbortSignal.any([input.signal, leaseFailure.signal]);
    const heartbeats = new Map(
      jobs.map((job) => [
        job.id,
        startLeaseHeartbeat(executor, job, dependencies, failLease),
      ])
    );
    let dispatched = 0;
    let recoveryPaused = recoveryWasPaused;
    try {
      for (const job of jobs) {
        dispatchSignal.throwIfAborted();
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
