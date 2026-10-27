import { randomUUID } from 'node:crypto';
import {
  acknowledgeResearchRun,
  beginResearchAttempt,
  cancelLeasedJob,
  completeLeasedJob,
  deferResearchJob,
  failLeasedJob,
  getResearchAttempt,
  getResearchInput,
  JobLeaseConflictError,
  markResearchSubmissionStarted,
  publishResearchArtifact,
  readResearchCompanyDomain,
  recordResearchCleanupQuiescence,
  recordResearchCleanupAbsence,
  finishResearchCleanup,
  recomputeContactScore,
  type GrowthAppJobHandler,
  type SqlExecutor,
} from '../growth.js';
import { createCompanyCapture } from '@threadplane-internal/growth-capture';
import {
  createDawnResearchClient,
  type DawnResearchClient,
} from './dawn-client.js';
import { companyArtifact } from './dawn-result.js';
import { LIFECYCLE_SCORE_CONTENT_REGISTRY_V1 } from '../score-policy.js';
// Shared company wire/runtime helpers must remain identical to the managed app.
/* eslint-disable @nx/enforce-module-boundaries */
import {
  CompanyRequestSchema,
  hashCompanyEvidence,
  parseCompanyRequest,
} from '../../../growth-research/src/production/contracts.js';
import {
  createClaimStore,
  type ClaimStatus,
} from '../../../growth-research/src/production/claims.js';
import { createTraceTransport } from '../../../growth-research/src/production/tracing.js';
/* eslint-enable @nx/enforce-module-boundaries */

const TERMINAL = new Set(['success', 'error', 'interrupted', 'timeout']);
const RECOVERY_GRACE_MS = 5 * 60000;
// The research_attempt deadline below only exists once an attempt was submitted,
// so a job that keeps failing before submission carries no deadline at all. These
// bounds are the payload-independent terminal condition for that case.
const MAX_RECONCILIATION_ATTEMPTS = 20;
const RECONCILIATION_BASE_DELAY_MS = 15_000;
const RECONCILIATION_MAX_DELAY_MS = 15 * 60_000;
const CLEANUP_HORIZON_MS = 7 * 86400000;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export interface DawnJobDependencies {
  now: () => Date;
  uuid: () => string;
  capture: ReturnType<typeof createCompanyCapture>;
  refreshScore: (db: SqlExecutor, contactId: string) => Promise<void>;
  client: () => DawnResearchClient;
  readDomain: typeof readResearchCompanyDomain;
  begin: typeof beginResearchAttempt;
  fence: typeof markResearchSubmissionStarted;
  acknowledge: typeof acknowledgeResearchRun;
  publish: typeof publishResearchArtifact;
  complete: typeof completeLeasedJob;
  fail: typeof failLeasedJob;
  cancel: typeof cancelLeasedJob;
  defer: typeof deferResearchJob;
  artifact: typeof companyArtifact;
  readClaim: (attemptId: string) => Promise<ClaimStatus | null>;
  parentActive: (db: SqlExecutor, attemptId: string) => Promise<boolean>;
  deleteTraces: (attemptId: string) => Promise<void>;
  tracesAbsent: (attemptId: string) => Promise<boolean>;
  recordCleanupProof: typeof recordResearchCleanupQuiescence;
  recordCleanupAbsence: typeof recordResearchCleanupAbsence;
  finishCleanup: typeof finishResearchCleanup;
}

