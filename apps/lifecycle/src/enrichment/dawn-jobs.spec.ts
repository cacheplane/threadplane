import { describe, it, expect, vi } from 'vitest';
import type { GrowthJob, SqlExecutor } from '../growth.js';
import {
  createDawnJobHandlers,
  type DawnJobDependencies,
} from './dawn-jobs.js';
// eslint-disable-next-line @nx/enforce-module-boundaries -- exercise the identical managed wire hash
import { hashCompanyEvidence } from '../../../growth-research/src/production/contracts.js';
import { createLifecycleAppJobHandlers } from '../campaign/send.js';

const now = new Date('2026-09-05T00:00:00Z');
const attemptId = '650e8400-e29b-41d4-a716-446655440000',
  threadId = '550e8400-e29b-41d4-a716-446655440000',
  runId = '750e8400-e29b-41d4-a716-446655440000';
const pages = [
  {
    canonicalUrl: 'https://example.com/',
    retrievedAt: now.toISOString(),
    contentHash: 'a'.repeat(64),
    facts: ['Example builds test software.'],
    snippets: [],
  },
];
const request = {
  version: 'company_research.request.v1',
  attemptId,
  domain: 'example.com',
  pages,
  evidenceHash: hashCompanyEvidence('example.com', pages),
  expiresAt: new Date(now.getTime() + 90000).toISOString(),
  generationRef: 'fixture',
};
const attempt = {
  attemptId,
  threadId,
  companyDomain: 'example.com',
  evidenceHash: request.evidenceHash,
  expiresAt: request.expiresAt,
  runId,
  phase: 'submitted' as const,
};
const job = {
  id: '850e8400-e29b-41d4-a716-446655440000',
  kind: 'enrich',
  contactId: threadId,
  status: 'leased',
  leaseToken: threadId,
  payload: {},
} as GrowthJob;
const db = {} as SqlExecutor;
function fixture() {
  const events: string[] = [];
  const client = {
    ensureThread: vi.fn(async () => {
      events.push('thread');
    }),
    submit: vi.fn(async () => {
      events.push('post');
      return { runId, status: 'pending' };
    }),
    findRun: vi.fn().mockResolvedValue({ runId, status: 'success' }),
    result: vi.fn().mockResolvedValue({}),
    interrupt: vi.fn(),
    deleteThread: vi.fn(),
    threadAbsent: vi.fn().mockResolvedValue(true),
  };
  const deps = {
    now: () => now,
    uuid: () => attemptId,
    capture: vi.fn().mockResolvedValue(pages),
    refreshScore: vi.fn(async () => {
      events.push('score');
    }),
    client: () => client,
    readDomain: vi.fn().mockResolvedValue('example.com'),
    begin: vi.fn(async () => {
      events.push('begin');
      return {
        attempt: { ...attempt, runId: null, phase: 'prepared' },
        researchInput: request,
        created: true,
      };
    }),
    fence: vi.fn(async () => {
      events.push('fence');
      return { claimed: true };
    }),
    acknowledge: vi.fn(async () => {
      events.push('ack');
    }),
    publish: vi.fn(),
    complete: vi.fn(),
    fail: vi.fn(),
    cancel: vi.fn(),
    defer: vi.fn(),
    readClaim: vi.fn().mockResolvedValue({
      attemptId,
      expiresAt: request.expiresAt,
      settledAt: now.toISOString(),
    }),
    parentActive: vi.fn().mockResolvedValue(false),
    artifact: vi.fn().mockReturnValue({ profile: { name: 'Example' } }),
    deleteTraces: vi.fn(),
    tracesAbsent: vi.fn().mockResolvedValue(true),
    recordCleanupProof: vi.fn(),
    recordCleanupAbsence: vi.fn(),
    finishCleanup: vi.fn(),
  };
  return {
    deps,
    client,
    events,
    handlers: createDawnJobHandlers(
      () => deps as unknown as DawnJobDependencies
    ),
  };
}
describe('Dawn Growth job orchestration', () => {
  it('routes enabled or in-flight enrichment to Dawn without initializing the old generator', async () => {
    for (const enabled of [true, false]) {
      const { deps } = fixture();
      const legacy = vi.fn(() => {
        throw new Error('old generator initialized');
      });
      const handlers = createLifecycleAppJobHandlers(legacy, {
        environment: { GROWTH_DAWN_ENRICHMENT_ENABLED: String(enabled) },
        dawnDependenciesFactory: () => deps as unknown as DawnJobDependencies,
      });
      const target = enabled
        ? job
        : {
            ...job,
            payload: { research_attempt: attempt, research_input: request },
          };
      await handlers.enrich(db, target, {});
      expect(legacy).not.toHaveBeenCalled();
      expect(handlers.research_cleanup).toBeTypeOf('function');
    }
  });
  it('records snapshot and fences before exactly one paid submission', async () => {
    const { handlers, deps, events } = fixture();
    expect(await handlers.enrich(db, job, {})).toBe('deferred');
    expect(events).toEqual([
      'score',
      'begin',
      'thread',
      'fence',
      'post',
      'ack',
    ]);
    expect(deps.begin).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        researchInput: expect.objectContaining({
          pages,
          evidenceHash: request.evidenceHash,
        }),
      })
    );
    expect(deps.defer).toHaveBeenCalled();
  });
  it('skips missing domain and empty evidence without remote submission', async () => {
    for (const missing of [true, false]) {
      const { handlers, deps, client } = fixture();
      if (missing) deps.readDomain.mockResolvedValue(null as never);
      else deps.capture.mockResolvedValue([]);
      expect(await handlers.enrich(db, job, {})).toBe('completed');
      expect(client.submit).not.toHaveBeenCalled();
      expect(deps.begin).not.toHaveBeenCalled();
    }
  });
  it('reconciles ambiguous submission within its window without recapturing or reposting', async () => {
    const { handlers, deps, client } = fixture();
    client.submit.mockRejectedValueOnce(new Error('lost acknowledgement'));
    expect(await handlers.enrich(db, job, {})).toBe('deferred');
    client.findRun.mockResolvedValue(null);
    const recovery = {
      ...job,
      payload: {
        research_attempt: { ...attempt, runId: null, phase: 'submitting' },
        research_input: request,
      },
    };
    await handlers.enrich(db, recovery, {});
    await handlers.enrich(db, recovery, {});
    expect(client.submit).toHaveBeenCalledTimes(1);
    expect(deps.capture).toHaveBeenCalledTimes(1);
    expect(deps.fail).not.toHaveBeenCalled();
  });
  it('keeps expired empty lookups ambiguous without ever submitting again', async () => {
    const { handlers, deps, client } = fixture();
    deps.now = () => new Date(now.getTime() + 100000);
    client.findRun.mockResolvedValue(null);
    deps.readClaim.mockResolvedValue(null);
    expect(
      await handlers.enrich(
        db,
        {
          ...job,
          payload: {
            research_attempt: { ...attempt, runId: null, phase: 'submitting' },
            research_input: request,
          },
        },
        {}
      )
    ).toBe('deferred');
    expect(client.submit).not.toHaveBeenCalled();
    expect(deps.fail).not.toHaveBeenCalled();
  });
  it('revalidates against original snapshot only after a settled claim and publishes under lease', async () => {
    const { handlers, deps, client } = fixture();
    expect(
      await handlers.enrich(
        db,
        {
          ...job,
          payload: { research_attempt: attempt, research_input: request },
        },
        {}
      )
    ).toBe('completed');
    expect(deps.capture).not.toHaveBeenCalled();
    expect(client.submit).not.toHaveBeenCalled();
    expect(deps.artifact).toHaveBeenCalledWith(
      request,
      {},
      { threadId, runId }
    );
    expect(deps.publish).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        attemptId,
        companyDomain: 'example.com',
        evidenceHash: request.evidenceHash,
      })
    );
  });
  it('does not publish terminal success while the execution claim is unsettled', async () => {
    const { handlers, deps } = fixture();
    deps.readClaim.mockResolvedValue({ ...attempt, settledAt: null });
    expect(
      await handlers.enrich(
        db,
        {
          ...job,
          payload: { research_attempt: attempt, research_input: request },
        },
        {}
      )
    ).toBe('deferred');
    expect(deps.publish).not.toHaveBeenCalled();
  });
  it('rejects invalid remote candidates without publication', async () => {
    const { handlers, deps } = fixture();
    deps.artifact.mockImplementation(() => {
      throw new Error('invalid');
    });
    expect(
      await handlers.enrich(
        db,
        {
          ...job,
          payload: { research_attempt: attempt, research_input: request },
        },
        {}
      )
    ).toBe('failed');
    expect(deps.publish).not.toHaveBeenCalled();
  });
  const cleanup = {
    ...job,
    kind: 'research_cleanup',
    contactId: null,
    payload: { attemptId, threadId, runId, expiresAt: request.expiresAt },
  };
  const observedCleanup = {
    ...cleanup,
    payload: {
      ...cleanup.payload,
      cleanup_absent_at: new Date(now.getTime() - 60000).toISOString(),
    },
  };
  it('fails lost acknowledgement and transient lookup errors at expiry plus five minutes without reposting', async () => {
    for (const unavailable of [false, true]) {
      const { handlers, deps, client } = fixture();
      deps.now = () => new Date(Date.parse(request.expiresAt) + 300000);
      if (unavailable) client.findRun.mockRejectedValue(new Error('offline'));
      else client.findRun.mockResolvedValue(null);
      expect(
        await handlers.enrich(
          db,
          {
            ...job,
            payload: {
              research_attempt: {
                ...attempt,
                phase: 'submitting',
                runId: null,
              },
              research_input: request,
            },
          },
          {}
        )
      ).toBe('failed');
      expect(client.submit).not.toHaveBeenCalled();
      expect(deps.fail).toHaveBeenCalledWith(
        db,
        expect.objectContaining({ errorCode: 'dawn_recovery_deadline' })
      );
    }
  });
  it('deletes unresolved expired state without claiming settlement and confirms absence on a later tick', async () => {
    const { handlers, deps, client } = fixture();
    const deadline = new Date(Date.parse(request.expiresAt) + 300000);
    deps.now = () => deadline;
    client.findRun.mockResolvedValue(null);
    deps.readClaim.mockResolvedValue(null);
    expect(await handlers.research_cleanup(db, cleanup, {})).toBe('deferred');
    expect(client.deleteThread).toHaveBeenCalledWith(
      threadId,
      expect.any(AbortSignal)
    );
    expect(deps.recordCleanupProof).not.toHaveBeenCalled();
    expect(deps.recordCleanupAbsence).toHaveBeenCalled();
    expect(deps.finishCleanup).not.toHaveBeenCalled();
    deps.now = () => new Date(deadline.getTime() + 60000);
    const observed = {
      ...cleanup,
      payload: {
        ...cleanup.payload,
        cleanup_absent_at: deadline.toISOString(),
      },
    };
    expect(await handlers.research_cleanup(db, observed, {})).toBe('completed');
    expect(deps.finishCleanup).toHaveBeenCalled();
  });
  it('stops unresolved cleanup after seven days with visible failure', async () => {
    const { handlers, deps, client } = fixture();
    deps.now = () => new Date(Date.parse(request.expiresAt) + 7 * 86400000);
    expect(await handlers.research_cleanup(db, cleanup, {})).toBe('failed');
    expect(deps.finishCleanup).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        status: 'failed',
        errorCode: 'dawn_cleanup_horizon_exceeded',
      })
    );
    expect(client.deleteThread).not.toHaveBeenCalled();
  });
  it('never interprets an expired empty run/claim lookup as permission to delete remote state', async () => {
    const { handlers, deps, client } = fixture();
    deps.now = () => new Date(now.getTime() + 100000);
    client.findRun.mockResolvedValue(null);
    deps.readClaim.mockResolvedValue(null);
    client.threadAbsent.mockResolvedValue(false);
    expect(await handlers.research_cleanup(db, cleanup, {})).toBe('deferred');
    expect(client.deleteThread).not.toHaveBeenCalled();
    expect(deps.complete).not.toHaveBeenCalled();
    expect(deps.recordCleanupProof).not.toHaveBeenCalled();
  });
  it('records quiescence before DELETE and resumes trace cleanup from durable proof after thread removal', async () => {
    const { handlers, deps, client, events } = fixture();
    deps.recordCleanupProof.mockImplementation(async () => {
      events.push('proof');
    });
    client.deleteThread.mockImplementation(async () => {
      events.push('delete');
    });
    await handlers.research_cleanup(db, cleanup, {});
    expect(events.indexOf('proof')).toBeLessThan(events.indexOf('delete'));
    client.findRun.mockResolvedValue(null);
    const proved = {
      ...cleanup,
      payload: {
        ...cleanup.payload,
        cleanup_quiescence: { runId, settledAt: now.toISOString() },
        cleanup_absent_at: now.toISOString(),
      },
    };
    deps.now = () => new Date(now.getTime() + 60000);
    expect(await handlers.research_cleanup(db, proved, {})).toBe('completed');
  });
  it('preserves a successful result for an active parent even after execution expiry', async () => {
    const { handlers, deps, client } = fixture();
    deps.now = () => new Date(now.getTime() + 100000);
    deps.parentActive.mockResolvedValue(true);
    expect(await handlers.research_cleanup(db, cleanup, {})).toBe('deferred');
    expect(client.deleteThread).not.toHaveBeenCalled();
    expect(deps.deleteTraces).not.toHaveBeenCalled();
  });
  it('never equates interrupted remote status with quiescence', async () => {
    const { handlers, deps, client } = fixture();
    client.findRun.mockResolvedValue({ runId, status: 'interrupted' });
    deps.readClaim.mockResolvedValue({ ...attempt, settledAt: null });
    expect(await handlers.research_cleanup(db, cleanup, {})).toBe('deferred');
    expect(client.deleteThread).not.toHaveBeenCalled();
  });
  it('waits for active parents and interrupts unfinished runs only when cleanup is eligible', async () => {
    const { handlers, deps, client } = fixture();
    deps.parentActive.mockResolvedValue(true);
    client.findRun.mockResolvedValue({ runId, status: 'running' });
    expect(await handlers.research_cleanup(db, cleanup, {})).toBe('deferred');
    expect(client.interrupt).not.toHaveBeenCalled();
    deps.parentActive.mockResolvedValue(false);
    expect(await handlers.research_cleanup(db, cleanup, {})).toBe('deferred');
    expect(client.interrupt).toHaveBeenCalled();
    expect(client.deleteThread).not.toHaveBeenCalled();
  });
  it('verifies thread and independent trace absence before completing cleanup', async () => {
    const { handlers, deps, client } = fixture();
    deps.tracesAbsent.mockResolvedValue(false);
    expect(await handlers.research_cleanup(db, observedCleanup, {})).toBe(
      'deferred'
    );
    expect(deps.defer).toHaveBeenLastCalledWith(
      db,
      expect.objectContaining({
        errorCode: 'dawn_cleanup_traces_present',
        availableAt: new Date(now.getTime() + 3600000),
      })
    );
    expect(deps.complete).not.toHaveBeenCalled();
    deps.tracesAbsent.mockResolvedValue(true);
    expect(await handlers.research_cleanup(db, observedCleanup, {})).toBe(
      'completed'
    );
    expect(client.deleteThread).toHaveBeenCalled();
    expect(client.threadAbsent).toHaveBeenCalled();
    expect(deps.deleteTraces).toHaveBeenCalledWith(attemptId);
  });
  it('does not submit a trace deletion request when exact trace absence is already verified', async () => {
    const { handlers, deps } = fixture();
    expect(await handlers.research_cleanup(db, observedCleanup, {})).toBe(
      'completed'
    );
    expect(deps.tracesAbsent).toHaveBeenCalledWith(attemptId);
    expect(deps.deleteTraces).not.toHaveBeenCalled();
  });
  it('keeps cleanup retryable when trace deletion is unavailable without affecting parent success', async () => {
    const { handlers, deps } = fixture();
    expect(
      await handlers.enrich(
        db,
        {
          ...job,
          payload: { research_attempt: attempt, research_input: request },
        },
        {}
      )
    ).toBe('completed');
    deps.complete.mockClear();
    deps.tracesAbsent.mockResolvedValue(false);
    deps.deleteTraces.mockRejectedValue(
      new Error('trace configuration unavailable')
    );
    expect(await handlers.research_cleanup(db, observedCleanup, {})).toBe(
      'deferred'
    );
    expect(deps.complete).not.toHaveBeenCalled();
    expect(deps.fail).not.toHaveBeenCalled();
    expect(deps.defer).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        errorCode: 'dawn_cleanup_reconciliation_required',
        availableAt: new Date(now.getTime() + 3600000),
      })
    );
  });
  it('cancels a remaining run at the recovery deadline even without settled writers', async () => {
    const { handlers, deps, client } = fixture();
    deps.now = () => new Date(Date.parse(request.expiresAt) + 300000);
    client.findRun.mockResolvedValue({ runId, status: 'running' });
    deps.readClaim.mockResolvedValue(null);
    expect(await handlers.research_cleanup(db, cleanup, {})).toBe('deferred');
    expect(client.interrupt).toHaveBeenCalled();
    expect(client.deleteThread).toHaveBeenCalled();
    expect(deps.recordCleanupProof).not.toHaveBeenCalled();
  });
  it('restarts the absence confirmation when a thread reappears', async () => {
    const { handlers, deps, client } = fixture();
    client.threadAbsent.mockResolvedValueOnce(false).mockResolvedValue(true);
    expect(await handlers.research_cleanup(db, observedCleanup, {})).toBe(
      'deferred'
    );
    expect(deps.recordCleanupAbsence).toHaveBeenCalled();
    expect(deps.finishCleanup).not.toHaveBeenCalled();
  });
  it('does not let a broken run listing block deadline cleanup after the parent is terminal', async () => {
    const { handlers, deps, client } = fixture();
    deps.now = () => new Date(Date.parse(request.expiresAt) + 300000);
    client.findRun.mockRejectedValue(new Error('offline'));
    expect(await handlers.research_cleanup(db, cleanup, {})).toBe('deferred');
    expect(client.interrupt).toHaveBeenCalledWith(
      threadId,
      runId,
      expect.any(AbortSignal)
    );
    expect(client.deleteThread).toHaveBeenCalled();
  });
  it('clears the old absence timestamp even when deletion still leaves the thread present', async () => {
    const { handlers, deps, client } = fixture();
    client.threadAbsent.mockResolvedValue(false);
    expect(await handlers.research_cleanup(db, observedCleanup, {})).toBe(
      'deferred'
    );
    expect(deps.recordCleanupAbsence).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ absent: false })
    );
    expect(deps.finishCleanup).not.toHaveBeenCalled();
  });
  it('deletes at the deadline even when cancellation fails for an already missing run', async () => {
    const { handlers, deps, client } = fixture();
    deps.now = () => new Date(Date.parse(request.expiresAt) + 300000);
    client.findRun.mockRejectedValue(new Error('offline'));
    client.interrupt.mockRejectedValue(new Error('404'));
    expect(await handlers.research_cleanup(db, cleanup, {})).toBe('deferred');
    expect(client.deleteThread).toHaveBeenCalled();
    expect(deps.recordCleanupAbsence).toHaveBeenCalled();
    expect(deps.finishCleanup).not.toHaveBeenCalled();
  });

  // Production defect: every runaway job had no research_attempt in its payload,
  // so the expiresAt deadline never applied and the job deferred every fifteen
  // seconds indefinitely (four jobs reached ~2,400 attempts over six days).
  const reconciling = (attempts: number) => {
    const f = fixture();
    f.deps.readDomain.mockRejectedValue(new Error('offline'));
    return {
      ...f,
      run: () => f.handlers.enrich(db, { ...job, payload: {}, attempts }, {}),
    };
  };
  const deferredDelay = (deps: { defer: ReturnType<typeof vi.fn> }) =>
    (
      deps.defer.mock.calls.at(-1)?.[1] as { availableAt: Date }
    ).availableAt.getTime() - now.getTime();
  it('backs reconciliation off exponentially when the payload carries no attempt deadline', async () => {
    const first = reconciling(0);
    expect(await first.run()).toBe('deferred');
    expect(first.deps.fail).not.toHaveBeenCalled();
    const second = reconciling(3);
    expect(await second.run()).toBe('deferred');
    const ceiling = reconciling(9);
    expect(await ceiling.run()).toBe('deferred');
    const a = deferredDelay(first.deps),
      b = deferredDelay(second.deps),
      c = deferredDelay(ceiling.deps);
    expect(a).toBe(15000);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(c).toBeLessThanOrEqual(15 * 60000);
  });
  it('fails reconciliation for manual review once the attempt cap is reached', async () => {
    const capped = reconciling(20);
    expect(await capped.run()).toBe('failed');
    expect(capped.deps.defer).not.toHaveBeenCalled();
    expect(capped.deps.fail).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ errorCode: 'dawn_reconciliation_exhausted' })
    );
  });
});
