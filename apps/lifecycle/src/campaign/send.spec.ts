import {
  createUnsubscribeActionUrl,
  unsubscribeActionUrlValue,
  type GrowthArtifact,
  type GrowthJob,
  type SqlExecutor,
} from '@threadplane-internal/growth';
import { describe, expect, it, vi } from 'vitest';

const resendSend = vi.hoisted(() => vi.fn());

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: resendSend };
  },
}));

import {
  createDefaultLifecycleJobDependencies,
  dispatchLifecycleAppOwnedJob,
  LIFECYCLE_SCORE_CONTENT_REGISTRY_V1,
  loadLifecycleRuntimeConfiguration,
  campaignGreeting,
  prepareCampaignMessage,
  type LifecycleJobContext,
  type LifecycleJobDependencies,
} from './send.js';
import { DeterministicLifecycleJobError } from '../job-errors.js';
import { FOUNDER_BOOKING_URL } from './templates.js';

const NOW = new Date('2026-09-01T12:03:00.000Z');
const CONTACT_ID = '00000000-0000-4000-8000-000000000002';
const LEASE_TOKEN = '00000000-0000-4000-8000-000000000099';
const TOKEN_KEY = {
  version: 1,
  secret: 'campaign-send-test-token-secret-material',
};
const UNSUBSCRIBE = createUnsubscribeActionUrl(
  {
    contactId: CONTACT_ID,
    issuedAt: NOW,
    eventNonce: 'campaign-step-1',
  },
  TOKEN_KEY,
  'https://website.test'
);
const DIGEST_CANDIDATE = {
  email: 'dev@corp.example',
  companyDomain: 'corp.example',
  gitDisplayName: 'Dev Person',
  repositoryProvider: 'github',
  repositoryOwner: 'corp',
  gitConfigOrigin: 'global' as const,
  packages: [
    { packageName: '@threadplane/langgraph', packageVersion: '0.2.0' },
  ],
  installCount: 1,
  firstSeenAt: new Date('2026-09-15T15:00:00.000Z'),
  lastSeenAt: new Date('2026-09-15T15:00:00.000Z'),
  firstInstallObservationId: '0f1e2d3c-4b5a-4c7d-8e9f-a0b1c2d3e4f5',
  emailLookupHmac: 'a'.repeat(64),
  emailKeyVersion: 1,
};

function job(
  kind = 'send_step',
  payload: Record<string, unknown> = {}
): GrowthJob {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    kind,
    contactId: CONTACT_ID,
    projectId: null,
    status: 'leased',
    availableAt: NOW,
    leaseUntil: new Date(NOW.getTime() + 60_000),
    leaseToken: LEASE_TOKEN,
    attempts: 1,
    idempotencyKey: `${kind}:fixture`,
    payload,
    providerEmailId: null,
    rfcMessageId: null,
    gmailSeedMessageId: null,
    deliveryStatus: 'not_submitted',
    lastErrorCode: null,
    createdAt: new Date('2026-09-01T12:00:00.000Z'),
    updatedAt: NOW,
  };
}

function artifact(overrides: Record<string, unknown> = {}): GrowthArtifact {
  return {
    id: '00000000-0000-4000-8000-000000000010',
    jobId: '00000000-0000-4000-8000-000000000011',
    contactId: CONTACT_ID,
    projectId: null,
    kind: 'enrichment.v1',
    schemaVersion: 1,
    createdAt: new Date('2026-09-01T12:02:00.000Z'),
    content: {
      summary: 'Bounded summary.',
      confidence: 'medium',
      company_profile: { name: null, description: null, industry: null },
      score_version: 'growth-score:v1',
      score_reasons: [],
      recommended_angle: 'Keep it practical.',
      cited_signals: [
        { signal: 'Bounded source fact', source_ids: ['source-1'] },
      ],
      sources: [
        {
          id: 'source-1',
          url: 'https://example.com/about',
          retrieved_at: '2026-09-01T12:00:00.000Z',
          content_hash: 'a'.repeat(64),
        },
      ],
      drafts: [
        { angle_id: 'streaming_foundation', source_id: 'source-1' },
        { angle_id: 'debugging_layers', source_id: 'source-1' },
        { angle_id: 'event_state_boundary', source_id: 'source-1' },
      ],
      ...overrides,
    },
  };
}

function context(
  overrides: Partial<LifecycleJobContext> = {}
): LifecycleJobContext {
  return {
    contactId: CONTACT_ID,
    displayName: 'Ada',
    companyName: 'Example',
    companyDomain: 'example.com',
    emailClassification: 'work',
    formSubmission: {
      form_kind: 'whitepaper',
      paper: 'chat',
      submission_id: '00000000-0000-4000-8000-000000000012',
    },
    enrollmentAt: new Date('2026-09-01T12:00:00.000Z'),
    enrichmentArtifact: artifact(),
    ...overrides,
  };
}