export function createDefaultDawnJobDependencies(
  environment: Record<string, string | undefined> = process.env
): DawnJobDependencies {
  let client: DawnResearchClient | undefined;
  let claims: ReturnType<typeof createClaimStore> | undefined;
  let traces: ReturnType<typeof createTraceTransport> | undefined;
  const traceTransport = () => {
    const apiKey = environment['LANGSMITH_API_KEY'],
      projectId = environment['GROWTH_RESEARCH_TRACE_PROJECT_ID'];
    if (!apiKey || !projectId)
      throw new Error('dawn_trace_cleanup_configuration_required');
    return (traces ??= createTraceTransport({
      apiKey,
      projectId,
      endpoint: environment['LANGSMITH_ENDPOINT'],
      workspaceId: environment['LANGSMITH_WORKSPACE_ID'],
    }));
  };
  return {
    now: () => new Date(),
    uuid: randomUUID,
    capture: createCompanyCapture(environment),
    async refreshScore(db, contactId) {
      await recomputeContactScore(db, {
        contactId,
        contentRegistry: LIFECYCLE_SCORE_CONTENT_REGISTRY_V1,
      });
    },
    client: () => (client ??= createDawnResearchClient(environment)),
    readDomain: readResearchCompanyDomain,
    begin: beginResearchAttempt,
    fence: markResearchSubmissionStarted,
    acknowledge: acknowledgeResearchRun,
    publish: publishResearchArtifact,
    complete: completeLeasedJob,
    fail: failLeasedJob,
    cancel: cancelLeasedJob,
    defer: deferResearchJob,
    artifact: companyArtifact,
    async readClaim(attemptId) {
      const url = environment['GROWTH_RESEARCH_DATABASE_URL'];
      if (!url) throw new Error('dawn_claim_database_required');
      claims ??= createClaimStore(url);
      return claims.get(attemptId);
    },
    async parentActive(db, attemptId) {
      const result = await db.execute<{ active: boolean }>(
        `select exists(select 1 from growth_jobs where kind='enrich' and payload->'research_attempt'->>'attemptId'=$1 and status in ('pending','leased')) as active`,
        [attemptId]
      );
      return result.rows[0]?.active === true;
    },
    deleteTraces: (attemptId) => traceTransport().requestDeletion(attemptId),
    tracesAbsent: (attemptId) => traceTransport().isAbsent(attemptId),
    recordCleanupProof: recordResearchCleanupQuiescence,
    recordCleanupAbsence: recordResearchCleanupAbsence,
    finishCleanup: finishResearchCleanup,
  };
}

function settled(
  claim: ClaimStatus | null,
  attemptId: string,
  expiresAt: string
): boolean {
  return (
    claim?.attemptId === attemptId &&
    claim.expiresAt === expiresAt &&
    typeof claim.settledAt === 'string' &&
    Number.isFinite(Date.parse(claim.settledAt))
  );
}

