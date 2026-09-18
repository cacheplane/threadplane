import type { SqlExecutor } from './database.ts';
import type { GrowthJob } from './models.ts';
import {
  isGoogleMailboxRecoveryPaused,
  settleGoogleReplyReconciliation,
  type ProcessGoogleMailboxEventDependencies,
} from './replies.ts';

export type GrowthDispatchResult =
  | Awaited<ReturnType<typeof settleGoogleReplyReconciliation>>
  | 'cancelled'
  | 'failed'
  | 'deferred'
  | 'recovery_paused';

export type GrowthAppJobKind =
  | 'fulfill'
  | 'enrich'
  | 'notify'
  | 'send_step'
  | 'research_cleanup'
  | 'digest';

export interface GrowthAppJobDispatchContext {
  signal?: AbortSignal;
}

export type GrowthAppJobHandler = (
  executor: SqlExecutor,
  job: GrowthJob,
  context: GrowthAppJobDispatchContext
) => Promise<GrowthDispatchResult>;

export type GrowthAppJobHandlers = Partial<
  Record<GrowthAppJobKind, GrowthAppJobHandler>
>;

export type GrowthDispatchDependencies =
  | ProcessGoogleMailboxEventDependencies
  | {
      signal?: AbortSignal;
      googleMailbox?: ProcessGoogleMailboxEventDependencies;
      appHandlers?: GrowthAppJobHandlers;
    };

/**
 * The production dispatch boundary for jobs returned by `leaseDueJobs`.
 * Task 11's Dawn worker must call this function rather than switching on job
 * kinds independently.
 */
export async function dispatchGrowthLeasedJob(
  executor: SqlExecutor,
  job: GrowthJob,
  dependencies?: GrowthDispatchDependencies
): Promise<GrowthDispatchResult> {
  const signal =
    dependencies && 'signal' in dependencies ? dependencies.signal : undefined;
  signal?.throwIfAborted();
  if (job.status !== 'leased' || !job.leaseToken) {
    throw new Error(`Unsupported or inactive growth job kind: ${job.kind}`);
  }
  const appHandlers =
    dependencies && 'appHandlers' in dependencies
      ? dependencies.appHandlers
      : undefined;
  const appHandler = appHandlers?.[job.kind as GrowthAppJobKind];
  if (job.kind !== 'reply_reconcile' && !appHandler) {
    throw new Error(`Unsupported or inactive growth job kind: ${job.kind}`);
  }
  if (
    (job.kind === 'reply_reconcile' || job.kind === 'send_step') &&
    (await isGoogleMailboxRecoveryPaused(executor))
  ) {
    return 'recovery_paused';
  }
  signal?.throwIfAborted();
  if (appHandler) {
    return appHandler(executor, job, { signal });
  }
  const googleMailboxDependencies =
    dependencies && 'stopContact' in dependencies
      ? dependencies
      : dependencies?.googleMailbox;
  return settleGoogleReplyReconciliation(
    executor,
    {
      jobId: job.id,
      leaseToken: job.leaseToken,
      now: new Date(),
    },
    googleMailboxDependencies
  );
}
