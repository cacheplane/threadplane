import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { Resend } from 'resend';

import type { SqlExecutor } from './database.ts';
import type { GrowthJob } from './models.ts';
import {
  createGrowthActionToken,
  createUnsubscribeActionUrl,
  unsubscribeActionUrlValue,
} from './tokens.ts';
import {
  APPROVED_ATTACHMENT_PATHS,
  RECIPIENT_EMAIL_SENDER,
  sendRecipientEmail,
  reconcilePendingResendMessageIds,
  type RecipientDeliveryPolicy,
  type RecipientResendClient,
} from './resend.ts';

const now = new Date('2026-09-01T14:00:00.000Z');
const jobId = '00000000-0000-4000-8000-000000000001';
const leaseToken = '00000000-0000-4000-8000-000000000099';
const contactId = '00000000-0000-4000-8000-000000000002';
const providerEmailId = '4e1f6e67-e9a1-4b8f-9ec8-a4a9f886c817';
const unsubscribeActionUrl = createUnsubscribeActionUrl(
  {
    contactId,
    issuedAt: now,
    eventNonce: 'resend-contract-test',
  },
  { version: 1, secret: 'resend-contract-test-token-secret!!' },
  'https://website.test'
);
const unsubscribeUrl = unsubscribeActionUrlValue(unsubscribeActionUrl);
const founderStopToken = createGrowthActionToken(
  {
    contactId: '00000000-0000-4000-8000-000000000002',
    purpose: 'founder_stop',
    issuedAt: now,
  },
  { version: 1, secret: 'resend-contract-test-token-secret!!' }
);

function executor(): SqlExecutor {
  return {
    execute: vi.fn(),
    transaction: vi.fn(),
  } as unknown as SqlExecutor;
}

