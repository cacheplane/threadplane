import {
  verifyGrowthActionToken,
  type GrowthJob,
  type LinkedInDigestContext,
  type LinkedInDigestLead,
  type SqlExecutor,
} from '@threadplane-internal/growth';
import { describe, expect, it, vi } from 'vitest';

import { DeterministicLifecycleJobError } from '../job-errors.js';
import {
  dispatchLifecycleAppOwnedJob,
  type LifecycleJobDependencies,
} from './send.js';

const NOW = new Date('2026-11-02T16:00:00.000Z');
const LEASE_TOKEN = '00000000-0000-4000-8000-000000000099';
const JOB_ID = '00000000-0000-4000-8000-0000000000d1';
const LEAD_ID = '00000000-0000-4000-8000-00000000011d';
const TOKEN_KEY = {
  version: 1,
  secret: 'linkedin-digest-job-test-token-secret-material',
};

const LEAD: LinkedInDigestLead = {
  id: LEAD_ID,
  profileUrl: 'https://www.linkedin.com/in/dana-builder',
  displayName: 'Dana Builder',
  headline: 'Staff Engineer at Example Corp',
  companyName: 'Example Corp',
  status: 'new',
  score: 50,
  firstSeenAt: new Date('2026-10-30T15:00:00.000Z'),
  lastSeenAt: new Date('2026-10-30T15:00:00.000Z'),
  decidedAt: null,
  approvedVariant: null,
  approvedText: null,
  engagements: [
    {
      kind: 'comment',
      commentText: 'Great write-up',
      occurredAt: new Date('2026-10-30T15:00:00.000Z'),
      postUrn: 'urn:li:activity:1',
      postUrl: null,
    },
  ],
  previouslyRejected: false,
};

const EMPTY_CONTEXT: LinkedInDigestContext = {
  since: new Date('2026-11-01T16:00:00.000Z'),
  unparsedCount: 0,
  dropCount: 0,
  ingestCount: 0,
  forwardBacklog: 0,
};

