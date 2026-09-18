import {
  createUnsubscribeActionUrl,
  dispatchGrowthLeasedJob,
  reconcilePendingResendMessageIds,
  type GrowthJob,
  type SqlExecutor,
} from '@threadplane-internal/growth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import middleware from './middleware.js';
import {
  createLifecycleVercelAdapter,
  type DawnFetchApp,
} from './vercel-adapter.js';
import {
  dispatchLifecycleJobs,
  type LifecycleDispatcherDependencies,
} from './dispatcher.js';
import {
  createLifecycleAppJobHandlers,
  type LifecycleJobDependencies,
} from './campaign/send.js';

const NOW = new Date('2026-09-01T12:00:00.000Z');
const EMAIL_KEYRING = {
  active: { version: 1, secret: 'dispatcher-email-test-secret-material' },
};

afterEach(() => vi.useRealTimers());

function leasedJob(id: string, kind = 'reply_reconcile'): GrowthJob {
  return {
    id,
    kind,
    contactId: null,
    projectId: null,
    status: 'leased',
    availableAt: NOW,
    leaseUntil: new Date(NOW.getTime() + 60_000),
    leaseToken: '00000000-0000-4000-8000-000000000099',
    attempts: 1,
    idempotencyKey: `test:${id}`,
    payload: {},
    providerEmailId: null,
    rfcMessageId: null,
    gmailSeedMessageId: null,
    deliveryStatus: 'not_submitted',
    lastErrorCode: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function dependencies(
  overrides: Partial<LifecycleDispatcherDependencies> = {}
): LifecycleDispatcherDependencies {
  const executor = {
    execute: vi.fn(),
    transaction: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as SqlExecutor;
  return {
    appHandlers: {},
    createDatabase: vi.fn(() => executor),
    dispatchLeasedJob: vi.fn().mockResolvedValue('completed'),
    isRecoveryPaused: vi.fn().mockResolvedValue(false),
    reconcileMessageIds: vi.fn().mockResolvedValue({ attempted: 0, bound: 0 }),
    leaseDueJobs: vi.fn().mockResolvedValue([]),
    loadEmailKeyring: vi.fn(() => EMAIL_KEYRING),
    processInstallRuntimeActivations: vi.fn().mockResolvedValue({
      approved: 0,
      ineligible: 0,
      conflicted: 0,
      disabled: false,
    }),
    materializeCampaignEnrollment: vi.fn().mockResolvedValue({
      enrolledContactIds: [],
      createdJobs: 0,
    }),
    enqueueInstallDigestJob: vi.fn().mockResolvedValue(null),
    processObservations: vi.fn().mockResolvedValue({
      completed: 0,
      leaseLost: 0,
      retryScheduled: 0,
      failed: 0,
      disabled: false,
    }),
    projectFormObservations: vi
      .fn()
      .mockResolvedValue({ projected: 0, disabled: false }),
    now: vi.fn(() => NOW),
    renewJobLease: vi
      .fn()
      .mockImplementation(async (_executor, input) => leasedJob(input.jobId)),
    quarantineJob: vi
      .fn()
      .mockImplementation(async (_executor, input) => leasedJob(input.jobId)),
    clearTimeout,
    setTimeout,
    ...overrides,
  };
}

describe('Dawn lifecycle service authorization', () => {
  beforeEach(() =>
    vi.stubEnv('DAWN_DATABASE_URL', 'postgres://dawn.test/runtime')
  );
  afterEach(() => vi.unstubAllEnvs());

  it.each([undefined, '', '   '])(
    'rejects absent Dawn database binding: %s',
    async (databaseUrl) => {
      vi.stubEnv('DAWN_DATABASE_URL', databaseUrl);
      vi.stubEnv('DATABASE_URL', 'postgres://growth.test/control');
      const fetch = vi.fn();
      const adapter = createLifecycleVercelAdapter({ fetch }, () => 'secret');
      const response = await adapter.fetch(
        new Request('https://lifecycle.test/healthz', {
          headers: { authorization: 'Bearer secret' },
        })
      );
      expect(response.status).toBe(503);
      expect(fetch).not.toHaveBeenCalled();
    }
  );
  it.each([undefined, '', 'Bearer wrong', 'bearer service-secret'])(
    'rejects a missing or wrong route-middleware token: %s',
    async (authorization) => {
      vi.stubEnv('LIFECYCLE_SERVICE_SECRET', 'service-secret');
      const result = await middleware({
        assistantId: '/dispatch#workflow',
        headers: authorization ? { authorization } : {},
        method: 'POST',
        params: {},
        routeId: '/dispatch',
        url: '/threads/id/runs/wait',
      });
      expect(result).toMatchObject({ action: 'reject', status: 401 });
      vi.unstubAllEnvs();
    }
  );

  it('allows only the exact service bearer token in route middleware', async () => {
    vi.stubEnv('LIFECYCLE_SERVICE_SECRET', 'service-secret');
    expect(
      await middleware({
        assistantId: '/dispatch#workflow',
        headers: { authorization: 'Bearer service-secret' },
        method: 'POST',
        params: {},
        routeId: '/dispatch',
        url: '/threads/id/runs/wait',
      })
    ).toMatchObject({ action: 'continue' });
    vi.unstubAllEnvs();
  });

  it.each([
    '/healthz',
    '/threads',
    '/threads/id',
    '/threads/id/state',
    '/threads/id/cancel',
    '/threads/id/runs/wait',
    '/agui/%2Fdispatch%23workflow',
    '/memory/candidates',
  ])('outer adapter rejects %s before Dawn receives it', async (pathname) => {
    const fetch = vi.fn().mockResolvedValue(new Response('delegated'));
    const app: DawnFetchApp = { fetch };
    const adapter = createLifecycleVercelAdapter(app, () => 'service-secret');

    const response = await adapter.fetch(
      new Request(`https://lifecycle.test${pathname}`)
    );

    expect(response.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    '/healthz',
    '/threads',
    '/threads/id',
    '/threads/id/state',
    '/threads/id/cancel',
    '/threads/id/runs/wait',
    '/agui/%2Fdispatch%23workflow',
    '/memory/candidates',
  ])(
    'outer adapter preserves %s through the native Vercel catch-all',
    async (pathname) => {
      const fetch = vi.fn().mockResolvedValue(new Response('healthy'));
      const adapter = createLifecycleVercelAdapter({ fetch }, () => 'secret');
      const request = new Request(`https://lifecycle.test${pathname}?probe=1`, {
        headers: { authorization: 'Bearer secret' },
      });

      const response = await adapter.fetch(request);

      expect(await response.text()).toBe('healthy');
      expect(fetch).toHaveBeenCalledWith(request, {
        DATABASE_URL: 'postgres://dawn.test/runtime',
      });
      const delegated = fetch.mock.calls[0]?.[0];
      expect(delegated).toBe(request);
      expect(new URL(delegated?.url ?? '').pathname).toBe(pathname);
      expect(new URL(delegated?.url ?? '').search).toBe('?probe=1');
    }
  );

  it('outer adapter delegates the original public request', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('healthy'));
    const adapter = createLifecycleVercelAdapter({ fetch }, () => 'secret');
    const request = new Request('https://lifecycle.test/healthz', {
      headers: { authorization: 'Bearer secret' },
    });

    const response = await adapter.fetch(request);

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledOnce();
    expect(new URL(fetch.mock.calls[0]?.[0]?.url ?? '').pathname).toBe(
      '/healthz'
    );
  });

  it('outer adapter rejects a wrong bearer token before delegation', async () => {
    const fetch = vi.fn();
    const adapter = createLifecycleVercelAdapter({ fetch }, () => 'secret');
    const response = await adapter.fetch(
      new Request('https://lifecycle.test/healthz', {
        headers: { authorization: 'Bearer wrong' },
      })
    );
    expect(response.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('exposes the Vercel deployment id only on an authenticated health response', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ status: 'ready' }));
    const adapter = createLifecycleVercelAdapter(
      { fetch },
      () => 'secret',
      () => 'dpl_preview_a'
    );

    const response = await adapter.fetch(
      new Request('https://lifecycle.test/healthz', {
        headers: { authorization: 'Bearer secret' },
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('x-threadplane-deployment-id')).toBe(
      'dpl_preview_a'
    );
  });

  it('does not expose the Vercel deployment id before bearer authentication', async () => {
    const fetch = vi.fn();
    const readDeploymentId = vi.fn(() => 'dpl_preview_a');
    const adapter = createLifecycleVercelAdapter(
      { fetch },
      () => 'secret',
      readDeploymentId
    );

    const response = await adapter.fetch(
      new Request('https://lifecycle.test/healthz')
    );

    expect(response.status).toBe(401);
    expect(response.headers.has('x-threadplane-deployment-id')).toBe(false);
    expect(readDeploymentId).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('dispatchLifecycleJobs', () => {
  it('leases a bounded batch and routes every lease through the growth boundary', async () => {
    const jobs = Array.from({ length: 25 }, (_, index) =>
      leasedJob(`00000000-0000-4000-8000-${String(index).padStart(12, '0')}`)
    );
    const leaseDueJobs = vi.fn().mockResolvedValue(jobs);
    const dispatchLeasedJob = vi.fn().mockResolvedValue('completed');
    const deps = dependencies({ dispatchLeasedJob, leaseDueJobs });
    const signal = new AbortController().signal;

    const result = await dispatchLifecycleJobs(
      { batchSize: 25, campaignEnabled: false, signal },
      deps
    );

    expect(leaseDueJobs).toHaveBeenCalledWith(expect.anything(), {
      batchSize: 25,
      campaignEnabled: false,
      kinds: [
        'fulfill',
        'enrich',
        'notify',
        'send_step',
        'reply_reconcile',
        'research_cleanup',
        'digest',
      ],
      leaseDurationMs: 60_000,
      now: NOW,
    });
    expect(dispatchLeasedJob).toHaveBeenCalledTimes(25);
    for (const job of jobs) {
      expect(dispatchLeasedJob).toHaveBeenCalledWith(
        expect.anything(),
        job,
        expect.objectContaining({
          appHandlers: deps.appHandlers,
          signal: expect.any(AbortSignal),
        })
      );
    }
    expect(result).toMatchObject({ dispatched: 25, leased: 25 });
  });

  it('materializes the immutable cohort before leasing when enrollment is enabled', async () => {
    const materializeCampaignEnrollment = vi.fn().mockResolvedValue({
      enrolledContactIds: [],
      createdJobs: 0,
    });
    const leaseDueJobs = vi.fn().mockResolvedValue([]);
    const deps = dependencies({ materializeCampaignEnrollment, leaseDueJobs });
    const start = new Date('2026-09-01T11:00:00.000Z');

    await dispatchLifecycleJobs(
      {
        batchSize: 10,
        campaignEnabled: false,
        campaignEnrollmentEnabled: true,
        installRuntimeHelloEnabled: true,
        campaignEnrollmentStartAt: start,
        signal: new AbortController().signal,
      },
      deps
    );

    expect(materializeCampaignEnrollment).toHaveBeenCalledWith(
      expect.anything(),
      {
        enrollmentEnabled: true,
        enrollmentStartAt: start,
        now: NOW,
        batchSize: 10,
      }
    );
    expect(deps.loadEmailKeyring).toHaveBeenCalledOnce();
    expect(deps.processInstallRuntimeActivations).toHaveBeenCalledWith(
      expect.anything(),
      { enabled: true, limit: 10, now: NOW, keyring: EMAIL_KEYRING }
    );
    expect(
      vi.mocked(deps.processInstallRuntimeActivations).mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      materializeCampaignEnrollment.mock.invocationCallOrder[0] ?? 0
    );
    expect(
      materializeCampaignEnrollment.mock.invocationCallOrder[0]
    ).toBeLessThan(
      leaseDueJobs.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
    );
  });

  it.each([undefined, false])(
    'keeps form and claim enrollment working without new keys when hello rollout is %s',
    async (installRuntimeHelloEnabled) => {
      const deps = dependencies({
        loadEmailKeyring: vi.fn(() => {
          throw new Error('new HMAC keys are not configured');
        }),
      });
      await expect(
        dispatchLifecycleJobs(
          {
            batchSize: 10,
            campaignEnabled: true,
            campaignEnrollmentEnabled: true,
            installRuntimeHelloEnabled,
            campaignEnrollmentStartAt: NOW,
            signal: new AbortController().signal,
          },
          deps
        )
      ).resolves.toMatchObject({ leased: 0 });
      expect(deps.materializeCampaignEnrollment).toHaveBeenCalledOnce();
      expect(deps.leaseDueJobs).toHaveBeenCalledOnce();
      expect(deps.loadEmailKeyring).not.toHaveBeenCalled();
      expect(deps.processInstallRuntimeActivations).not.toHaveBeenCalled();
    }
  );

  it('enqueues the install digest once per Pacific business day when enabled', async () => {
    const enqueueInstallDigestJob = vi
      .fn()
      .mockResolvedValue('00000000-0000-4000-8000-00000000d1e5');
    // 2026-09-16T15:00Z is Wednesday 08:00 Pacific.
    const now = new Date('2026-09-16T15:00:00.000Z');
    const deps = dependencies({
      enqueueInstallDigestJob,
      now: vi.fn(() => now),
    });
    await dispatchLifecycleJobs(
      {
        batchSize: 25,
        campaignEnabled: false,
        installDigestEnabled: true,
        signal: new AbortController().signal,
      },
      deps
    );
    expect(enqueueInstallDigestJob).toHaveBeenCalledWith(expect.anything(), {
      now,
      idempotencyKey: 'install_digest:2026-09-16',
      businessDate: '2026-09-16',
      keyring: EMAIL_KEYRING,
    });
  });

  it('does not enqueue the install digest on weekends or when disabled', async () => {
    const enqueueInstallDigestJob = vi.fn();
    // 2026-09-19T15:00Z is Saturday 08:00 Pacific.
    const saturday = new Date('2026-09-19T15:00:00.000Z');
    await dispatchLifecycleJobs(
      {
        batchSize: 25,
        campaignEnabled: false,
        installDigestEnabled: true,
        signal: new AbortController().signal,
      },
      dependencies({ enqueueInstallDigestJob, now: vi.fn(() => saturday) })
    );
    await dispatchLifecycleJobs(
      {
        batchSize: 25,
        campaignEnabled: false,
        signal: new AbortController().signal,
      },
      dependencies({ enqueueInstallDigestJob, now: vi.fn(() => NOW) })
    );
    expect(enqueueInstallDigestJob).not.toHaveBeenCalled();
  });

  it('does no enrollment work when enrollment is disabled', async () => {
    const deps = dependencies();

    await dispatchLifecycleJobs(
      {
        batchSize: 10,
        campaignEnabled: true,
        campaignEnrollmentEnabled: false,
        installRuntimeHelloEnabled: true,
        signal: new AbortController().signal,
      },
      deps
    );

    expect(deps.materializeCampaignEnrollment).not.toHaveBeenCalled();
    expect(deps.processInstallRuntimeActivations).not.toHaveBeenCalled();
    expect(deps.loadEmailKeyring).not.toHaveBeenCalled();
  });

  it('stops before enrollment and leasing if activation processing is cancelled', async () => {
    const controller = new AbortController();
    const deps = dependencies({
      processInstallRuntimeActivations: vi.fn().mockImplementation(async () => {
        controller.abort(new Error('activation cancelled'));
        return { approved: 0, ineligible: 0, conflicted: 0, disabled: false };
      }),
    });
    await expect(
      dispatchLifecycleJobs(
        {
          batchSize: 10,
          campaignEnabled: true,
          campaignEnrollmentEnabled: true,
          installRuntimeHelloEnabled: true,
          campaignEnrollmentStartAt: NOW,
          signal: controller.signal,
        },
        deps
      )
    ).rejects.toThrow('activation cancelled');
    expect(deps.materializeCampaignEnrollment).not.toHaveBeenCalled();
    expect(deps.leaseDueJobs).not.toHaveBeenCalled();
    expect(deps.createDatabase().close).toHaveBeenCalledOnce();
  });

  it.each([0, 26, 1.5])(
    'rejects an unsafe batch size: %s',
    async (batchSize) => {
      await expect(
        dispatchLifecycleJobs(
          {
            batchSize,
            campaignEnabled: false,
            signal: new AbortController().signal,
          },
          dependencies()
        )
      ).rejects.toThrow(/batchSize/u);
    }
  );

  it('recovers expired leases through the canonical lease query parameters', async () => {
    const expired = leasedJob('00000000-0000-4000-8000-000000000001');
    expired.leaseUntil = new Date(NOW.getTime() - 1);
    const leaseDueJobs = vi.fn().mockResolvedValue([expired]);
    const deps = dependencies({ leaseDueJobs });

    await dispatchLifecycleJobs(
      {
        batchSize: 1,
        campaignEnabled: false,
        signal: new AbortController().signal,
      },
      deps
    );

    expect(leaseDueJobs).toHaveBeenCalledOnce();
    expect(deps.dispatchLeasedJob).toHaveBeenCalledWith(
      expect.anything(),
      expired,
      expect.anything()
    );
  });

  it('propagates Dawn AbortSignal and stops before another effect', async () => {
    const controller = new AbortController();
    const first = leasedJob('00000000-0000-4000-8000-000000000001');
    const second = leasedJob('00000000-0000-4000-8000-000000000002');
    const dispatchLeasedJob = vi.fn().mockImplementation(async () => {
      controller.abort(new Error('cancelled by Dawn'));
      return 'completed';
    });
    const deps = dependencies({
      dispatchLeasedJob,
      leaseDueJobs: vi.fn().mockResolvedValue([first, second]),
    });

    await expect(
      dispatchLifecycleJobs(
        { batchSize: 2, campaignEnabled: false, signal: controller.signal },
        deps
      )
    ).rejects.toThrow('cancelled by Dawn');
    expect(dispatchLeasedJob).toHaveBeenCalledTimes(1);
    expect(deps.quarantineJob).not.toHaveBeenCalled();
  });

  it('quarantines a real corrupt app job and continues through the real dispatch boundary', async () => {
    const contactId = '00000000-0000-4000-8000-000000000777';
    const poison = leasedJob('00000000-0000-4000-8000-000000000001', 'fulfill');
    poison.contactId = contactId;
    poison.payload = {
      form_kind: 'whitepaper',
      paper: 'corrupt-paper',
      submission_id: '00000000-0000-4000-8000-000000000011',
    };
    const healthy = leasedJob(
      '00000000-0000-4000-8000-000000000002',
      'fulfill'
    );
    healthy.contactId = contactId;
    healthy.payload = {
      form_kind: 'whitepaper',
      paper: 'chat',
      submission_id: '00000000-0000-4000-8000-000000000012',
    };
    const unsubscribeUrl = createUnsubscribeActionUrl(
      { contactId, issuedAt: NOW },
      { version: 1, secret: 'dispatcher-real-handler-token-secret-material' },
      'https://website.test'
    );
    const sendRecipient = vi.fn().mockResolvedValue({
      accepted: true,
      providerEmailId: 'provider-healthy',
    });
    const appDependencies = {
      now: () => NOW,
      readJobContext: vi.fn().mockResolvedValue({
        contactId,
        displayName: 'Ada',
        companyName: null,
        companyDomain: null,
        emailClassification: 'work',
        formSubmission: {},
        enrollmentAt: null,
        enrichmentArtifact: null,
      }),
      createUnsubscribeUrl: vi.fn(() => unsubscribeUrl),
      sendRecipient,
      recipientPolicy: {
        campaignEnabled: false,
        deliveryEnabled: true,
        environment: 'test',
        databaseEnvironment: 'test',
        senderVerified: true,
        verifiedDomain: 'threadplane.ai',
        configuredSender: 'Brian at Threadplane <brian@threadplane.ai>',
        providerTrackingDisabled: true,
        nonProductionRecipientAllowlist: ['brian@threadplane.ai'],
      },
      tokenKey: {
        version: 1,
        secret: 'dispatcher-real-handler-token-secret-material',
      },
    } as unknown as LifecycleJobDependencies;
    const quarantineJob = vi.fn().mockResolvedValue(poison);
    const deps = dependencies({
      appHandlers: createLifecycleAppJobHandlers(() => appDependencies),
      dispatchLeasedJob: dispatchGrowthLeasedJob,
      leaseDueJobs: vi.fn().mockResolvedValue([poison, healthy]),
      quarantineJob,
    });

    await expect(
      dispatchLifecycleJobs(
        {
          batchSize: 2,
          campaignEnabled: false,
          signal: new AbortController().signal,
        },
        deps
      )
    ).resolves.toMatchObject({ leased: 2, dispatched: 2 });
    expect(quarantineJob).toHaveBeenCalledWith(expect.anything(), {
      errorCode: 'deterministic_job_poison',
      jobId: poison.id,
      leaseToken: poison.leaseToken,
      now: NOW,
    });
    expect(sendRecipient).toHaveBeenCalledOnce();
    expect(sendRecipient).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ jobId: healthy.id }),
      appDependencies.recipientPolicy
    );
  });

  it('relies on leasing to make concurrent cron invocations effect-once', async () => {
    const job = leasedJob('00000000-0000-4000-8000-000000000001');
    let claimed = false;
    const leaseDueJobs = vi.fn().mockImplementation(async () => {
      if (claimed) return [];
      claimed = true;
      return [job];
    });
    const dispatchLeasedJob = vi.fn().mockResolvedValue('completed');
    const deps = dependencies({ dispatchLeasedJob, leaseDueJobs });
    const input = {
      batchSize: 10,
      campaignEnabled: false,
      signal: new AbortController().signal,
    };

    await Promise.all([
      dispatchLifecycleJobs(input, deps),
      dispatchLifecycleJobs(input, deps),
    ]);

    expect(dispatchLeasedJob).toHaveBeenCalledOnce();
  });

  it('renews active and waiting leases before an overlapping cron can reclaim them', async () => {
    vi.useFakeTimers({ now: NOW });
    const first = leasedJob('00000000-0000-4000-8000-000000000001');
    const second = leasedJob('00000000-0000-4000-8000-000000000002');
    let leaseUntil = NOW.getTime() + 60_000;
    let firstBatchClaimed = false;
    let releaseFirst!: () => void;
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const leaseDueJobs = vi.fn().mockImplementation(async () => {
      if (!firstBatchClaimed) {
        firstBatchClaimed = true;
        return [first, second];
      }
      return Date.now() >= leaseUntil ? [first, second] : [];
    });
    const renewJobLease = vi
      .fn()
      .mockImplementation(async (_executor, input) => {
        leaseUntil = Date.now() + input.leaseDurationMs;
        return leasedJob(input.jobId);
      });
    const dispatchLeasedJob = vi
      .fn()
      .mockImplementationOnce(async () => firstPending.then(() => 'completed'))
      .mockResolvedValue('completed');
    const deps = dependencies({
      dispatchLeasedJob,
      leaseDueJobs,
      now: () => new Date(Date.now()),
      renewJobLease,
    });
    const input = {
      batchSize: 2,
      campaignEnabled: false,
      signal: new AbortController().signal,
    };

    const firstRun = dispatchLifecycleJobs(input, deps);
    await vi.advanceTimersByTimeAsync(65_000);
    const overlap = await dispatchLifecycleJobs(input, deps);

    expect(overlap.leased).toBe(0);
    expect(renewJobLease).toHaveBeenCalledWith(expect.anything(), {
      jobId: first.id,
      leaseDurationMs: 60_000,
      leaseToken: first.leaseToken,
      now: expect.any(Date),
    });
    expect(renewJobLease).toHaveBeenCalledWith(expect.anything(), {
      jobId: second.id,
      leaseDurationMs: 60_000,
      leaseToken: second.leaseToken,
      now: expect.any(Date),
    });
    releaseFirst();
    await firstRun;
    vi.useRealTimers();
  });

  it('aborts dispatch and clears renewal timers when a lease cannot renew', async () => {
    vi.useFakeTimers({ now: NOW });
    const job = leasedJob('00000000-0000-4000-8000-000000000001');
    const renewJobLease = vi.fn().mockResolvedValue(null);
    const dispatchLeasedJob = vi.fn().mockImplementation(
      async (_executor, _job, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        })
    );
    const deps = dependencies({
      dispatchLeasedJob,
      leaseDueJobs: vi.fn().mockResolvedValue([job]),
      now: () => new Date(Date.now()),
      renewJobLease,
    });

    const run = dispatchLifecycleJobs(
      {
        batchSize: 1,
        campaignEnabled: false,
        signal: new AbortController().signal,
      },
      deps
    );
    const rejection = expect(run).rejects.toThrow(/lease renewal failed/u);
    await vi.advanceTimersByTimeAsync(20_000);
    await rejection;
    const renewalsAfterFailure = renewJobLease.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);

    expect(renewJobLease).toHaveBeenCalledOnce();
    expect(renewJobLease).toHaveBeenCalledTimes(renewalsAfterFailure);
    vi.useRealTimers();
  });

  it('surfaces a closed operator alert while still dispatching recovery-safe non-mail work', async () => {
    const enrich = leasedJob('00000000-0000-4000-8000-000000000001', 'enrich');
    const deps = dependencies({
      isRecoveryPaused: vi.fn().mockResolvedValue(true),
      leaseDueJobs: vi.fn().mockResolvedValue([enrich]),
    });

    const result = await dispatchLifecycleJobs(
      {
        batchSize: 10,
        campaignEnabled: true,
        signal: new AbortController().signal,
      },
      deps
    );

    expect(deps.leaseDueJobs).toHaveBeenCalledOnce();
    expect(deps.dispatchLeasedJob).toHaveBeenCalledWith(
      expect.anything(),
      enrich,
      expect.objectContaining({
        appHandlers: deps.appHandlers,
        signal: expect.any(AbortSignal),
      })
    );
    expect(result).toEqual({
      dispatched: 1,
      leased: 1,
      operatorAlerts: ['mailbox_recovery_required'],
      recoveryPaused: true,
    });
  });

  it('returns recovery_paused for an already leased reconciliation and resumes only after completion is observed', async () => {
    const job = leasedJob('00000000-0000-4000-8000-000000000001');
    const isRecoveryPaused = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const leaseDueJobs = vi
      .fn()
      .mockResolvedValueOnce([job])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([job]);
    const dispatchLeasedJob = vi
      .fn()
      .mockResolvedValueOnce('recovery_paused')
      .mockResolvedValueOnce('completed');
    const deps = dependencies({
      dispatchLeasedJob,
      isRecoveryPaused,
      leaseDueJobs,
    });
    const input = {
      batchSize: 1,
      campaignEnabled: true,
      signal: new AbortController().signal,
    };

    const first = await dispatchLifecycleJobs(input, deps);
    const paused = await dispatchLifecycleJobs(input, deps);
    const resumed = await dispatchLifecycleJobs(input, deps);

    expect(first.recoveryPaused).toBe(true);
    expect(paused.recoveryPaused).toBe(true);
    expect(resumed.recoveryPaused).toBe(false);
    expect(dispatchLeasedJob).toHaveBeenCalledTimes(2);
  });

  it('projects observations and form links before enrollment when the switch is on', async () => {
    const deps = dependencies();
    await dispatchLifecycleJobs(
      {
        batchSize: 10,
        campaignEnabled: true,
        campaignEnrollmentEnabled: true,
        campaignEnrollmentStartAt: NOW,
        observationProcessingEnabled: true,
        signal: new AbortController().signal,
      },
      deps
    );
    expect(deps.processObservations).toHaveBeenCalledOnce();
    expect(deps.processObservations).toHaveBeenCalledWith(expect.anything(), {
      enabled: true,
      limit: 10,
      now: deps.now,
    });
    expect(deps.projectFormObservations).toHaveBeenCalledOnce();
    expect(deps.projectFormObservations).toHaveBeenCalledWith(
      expect.anything(),
      { enabled: true, limit: 10, now: deps.now }
    );
    const order = (fn: unknown): number =>
      (fn as { mock: { invocationCallOrder: number[] } }).mock
        .invocationCallOrder[0];
    expect(order(deps.processObservations)).toBeLessThan(
      order(deps.materializeCampaignEnrollment)
    );
    expect(order(deps.projectFormObservations)).toBeLessThan(
      order(deps.materializeCampaignEnrollment)
    );
  });

  it.each([undefined, false])(
    'projects no observations when the switch is %s',
    async (observationProcessingEnabled) => {
      const deps = dependencies();
      await dispatchLifecycleJobs(
        {
          batchSize: 10,
          campaignEnabled: true,
          observationProcessingEnabled,
          signal: new AbortController().signal,
        },
        deps
      );
      expect(deps.processObservations).not.toHaveBeenCalled();
      expect(deps.projectFormObservations).not.toHaveBeenCalled();
    }
  );

  it('clamps the observation batch to the dispatcher maximum, well under the projection cap of 100', async () => {
    const deps = dependencies();
    await dispatchLifecycleJobs(
      {
        batchSize: 25,
        campaignEnabled: false,
        observationProcessingEnabled: true,
        signal: new AbortController().signal,
      },
      deps
    );
    for (const fn of [deps.processObservations, deps.projectFormObservations]) {
      const limit = (
        fn as unknown as { mock: { calls: [unknown, { limit: number }][] } }
      ).mock.calls[0][1].limit;
      expect(limit).toBe(25);
      expect(limit).toBeLessThanOrEqual(100);
    }
  });

  it('still leases and dispatches jobs when observation projection fails, and reports it to operators', async () => {
    const job = leasedJob('00000000-0000-4000-8000-0000000000ab');
    const deps = dependencies({
      processObservations: vi
        .fn()
        .mockRejectedValue(new Error('projection exploded')),
      leaseDueJobs: vi.fn().mockResolvedValue([job]),
    });
    const result = await dispatchLifecycleJobs(
      {
        batchSize: 10,
        campaignEnabled: true,
        observationProcessingEnabled: true,
        signal: new AbortController().signal,
      },
      deps
    );
    expect(deps.leaseDueJobs).toHaveBeenCalledOnce();
    expect(deps.dispatchLeasedJob).toHaveBeenCalledOnce();
    expect(deps.projectFormObservations).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      leased: 1,
      dispatched: 1,
      operatorAlerts: ['observation_projection_failed'],
    });
  });
});