function job(overrides: Partial<GrowthJob> = {}): GrowthJob {
  return {
    id: jobId,
    kind: 'send_step',
    contactId: '00000000-0000-4000-8000-000000000002',
    projectId: null,
    status: 'leased',
    availableAt: now,
    leaseUntil: new Date('2026-09-01T14:05:00.000Z'),
    leaseToken,
    attempts: 1,
    idempotencyKey: 'campaign:v1:contact:step:1',
    payload: { campaign_version: 'v1', step: 1 },
    providerEmailId: null,
    rfcMessageId: null,
    gmailSeedMessageId: null,
    deliveryStatus: 'not_submitted',
    lastErrorCode: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function productionPolicy(
  overrides: Partial<RecipientDeliveryPolicy> = {}
): RecipientDeliveryPolicy {
  return {
    campaignEnabled: true,
    deliveryEnabled: true,
    environment: 'production',
    databaseEnvironment: 'production',
    senderVerified: true,
    verifiedDomain: 'threadplane.ai',
    configuredSender: RECIPIENT_EMAIL_SENDER,
    providerTrackingDisabled: true,
    nonProductionRecipientAllowlist: [],
    ...overrides,
  };
}

function harness(overrides: { job?: GrowthJob; response?: unknown } = {}) {
  const database = executor();
  const authorizedJob = overrides.job ?? job();
  const authorizeLeasedJobForSubmission = vi.fn().mockResolvedValue({
    authorized: true,
    job: authorizedJob,
    recipient: {
      contactId: authorizedJob.contactId,
      emailNormalized: 'developer@example.com',
    },
    boundedRaceNotice: 'a_future_stop_can_overlap_provider_submission',
  });
  const recordProviderAcceptance = vi
    .fn()
    .mockResolvedValue({ ...authorizedJob, providerEmailId });
  const markProviderAcceptanceUnknown = vi.fn().mockResolvedValue({
    ...authorizedJob,
    deliveryStatus: 'unknown',
  });
  const markProviderRejection = vi.fn().mockResolvedValue({
    ...authorizedJob,
    status: 'failed',
    deliveryStatus: 'failed',
  });
  const send = vi.fn().mockResolvedValue(
    overrides.response ?? {
      data: { id: providerEmailId },
      error: null,
      headers: {},
    }
  );
  return {
    database,
    send,
    authorizeLeasedJobForSubmission,
    recordProviderAcceptance,
    markProviderAcceptanceUnknown,
    markProviderRejection,
    dependencies: {
      now: () => now,
      resend: { emails: { send } },
      authorizeLeasedJobForSubmission,
      recordProviderAcceptance,
      markProviderAcceptanceUnknown,
      markProviderRejection,
    },
  };
}

const APPROVED_GUIDE = {
  filename: 'angular-streaming-guide.pdf',
  path: 'https://threadplane.ai/whitepapers/angular.pdf',
};

function fulfillmentJob() {
  return job({
    kind: 'fulfill',
    idempotencyKey: 'fulfill:whitepaper:contact',
    payload: { fulfillment_kind: 'whitepaper' },
  });
}

const message = {
  jobId,
  leaseToken,
  subject: 'A Threadplane architecture note',
  text: 'Hi Sam,\n\nHere is the architecture note.\n\nBrian',
  unsubscribeUrl: unsubscribeActionUrl,
  campaignTemplate: 'immediate' as const,
};

describe('sendRecipientEmail', () => {
  it('accepts the pinned Resend SDK client contract without an adapter cast', () => {
    expectTypeOf<Resend>().toMatchTypeOf<RecipientResendClient>();
  });

  it('sends the exact text-only recipient contract and persists provider acceptance', async () => {
    const test = harness();

    const result = await sendRecipientEmail(
      test.database,
      message,
      productionPolicy(),
      test.dependencies
    );

    expect(result).toEqual({ accepted: true, providerEmailId });
    expect(test.send).toHaveBeenCalledWith(
      {
        from: RECIPIENT_EMAIL_SENDER,
        to: 'developer@example.com',
        replyTo: RECIPIENT_EMAIL_SENDER,
        subject: message.subject,
        text: message.text,
        headers: {
          'List-Unsubscribe': `<${unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          'X-Threadplane-Job-ID': jobId,
        },
        tags: [
          { name: 'app', value: 'threadplane' },
          { name: 'environment', value: 'production' },
          { name: 'job_kind', value: 'send_step' },
          { name: 'campaign_version', value: 'v1' },
          { name: 'campaign_step', value: '1' },
          { name: 'campaign_template', value: 'immediate' },
        ],
      },
      { idempotencyKey: 'campaign:v1:contact:step:1' }
    );
    const payload = test.send.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('html');
    expect(payload).not.toHaveProperty('react');
    expect(payload).not.toHaveProperty('scheduledAt');
    expect(JSON.stringify(payload.headers)).not.toContain(
      'developer@example.com'
    );
    expect(JSON.stringify(payload.tags)).not.toContain('developer@example.com');
    expect(test.recordProviderAcceptance).toHaveBeenCalledWith(test.database, {
      jobId,
      leaseToken,
      acceptedAt: now,
      providerEmailId,
    });
    expect(test.markProviderAcceptanceUnknown).not.toHaveBeenCalled();
  });

  it('forwards a plain-paragraph HTML alternative that links the unsubscribe URL', async () => {
    const test = harness();
    const html = `<p>Hi Sam,</p><p>Here is the <a href="https://threadplane.ai/docs">note</a>.</p><p>To stop these emails, click <a href="${unsubscribeUrl}">here</a>.</p>`;

    await expect(
      sendRecipientEmail(
        test.database,
        { ...message, html },
        productionPolicy(),
        test.dependencies
      )
    ).resolves.toEqual({ accepted: true, providerEmailId });
    const payload = test.send.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload['html']).toBe(html);
    expect(payload['text']).toBe(message.text);
  });

  it.each([
    [
      'a tracking image',
      '<p>Hi</p><img src="https://tracker.example/pixel.gif">',
    ],
    ['a script', '<p>Hi</p><script>alert(1)</script>'],
    ['a style block', '<style>p{color:red}</style><p>Hi</p>'],
    ['an inline style', '<p style="color:red">Hi</p>'],
    [
      'an event handler',
      '<p><a href="https://threadplane.ai/docs" onclick="x()">Docs</a></p>',
    ],
    ['a non-HTTPS anchor', '<p><a href="javascript:alert(1)">Docs</a></p>'],
    [
      'an unquoted anchor',
      '<p><a href=https://threadplane.ai/docs>Docs</a></p>',
    ],
    ['an unknown element', '<div><p>Hi</p></div>'],
    ['an HTML comment', '<p>Hi</p><!-- hidden -->'],
    [
      'no unsubscribe link',
      '<p>Hi</p><p><a href="https://threadplane.ai/docs">Docs</a></p>',
    ],
  ])(
    'rejects an HTML alternative containing %s before authorization',
    async (_case, fragment) => {
      const test = harness();
      const html = fragment.includes(unsubscribeUrl)
        ? fragment
        : _case === 'no unsubscribe link'
        ? fragment
        : `${fragment}<p><a href="${unsubscribeUrl}">here</a></p>`;

      await expect(
        sendRecipientEmail(
          test.database,
          { ...message, html },
          productionPolicy(),
          test.dependencies
        )
      ).rejects.toThrow();
      expect(test.authorizeLeasedJobForSubmission).not.toHaveBeenCalled();
      expect(test.send).not.toHaveBeenCalled();
    }
  );

  it('rejects an HTML alternative that repeats the unsubscribe link', async () => {
    const test = harness();
    const html = `<p><a href="${unsubscribeUrl}">here</a> or <a href="${unsubscribeUrl}">here</a></p>`;

    await expect(
      sendRecipientEmail(
        test.database,
        { ...message, html },
        productionPolicy(),
        test.dependencies
      )
    ).rejects.toThrow(/exactly once/u);
    expect(test.send).not.toHaveBeenCalled();
  });

  it.each([
    'immediate',
    'day-3',
    'day-8',
    'streaming_foundation',
    'debugging_layers',
    'event_state_boundary',
  ] as const)('tags a send_step with the %s template', async (template) => {
    const test = harness();

    await sendRecipientEmail(
      test.database,
      { ...message, campaignTemplate: template },
      productionPolicy(),
      test.dependencies
    );

    expect(test.send.mock.calls[0]?.[0]).toMatchObject({
      tags: expect.arrayContaining([
        { name: 'campaign_template', value: template },
      ]),
    });
  });

  it.each([
    undefined,
    '',
    'day-4',
    'immediate; developer@example.com',
    'IMMEDIATE',
  ])(
    'rejects a send_step whose template is outside the closed allowlist (%j)',
    async (template) => {
      const test = harness();

      await expect(
        sendRecipientEmail(
          test.database,
          { ...message, campaignTemplate: template as never },
          productionPolicy(),
          test.dependencies
        )
      ).rejects.toThrow(/campaign template/u);
      expect(test.send).not.toHaveBeenCalled();
    }
  );

  it('rejects a campaign template on a non-campaign job', async () => {
    const test = harness({
      job: job({
        kind: 'fulfill',
        idempotencyKey: 'fulfill:whitepaper:contact',
        payload: { fulfillment_kind: 'whitepaper' },
      }),
    });

    await expect(
      sendRecipientEmail(
        test.database,
        message,
        productionPolicy(),
        test.dependencies
      )
    ).rejects.toThrow(/campaign template/u);
    expect(test.send).not.toHaveBeenCalled();
  });

  it('uses a separate fulfillment tag contract without campaign tags', async () => {
    const test = harness({
      job: job({
        kind: 'fulfill',
        idempotencyKey: 'fulfill:whitepaper:contact',
        payload: { fulfillment_kind: 'whitepaper' },
      }),
    });

    await sendRecipientEmail(
      test.database,
      { ...message, campaignTemplate: undefined },
      productionPolicy(),
      test.dependencies
    );

    expect(test.send.mock.calls[0]?.[0]).toMatchObject({
      tags: [
        { name: 'app', value: 'threadplane' },
        { name: 'environment', value: 'production' },
        { name: 'job_kind', value: 'fulfill' },
      ],
    });
  });

  it('attaches an approved deliverable to fulfillment mail', async () => {
    const test = harness({ job: fulfillmentJob() });

    await sendRecipientEmail(
      test.database,
      {
        ...message,
        campaignTemplate: undefined,
        attachments: [
          {
            filename: 'angular-streaming-guide.pdf',
            path: 'https://threadplane.ai/whitepapers/angular.pdf',
          },
        ],
      },
      productionPolicy(),
      test.dependencies
    );

    expect(test.send.mock.calls[0]?.[0]).toMatchObject({
      attachments: [
        {
          filename: 'angular-streaming-guide.pdf',
          path: 'https://threadplane.ai/whitepapers/angular.pdf',
        },
      ],
    });
  });

  it.each(APPROVED_ATTACHMENT_PATHS)(
    'submits the approved deliverable path %s unchanged',
    async (path) => {
      const test = harness({ job: fulfillmentJob() });

      await sendRecipientEmail(
        test.database,
        {
          ...message,
          campaignTemplate: undefined,
          attachments: [{ filename: 'guide.pdf', path }],
        },
        productionPolicy(),
        test.dependencies
      );

      expect(test.send.mock.calls[0]?.[0]).toMatchObject({
        attachments: [{ filename: 'guide.pdf', path }],
      });
    }
  );

  it('sends no attachments key when fulfillment mail carries no file', async () => {
    const test = harness({ job: fulfillmentJob() });

    await sendRecipientEmail(
      test.database,
      { ...message, campaignTemplate: undefined },
      productionPolicy(),
      test.dependencies
    );

    expect(test.send.mock.calls[0]?.[0]).not.toHaveProperty('attachments');
  });

  it('rejects an attachment on a campaign step', async () => {
    const test = harness();

    await expect(
      sendRecipientEmail(
        test.database,
        {
          ...message,
          attachments: [
            {
              filename: 'angular-streaming-guide.pdf',
              path: 'https://threadplane.ai/whitepapers/angular.pdf',
            },
          ],
        },
        productionPolicy(),
        test.dependencies
      )
    ).rejects.toThrow(/Only fulfill mail carries an attachment/u);
    expect(test.send).not.toHaveBeenCalled();
  });

  it.each([
    'https://threadplane.ai/whitepapers/angular.pdf?x=1',
    'https://threadplane.ai/../etc/passwd',
    'https://evil.example/whitepapers/angular.pdf',
    'http://threadplane.ai/whitepaper.pdf',
    'https://threadplane.ai/whitepapers/Angular.pdf',
    'file:///etc/passwd',
    '/whitepaper.pdf',
  ])('rejects the off-registry attachment path %s', async (path) => {
    const test = harness({ job: fulfillmentJob() });

    await expect(
      sendRecipientEmail(
        test.database,
        {
          ...message,
          campaignTemplate: undefined,
          attachments: [{ filename: 'guide.pdf', path }],
        },
        productionPolicy(),
        test.dependencies
      )
    ).rejects.toThrow(/attachment\.path/u);
    expect(test.send).not.toHaveBeenCalled();
  });

  it.each([
    '',
    'guide.exe',
    'guide.pdf.exe',
    '../guide.pdf',
    'Guide.pdf',
    'guide report.pdf',
    'guide.pdf\nBcc: victim@example.com',
  ])('rejects the unsafe attachment filename %j', async (filename) => {
    const test = harness({ job: fulfillmentJob() });

    await expect(
      sendRecipientEmail(
        test.database,
        {
          ...message,
          campaignTemplate: undefined,
          attachments: [
            {
              filename,
              path: 'https://threadplane.ai/whitepapers/angular.pdf',
            },
          ],
        },
        productionPolicy(),
        test.dependencies
      )
    ).rejects.toThrow(/attachment\.filename/u);
    expect(test.send).not.toHaveBeenCalled();
  });

  it.each([[[]], [[APPROVED_GUIDE, APPROVED_GUIDE]]])(
    'rejects an attachment list that is not exactly one file (%j)',
    async (attachments) => {
      const test = harness({ job: fulfillmentJob() });

      await expect(
        sendRecipientEmail(
          test.database,
          { ...message, campaignTemplate: undefined, attachments },
          productionPolicy(),
          test.dependencies
        )
      ).rejects.toThrow(/exactly one attachment/u);
      expect(test.send).not.toHaveBeenCalled();
    }
  );

  it('returns an explicit rejection for a resolved provider error without recording acceptance', async () => {
    const test = harness({
      response: {
        data: null,
        error: {
          name: 'validation_error',
          message: 'rejected',
          statusCode: 422,
        },
        headers: {},
      },
    });

    await expect(
      sendRecipientEmail(
        test.database,
        message,
        productionPolicy(),
        test.dependencies
      )
    ).resolves.toEqual({ accepted: false, reason: 'provider_rejected' });
    expect(test.recordProviderAcceptance).not.toHaveBeenCalled();
    expect(test.markProviderAcceptanceUnknown).not.toHaveBeenCalled();
    expect(test.markProviderRejection).toHaveBeenCalledWith(test.database, {
      errorCode: 'resend_validation_error',
      jobId,
      leaseToken,
      occurredAt: now,
    });
  });

  it.each([
    ['concurrent_idempotent_requests', 409],
    ['invalid_idempotent_request', 409],
    ['rate_limit_exceeded', 429],
    ['internal_server_error', 500],
  ] as const)(
    'treats ambiguous Resend %s (%i) as unknown manual review',
    async (name, statusCode) => {
      const test = harness({
        response: {
          data: null,
          error: { name, message: 'ambiguous provider response', statusCode },
          headers: {},
        },
      });

      await expect(
        sendRecipientEmail(
          test.database,
          message,
          productionPolicy(),
          test.dependencies
        )
      ).resolves.toEqual({
        accepted: false,
        reason: 'provider_outcome_unknown',
      });
      expect(test.markProviderRejection).not.toHaveBeenCalled();
      expect(test.markProviderAcceptanceUnknown).toHaveBeenCalledOnce();
    }
  );

  it('marks the exact resolved Resend network error shape unknown without retrying', async () => {
    const test = harness({
      response: {
        data: null,
        error: {
          name: 'application_error',
          message: 'Unable to fetch data. The request could not be resolved.',
          statusCode: null,
        },
        headers: null,
      },
    });

    await expect(
      sendRecipientEmail(
        test.database,
        message,
        productionPolicy(),
        test.dependencies
      )
    ).resolves.toEqual({ accepted: false, reason: 'provider_outcome_unknown' });
    expect(test.send).toHaveBeenCalledTimes(1);
    expect(test.recordProviderAcceptance).not.toHaveBeenCalled();
    expect(test.markProviderAcceptanceUnknown).toHaveBeenCalledWith(
      test.database,
      {
        jobId,
        leaseToken,
        occurredAt: now,
        errorCode: 'resend_submission_outcome_unknown',
      }
    );
  });

  it('moves a malformed provider acceptance ID to unknown instead of persisting it', async () => {
    const test = harness({
      response: {
        data: { id: 'developer@example.com' },
        error: null,
        headers: {},
      },
    });

    await expect(
      sendRecipientEmail(
        test.database,
        message,
        productionPolicy(),
        test.dependencies
      )
    ).resolves.toEqual({ accepted: false, reason: 'provider_outcome_unknown' });
    expect(test.recordProviderAcceptance).not.toHaveBeenCalled();
    expect(test.markProviderAcceptanceUnknown).toHaveBeenCalledTimes(1);
  });

  it('marks a thrown provider outcome unknown and never retries in the helper', async () => {
    const test = harness();
    test.send.mockRejectedValueOnce(new Error('network outcome unknown'));

    await expect(
      sendRecipientEmail(
        test.database,
        message,
        productionPolicy(),
        test.dependencies
      )
    ).resolves.toEqual({ accepted: false, reason: 'provider_outcome_unknown' });
    expect(test.send).toHaveBeenCalledTimes(1);
    expect(test.recordProviderAcceptance).not.toHaveBeenCalled();
    expect(test.markProviderAcceptanceUnknown).toHaveBeenCalledWith(
      test.database,
      {
        jobId,
        leaseToken,
        occurredAt: now,
        errorCode: 'resend_submission_outcome_unknown',
      }
    );
  });

  it('records the post-submission observation time rather than the earlier authorization time', async () => {
    const test = harness();
    const submittedAt = new Date('2026-09-01T14:00:02.000Z');
    test.dependencies.now = vi
      .fn()
      .mockReturnValue(submittedAt)
      .mockReturnValueOnce(now)
      .mockReturnValueOnce(submittedAt);

    await sendRecipientEmail(
      test.database,
      message,
      productionPolicy(),
      test.dependencies
    );

    expect(test.authorizeLeasedJobForSubmission).toHaveBeenCalledWith(
      test.database,
      {
        campaignEnabled: true,
        deliveryEnabled: true,
        jobId,
        leaseToken,
        now,
        currentTime: test.dependencies.now,
      }
    );
    expect(test.recordProviderAcceptance).toHaveBeenCalledWith(
      test.database,
      expect.objectContaining({ acceptedAt: submittedAt })
    );
  });

  it('does not submit when final authorization denies the recipient', async () => {
    const test = harness();
    test.authorizeLeasedJobForSubmission.mockResolvedValueOnce({
      authorized: false,
      reason: 'outside_send_window',
      job: job(),
    });
    await expect(
      sendRecipientEmail(
        test.database,
        message,
        productionPolicy(),
        test.dependencies
      )
    ).resolves.toEqual({ accepted: false, reason: 'outside_send_window' });
    expect(test.send).not.toHaveBeenCalled();
  });

  it('rechecks the clock immediately before provider submission', async () => {
    const test = harness();
    test.dependencies.now = vi
      .fn()
      .mockReturnValueOnce(new Date('2026-09-01T14:59:59Z'))
      .mockReturnValue(new Date('2026-09-01T15:00:00Z'));
    await expect(
      sendRecipientEmail(
        test.database,
        message,
        productionPolicy(),
        test.dependencies
      )
    ).resolves.toEqual({ accepted: false, reason: 'outside_send_window' });
    expect(test.send).not.toHaveBeenCalled();
    expect(test.markProviderAcceptanceUnknown).not.toHaveBeenCalled();
  });

  it('does not submit when final authorization denies the recipient for a stop', async () => {
    const test = harness();
    test.authorizeLeasedJobForSubmission.mockResolvedValueOnce({
      authorized: false,
      reason: 'contact_stopped',
      job: job(),
    });

    await expect(
      sendRecipientEmail(
        test.database,
        message,
        productionPolicy(),
        test.dependencies
      )
    ).resolves.toEqual({ accepted: false, reason: 'contact_stopped' });
    expect(test.send).not.toHaveBeenCalled();
  });

  it('does not call Resend when cancellation arrives after durable final authorization', async () => {
    const controller = new AbortController();
    const test = harness();
    test.authorizeLeasedJobForSubmission.mockImplementationOnce(async () => {
      controller.abort(new Error('lease lost after authorization'));
      return {
        authorized: true,
        job: job(),
        recipient: {
          contactId,
          emailNormalized: 'developer@example.com',
        },
        boundedRaceNotice: 'a_future_stop_can_overlap_provider_submission',
      };
    });

    await expect(
      sendRecipientEmail(
        test.database,
        { ...message, signal: controller.signal },
        productionPolicy(),
        test.dependencies
      )
    ).rejects.toThrow('lease lost after authorization');
    expect(test.send).not.toHaveBeenCalled();
    expect(test.recordProviderAcceptance).not.toHaveBeenCalled();
    expect(test.markProviderAcceptanceUnknown).not.toHaveBeenCalled();
    expect(test.markProviderRejection).not.toHaveBeenCalled();
  });

  it('passes the campaign switch into the immediate final authorization gate', async () => {
    const test = harness();
    test.authorizeLeasedJobForSubmission.mockResolvedValueOnce({
      authorized: false,
      reason: 'campaign_disabled',
      job: job(),
    });

    await expect(
      sendRecipientEmail(
        test.database,
        message,
        productionPolicy({ campaignEnabled: false }),
        test.dependencies
      )
    ).resolves.toEqual({ accepted: false, reason: 'campaign_disabled' });
    expect(test.authorizeLeasedJobForSubmission).toHaveBeenCalledWith(
      test.database,
      expect.objectContaining({
        campaignEnabled: false,
        deliveryEnabled: true,
      })
    );
    expect(test.send).not.toHaveBeenCalled();
  });

  it('passes the delivery switch into the immediate final authorization gate', async () => {
    const test = harness();
    test.authorizeLeasedJobForSubmission.mockResolvedValueOnce({
      authorized: false,
      reason: 'delivery_disabled',
      job: job(),
    });

    await expect(
      sendRecipientEmail(
        test.database,
        message,
        productionPolicy({ deliveryEnabled: false }),
        test.dependencies
      )
    ).resolves.toEqual({ accepted: false, reason: 'delivery_disabled' });
    expect(test.authorizeLeasedJobForSubmission).toHaveBeenCalledWith(
      test.database,
      expect.objectContaining({ deliveryEnabled: false })
    );
    expect(test.send).not.toHaveBeenCalled();
  });

  it.each([
    ['campaignEnabled', undefined],
    ['campaignEnabled', 'true'],
    ['deliveryEnabled', undefined],
    ['deliveryEnabled', 'true'],
  ] as const)('fails closed for nonboolean policy %s', async (field, value) => {
    const test = harness();
    await expect(
      sendRecipientEmail(
        test.database,
        message,
        productionPolicy({ [field]: value } as never),
        test.dependencies
      )
    ).rejects.toThrow(new RegExp(field, 'iu'));
    expect(test.authorizeLeasedJobForSubmission).not.toHaveBeenCalled();
    expect(test.send).not.toHaveBeenCalled();
  });

  it('uses only the canonical contact email returned by final authorization', async () => {
    const test = harness();
    const attemptedOverride = {
      ...message,
      to: 'attacker@example.com',
    };
    test.authorizeLeasedJobForSubmission.mockResolvedValueOnce({
      authorized: true,
      job: job(),
      recipient: {
        contactId,
        emailNormalized: 'canonical@example.com',
      },
      boundedRaceNotice: 'a_future_stop_can_overlap_provider_submission',
    });

    await sendRecipientEmail(
      test.database,
      attemptedOverride,
      productionPolicy(),
      test.dependencies
    );

    expect(test.send.mock.calls[0]?.[0]).toMatchObject({
      to: 'canonical@example.com',
    });
    expect(JSON.stringify(test.send.mock.calls[0]?.[0])).not.toContain(
      'attacker@example.com'
    );
  });

  it.each([
    [
      'a different authorized contact',
      {
        contactId: '00000000-0000-4000-8000-000000000777',
        emailNormalized: 'attacker@example.com',
      },
    ],
    ['a missing canonical recipient', { contactId, emailNormalized: null }],
  ] as const)(
    'rejects final authorization for %s before provider submission',
    async (_label, recipient) => {
      const test = harness();
      test.authorizeLeasedJobForSubmission.mockResolvedValueOnce({
        authorized: true,
        job: job(),
        recipient,
        boundedRaceNotice: 'a_future_stop_can_overlap_provider_submission',
      });

      await expect(
        sendRecipientEmail(
          test.database,
          message,
          productionPolicy(),
          test.dependencies
        )
      ).rejects.toThrow(/authorization|recipient/iu);
      expect(test.send).not.toHaveBeenCalled();
    }
  );

  it('rejects an unsubscribe URL bound to another contact before provider submission', async () => {
    const test = harness();
    const wrongContactUrl = createUnsubscribeActionUrl(
      {
        contactId: '00000000-0000-4000-8000-000000000777',
        issuedAt: now,
        eventNonce: 'wrong-contact',
      },
      { version: 1, secret: 'resend-contract-test-token-secret!!' },
      'https://website.test'
    );

    await expect(
      sendRecipientEmail(
        test.database,
        { ...message, unsubscribeUrl: wrongContactUrl },
        productionPolicy(),
        test.dependencies
      )
    ).rejects.toThrow(/contact/iu);
    expect(test.send).not.toHaveBeenCalled();
  });

  it.each([
    ['production database mixing', { databaseEnvironment: 'preview' }],
    ['unverified sender', { senderVerified: false }],
    [
      'wrong sender config',
      { configuredSender: 'Other <other@threadplane.ai>' },
    ],
    ['wrong verified domain', { verifiedDomain: 'example.com' }],
    ['provider tracking enabled', { providerTrackingDisabled: false }],
  ] as const)(
    'fails closed before authorization for %s',
    async (_label, change) => {
      const test = harness();

      await expect(
        sendRecipientEmail(
          test.database,
          message,
          productionPolicy(change as Partial<RecipientDeliveryPolicy>),
          test.dependencies
        )
      ).rejects.toThrow();
      expect(test.authorizeLeasedJobForSubmission).not.toHaveBeenCalled();
      expect(test.send).not.toHaveBeenCalled();
    }
  );

  it('requires a non-production database and a non-empty allowlist', async () => {
    const test = harness();
    const preview = productionPolicy({
      environment: 'preview',
      databaseEnvironment: 'preview',
      nonProductionRecipientAllowlist: [],
    });

    await expect(
      sendRecipientEmail(test.database, message, preview, test.dependencies)
    ).rejects.toThrow(/allowlist/iu);
    expect(test.authorizeLeasedJobForSubmission).not.toHaveBeenCalled();
  });

  it.each(['preview', 'test'] as const)(
    'allows %s recipient delivery without allowlisting an unused BCC mailbox',
    async (environment) => {
      const test = harness();
      const policy = productionPolicy({
        environment,
        databaseEnvironment: environment,
        nonProductionRecipientAllowlist: ['preview@threadplane.ai'],
        nonProductionRedirectTo: 'preview@threadplane.ai',
      });

      await expect(
        sendRecipientEmail(test.database, message, policy, test.dependencies)
      ).resolves.toEqual({ accepted: true, providerEmailId });
      expect(test.send.mock.calls[0]?.[0]).not.toHaveProperty('bcc');
    }
  );

  it.each([
    ['preview', 'test'],
    ['test', 'preview'],
  ] as const)(
    'rejects %s delivery against the %s database',
    async (environment, databaseEnvironment) => {
      const test = harness();
      const policy = productionPolicy({
        environment,
        databaseEnvironment,
        nonProductionRecipientAllowlist: ['preview@threadplane.ai'],
        nonProductionRedirectTo: 'preview@threadplane.ai',
      });

      await expect(
        sendRecipientEmail(test.database, message, policy, test.dependencies)
      ).rejects.toThrow(/database|environment/iu);
      expect(test.authorizeLeasedJobForSubmission).not.toHaveBeenCalled();
      expect(test.send).not.toHaveBeenCalled();
    }
  );

  it('rejects an unregistered runtime environment before authorization', async () => {
    const test = harness();
    const policy = productionPolicy({
      environment: 'staging' as never,
      databaseEnvironment: 'preview',
      nonProductionRecipientAllowlist: ['developer@example.com'],
    });

    await expect(
      sendRecipientEmail(test.database, message, policy, test.dependencies)
    ).rejects.toThrow(/environment/iu);
    expect(test.authorizeLeasedJobForSubmission).not.toHaveBeenCalled();
  });

  it('redirects preview mail only to an explicitly allowlisted address', async () => {
    const test = harness();
    const preview = productionPolicy({
      environment: 'preview',
      databaseEnvironment: 'preview',
      nonProductionRecipientAllowlist: [
        'preview@threadplane.ai',
        'brian@threadplane.ai',
      ],
      nonProductionRedirectTo: 'preview@threadplane.ai',
    });

    await sendRecipientEmail(
      test.database,
      message,
      preview,
      test.dependencies
    );

    expect(test.send.mock.calls[0]?.[0]).toMatchObject({
      to: 'preview@threadplane.ai',
      tags: expect.arrayContaining([{ name: 'environment', value: 'preview' }]),
    });
  });

  it.each([
    [{ ...message, subject: 'x'.repeat(201) }, /subject/iu],
    [{ ...message, text: 'x'.repeat(20_001) }, /text/iu],
    [
      {
        ...message,
        unsubscribeUrl:
          'https://threadplane.ai/api/unsubscribe?email=a%40b.com' as never,
      },
      /unsubscribe/iu,
    ],
    [
      {
        ...message,
        unsubscribeUrl:
          `https://threadplane.ai/api/unsubscribe?token=${founderStopToken}` as never,
      },
      /unsubscribe/iu,
    ],
  ] as const)(
    'rejects malformed or oversized recipient inputs %#',
    async (input, error) => {
      const test = harness();
      await expect(
        sendRecipientEmail(
          test.database,
          input,
          productionPolicy(),
          test.dependencies
        )
      ).rejects.toThrow(error);
      expect(test.authorizeLeasedJobForSubmission).not.toHaveBeenCalled();
    }
  );

  it('rejects internal and unknown job kinds at the recipient boundary', async () => {
    const test = harness({ job: job({ kind: 'notify' }) });

    await expect(
      sendRecipientEmail(
        test.database,
        message,
        productionPolicy(),
        test.dependencies
      )
    ).rejects.toThrow(/recipient job kind/iu);
    expect(test.send).not.toHaveBeenCalled();
  });

  it('rejects an idempotency key containing raw contact data before provider submission', async () => {
    const test = harness({
      job: job({ idempotencyKey: 'campaign:developer@example.com:step:1' }),
    });

    await expect(
      sendRecipientEmail(
        test.database,
        message,
        productionPolicy(),
        test.dependencies
      )
    ).rejects.toThrow(/idempotency/iu);
    expect(test.send).not.toHaveBeenCalled();
  });
});

describe('durable provider Message-ID lookup', () => {
  function lookupHarness(
    response: unknown = {
      id: providerEmailId,
      message_id: '<actual@resend.dev>',
      tags: { environment: 'production' },
    }
  ) {
    const database = executor();
    const execute = vi
      .fn()
      .mockResolvedValue({ rows: [{ provider_email_id: providerEmailId }] });
    database.execute = execute;
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(response)));
    const bindProviderMessageId = vi.fn().mockResolvedValue('bound');
    return {
      database,
      execute,
      fetch,
      bindProviderMessageId,
      dependencies: {
        fetch,
        bindProviderMessageId,
        apiKey: 'test-key',
        environment: 'production' as const,
        databaseEnvironment: 'production' as const,
      },
    };
  }
  it('durably reserves a bounded retry before authenticated retrieval of the exact accepted ID', async () => {
    const h = lookupHarness();
    await reconcilePendingResendMessageIds(
      h.database,
      { now, signal: new AbortController().signal },
      h.dependencies
    );
    expect(h.execute.mock.calls[0]?.[0]).toMatch(
      /for update of job skip locked/iu
    );
    expect(h.execute.mock.calls[0]?.[0]).toMatch(/message_id_lookup_after/u);
    expect(h.execute.mock.calls[0]?.[0]).toMatch(/rfc_message_id is null/u);
    expect(h.fetch).toHaveBeenCalledWith(
      `https://api.resend.com/emails/${providerEmailId}`,
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer test-key' },
        redirect: 'error',
      })
    );
    expect(h.bindProviderMessageId).toHaveBeenCalledWith(h.database, {
      providerEmailId,
      rfcMessageId: '<actual@resend.dev>',
    });
  });
  it.each([
    {
      id: 'different',
      message_id: '<actual@resend.dev>',
      tags: { environment: 'production' },
    },
    {
      id: providerEmailId,
      message_id: null,
      tags: { environment: 'production' },
    },
    {
      id: providerEmailId,
      message_id: '<actual@resend.dev>',
      tags: { environment: 'preview' },
    },
  ])(
    'leaves a durable retry for mismatched or missing identity: %j',
    async (response) => {
      const h = lookupHarness(response);
      await reconcilePendingResendMessageIds(
        h.database,
        { now, signal: new AbortController().signal },
        h.dependencies
      );
      expect(h.bindProviderMessageId).not.toHaveBeenCalled();
      expect(h.execute).toHaveBeenCalledOnce();
    }
  );
  it('retains the retry when retrieval fails, without submitting email', async () => {
    const h = lookupHarness();
    h.fetch.mockRejectedValue(new Error('temporary'));
    await expect(
      reconcilePendingResendMessageIds(
        h.database,
        { now, signal: new AbortController().signal },
        h.dependencies
      )
    ).resolves.toEqual({ attempted: 1, bound: 0 });
    expect(h.bindProviderMessageId).not.toHaveBeenCalled();
  });
  it('accepts the provider GET tag array format', async () => {
    const h = lookupHarness({
      id: providerEmailId,
      message_id: '<actual@resend.dev>',
      tags: [{ name: 'environment', value: 'production' }],
    });
    await reconcilePendingResendMessageIds(
      h.database,
      { now, signal: new AbortController().signal },
      h.dependencies
    );
    expect(h.bindProviderMessageId).toHaveBeenCalledOnce();
  });
  it('propagates database failures during binding while retaining the reserved retry', async () => {
    const h = lookupHarness();
    h.bindProviderMessageId.mockRejectedValue(
      new Error('database unavailable')
    );
    await expect(
      reconcilePendingResendMessageIds(
        h.database,
        { now, signal: new AbortController().signal },
        h.dependencies
      )
    ).rejects.toThrow('database unavailable');
    expect(h.execute).toHaveBeenCalledOnce();
  });
  it('rejects a database environment mismatch before reserving or fetching', async () => {
    const h = lookupHarness();
    await expect(
      reconcilePendingResendMessageIds(
        h.database,
        { now, signal: new AbortController().signal },
        { ...h.dependencies, databaseEnvironment: 'preview' }
      )
    ).rejects.toThrow(/matching environments/u);
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it('bounds the provider response and leaves a retry for oversized content', async () => {
    const h = lookupHarness();
    h.fetch.mockResolvedValue(new Response('x'.repeat(131_073)));
    await expect(
      reconcilePendingResendMessageIds(
        h.database,
        { now, signal: new AbortController().signal },
        h.dependencies
      )
    ).resolves.toEqual({ attempted: 1, bound: 0 });
    expect(h.bindProviderMessageId).not.toHaveBeenCalled();
  });
});