describe('prepareCampaignMessage', () => {
  it('uses generic copy when the newest artifact is company research even if content resembles legacy drafts', () => {
    const stored = { ...artifact(), kind: 'company_enrichment.v1' };
    const prepared = prepareCampaignMessage({
      context: context({ enrichmentArtifact: stored }),
      job: job('send_step', { campaign_version: 'v1', step: 1 }),
      unsubscribeUrl: UNSUBSCRIBE,
    });
    expect(prepared).toMatchObject({
      subject: 'Engineer to engineer',
      template: 'immediate',
    });
  });
  it('prepares the install-runtime hello immediately without research', () => {
    expect(
      prepareCampaignMessage({
        context: {
          ...context({ enrichmentArtifact: null }),
          campaignEnrollmentReason: 'install_runtime',
        },
        job: job('send_step', { campaign_version: 'v1', step: 1 }),
        unsubscribeUrl: UNSUBSCRIBE,
      })
    ).toMatchObject({ status: 'ready', subject: 'Engineer to engineer' });
  });

  it.each([1, 2, 3] as const)(
    'keeps install-runtime step %i generic even when research is available',
    (step) => {
      const prepared = prepareCampaignMessage({
        context: { ...context(), campaignEnrollmentReason: 'install_runtime' },
        job: job('send_step', { campaign_version: 'v1', step }),
        unsubscribeUrl: UNSUBSCRIBE,
      });
      expect(prepared).toMatchObject({
        status: 'ready',
        subject: [
          'Engineer to engineer',
          'Get your agent UI into production',
          'Free engineering session with the Threadplane founder',
        ][step - 1],
        template: ['immediate', 'day-3', 'day-8'][step - 1],
      });
      if (prepared.status !== 'ready') throw new Error('expected ready');
      expect(prepared.text).toContain(unsubscribeActionUrlValue(UNSUBSCRIBE));
      expect(prepared.text).toContain('\n\n—\nBrian\n');
      if (step === 3)
        expect(prepared.text).toContain('This is my last automated follow-up.');
    }
  );

  it('rejects a fourth install-runtime sequence step', () => {
    expect(() =>
      prepareCampaignMessage({
        context: { ...context(), campaignEnrollmentReason: 'install_runtime' },
        job: job('send_step', { campaign_version: 'v1', step: 4 }),
        unsubscribeUrl: UNSUBSCRIBE,
      })
    ).toThrow(DeterministicLifecycleJobError);
  });

  it('renders the evidence-flavored final offer for a closed evidence-linked artifact', () => {
    const cited = artifact({
      cited_signals: [
        { signal: 'Bounded source fact', source_ids: ['source-1'] },
      ],
      sources: [
        {
          id: 'source-1',
          url: 'https://example.com/about',
          retrieved_at: '2026-09-01T12:00:00.000Z',
          content_hash: 'a'.repeat(64),
        },
      ],
      drafts: [
        { angle_id: 'streaming_foundation', source_id: 'source-1' },
        { angle_id: 'debugging_layers', source_id: 'source-1' },
        { angle_id: 'event_state_boundary', source_id: 'source-1' },
      ],
    });

    expect(
      prepareCampaignMessage({
        context: context({ enrichmentArtifact: cited }),
        job: job('send_step', { campaign_version: 'v1', step: 3 }),
        unsubscribeUrl: UNSUBSCRIBE,
      })
    ).toMatchObject({
      status: 'ready',
      subject: 'One boundary that makes agent UIs testable',
    });
  });

  it.each([
    'Your funding round means you need this now.',
    'Your customers are demanding agent streaming.',
    'As VP Engineering, you should move urgently.',
    'You already use Threadplane in production.',
  ])('never sends invented model personalization: %s', (inventedClaim) => {
    const unsafe = artifact({
      drafts: [
        { subject: 'A thought', body: inventedClaim },
        { subject: 'Second', body: 'Would this help?' },
        { subject: 'Third', body: 'One final note.' },
      ],
    });

    const prepared = prepareCampaignMessage({
      context: context({ enrichmentArtifact: unsafe }),
      job: job('send_step', { campaign_version: 'v1', step: 1 }),
      unsubscribeUrl: UNSUBSCRIBE,
    });

    expect(prepared).toMatchObject({
      status: 'ready',
      subject: 'Engineer to engineer',
    });
    if (prepared.status === 'ready') {
      expect(prepared.text).not.toContain(inventedClaim);
    }
  });

  it.each([1, 2, 3] as const)(
    'maps the validated research angle at index %i to only that fixed step',
    (step) => {
      const prepared = prepareCampaignMessage({
        context: context(),
        job: job('send_step', { campaign_version: 'v1', step }),
        unsubscribeUrl: UNSUBSCRIBE,
      });

      expect(prepared).toMatchObject({
        status: 'ready',
        subject: [
          'Streaming first, then the rest',
          'Three checks when the UI stalls',
          'One boundary that makes agent UIs testable',
        ][step - 1],
        template: [
          'streaming_foundation',
          'debugging_layers',
          'event_state_boundary',
        ][step - 1],
      });
      if (prepared.status !== 'ready') throw new Error('expected ready');
      expect(prepared.text).toContain(
        '\n\n—\nBrian\n\nIs this email not relevant to you? Stop here: '
      );
      expect(prepared.text).toContain(unsubscribeActionUrlValue(UNSUBSCRIBE));
      expect(prepared.text).not.toContain('ada@example.com');
    }
  );

  it('sends the streaming-flavored offer as step one when research is cited', () => {
    expect(
      prepareCampaignMessage({
        context: context(),
        job: job('send_step', { campaign_version: 'v1', step: 1 }),
        unsubscribeUrl: UNSUBSCRIBE,
      })
    ).toMatchObject({
      status: 'ready',
      subject: 'Streaming first, then the rest',
    });
  });

  it('sends step one immediately without waiting for a research artifact', () => {
    expect(
      prepareCampaignMessage({
        context: context({ enrichmentArtifact: null, enrollmentAt: null }),
        job: job('send_step', { campaign_version: 'v1', step: 1 }),
        unsubscribeUrl: UNSUBSCRIBE,
      })
    ).toMatchObject({ status: 'ready', subject: 'Engineer to engineer' });
  });

  it('renders a plain HTML alternative with a one-word unsubscribe link', () => {
    const prepared = prepareCampaignMessage({
      context: context(),
      job: job('send_step', { campaign_version: 'v1', step: 1 }),
      unsubscribeUrl: UNSUBSCRIBE,
    });
    const unsubscribeUrl = unsubscribeActionUrlValue(UNSUBSCRIBE);

    expect(prepared.html).toContain(
      `here:<br><a href="${FOUNDER_BOOKING_URL}">${FOUNDER_BOOKING_URL}</a></p>`
    );
    expect(prepared.html).toContain('<p>—<br>Brian</p>');
    expect(
      prepared.html.endsWith(
        `<p>Is this email not relevant to you? Click <a href="${unsubscribeUrl}">here</a>.</p>`
      )
    ).toBe(true);
    expect(prepared.html.split(unsubscribeUrl)).toHaveLength(2);
    expect(prepared.html).not.toMatch(
      /<(?:img|script|style|div|span|table)\b/iu
    );
    expect(prepared.html).toContain(`href="${unsubscribeUrl}">here</a>`);
    expect(prepared.text).toContain(
      `Is this email not relevant to you? Stop here: ${unsubscribeUrl}`
    );
  });

  it('escapes body text and keeps only bare links as anchors in the HTML part', () => {
    const prepared = prepareCampaignMessage({
      context: context({ enrichmentArtifact: null }),
      job: job('send_step', { campaign_version: 'v1', step: 2 }),
      unsubscribeUrl: UNSUBSCRIBE,
    });

    expect(prepared.html).toContain(
      `me:<br><a href="${FOUNDER_BOOKING_URL}">${FOUNDER_BOOKING_URL}</a></p>`
    );
    expect(prepared.html).toMatch(
      /^<p>Hey Ada,<\/p>\n<p>[^<]+<\/p>\n<p>[^<]+<\/p>\n<p>[^<]+<br>/u
    );
    expect(prepared.html).not.toContain('&lt;');
  });

  it.each([
    ['Ada', 'Hey Ada,'],
    ['Ada Lovelace', 'Hey Ada,'],
    ["  O'Brien  ", "Hey O'Brien,"],
    ['Anne-Marie Smith', 'Hey Anne-Marie,'],
    [null, 'Hey there,'],
    ['', 'Hey there,'],
    ['Click https://evil.example', 'Hey there,'],
    ['<b>Ada</b>', 'Hey there,'],
    ['ada@example.com', 'Hey there,'],
    ['Ada123', 'Hey there,'],
    ['A'.repeat(31), 'Hey there,'],
    ['Bcc: victim@example.com', 'Hey there,'],
  ])('greets display name %j as %s', (displayName, greeting) => {
    expect(campaignGreeting(displayName)).toBe(greeting);
  });

  it('opens every step with the greeting and escapes it in the HTML part', () => {
    const prepared = prepareCampaignMessage({
      context: context({ displayName: "O'Brien", enrichmentArtifact: null }),
      job: job('send_step', { campaign_version: 'v1', step: 2 }),
      unsubscribeUrl: UNSUBSCRIBE,
    });

    expect(prepared.text.startsWith("Hey O'Brien,\n\nEven with agents")).toBe(
      true
    );
    expect(
      prepared.html.startsWith('<p>Hey O&#39;Brien,</p>\n<p>Even with')
    ).toBe(true);
  });

  it('falls back per fixed step when an artifact draft violates copy checks', () => {
    const invalid = artifact({
      drafts: [
        { subject: 'I saw you', body: 'I saw you reading the docs.' },
        { subject: 'Safe second', body: 'Would this second idea help?' },
        { subject: 'Safe third', body: 'Would this third idea help?' },
      ],
    });

    expect(
      prepareCampaignMessage({
        context: context({ enrichmentArtifact: invalid }),
        job: job('send_step', { campaign_version: 'v1', step: 1 }),
        unsubscribeUrl: UNSUBSCRIBE,
      })
    ).toMatchObject({ status: 'ready', subject: 'Engineer to engineer' });
  });
});