export function createDawnJobHandlers(
  factory: () => DawnJobDependencies = createDefaultDawnJobDependencies
): {
  enrich: GrowthAppJobHandler;
  research_cleanup: GrowthAppJobHandler;
} {
  let cached: DawnJobDependencies | undefined;
  const dependencies = () => (cached ??= factory());
  const enrich: GrowthAppJobHandler = async (db, job, context) => {
    const d = dependencies(),
      signal = context.signal ?? new AbortController().signal;
    if (!job.leaseToken) throw new JobLeaseConflictError(job.id);
    const lease = () => ({
      jobId: job.id,
      leaseToken: job.leaseToken as string,
      now: d.now(),
    });
    const defer = async (errorCode: string) => {
      const input = lease();
      const expiresAt = (
        job.payload['research_attempt'] as { expiresAt?: string } | undefined
      )?.expiresAt;
      if (
        expiresAt &&
        input.now.getTime() >= Date.parse(expiresAt) + RECOVERY_GRACE_MS
      )
        return fail('dawn_recovery_deadline');
      const attempts = job.attempts ?? 0;
      if (attempts >= MAX_RECONCILIATION_ATTEMPTS)
        return fail('dawn_reconciliation_exhausted');
      await d.defer(db, {
        ...input,
        errorCode,
        availableAt: new Date(
          input.now.getTime() +
            Math.min(
              RECONCILIATION_MAX_DELAY_MS,
              RECONCILIATION_BASE_DELAY_MS * 2 ** Math.min(attempts, 10)
            )
        ),
      });
      return 'deferred' as const;
    };
    const fail = async (errorCode: string) => {
      await d.fail(db, { ...lease(), errorCode });
      return 'failed' as const;
    };
    try {
      signal.throwIfAborted();
      const currentDomain = await d.readDomain(db, lease());
      let attempt = getResearchAttempt(job);
      let snapshot = getResearchInput(job);
      if (!attempt) {
        if (job.contactId) await d.refreshScore(db, job.contactId);
        if (!currentDomain) {
          await d.complete(db, {
            ...lease(),
            errorCode: 'dawn_skipped_no_company_domain',
          });
          return 'completed';
        }
        const pages = await d.capture(currentDomain, signal);
        if (!pages.some((page) => page.facts.length || page.snippets.length)) {
          await d.complete(db, {
            ...lease(),
            errorCode: 'dawn_skipped_empty_evidence',
          });
          return 'completed';
        }
        // Capture has already enforced the redirect policy; source acceptance is
        // narrowed to that canonical company host in the managed wire contract.
        const domain = new URL(pages[0].canonicalUrl).hostname;
        const input = lease(),
          attemptId = d.uuid(),
          threadId = d.uuid();
        const expiresAt = new Date(input.now.getTime() + 90000);
        const request = parseCompanyRequest(
          {
            version: 'company_research.request.v1',
            attemptId,
            domain,
            pages,
            evidenceHash: hashCompanyEvidence(domain, pages),
            expiresAt: expiresAt.toISOString(),
            generationRef: job.id,
          },
          input.now.getTime()
        );
        const begun = await d.begin(db, {
          ...input,
          attemptId,
          threadId,
          companyDomain: currentDomain,
          evidenceHash: request.evidenceHash,
          expiresAt,
          researchInput: request,
        });
        attempt = begun.attempt;
        snapshot = begun.researchInput;
      }
      if (currentDomain !== attempt.companyDomain)
        return fail('dawn_company_changed');
      if (!snapshot) return fail('dawn_snapshot_missing');
      const request = CompanyRequestSchema.parse(snapshot);
      const client = d.client();
      if (attempt.phase === 'prepared') {
        if (Date.parse(attempt.expiresAt) <= d.now().getTime())
          return fail('dawn_attempt_expired_unsubmitted');
        await client.ensureThread(attempt.threadId, attempt.attemptId, signal);
        const fence = await d.fence(db, {
          ...lease(),
          attemptId: attempt.attemptId,
        });
        if (!fence.claimed) return defer('dawn_submission_not_claimed');
        // No automatic retry may surround this POST. A thrown/lost response
        // leaves the durable fence submitting and recovery only looks it up.
        const run = await client.submit(
          attempt.threadId,
          attempt.attemptId,
          request,
          signal
        );
        await d.acknowledge(db, {
          ...lease(),
          attemptId: attempt.attemptId,
          runId: run.runId,
        });
        return defer('dawn_run_pending');
      }
      const run = await client.findRun(
        attempt.threadId,
        attempt.attemptId,
        signal
      );
      if (!run) {
        // Reconcile a lost acknowledgement only within the recovery window;
        // the durable submission fence is never reset.
        return defer('dawn_submission_ambiguous');
      }
      if (attempt.runId && attempt.runId !== run.runId)
        return fail('dawn_run_mismatch');
      if (!attempt.runId)
        await d.acknowledge(db, {
          ...lease(),
          attemptId: attempt.attemptId,
          runId: run.runId,
        });
      if (!TERMINAL.has(run.status)) {
        return defer('dawn_run_pending');
      }
      if (run.status !== 'success') return fail('dawn_remote_failed');
      if (
        !settled(
          await d.readClaim(attempt.attemptId),
          attempt.attemptId,
          attempt.expiresAt
        )
      )
        return defer('dawn_writers_unsettled');
      let content: Record<string, unknown>;
      const output = await client.result(attempt.threadId, signal);
      try {
        content = d.artifact(request, output, {
          threadId: attempt.threadId,
          runId: run.runId,
        });
      } catch {
        return fail('dawn_candidate_rejected');
      }
      await d.publish(db, {
        ...lease(),
        attemptId: attempt.attemptId,
        companyDomain: attempt.companyDomain,
        evidenceHash: attempt.evidenceHash,
        content,
      });
      await d.complete(db, lease());
      return 'completed';
    } catch (error) {
      if (error instanceof JobLeaseConflictError) return 'cancelled';
      signal.throwIfAborted();
      return defer('dawn_reconciliation_required');
    }
  };
  const research_cleanup: GrowthAppJobHandler = async (db, job, context) => {
    const d = dependencies(),
      signal = context.signal ?? new AbortController().signal;
    if (!job.leaseToken) throw new JobLeaseConflictError(job.id);
    const lease = () => ({
      jobId: job.id,
      leaseToken: job.leaseToken as string,
      now: d.now(),
    });
    const defer = async (errorCode: string, delayMs = 15000) => {
      const input = lease();
      await d.defer(db, {
        ...input,
        errorCode,
        availableAt: new Date(input.now.getTime() + delayMs),
      });
      return 'deferred' as const;
    };
    const { attemptId, threadId, expiresAt } = job.payload;
    let checkingTraces = false;
    try {
      if (
        typeof attemptId !== 'string' ||
        !UUID.test(attemptId) ||
        typeof threadId !== 'string' ||
        !UUID.test(threadId) ||
        typeof expiresAt !== 'string' ||
        !Number.isFinite(Date.parse(expiresAt))
      ) {
        await d.fail(db, {
          ...lease(),
          errorCode: 'dawn_cleanup_identity_invalid',
        });
        return 'failed';
      }
      const age = d.now().getTime() - Date.parse(expiresAt);
      if (age >= CLEANUP_HORIZON_MS) {
        await d.finishCleanup(db, {
          ...lease(),
          attemptId,
          threadId,
          status: 'failed',
          errorCode: 'dawn_cleanup_horizon_exceeded',
        });
        return 'failed';
      }
      const deadline = age >= RECOVERY_GRACE_MS;
      const parentActive = await d.parentActive(db, attemptId);
      if (!deadline && parentActive) return defer('dawn_cleanup_parent_active');
      const client = d.client();
      const run = await client
        .findRun(threadId, attemptId, signal)
        .catch((error) => {
          signal.throwIfAborted();
          if (!deadline || parentActive) throw error;
          const runId = job.payload['runId'];
          return typeof runId === 'string' && UUID.test(runId)
            ? { runId, status: 'unknown' }
            : null;
        });
      // Expiry prevents more execution; it does not erase an unconsumed valid
      // result. A delayed active parent must retain the chance to publish it.
      if (parentActive && run?.status === 'success')
        return defer('dawn_cleanup_parent_active');
      if (run && !TERMINAL.has(run.status)) {
        try {
          await client.interrupt(threadId, run.runId, signal);
        } catch (error) {
          signal.throwIfAborted();
          if (!deadline) throw error;
        }
        if (!deadline) return defer('dawn_cleanup_waiting_terminal');
      }
      // At the deadline cleanup no longer depends on a surviving claim writer.
      // This policy is not evidence that the claim has settled.
      const claim = deadline ? null : await d.readClaim(attemptId);
      const proof = job.payload['cleanup_quiescence'] as
        | { runId?: unknown; settledAt?: unknown }
        | undefined;
      const recordedProof =
        proof &&
        typeof proof.runId === 'string' &&
        UUID.test(proof.runId) &&
        typeof proof.settledAt === 'string' &&
        Number.isFinite(Date.parse(proof.settledAt));
      if (!deadline && !recordedProof && !settled(claim, attemptId, expiresAt))
        return defer('dawn_cleanup_writers_unsettled');
      if (!deadline && !run && !recordedProof)
        return defer('dawn_cleanup_terminal_unproven');
      if (
        recordedProof &&
        ((!deadline && claim && proof.settledAt !== claim.settledAt) ||
          (run && run.runId !== proof.runId))
      )
        return defer('dawn_cleanup_proof_conflict');
      if (!recordedProof && run && claim?.settledAt)
        await d.recordCleanupProof(db, {
          ...lease(),
          attemptId,
          threadId,
          runId: run.runId,
          settledAt: claim.settledAt,
        });
      const observedAt = job.payload['cleanup_absent_at'];
      const priorAbsence =
        typeof observedAt === 'string' &&
        Number.isFinite(Date.parse(observedAt));
      const reappeared =
        priorAbsence && !(await client.threadAbsent(threadId, signal));
      if (reappeared)
        await d.recordCleanupAbsence(db, {
          ...lease(),
          attemptId,
          threadId,
          absent: false,
        });
      await client.deleteThread(threadId, signal);
      if (!(await client.threadAbsent(threadId, signal))) {
        await d.recordCleanupAbsence(db, {
          ...lease(),
          attemptId,
          threadId,
          absent: false,
        });
        return defer('dawn_cleanup_thread_present');
      }
      if (!priorAbsence || reappeared) {
        await d.recordCleanupAbsence(db, { ...lease(), attemptId, threadId });
        return defer('dawn_cleanup_confirm_absence', 60000);
      }
      if (d.now().getTime() - Date.parse(observedAt) < 60000)
        return defer('dawn_cleanup_confirm_absence', 60000);
      checkingTraces = true;
      if (!(await d.tracesAbsent(attemptId))) {
        await d.deleteTraces(attemptId);
        // Trace deletion is asynchronous and can queue for days. Keep fast
        // execution reconciliation separate from this hourly absence check.
        return defer('dawn_cleanup_traces_present', 3600000);
      }
      if (parentActive) return defer('dawn_cleanup_parent_active');
      await d.finishCleanup(db, { ...lease(), attemptId, threadId });
      return 'completed';
    } catch (error) {
      if (error instanceof JobLeaseConflictError) return 'cancelled';
      signal.throwIfAborted();
      return defer(
        'dawn_cleanup_reconciliation_required',
        checkingTraces ? 3600000 : 15000
      );
    }
  };
  return { enrich, research_cleanup };
}