it('reconciles accepted send identities before leasing contact follow-ups', async () => {
  const deps = dependencies();
  await dispatchLifecycleJobs(
    {
      batchSize: 5,
      campaignEnabled: true,
      signal: new AbortController().signal,
    },
    deps
  );
  expect(deps.reconcileMessageIds).toHaveBeenCalledWith(expect.anything(), {
    now: NOW,
    signal: expect.any(AbortSignal),
  });
  expect(
    deps.reconcileMessageIds &&
      vi.mocked(deps.reconcileMessageIds).mock.invocationCallOrder[0]
  ).toBeLessThan(vi.mocked(deps.leaseDueJobs).mock.invocationCallOrder[0] ?? 0);
});

it('continues enrichment-only dispatch when delivery configuration is absent', async () => {
  vi.stubEnv('RESEND_API_KEY', undefined);
  vi.stubEnv('DELIVERY_ENVIRONMENT', undefined);
  vi.stubEnv('GROWTH_DATABASE_ENVIRONMENT', undefined);
  try {
    const deps = dependencies({
      reconcileMessageIds: reconcilePendingResendMessageIds,
      leaseDueJobs: vi
        .fn()
        .mockResolvedValue([leasedJob('enrich-1', 'enrich')]),
    });
    await expect(
      dispatchLifecycleJobs(
        {
          batchSize: 5,
          campaignEnabled: true,
          signal: new AbortController().signal,
        },
        deps
      )
    ).resolves.toMatchObject({ dispatched: 1 });
    expect(deps.dispatchLeasedJob).toHaveBeenCalledOnce();
  } finally {
    vi.unstubAllEnvs();
  }
});