function dependencies(
  overrides: Partial<LifecycleJobDependencies> = {}
): LifecycleJobDependencies {
  return {
    now: () => NOW,
    readJobContext: vi.fn().mockResolvedValue(context()),
    createUnsubscribeUrl: vi.fn(() => UNSUBSCRIBE),
    sendRecipient: vi.fn().mockResolvedValue({
      accepted: true,
      providerEmailId: 'provider-1',
    }),
    deferJob: vi.fn().mockResolvedValue(job()),
    completeJob: vi.fn().mockResolvedValue(job()),
    cancelJob: vi.fn().mockResolvedValue(job()),
    claimInternalNotification: vi.fn().mockResolvedValue(true),
    markInternalNotificationUnknown: vi.fn().mockResolvedValue(job()),
    failJob: vi.fn().mockResolvedValue(job()),
    sendInternalNotification: vi.fn().mockResolvedValue({
      outcome: 'accepted',
    }),
    founderNotificationEmail: 'founder@threadplane.ai',
    recipientPolicy: {
      campaignEnabled: true,
      deliveryEnabled: true,
      environment: 'test',
      databaseEnvironment: 'test',
      senderVerified: true,
      verifiedDomain: 'threadplane.ai',
      configuredSender: 'Brian at Threadplane <brian@threadplane.ai>',
      providerTrackingDisabled: true,
      nonProductionRecipientAllowlist: [
        'brian@threadplane.ai',
        'recipient-test@threadplane.ai',
      ],
      nonProductionRedirectTo: 'recipient-test@threadplane.ai',
    },
    tokenKey: TOKEN_KEY,
    publicActionOrigin: 'https://threadplane.ai',
    readInstallDigestCandidates: vi.fn().mockResolvedValue([DIGEST_CANDIDATE]),
    readInstallDigestContext: vi.fn().mockResolvedValue({
      since: new Date('2026-09-15T14:00:00.000Z'),
      anonymousInstallSubjects: 2,
      ciInstallSubjects: 5,
    }),
    markInstallDigestReported: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('dispatchLifecycleAppOwnedJob', () => {
  it('sends the install-runtime hello through the shared recipient boundary without research', async () => {
    const deps = dependencies({
      readJobContext: vi.fn().mockResolvedValue(
        context({
          campaignEnrollmentReason: 'install_runtime',
          enrichmentArtifact: null,
        })
      ),
    });
    const send = job('send_step', { campaign_version: 'v1', step: 1 });
    await expect(
      dispatchLifecycleAppOwnedJob({} as SqlExecutor, send, {}, deps)
    ).resolves.toBe('completed');
    expect(deps.sendRecipient).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        jobId: send.id,
        leaseToken: LEASE_TOKEN,
        subject: 'Engineer to engineer',
        text: expect.stringContaining('Stop here: '),
        html: expect.stringContaining('Click <a href="'),
        unsubscribeUrl: UNSUBSCRIBE,
        campaignTemplate: 'immediate',
      }),
      deps.recipientPolicy
    );
    expect(deps.deferJob).not.toHaveBeenCalled();
  });

  it.each([
    'contact_stopped',
    'contact_unapproved',
    'contact_deleted',
  ] as const)(
    'preserves the shared %s delivery stop for an install-runtime hello',
    async (reason) => {
      const deps = dependencies({
        readJobContext: vi.fn().mockResolvedValue(
          context({
            campaignEnrollmentReason: 'install_runtime',
            enrichmentArtifact: null,
          })
        ),
        sendRecipient: vi.fn().mockResolvedValue({ accepted: false, reason }),
      });
      await expect(
        dispatchLifecycleAppOwnedJob(
          {} as SqlExecutor,
          job('send_step', { campaign_version: 'v1', step: 1 }),
          {},
          deps
        )
      ).resolves.toBe('cancelled');
      expect(deps.cancelJob).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ errorCode: reason })
      );
    }
  );

  it.each([
    'campaign_disabled',
    'delivery_disabled',
    'outside_send_window',
    'reply_binding_pending',
  ] as const)(
    'keeps an install-runtime hello deferred while %s',
    async (reason) => {
      const deps = dependencies({
        readJobContext: vi.fn().mockResolvedValue(
          context({
            campaignEnrollmentReason: 'install_runtime',
            enrichmentArtifact: null,
          })
        ),
        sendRecipient: vi.fn().mockResolvedValue({ accepted: false, reason }),
      });
      await expect(
        dispatchLifecycleAppOwnedJob(
          {} as SqlExecutor,
          job('send_step', { campaign_version: 'v1', step: 1 }),
          {},
          deps
        )
      ).resolves.toBe('deferred');
      expect(deps.deferJob).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ errorCode: reason })
      );
    }
  );

  it('fulfills the persisted form request through the recipient boundary', async () => {
    const deps = dependencies();
    const fulfill = job('fulfill', {
      form_kind: 'whitepaper',
      paper: 'chat',
      submission_id: '00000000-0000-4000-8000-000000000012',
    });

    await expect(
      dispatchLifecycleAppOwnedJob({} as SqlExecutor, fulfill, {}, deps)
    ).resolves.toBe('completed');
    expect(deps.sendRecipient).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        jobId: fulfill.id,
        leaseToken: LEASE_TOKEN,
        subject: 'Your Angular agent chat guide',
        text: expect.stringContaining(
          'https://threadplane.ai/whitepapers/chat.pdf'
        ),
      }),
      deps.recipientPolicy
    );
    expect(deps.sendRecipient).toHaveBeenCalledWith(
      expect.anything(),
      expect.not.objectContaining({ campaignTemplate: expect.anything() }),
      deps.recipientPolicy
    );
    const sent = vi.mocked(deps.sendRecipient).mock.calls[0]?.[1];
    expect(sent?.text.startsWith('Hey Ada,\n\nHere is the guide')).toBe(true);
    expect(
      sent?.html?.startsWith('<p>Hey Ada,</p>\n<p>Here is the guide')
    ).toBe(true);
    expect(sent?.html).toContain(
      '<a href="https://threadplane.ai/whitepapers/chat.pdf">'
    );
    expect(sent?.attachments).toEqual([
      {
        filename: 'angular-chat-guide.pdf',
        path: 'https://threadplane.ai/whitepapers/chat.pdf',
      },
    ]);
  });

  it.each([
    ['overview', 'angular-agent-readiness-guide.pdf', 'whitepaper.pdf'],
    ['angular', 'angular-streaming-guide.pdf', 'whitepapers/angular.pdf'],
    ['render', 'angular-genui-guide.pdf', 'whitepapers/render.pdf'],
    ['chat', 'angular-chat-guide.pdf', 'whitepapers/chat.pdf'],
  ] as const)(
    'attaches the requested %s guide to the fulfillment message',
    async (paper, filename, path) => {
      const deps = dependencies();

      await expect(
        dispatchLifecycleAppOwnedJob(
          {} as SqlExecutor,
          job('fulfill', {
            form_kind: 'whitepaper',
            paper,
            submission_id: '00000000-0000-4000-8000-000000000012',
          }),
          {},
          deps
        )
      ).resolves.toBe('completed');

      expect(
        vi.mocked(deps.sendRecipient).mock.calls[0]?.[1].attachments
      ).toEqual([{ filename, path: `https://threadplane.ai/${path}` }]);
    }
  );

  it.each(['newsletter', 'contact', 'pricing'] as const)(
    'attaches no file to a %s fulfillment',
    async (formKind) => {
      const deps = dependencies();

      await expect(
        dispatchLifecycleAppOwnedJob(
          {} as SqlExecutor,
          job('fulfill', {
            form_kind: formKind,
            submission_id: '00000000-0000-4000-8000-000000000012',
          }),
          {},
          deps
        )
      ).resolves.toBe('completed');

      expect(
        vi.mocked(deps.sendRecipient).mock.calls[0]?.[1]
      ).not.toHaveProperty('attachments');
    }
  );

  it('never attaches a file to a campaign step', async () => {
    const deps = dependencies();

    await expect(
      dispatchLifecycleAppOwnedJob(
        {} as SqlExecutor,
        job('send_step', { campaign_version: 'v1', step: 1 }),
        {},
        deps
      )
    ).resolves.toBe('completed');

    expect(vi.mocked(deps.sendRecipient).mock.calls[0]?.[1]).not.toHaveProperty(
      'attachments'
    );
  });

  it('falls back to the generic greeting on fulfillment when the display name is unusable', async () => {
    const deps = dependencies({
      readJobContext: vi
        .fn()
        .mockResolvedValue(
          context({ displayName: 'Click https://evil.example' })
        ),
    });
    const fulfill = job('fulfill', {
      form_kind: 'newsletter',
      submission_id: '00000000-0000-4000-8000-000000000012',
    });

    await expect(
      dispatchLifecycleAppOwnedJob({} as SqlExecutor, fulfill, {}, deps)
    ).resolves.toBe('completed');
    const sent = vi.mocked(deps.sendRecipient).mock.calls[0]?.[1];
    expect(sent?.text.startsWith('Hey there,\n\nYou are on the list.')).toBe(
      true
    );
    expect(sent?.text).not.toContain('evil.example');
  });

  it('translates corrupt persisted fulfillment input into deterministic poison', async () => {
    const deps = dependencies();

    await expect(
      dispatchLifecycleAppOwnedJob(
        {} as SqlExecutor,
        job('fulfill', {
          form_kind: 'whitepaper',
          paper: 'corrupt-paper',
          submission_id: '00000000-0000-4000-8000-000000000012',
        }),
        {},
        deps
      )
    ).rejects.toBeInstanceOf(DeterministicLifecycleJobError);
    expect(deps.sendRecipient).not.toHaveBeenCalled();
  });

  it('does not submit fulfillment when cancellation arrives during context preparation', async () => {
    const controller = new AbortController();
    const deps = dependencies({
      readJobContext: vi.fn().mockImplementation(async () => {
        controller.abort(new Error('lease heartbeat failed'));
        return context();
      }),
    });

    await expect(
      dispatchLifecycleAppOwnedJob(
        {} as SqlExecutor,
        job('fulfill', {
          form_kind: 'whitepaper',
          paper: 'chat',
          submission_id: '00000000-0000-4000-8000-000000000012',
        }),
        { signal: controller.signal },
        deps
      )
    ).rejects.toThrow('lease heartbeat failed');
    expect(deps.sendRecipient).not.toHaveBeenCalled();
  });

  it('does not claim or notify when cancellation arrives during notification context preparation', async () => {
    const controller = new AbortController();
    const deps = dependencies({
      readJobContext: vi.fn().mockImplementation(async () => {
        controller.abort(new Error('cancelled before notification claim'));
        return context();
      }),
    });

    await expect(
      dispatchLifecycleAppOwnedJob(
        {} as SqlExecutor,
        job('notify', { submission_id: 'submission-1' }),
        { signal: controller.signal },
        deps
      )
    ).rejects.toThrow('cancelled before notification claim');
    expect(deps.claimInternalNotification).not.toHaveBeenCalled();
    expect(deps.sendInternalNotification).not.toHaveBeenCalled();
  });

  it('does not call the internal provider when cancellation arrives after the at-most-once claim', async () => {
    const controller = new AbortController();
    const deps = dependencies({
      claimInternalNotification: vi.fn().mockImplementation(async () => {
        controller.abort(new Error('lease lost after notification claim'));
        return true;
      }),
    });

    await expect(
      dispatchLifecycleAppOwnedJob(
        {} as SqlExecutor,
        job('notify', { submission_id: 'submission-1' }),
        { signal: controller.signal },
        deps
      )
    ).rejects.toThrow('lease lost after notification claim');
    expect(deps.sendInternalNotification).not.toHaveBeenCalled();
    expect(deps.failJob).not.toHaveBeenCalled();
  });

  it('uses a separate founder-only notification provider without recipient authority', async () => {
    const deps = dependencies();
    const notify = job('notify', {
      form_kind: 'whitepaper',
      submission_id: '00000000-0000-4000-8000-000000000012',
    });

    await expect(
      dispatchLifecycleAppOwnedJob({} as SqlExecutor, notify, {}, deps)
    ).resolves.toBe('completed');
    expect(deps.sendInternalNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: notify.idempotencyKey,
        text: expect.stringContaining('does not authorize or schedule'),
        to: 'founder@threadplane.ai',
      })
    );
    expect(deps.sendRecipient).not.toHaveBeenCalled();
    expect(deps.completeJob).toHaveBeenCalledOnce();
  });

  it('validates and renders the internal summary before consuming its at-most-once claim', async () => {
    const invalid = artifact({ score_version: 'growth-score:v1\nBcc: bad' });
    const deps = dependencies({
      readJobContext: vi
        .fn()
        .mockResolvedValue(context({ enrichmentArtifact: invalid })),
    });

    await expect(
      dispatchLifecycleAppOwnedJob(
        {} as SqlExecutor,
        job('notify', { submission_id: 'submission-1' }),
        {},
        deps
      )
    ).rejects.toThrow(/scoreVersion|invalid/iu);
    expect(deps.claimInternalNotification).not.toHaveBeenCalled();
    expect(deps.sendInternalNotification).not.toHaveBeenCalled();
  });

  it('persists an ambiguous internal provider outcome for manual review without retry', async () => {
    const deps = dependencies({
      sendInternalNotification: vi.fn().mockResolvedValue({
        outcome: 'unknown',
      }),
    });

    await expect(
      dispatchLifecycleAppOwnedJob(
        {} as SqlExecutor,
        job('notify', { submission_id: 'submission-1' }),
        {},
        deps
      )
    ).resolves.toBe('failed');
    expect(deps.markInternalNotificationUnknown).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        errorCode: 'internal_notification_outcome_unknown',
      })
    );
    expect(deps.sendInternalNotification).toHaveBeenCalledOnce();
    expect(deps.failJob).not.toHaveBeenCalled();
  });

  it('settles a definitive internal provider rejection without retry', async () => {
    const deps = dependencies({
      sendInternalNotification: vi.fn().mockResolvedValue({
        outcome: 'rejected',
      }),
    });

    await expect(
      dispatchLifecycleAppOwnedJob(
        {} as SqlExecutor,
        job('notify', { submission_id: 'submission-1' }),
        {},
        deps
      )
    ).resolves.toBe('failed');
    expect(deps.failJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ errorCode: 'internal_notification_rejected' })
    );
    expect(deps.markInternalNotificationUnknown).not.toHaveBeenCalled();
  });

  it('defers internal notification provider work while delivery is disabled', async () => {
    const base = dependencies();
    const deps = dependencies({
      recipientPolicy: { ...base.recipientPolicy, deliveryEnabled: false },
    });
    const notify = job('notify', {
      form_kind: 'whitepaper',
      submission_id: '00000000-0000-4000-8000-000000000012',
    });

    await expect(
      dispatchLifecycleAppOwnedJob({} as SqlExecutor, notify, {}, deps)
    ).resolves.toBe('deferred');
    expect(deps.sendInternalNotification).not.toHaveBeenCalled();
    expect(deps.deferJob).toHaveBeenCalledOnce();
  });

  it('marks a reclaimed internal notification unknown without submitting it twice', async () => {
    const deps = dependencies({
      claimInternalNotification: vi.fn().mockResolvedValue(false),
    });
    const notify = job('notify', {
      form_kind: 'whitepaper',
      submission_id: '00000000-0000-4000-8000-000000000012',
    });

    await expect(
      dispatchLifecycleAppOwnedJob({} as SqlExecutor, notify, {}, deps)
    ).resolves.toBe('failed');
    expect(deps.sendInternalNotification).not.toHaveBeenCalled();
    expect(deps.markInternalNotificationUnknown).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        errorCode: 'internal_notification_outcome_unknown',
      })
    );
    expect(deps.failJob).not.toHaveBeenCalled();
  });
});