function digestJob(payload: Record<string, unknown>): GrowthJob {
  return {
    id: JOB_ID,
    kind: 'digest',
    contactId: null,
    projectId: null,
    status: 'leased',
    availableAt: NOW,
    leaseUntil: new Date(NOW.getTime() + 60_000),
    leaseToken: LEASE_TOKEN,
    attempts: 1,
    idempotencyKey: 'linkedin_digest:2026-11-02',
    payload,
    providerEmailId: null,
    rfcMessageId: null,
    gmailSeedMessageId: null,
    deliveryStatus: 'not_submitted',
    lastErrorCode: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

const linkedInJob = () =>
  digestJob({ business_date: '2026-11-02', digest_kind: 'linkedin_leads' });

function transactionalExecutor(): SqlExecutor {
  const stub = {
    execute: vi.fn(),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(stub)
    ),
  };
  return stub as unknown as SqlExecutor;
}

function dependencies(
  overrides: Partial<LifecycleJobDependencies> = {}
): LifecycleJobDependencies {
  return {
    now: () => NOW,
    readJobContext: vi.fn(),
    createUnsubscribeUrl: vi.fn(),
    sendRecipient: vi.fn(),
    deferJob: vi.fn().mockResolvedValue(linkedInJob()),
    completeJob: vi.fn().mockResolvedValue(linkedInJob()),
    cancelJob: vi.fn(),
    claimInternalNotification: vi.fn().mockResolvedValue(true),
    markInternalNotificationUnknown: vi.fn().mockResolvedValue(linkedInJob()),
    failJob: vi.fn().mockResolvedValue(linkedInJob()),
    sendInternalNotification: vi
      .fn()
      .mockResolvedValue({ outcome: 'accepted' }),
    readInstallDigestCandidates: vi.fn().mockResolvedValue([]),
    readInstallDigestContext: vi.fn(),
    markInstallDigestReported: vi.fn(),
    readLinkedInDigestLeads: vi.fn().mockResolvedValue([LEAD]),
    readLinkedInDigestContext: vi.fn().mockResolvedValue({
      ...EMPTY_CONTEXT,
      ingestCount: 3,
    }),
    markLinkedInDigestSent: vi.fn().mockResolvedValue(undefined),
    publicActionOrigin: 'https://threadplane.ai',
    emailKeyring: {
      active: { version: 1, secret: 'linkedin-digest-job-email-keyring' },
    },
    founderNotificationEmail: 'founder@threadplane.ai',
    recipientPolicy: {
      campaignEnabled: false,
      deliveryEnabled: true,
      environment: 'test',
      databaseEnvironment: 'test',
      senderVerified: true,
      verifiedDomain: 'threadplane.ai',
      configuredSender: 'Brian at Threadplane <brian@threadplane.ai>',
      providerTrackingDisabled: true,
      nonProductionRecipientAllowlist: ['founder@threadplane.ai'],
      nonProductionRedirectTo: 'founder@threadplane.ai',
    },
    tokenKey: TOKEN_KEY,
    ...overrides,
  };
}

function sentText(deps: LifecycleJobDependencies): string {
  return vi.mocked(deps.sendInternalNotification).mock.calls[0][0].text;
}

describe('LinkedIn digest jobs', () => {
  it('completes without sending when there are no leads and no counts to report', async () => {
    const deps = dependencies({
      readLinkedInDigestLeads: vi.fn().mockResolvedValue([]),
      readLinkedInDigestContext: vi
        .fn()
        .mockResolvedValue({ ...EMPTY_CONTEXT, ingestCount: 4 }),
    });
    await expect(
      dispatchLifecycleAppOwnedJob(transactionalExecutor(), linkedInJob(), {}, deps)
    ).resolves.toBe('completed');
    expect(deps.completeJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ jobId: JOB_ID, leaseToken: LEASE_TOKEN })
    );
    expect(deps.claimInternalNotification).not.toHaveBeenCalled();
    expect(deps.sendInternalNotification).not.toHaveBeenCalled();
    expect(deps.markLinkedInDigestSent).not.toHaveBeenCalled();
  });

  it('sends one founder email with signed reject and deny links and records the digest', async () => {
    const deps = dependencies();
    const executor = transactionalExecutor();
    await expect(
      dispatchLifecycleAppOwnedJob(executor, linkedInJob(), {}, deps)
    ).resolves.toBe('completed');

    expect(deps.claimInternalNotification).toHaveBeenCalledWith(
      executor,
      expect.objectContaining({ jobId: JOB_ID, kind: 'digest' })
    );
    expect(deps.sendInternalNotification).toHaveBeenCalledOnce();
    expect(deps.sendInternalNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'founder@threadplane.ai',
        subject: 'Threadplane LinkedIn leads for 2026-11-02: 1 new',
        idempotencyKey: 'linkedin_digest:2026-11-02',
        signal: expect.any(AbortSignal),
        kind: 'digest',
      })
    );
    const text = sentText(deps);
    expect(text).toContain('Dana Builder — Staff Engineer at Example Corp');
    const tokens = [
      ...text.matchAll(
        /https:\/\/threadplane\.ai\/api\/growth\/linkedin-decide\?token=([A-Za-z0-9._-]+)/gu
      ),
    ].map((match) => match[1]);
    expect(tokens).toHaveLength(2);
    const payloads = tokens.map((token) =>
      verifyGrowthActionToken(token, {
        expectedPurpose: 'founder_linkedin_decide',
        keyring: { active: TOKEN_KEY },
        now: NOW,
      })
    );
    expect(payloads).toEqual([
      expect.objectContaining({
        contactId: LEAD_ID,
        reason: 'reject',
        eventNonce: JOB_ID,
      }),
      expect.objectContaining({
        contactId: LEAD_ID,
        reason: 'deny',
        eventNonce: JOB_ID,
      }),
    ]);

    expect(executor.transaction).toHaveBeenCalledOnce();
    expect(deps.markLinkedInDigestSent).toHaveBeenCalledWith(executor, {
      businessDate: '2026-11-02',
      jobId: JOB_ID,
      sentAt: NOW,
      leadCount: 1,
      context: { ...EMPTY_CONTEXT, ingestCount: 3 },
    });
    expect(deps.completeJob).toHaveBeenCalledOnce();
    expect(deps.sendRecipient).not.toHaveBeenCalled();
    expect(deps.readJobContext).not.toHaveBeenCalled();
    expect(deps.readInstallDigestCandidates).not.toHaveBeenCalled();
  });

  it('renders a multi-line comment on one line instead of failing validation', async () => {
    const deps = dependencies({
      readLinkedInDigestLeads: vi.fn().mockResolvedValue([
        {
          ...LEAD,
          displayName: 'Dana\n  Builder',
          companyName: ' \t ',
          engagements: [
            {
              ...LEAD.engagements[0],
              commentText: 'First line\nsecond line\r\n\tthird',
            },
          ],
        },
      ]),
    });
    await expect(
      dispatchLifecycleAppOwnedJob(transactionalExecutor(), linkedInJob(), {}, deps)
    ).resolves.toBe('completed');
    const text = sentText(deps);
    expect(text).toContain('commented: "First line second line third"');
    expect(text).toContain('Dana Builder — Staff Engineer at Example Corp');
    expect(text).not.toContain('Company:');
  });

  it('strips bidi overrides and C1 controls from a headline', async () => {
    const deps = dependencies({
      readLinkedInDigestLeads: vi.fn().mockResolvedValue([
        { ...LEAD, headline: 'Staff\u202E Engineer\u0085 at Example\u2066 Corp' },
      ]),
    });
    await expect(
      dispatchLifecycleAppOwnedJob(transactionalExecutor(), linkedInJob(), {}, deps)
    ).resolves.toBe('completed');
    expect(sentText(deps)).toContain(
      'Dana Builder — Staff Engineer at Example Corp'
    );
  });

  it('clips oversized text and keeps the newest 200 engagements', async () => {
    const engagements = Array.from({ length: 201 }, (_, index) => ({
      kind: 'reaction' as const,
      commentText: null,
      occurredAt: new Date(Date.UTC(2026, 9, 1, 0, index)),
      postUrn: `urn:li:activity:${index}`,
      postUrl: null,
    }));
    const deps = dependencies({
      readLinkedInDigestLeads: vi.fn().mockResolvedValue([
        {
          ...LEAD,
          displayName: 'D'.repeat(300),
          headline: 'H'.repeat(900),
          engagements,
        },
      ]),
    });
    await expect(
      dispatchLifecycleAppOwnedJob(transactionalExecutor(), linkedInJob(), {}, deps)
    ).resolves.toBe('completed');
    const text = sentText(deps);
    expect(text.match(/^reacted on /gmu)).toHaveLength(200);
    expect(text).not.toContain('urn:li:activity:0 ');
    expect(text).toContain('urn:li:activity:200 ');
    expect(text).toContain(`${'D'.repeat(200)} — ${'H'.repeat(500)}\n`);
  });

  it('quarantines the job when the digest input still fails validation', async () => {
    const deps = dependencies({
      readLinkedInDigestLeads: vi
        .fn()
        .mockResolvedValue([{ ...LEAD, profileUrl: 'https://example.com/in/x' }]),
    });
    await expect(
      dispatchLifecycleAppOwnedJob(transactionalExecutor(), linkedInJob(), {}, deps)
    ).rejects.toBeInstanceOf(DeterministicLifecycleJobError);
    expect(deps.claimInternalNotification).not.toHaveBeenCalled();
    expect(deps.sendInternalNotification).not.toHaveBeenCalled();
  });

  it('sends a counts-only digest when unparsed mail or drops need attention', async () => {
    const deps = dependencies({
      readLinkedInDigestLeads: vi.fn().mockResolvedValue([]),
      readLinkedInDigestContext: vi
        .fn()
        .mockResolvedValue({ ...EMPTY_CONTEXT, unparsedCount: 1 }),
    });
    await expect(
      dispatchLifecycleAppOwnedJob(transactionalExecutor(), linkedInJob(), {}, deps)
    ).resolves.toBe('completed');
    expect(deps.sendInternalNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Threadplane LinkedIn leads for 2026-11-02: 0 new',
      })
    );
    expect(deps.markLinkedInDigestSent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ leadCount: 0 })
    );
  });

  it('defers while delivery is disabled', async () => {
    const deps = dependencies();
    deps.recipientPolicy = { ...deps.recipientPolicy, deliveryEnabled: false };
    await expect(
      dispatchLifecycleAppOwnedJob({} as SqlExecutor, linkedInJob(), {}, deps)
    ).resolves.toBe('deferred');
    expect(deps.deferJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ errorCode: 'delivery_disabled' })
    );
    expect(deps.readLinkedInDigestLeads).not.toHaveBeenCalled();
    expect(deps.sendInternalNotification).not.toHaveBeenCalled();
  });

  it('fails for manual review when the claim is lost or the outcome is unknown', async () => {
    const lost = dependencies({
      claimInternalNotification: vi.fn().mockResolvedValue(false),
    });
    await expect(
      dispatchLifecycleAppOwnedJob({} as SqlExecutor, linkedInJob(), {}, lost)
    ).resolves.toBe('failed');
    expect(lost.sendInternalNotification).not.toHaveBeenCalled();
    expect(lost.markInternalNotificationUnknown).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: 'digest',
        errorCode: 'linkedin_digest_outcome_unknown',
      })
    );

    const unknown = dependencies({
      sendInternalNotification: vi
        .fn()
        .mockResolvedValue({ outcome: 'unknown' }),
    });
    await expect(
      dispatchLifecycleAppOwnedJob({} as SqlExecutor, linkedInJob(), {}, unknown)
    ).resolves.toBe('failed');
    expect(unknown.markInternalNotificationUnknown).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ errorCode: 'linkedin_digest_outcome_unknown' })
    );
    expect(unknown.markLinkedInDigestSent).not.toHaveBeenCalled();
  });

  it('fails the job when the provider rejects the message', async () => {
    const deps = dependencies({
      sendInternalNotification: vi
        .fn()
        .mockResolvedValue({ outcome: 'rejected' }),
    });
    await expect(
      dispatchLifecycleAppOwnedJob({} as SqlExecutor, linkedInJob(), {}, deps)
    ).resolves.toBe('failed');
    expect(deps.failJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ errorCode: 'linkedin_digest_rejected' })
    );
    expect(deps.markLinkedInDigestSent).not.toHaveBeenCalled();
    expect(deps.completeJob).not.toHaveBeenCalled();
  });

  it('rejects a LinkedIn digest job without a valid business date', async () => {
    const deps = dependencies();
    await expect(
      dispatchLifecycleAppOwnedJob(
        {} as SqlExecutor,
        digestJob({ digest_kind: 'linkedin_leads' }),
        {},
        deps
      )
    ).rejects.toThrow('Digest job is missing its business date');
    expect(deps.readLinkedInDigestLeads).not.toHaveBeenCalled();
  });

  it.each([
    { business_date: '2026-11-02', digest_kind: 'install_identities' },
    { business_date: '2026-11-02' },
  ])('routes other digest jobs to the install handler: %o', async (payload) => {
    const deps = dependencies();
    await expect(
      dispatchLifecycleAppOwnedJob({} as SqlExecutor, digestJob(payload), {}, deps)
    ).resolves.toBe('completed');
    expect(deps.readInstallDigestCandidates).toHaveBeenCalledOnce();
    expect(deps.readLinkedInDigestLeads).not.toHaveBeenCalled();
    expect(deps.readLinkedInDigestContext).not.toHaveBeenCalled();
  });
});