describe('loadLifecycleRuntimeConfiguration', () => {
  it('pins v1 to no marketing-content scoring until a closed registry is approved', () => {
    expect(LIFECYCLE_SCORE_CONTENT_REGISTRY_V1).toEqual({
      version: 'threadplane-lifecycle-content-registry:v1:no-marketing-content',
      entries: [],
    });
  });

  it('defaults delivery and install-runtime activation switches off', () => {
    expect(loadLifecycleRuntimeConfiguration({})).toMatchObject({
      campaignEnrollmentEnabled: false,
      campaignEnabled: false,
      deliveryEnabled: false,
      installRuntimeHelloEnabled: false,
      installDigestEnabled: false,
    });
  });

  it('enables the install digest only with the exact configured boolean', () => {
    expect(
      loadLifecycleRuntimeConfiguration({
        GROWTH_INSTALL_DIGEST_ENABLED: 'true',
      })
    ).toMatchObject({ installDigestEnabled: true });
    expect(() =>
      loadLifecycleRuntimeConfiguration({ GROWTH_INSTALL_DIGEST_ENABLED: '1' })
    ).toThrow('GROWTH_INSTALL_DIGEST_ENABLED must be exactly true or false');
  });

  it('enables install-runtime hello only with the exact configured boolean', () => {
    expect(
      loadLifecycleRuntimeConfiguration({
        GROWTH_INSTALL_RUNTIME_HELLO_ENABLED: 'true',
      })
    ).toMatchObject({ installRuntimeHelloEnabled: true });
    expect(
      loadLifecycleRuntimeConfiguration({
        GROWTH_INSTALL_RUNTIME_HELLO_ENABLED: 'false',
      })
    ).toMatchObject({ installRuntimeHelloEnabled: false });
    for (const value of ['TRUE', '1', ' true ', '']) {
      expect(() =>
        loadLifecycleRuntimeConfiguration({
          GROWTH_INSTALL_RUNTIME_HELLO_ENABLED: value,
        })
      ).toThrow(/GROWTH_INSTALL_RUNTIME_HELLO_ENABLED/);
    }
  });

  it('rejects invalid booleans and requires a valid immutable cohort timestamp only when enrollment is on', () => {
    expect(() =>
      loadLifecycleRuntimeConfiguration({ CAMPAIGN_ENABLED: 'TRUE' })
    ).toThrow(/CAMPAIGN_ENABLED/u);
    expect(() =>
      loadLifecycleRuntimeConfiguration({ CAMPAIGN_ENROLLMENT_ENABLED: 'true' })
    ).toThrow(/CAMPAIGN_ENROLLMENT_START_AT/u);
    expect(
      loadLifecycleRuntimeConfiguration({
        CAMPAIGN_ENROLLMENT_ENABLED: 'true',
        CAMPAIGN_ENROLLMENT_START_AT: '2026-09-01T12:00:00.000Z',
      }).campaignEnrollmentStartAt
    ).toEqual(new Date('2026-09-01T12:00:00.000Z'));
  });

  it.each([
    '0',
    '09/01/2026 12:00:00',
    '2026-09-01T12:00:00',
    '2026-09-01T12:00:00Z',
    '2026-09-01T12:00:00.000+00:00',
    '2026-09-01T12:00:00.000-07:00',
    '2026-02-30T12:00:00.000Z',
  ])('rejects noncanonical campaign cohort timestamp %s', (value) => {
    expect(() =>
      loadLifecycleRuntimeConfiguration({
        CAMPAIGN_ENROLLMENT_ENABLED: 'true',
        CAMPAIGN_ENROLLMENT_START_AT: value,
      })
    ).toThrow(/canonical UTC RFC3339/u);
  });

  it('requires the configured founder on the preview/test allowlist', () => {
    expect(
      () =>
        createDefaultLifecycleJobDependencies({
          CAMPAIGN_ENABLED: 'false',
          CAMPAIGN_ENROLLMENT_ENABLED: 'false',
          DELIVERY_ENABLED: 'true',
          DELIVERY_ENVIRONMENT: 'test',
          GROWTH_DATABASE_ENVIRONMENT: 'test',
          RESEND_API_KEY: 'test-key',
          RESEND_SENDER_VERIFIED: 'true',
          RESEND_TRACKING_DISABLED: 'true',
          RESEND_NON_PRODUCTION_ALLOWLIST: 'brian@threadplane.ai',
          RESEND_NON_PRODUCTION_REDIRECT_TO: 'brian@threadplane.ai',
          FOUNDER_NOTIFICATION_EMAIL: 'founder@threadplane.ai',
          GROWTH_ACTION_TOKEN_ACTIVE_VERSION: '1',
          GROWTH_ACTION_TOKEN_ACTIVE_SECRET:
            'runtime-policy-test-token-secret-material',
        }).recipientPolicy
    ).toThrow(/founder.*allowlist/iu);
  });

  it('validates the full delivery policy when a mail path first needs it', () => {
    expect(
      () =>
        createDefaultLifecycleJobDependencies({
          CAMPAIGN_ENABLED: 'false',
          CAMPAIGN_ENROLLMENT_ENABLED: 'false',
          DELIVERY_ENABLED: 'true',
          DELIVERY_ENVIRONMENT: 'preview',
          GROWTH_DATABASE_ENVIRONMENT: 'test',
          RESEND_API_KEY: 'test-key',
          RESEND_SENDER_VERIFIED: 'true',
          RESEND_TRACKING_DISABLED: 'true',
          RESEND_NON_PRODUCTION_ALLOWLIST:
            'brian@threadplane.ai,founder@threadplane.ai',
          RESEND_NON_PRODUCTION_REDIRECT_TO: 'founder@threadplane.ai',
          FOUNDER_NOTIFICATION_EMAIL: 'founder@threadplane.ai',
          GROWTH_ACTION_TOKEN_ACTIVE_VERSION: '1',
          GROWTH_ACTION_TOKEN_ACTIVE_SECRET:
            'runtime-policy-test-token-secret-material',
        }).recipientPolicy
    ).toThrow(/environment.*match/iu);
  });

  it('requires a bare HTTPS public action origin and uses it for unsubscribe links', () => {
    const environment = {
      CAMPAIGN_ENABLED: 'false',
      CAMPAIGN_ENROLLMENT_ENABLED: 'false',
      DELIVERY_ENABLED: 'true',
      DELIVERY_ENVIRONMENT: 'preview',
      GROWTH_DATABASE_ENVIRONMENT: 'preview',
      RESEND_API_KEY: 'test-key',
      RESEND_SENDER_VERIFIED: 'true',
      RESEND_TRACKING_DISABLED: 'true',
      RESEND_NON_PRODUCTION_ALLOWLIST:
        'brian@threadplane.ai,founder@threadplane.ai',
      RESEND_NON_PRODUCTION_REDIRECT_TO: 'founder@threadplane.ai',
      FOUNDER_NOTIFICATION_EMAIL: 'founder@threadplane.ai',
      GROWTH_ACTION_TOKEN_ACTIVE_VERSION: '1',
      GROWTH_ACTION_TOKEN_ACTIVE_SECRET:
        'runtime-policy-test-token-secret-material',
    };

    const missing = createDefaultLifecycleJobDependencies(environment);
    expect(() => missing.tokenKey).toThrow(/GROWTH_PUBLIC_ACTION_ORIGIN/u);

    for (const invalidOrigin of [
      'http://website-preview.example',
      'https://website-preview.example/api/unsubscribe',
      ' https://website-preview.example',
      'https://website-preview.example ',
    ]) {
      const invalid = createDefaultLifecycleJobDependencies({
        ...environment,
        GROWTH_PUBLIC_ACTION_ORIGIN: invalidOrigin,
      });
      expect(() => invalid.tokenKey).toThrow(/public action origin/iu);
    }

    const configured = createDefaultLifecycleJobDependencies({
      ...environment,
      GROWTH_PUBLIC_ACTION_ORIGIN: 'https://website-preview.example',
    });
    const actionUrl = configured.createUnsubscribeUrl(
      { contactId: CONTACT_ID, issuedAt: NOW },
      configured.tokenKey
    );
    expect(unsubscribeActionUrlValue(actionUrl)).toMatch(
      /^https:\/\/website-preview\.example\/api\/unsubscribe\?token=g1\./u
    );
  });

  it('classifies a malformed internal Resend success shape as unknown', async () => {
    resendSend.mockResolvedValueOnce({ data: null, error: null });
    const dependencies = createDefaultLifecycleJobDependencies({
      CAMPAIGN_ENABLED: 'false',
      CAMPAIGN_ENROLLMENT_ENABLED: 'false',
      DELIVERY_ENABLED: 'true',
      DELIVERY_ENVIRONMENT: 'test',
      GROWTH_DATABASE_ENVIRONMENT: 'test',
      RESEND_API_KEY: 'test-key',
      RESEND_SENDER_VERIFIED: 'true',
      RESEND_TRACKING_DISABLED: 'true',
      RESEND_NON_PRODUCTION_ALLOWLIST:
        'brian@threadplane.ai,founder@threadplane.ai',
      RESEND_NON_PRODUCTION_REDIRECT_TO: 'founder@threadplane.ai',
      FOUNDER_NOTIFICATION_EMAIL: 'founder@threadplane.ai',
      GROWTH_PUBLIC_ACTION_ORIGIN: 'https://website.test',
      GROWTH_ACTION_TOKEN_ACTIVE_VERSION: '1',
      GROWTH_ACTION_TOKEN_ACTIVE_SECRET:
        'runtime-policy-test-token-secret-material',
    });

    await expect(
      dependencies.sendInternalNotification({
        to: 'founder@threadplane.ai',
        subject: 'Review',
        text: 'Bounded review.',
        idempotencyKey: 'notify:test',
      })
    ).resolves.toEqual({ outcome: 'unknown' });

    resendSend.mockResolvedValueOnce({
      data: { id: 'resend-internal-1' },
      error: null,
    });
    await expect(
      dependencies.sendInternalNotification({
        to: 'founder@threadplane.ai',
        subject: 'Review',
        text: 'Bounded review.',
        idempotencyKey: 'notify:test:accepted',
      })
    ).resolves.toEqual({ outcome: 'accepted' });
  });
});

describe('install digest jobs', () => {
  const digest = () =>
    ({
      ...job('digest', {
        business_date: '2026-09-16',
        digest_kind: 'install_identities',
      }),
      contactId: null,
    } as GrowthJob);

  it('renders, claims, sends to the founder, records the identities and completes', async () => {
    const deps = dependencies();
    await expect(
      dispatchLifecycleAppOwnedJob({} as SqlExecutor, digest(), {}, deps)
    ).resolves.toBe('completed');
    expect(deps.claimInternalNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: 'digest' })
    );
    expect(deps.sendInternalNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'founder@threadplane.ai',
        subject: 'Threadplane install digest for 2026-09-16: 1 new identity',
        text: expect.stringContaining(
          'dev@corp.example (Dev Person) — corp.example'
        ),
        idempotencyKey: digest().idempotencyKey,
        kind: 'digest',
      })
    );
    const text = (deps.sendInternalNotification as ReturnType<typeof vi.fn>)
      .mock.calls[0][0].text as string;
    expect(text).toMatch(
      /https:\/\/threadplane\.ai\/api\/growth\/approve-install\?token=g1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/u
    );
    expect(deps.markInstallDigestReported).toHaveBeenCalledWith(
      expect.anything(),
      {
        digestJobId: digest().id,
        reportedAt: NOW,
        candidates: [DIGEST_CANDIDATE],
      }
    );
    expect(deps.completeJob).toHaveBeenCalledOnce();
    expect(deps.sendRecipient).not.toHaveBeenCalled();
    expect(deps.readJobContext).not.toHaveBeenCalled();
  });

  it('completes without sending when no candidates remain', async () => {
    const deps = dependencies({
      readInstallDigestCandidates: vi.fn().mockResolvedValue([]),
    });
    await expect(
      dispatchLifecycleAppOwnedJob({} as SqlExecutor, digest(), {}, deps)
    ).resolves.toBe('completed');
    expect(deps.sendInternalNotification).not.toHaveBeenCalled();
    expect(deps.markInstallDigestReported).not.toHaveBeenCalled();
  });

  it('defers while delivery is disabled', async () => {
    const deps = dependencies();
    deps.recipientPolicy = { ...deps.recipientPolicy, deliveryEnabled: false };
    await expect(
      dispatchLifecycleAppOwnedJob({} as SqlExecutor, digest(), {}, deps)
    ).resolves.toBe('deferred');
    expect(deps.deferJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ errorCode: 'delivery_disabled' })
    );
    expect(deps.sendInternalNotification).not.toHaveBeenCalled();
  });

  it('fails for manual review and does not record identities when the claim is lost or the outcome is unknown', async () => {
    const lost = dependencies({
      claimInternalNotification: vi.fn().mockResolvedValue(false),
    });
    await expect(
      dispatchLifecycleAppOwnedJob({} as SqlExecutor, digest(), {}, lost)
    ).resolves.toBe('failed');
    expect(lost.sendInternalNotification).not.toHaveBeenCalled();
    expect(lost.markInstallDigestReported).not.toHaveBeenCalled();

    const unknown = dependencies({
      sendInternalNotification: vi
        .fn()
        .mockResolvedValue({ outcome: 'unknown' }),
    });
    await expect(
      dispatchLifecycleAppOwnedJob({} as SqlExecutor, digest(), {}, unknown)
    ).resolves.toBe('failed');
    expect(unknown.markInternalNotificationUnknown).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: 'digest' })
    );
    expect(unknown.markInstallDigestReported).not.toHaveBeenCalled();
  });
});
