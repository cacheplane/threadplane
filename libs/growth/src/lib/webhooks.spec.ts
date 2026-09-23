import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';
import type { WebhookEventPayload } from 'resend';

import type {
  SqlExecutor,
  SqlQueryResult,
  SqlTransaction,
} from './database.ts';
import {
  processVerifiedResendWebhook,
  type ProcessResendWebhookDependencies,
} from './webhooks.ts';

type TestRow = Record<string, unknown>;

const now = new Date('2026-09-01T12:00:00.000Z');
const jobId = '00000000-0000-4000-8000-000000000001';
const contactId = '00000000-0000-4000-8000-000000000002';
const providerEmailId = 'resend-email-1';

beforeEach(() => {
  vi.stubEnv('GROWTH_DATABASE_ENVIRONMENT', 'production');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const sdkBaseEmailData = {
  created_at: now.toISOString(),
  email_id: providerEmailId,
  from: 'Brian at Threadplane <brian@threadplane.ai>',
  to: ['developer@example.com'],
  subject: 'A note',
};

const supportedSdkFixtures = [
  { type: 'email.sent', created_at: now.toISOString(), data: sdkBaseEmailData },
  {
    type: 'email.delivered',
    created_at: now.toISOString(),
    data: sdkBaseEmailData,
  },
  {
    type: 'email.delivery_delayed',
    created_at: now.toISOString(),
    data: sdkBaseEmailData,
  },
  {
    type: 'email.complained',
    created_at: now.toISOString(),
    data: sdkBaseEmailData,
  },
  {
    type: 'email.bounced',
    created_at: now.toISOString(),
    data: {
      ...sdkBaseEmailData,
      bounce: { type: 'Permanent', subType: 'General', message: 'bounced' },
    },
  },
  {
    type: 'email.failed',
    created_at: now.toISOString(),
    data: { ...sdkBaseEmailData, failed: { reason: 'provider_rejected' } },
  },
  {
    type: 'email.suppressed',
    created_at: now.toISOString(),
    data: {
      ...sdkBaseEmailData,
      suppressed: { type: 'Suppressed', message: 'suppressed' },
    },
  },
] satisfies readonly Extract<
  WebhookEventPayload,
  {
    type:
      | 'email.sent'
      | 'email.delivered'
      | 'email.delivery_delayed'
      | 'email.complained'
      | 'email.bounced'
      | 'email.failed'
      | 'email.suppressed';
  }
>[];

function jobRow(overrides: TestRow = {}): TestRow {
  return {
    id: jobId,
    kind: 'send_step',
    contact_id: contactId,
    project_id: null,
    status: 'completed',
    payload: { campaign_version: 'v1', step: 1 },
    provider_email_id: providerEmailId,
    delivery_status: 'submitted',
    ...overrides,
  };
}

function executorWith(
  handlers: Record<
    string,
    (parameters: readonly unknown[], sql: string) => SqlQueryResult<TestRow>
  >
): {
  executor: SqlExecutor;
  calls: string[];
  runTransaction: Mock<
    (
      operation: (transaction: SqlTransaction) => Promise<unknown>
    ) => Promise<unknown>
  >;
} {
  const calls: string[] = [];
  const transaction: SqlTransaction = {
    async execute<Row extends Record<string, unknown>>(
      sql: string,
      parameters: readonly unknown[] = []
    ): Promise<SqlQueryResult<Row>> {
      const marker = /\/\* growth:([a-z0-9-]+) \*\//u.exec(sql)?.[1];
      const handler = marker ? handlers[marker] : undefined;
      if (!marker || !handler) {
        throw new Error(`Unexpected SQL marker: ${marker ?? 'missing'}`);
      }
      calls.push(marker);
      return handler(parameters, sql) as SqlQueryResult<Row>;
    },
  };
  const runTransaction = vi.fn(
    async (operation: (transaction: SqlTransaction) => Promise<unknown>) =>
      operation(transaction)
  );
  return {
    calls,
    runTransaction,
    executor: {
      execute: transaction.execute,
      transaction: runTransaction as SqlExecutor['transaction'],
    },
  };
}

function event(
  type: string,
  dataOverrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    type,
    created_at: now.toISOString(),
    data: {
      created_at: now.toISOString(),
      email_id: providerEmailId,
      from: 'Brian at Threadplane <brian@threadplane.ai>',
      to: ['developer@example.com'],
      subject: 'A note',
      tags: {
        environment: 'production',
        job_kind: 'send_step',
        campaign_version: 'v1',
        campaign_step: '1',
        campaign_template: 'immediate',
      },
      ...(type === 'email.failed'
        ? { failed: { reason: 'provider_rejected' } }
        : {}),
      ...(type === 'email.suppressed'
        ? { suppressed: { type: 'Suppressed', message: 'provider message' } }
        : {}),
      ...dataOverrides,
    },
  };
}

function webhookHarness(
  options: {
    existingActivity?: TestRow;
    job?: TestRow;
    boundRfcMessageId?: string;
  } = {}
) {
  const currentJob = options.job ?? jobRow();
  const insertedRows = options.existingActivity ? [] : [{ event_key: 'x' }];
  const harness = executorWith({
    'inspect-resend-terminal-rfc-binding': (parameters) => {
      expect(parameters).toEqual([providerEmailId]);
      return {
        rows: [
          {
            kind: currentJob['kind'],
            status: currentJob['status'],
            contact_id: currentJob['contact_id'],
            delivery_status: currentJob['delivery_status'],
            rfc_message_id: options.boundRfcMessageId ?? null,
          },
        ],
      };
    },
    'discover-resend-webhook-job': (parameters, sql) => {
      expect(parameters).toEqual([providerEmailId]);
      expect(sql).toMatch(/where provider_email_id = \$1/u);
      expect(sql).not.toMatch(/x-threadplane|tags/iu);
      return { rows: [{ id: jobId, contact_id: contactId }] };
    },
    'lock-resend-webhook-contact': (_parameters, sql) => {
      expect(sql).toMatch(/for update/u);
      return { rows: [{ id: contactId }] };
    },
    'lock-resend-webhook-job': (_parameters, sql) => {
      expect(sql).toMatch(/provider_email_id = \$1/u);
      expect(sql).toMatch(/for update/u);
      return { rows: [currentJob] };
    },
    'insert-resend-webhook-activity': (parameters, sql) => {
      expect(parameters[0]).toMatch(/^resend:msg_/u);
      expect(sql).toMatch(/on conflict \(event_key\) do nothing/u);
      const serialized = String(parameters.at(-1));
      expect(serialized).not.toContain('developer@example.com');
      expect(serialized).not.toContain('A note');
      expect(serialized).not.toContain('Brian at Threadplane');
      return { rows: insertedRows };
    },
    'read-resend-webhook-activity': () => ({
      rows: options.existingActivity ? [options.existingActivity] : [],
    }),
    'update-resend-delivery-status': (_parameters, sql) => {
      expect(sql).toMatch(/delivery_status/u);
      return { rows: [currentJob] };
    },
  });
  const stopContact = vi
    .fn()
    .mockResolvedValue({ applied: true, effective: true });
  const dependencies: ProcessResendWebhookDependencies = {
    databaseEnvironment: 'production',
    stopContact,
    bindProviderMessageId: vi.fn().mockResolvedValue('bound'),
  };
  return { ...harness, stopContact, dependencies };
}

describe('processVerifiedResendWebhook', () => {
  it('binds an authenticated provider Message-ID using the exact provider email ID', async () => {
    const h = webhookHarness();
    await processVerifiedResendWebhook(
      h.executor,
      {
        providerEventId: 'msg_binding',
        payload: event('email.sent', { message_id: '<actual@resend.dev>' }),
      },
      h.dependencies
    );
    expect(h.dependencies.bindProviderMessageId).toHaveBeenCalledWith(
      expect.anything(),
      {
        providerEmailId,
        rfcMessageId: '<actual@resend.dev>',
      },
      { stopContact: h.stopContact }
    );
  });
  it('preserves an existing RFC binding while applying a terminal suppression with a different provider Message-ID', async () => {
    const h = webhookHarness({ boundRfcMessageId: '<original@resend.dev>' });
    const result = await processVerifiedResendWebhook(
      h.executor,
      {
        providerEventId: 'msg_terminal_binding_conflict',
        payload: event('email.suppressed', {
          message_id: '<different@resend.dev>',
        }),
      },
      h.dependencies
    );
    expect(result).toMatchObject({
      applied: true,
      deliveryStatus: 'suppressed',
    });
    expect(h.dependencies.bindProviderMessageId).not.toHaveBeenCalled();
    expect(h.stopContact).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reason: 'provider_suppression' })
    );
  });
  it('still reconciles a matching RFC binding on a terminal event', async () => {
    const h = webhookHarness({ boundRfcMessageId: '<actual@resend.dev>' });
    await processVerifiedResendWebhook(
      h.executor,
      {
        providerEventId: 'msg_matching_terminal_binding',
        payload: event('email.suppressed', {
          message_id: '<actual@resend.dev>',
        }),
      },
      h.dependencies
    );
    expect(h.dependencies.bindProviderMessageId).toHaveBeenCalledOnce();
  });
  it('does not bypass binding checks for an unfinished job', async () => {
    const h = webhookHarness({
      boundRfcMessageId: '<original@resend.dev>',
      job: jobRow({ status: 'pending' }),
    });
    vi.mocked(h.dependencies.bindProviderMessageId).mockRejectedValueOnce(
      new Error('Provider Message-ID binding conflict')
    );
    await expect(
      processVerifiedResendWebhook(
        h.executor,
        {
          providerEventId: 'msg_unfinished_terminal_binding',
          payload: event('email.suppressed', {
            message_id: '<different@resend.dev>',
          }),
        },
        h.dependencies
      )
    ).rejects.toThrow(/Provider Message-ID binding conflict/u);
    expect(h.stopContact).not.toHaveBeenCalled();
  });
  it('keeps a nonterminal RFC binding conflict retryable', async () => {
    const h = webhookHarness({ boundRfcMessageId: '<original@resend.dev>' });
    vi.mocked(h.dependencies.bindProviderMessageId).mockRejectedValueOnce(
      new Error('Provider Message-ID binding conflict')
    );
    await expect(
      processVerifiedResendWebhook(
        h.executor,
        {
          providerEventId: 'msg_nonterminal_binding_conflict',
          payload: event('email.delivered', {
            message_id: '<different@resend.dev>',
          }),
        },
        h.dependencies
      )
    ).rejects.toThrow(/Provider Message-ID binding conflict/u);
    expect(h.calls).not.toContain('inspect-resend-terminal-rfc-binding');
  });
  it('keeps supported parser fixtures assignable to the pinned Resend webhook union', () => {
    expect(supportedSdkFixtures).toHaveLength(7);
  });

  it.each([undefined, 'Preview', 'production '])(
    'fails closed before database access when GROWTH_DATABASE_ENVIRONMENT is %s',
    async (databaseEnvironment) => {
      vi.unstubAllEnvs();
      if (databaseEnvironment !== undefined) {
        vi.stubEnv('GROWTH_DATABASE_ENVIRONMENT', databaseEnvironment);
      }
      const harness = executorWith({});

      await expect(
        processVerifiedResendWebhook(harness.executor, {
          providerEventId: 'msg_invalid_database_environment',
          payload: event('email.delivered'),
        })
      ).rejects.toThrow(/GROWTH_DATABASE_ENVIRONMENT/u);
      expect(harness.calls).toEqual([]);
      expect(harness.runTransaction).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['a different environment', { environment: 'production' }],
    ['a missing environment tag', undefined],
  ])('acknowledges %s without any database access', async (_label, tags) => {
    const harness = webhookHarness();

    await expect(
      processVerifiedResendWebhook(
        harness.executor,
        {
          providerEventId: 'msg_wrong_environment',
          payload: event('email.delivered', { tags }),
        },
        {
          ...harness.dependencies,
          databaseEnvironment: 'preview',
        } as ProcessResendWebhookDependencies
      )
    ).resolves.toEqual({
      applied: false,
      reason: 'environment_mismatch',
    });
    expect(harness.calls).toEqual([]);
    expect(harness.runTransaction).not.toHaveBeenCalled();
    expect(harness.stopContact).not.toHaveBeenCalled();
  });

  it.each([
    ['email.sent', 'submitted', 'delivery.sent'],
    ['email.delivered', 'delivered', 'delivery.delivered'],
    ['email.delivery_delayed', 'submitted', 'delivery.delayed'],
    ['email.complained', 'complained', 'delivery.complained'],
    ['email.suppressed', 'suppressed', 'delivery.suppressed'],
    ['email.failed', 'failed', 'delivery.failed'],
  ] as const)('maps %s to the closed %s status', async (type, status, kind) => {
    const harness = webhookHarness();

    const result = await processVerifiedResendWebhook(
      harness.executor,
      { providerEventId: `msg_${type}`, payload: event(type) },
      harness.dependencies
    );

    expect(result).toMatchObject({
      applied: true,
      activityKind: kind,
      deliveryStatus: status,
    });
    if (status === 'submitted') {
      expect(harness.calls).not.toContain('update-resend-delivery-status');
    } else {
      expect(harness.calls).toContain('update-resend-delivery-status');
    }
  });

  it('accepts the documented Resend payload shape: message_id present and null optional ids', async () => {
    // Resend's wire payload gained `message_id` after SDK 6.10 pinned its
    // types, and transactional mail carries null broadcast/template ids.
    // Both must parse, or every real event answers 400 and delivery state
    // never leaves "submitted".
    const harness = webhookHarness();

    await expect(
      processVerifiedResendWebhook(
        harness.executor,
        {
          providerEventId: 'msg_documented_shape',
          payload: event('email.delivered', {
            broadcast_id: null,
            template_id: null,
            message_id: '<111-222-333@email.example.com>',
          }),
        },
        harness.dependencies
      )
    ).resolves.toMatchObject({ applied: true });
  });

  it('accepts the real Resend payload for a message with custom headers (headers array present)', async () => {
    // Captured verbatim from the production webhook event log on
    // 2026-09-03: recipient messages carry List-Unsubscribe, the job id,
    // Bcc, and Reply-To as a `headers` array. Rejecting it left every
    // recipient delivery stuck at "submitted".
    const harness = webhookHarness();

    await expect(
      processVerifiedResendWebhook(
        harness.executor,
        {
          providerEventId: 'msg_headers_shape',
          payload: event('email.delivered', {
            message_id: '<111-222-333@email.example.com>',
            headers: [
              {
                name: 'List-Unsubscribe',
                value: '<https://threadplane.ai/api/unsubscribe?token=g1.abc>',
              },
              {
                name: 'List-Unsubscribe-Post',
                value: 'List-Unsubscribe=One-Click',
              },
              {
                name: 'X-Threadplane-Job-ID',
                value: '68add347-ef99-414c-b96f-89475cf4ee26',
              },
              {
                name: 'Bcc',
                value: 'Brian at Threadplane <brian@threadplane.ai>',
              },
              {
                name: 'Reply-To',
                value: 'Brian at Threadplane <brian@threadplane.ai>',
              },
            ],
          }),
        },
        harness.dependencies
      )
    ).resolves.toMatchObject({ applied: true });
  });

  it('ignores unknown data keys instead of failing the whole event, within a bounded key count', async () => {
    const harness = webhookHarness();

    await expect(
      processVerifiedResendWebhook(
        harness.executor,
        {
          providerEventId: 'msg_unknown_key',
          payload: event('email.delivered', { some_future_field: 'x' }),
        },
        harness.dependencies
      )
    ).resolves.toMatchObject({ applied: true });

    const tooMany = Object.fromEntries(
      Array.from({ length: 40 }, (_, index) => [`k${index}`, 'v'])
    );
    await expect(
      processVerifiedResendWebhook(executorWith({}).executor, {
        providerEventId: 'msg_too_many_keys',
        payload: event('email.delivered', tooMany),
      })
    ).rejects.toThrow(/Invalid Resend webhook payload/u);
  });

  it('marks only a permanent bounce as a hard-bounce stop', async () => {
    const hard = webhookHarness();
    await processVerifiedResendWebhook(
      hard.executor,
      {
        providerEventId: 'msg_hard_bounce',
        payload: event('email.bounced', {
          bounce: {
            type: 'Permanent',
            subType: 'General',
            message: 'raw provider text',
          },
        }),
      },
      hard.dependencies
    );
    expect(hard.stopContact).toHaveBeenCalledWith(
      expect.objectContaining({ transaction: expect.any(Function) }),
      expect.objectContaining({
        contactId,
        reason: 'hard_bounce',
        eventKey: 'resend:msg_hard_bounce:stop',
        source: 'resend_webhook',
        provenance: expect.objectContaining({ kind: 'provider_webhook' }),
      })
    );

    const soft = webhookHarness();
    await processVerifiedResendWebhook(
      soft.executor,
      {
        providerEventId: 'msg_soft_bounce',
        payload: event('email.bounced', {
          bounce: {
            type: 'Transient',
            subType: 'MailboxFull',
            message: 'raw provider text',
          },
        }),
      },
      soft.dependencies
    );
    expect(soft.stopContact).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'null', diagnosticCode: null },
    { name: 'string', diagnosticCode: 'smtp; 550 user unknown' },
    { name: 'array with null', diagnosticCode: [null] },
  ])(
    'accepts provider bounce diagnostics $name and applies the hard-bounce stop',
    async ({ diagnosticCode }) => {
      const harness = webhookHarness();
      const result = await processVerifiedResendWebhook(
        harness.executor,
        {
          providerEventId: 'msg_bounce_diagnostics',
          payload: event('email.bounced', {
            bounce: {
              type: 'Permanent',
              subType: 'General',
              message: 'bounced',
              diagnosticCode,
            },
          }),
        },
        harness.dependencies
      );
      expect(result).toMatchObject({
        applied: true,
        deliveryStatus: 'bounced',
      });
      expect(harness.stopContact).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ reason: 'hard_bounce' })
      );
    }
  );

  it.each([
    { name: 'oversized string', diagnosticCode: 'x'.repeat(2001) },
    { name: 'oversized array item', diagnosticCode: ['x'.repeat(2001)] },
    { name: 'object array item', diagnosticCode: [{}] },
    { name: 'oversized array', diagnosticCode: Array(11).fill(null) },
  ])(
    'rejects $name bounce diagnostic before database access',
    async ({ diagnosticCode }) => {
      const harness = webhookHarness();
      await expect(
        processVerifiedResendWebhook(
          harness.executor,
          {
            providerEventId: 'msg_invalid_bounce_diagnostic',
            payload: event('email.bounced', {
              bounce: {
                type: 'Permanent',
                subType: 'General',
                message: 'bounced',
                diagnosticCode,
              },
            }),
          },
          harness.dependencies
        )
      ).rejects.toThrow(/Invalid Resend webhook payload/u);
      expect(harness.runTransaction).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['email.complained', 'complaint'],
    ['email.suppressed', 'provider_suppression'],
  ] as const)('uses canonical stop for %s', async (type, reason) => {
    const harness = webhookHarness();
    await processVerifiedResendWebhook(
      harness.executor,
      { providerEventId: `msg_${type}`, payload: event(type) },
      harness.dependencies
    );
    expect(harness.stopContact).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reason })
    );
  });

  it.each([
    { name: 'null', diagnosticCode: null },
    { name: 'string', diagnosticCode: 'smtp; 550 suppressed' },
    { name: 'array with string', diagnosticCode: ['smtp; 550 suppressed'] },
    { name: 'array with null', diagnosticCode: [null] },
  ])(
    'accepts provider suppression diagnostics $name and applies the canonical stop',
    async ({ diagnosticCode }) => {
      const harness = webhookHarness();
      const result = await processVerifiedResendWebhook(
        harness.executor,
        {
          providerEventId: 'msg_suppression_diagnostics',
          payload: event('email.suppressed', {
            suppressed: {
              type: 'Suppressed',
              message: 'suppressed',
              reason: 'Suppressed recipient',
              diagnosticCode,
            },
          }),
        },
        harness.dependencies
      );
      expect(result).toMatchObject({
        applied: true,
        deliveryStatus: 'suppressed',
      });
      expect(harness.stopContact).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ reason: 'provider_suppression' })
      );
    }
  );

  it.each([
    ['reason', 'x'.repeat(501)],
    ['diagnosticCode', 'x'.repeat(2001)],
    ['diagnosticCode', ['x'.repeat(2001)]],
    ['diagnosticCode', [{}]],
    ['diagnosticCode', Array(11).fill(null)],
    ['reason', {}],
  ])(
    'rejects invalid suppression %s before database access',
    async (key, value) => {
      const harness = webhookHarness();
      await expect(
        processVerifiedResendWebhook(
          harness.executor,
          {
            providerEventId: 'msg_invalid_suppression',
            payload: event('email.suppressed', {
              suppressed: {
                type: 'Suppressed',
                message: 'suppressed',
                [key as string]: value,
              },
            }),
          },
          harness.dependencies
        )
      ).rejects.toThrow('Invalid Resend webhook payload');
      expect(harness.runTransaction).not.toHaveBeenCalled();
    }
  );

  it('does not stop for a provider failure with arbitrary invalid-looking text', async () => {
    const harness = webhookHarness();
    await processVerifiedResendWebhook(
      harness.executor,
      {
        providerEventId: 'msg_failed',
        payload: event('email.failed', {
          failed: { reason: 'invalid address maybe attacker supplied' },
        }),
      },
      harness.dependencies
    );
    expect(harness.stopContact).not.toHaveBeenCalled();
  });

  it('ignores verified open, click, and irrelevant events without database access', async () => {
    const harness = executorWith({});
    for (const type of ['email.opened', 'email.clicked', 'contact.created']) {
      await expect(
        processVerifiedResendWebhook(harness.executor, {
          providerEventId: `msg_${type}`,
          payload: event(type),
        })
      ).resolves.toEqual({ applied: false, reason: 'ignored_event_type' });
    }
    expect(harness.calls).toEqual([]);
  });

  it('accepts bounded provider ISO timestamps with offsets and fractional precision', async () => {
    const harness = webhookHarness();
    const payload = event('email.sent');
    payload['created_at'] = '2026-09-01T05:00:00.123456-07:00';
    (payload['data'] as Record<string, unknown>)['created_at'] =
      '2026-09-01T05:00:00.123456-07:00';

    await expect(
      processVerifiedResendWebhook(
        harness.executor,
        { providerEventId: 'msg_timestamp', payload },
        harness.dependencies
      )
    ).resolves.toMatchObject({ applied: true });
  });

  it('finds the job only by provider email ID and rejects contradictory corroboration tags', async () => {
    const harness = webhookHarness();
    await expect(
      processVerifiedResendWebhook(
        harness.executor,
        {
          providerEventId: 'msg_bad_tags',
          payload: event('email.delivered', {
            tags: { environment: 'production', job_kind: 'fulfill' },
          }),
        },
        harness.dependencies
      )
    ).rejects.toThrow(/corroboration/iu);
    expect(harness.calls).toEqual([
      'read-resend-webhook-activity',
      'discover-resend-webhook-job',
      'lock-resend-webhook-contact',
      'lock-resend-webhook-job',
    ]);
  });

  it('leaves a tagged Threadplane webhook retryable until provider acceptance attaches the ID', async () => {
    const unmatched = executorWith({
      'read-resend-webhook-activity': () => ({ rows: [] }),
      'discover-resend-webhook-job': () => ({ rows: [] }),
    });
    const input = {
      providerEventId: 'msg_acceptance_race',
      payload: event('email.delivered'),
    };

    await expect(
      processVerifiedResendWebhook(unmatched.executor, input)
    ).resolves.toEqual({
      applied: false,
      reason: 'retryable_unmatched_job',
    });
    expect(unmatched.calls).toEqual([
      'read-resend-webhook-activity',
      'discover-resend-webhook-job',
    ]);

    const matched = webhookHarness();
    await expect(
      processVerifiedResendWebhook(
        matched.executor,
        input,
        matched.dependencies
      )
    ).resolves.toMatchObject({ applied: true });
    expect(
      matched.calls.filter(
        (marker) => marker === 'insert-resend-webhook-activity'
      )
    ).toHaveLength(1);

    const data = {
      provider: 'resend',
      provider_event_id: input.providerEventId,
      provider_email_id: providerEmailId,
      event_type: 'email.delivered',
      category: 'delivered',
    };
    const replay = webhookHarness({
      existingActivity: {
        event_key: `resend:${input.providerEventId}`,
        contact_id: contactId,
        project_id: null,
        kind: 'delivery.delivered',
        occurred_at: now,
        data,
      },
    });
    await expect(
      processVerifiedResendWebhook(replay.executor, input, replay.dependencies)
    ).resolves.toEqual({ applied: false, reason: 'replay' });
    expect(replay.calls).toEqual(['read-resend-webhook-activity']);
  });

  it('acknowledges an untagged provider event before database access', async () => {
    const harness = executorWith({
      'read-resend-webhook-activity': () => ({ rows: [] }),
      'discover-resend-webhook-job': () => ({ rows: [] }),
    });

    await expect(
      processVerifiedResendWebhook(harness.executor, {
        providerEventId: 'msg_legacy_unmatched',
        payload: event('email.delivered', { tags: undefined }),
      })
    ).resolves.toEqual({ applied: false, reason: 'environment_mismatch' });
    expect(harness.calls).toEqual([]);
  });

  it.each([
    [
      {
        environment: 'production',
        job_kind: 'send_step',
      },
      'unmatched_job',
    ],
    [
      {
        environment: 'production',
        job_kind: 'send_step',
        campaign_version: 'v1',
        campaign_step: '1',
        campaign_template: 'day-4',
      },
      'unmatched_job',
    ],
    [
      {
        environment: 'production',
        job_kind: 'send_step',
        campaign_version: 'v1',
        campaign_step: '1',
        campaign_template: 'immediate',
        extra: 'x',
      },
      'unmatched_job',
    ],
    [
      {
        environment: 'production',
        job_kind: 'fulfill',
        campaign_version: 'v1',
      },
      'unmatched_job',
    ],
    [
      {
        environment: 'unknown',
        job_kind: 'fulfill',
      },
      'environment_mismatch',
    ],
  ] as const)(
    'does not create an account-wide retry storm for noncanonical tags %#',
    async (tags, reason) => {
      const harness = executorWith({
        'read-resend-webhook-activity': () => ({ rows: [] }),
        'discover-resend-webhook-job': () => ({ rows: [] }),
      });

      await expect(
        processVerifiedResendWebhook(harness.executor, {
          providerEventId: 'msg_noncanonical_tags',
          payload: event('email.delivered', { tags }),
        })
      ).resolves.toEqual({ applied: false, reason });
    }
  );

  it.each([
    {
      environment: 'production',
      job_kind: 'send_step',
      campaign_version: 'v1',
      campaign_step: '1',
    },
    {
      environment: 'production',
      job_kind: 'send_step',
      campaign_version: 'v1',
      campaign_step: '1',
      campaign_template: 'streaming_foundation',
    },
  ])(
    'retries an unmatched canonical send_step event with or without a template tag %#',
    async (tags) => {
      const harness = executorWith({
        'read-resend-webhook-activity': () => ({ rows: [] }),
        'discover-resend-webhook-job': () => ({ rows: [] }),
      });

      await expect(
        processVerifiedResendWebhook(harness.executor, {
          providerEventId: 'msg_canonical_tags',
          payload: event('email.delivered', { tags }),
        })
      ).resolves.toEqual({ applied: false, reason: 'retryable_unmatched_job' });
    }
  );

  it('does not regress a terminal delivered status on delayed or failure events', async () => {
    const delivered = jobRow({ delivery_status: 'delivered' });
    for (const type of ['email.delivery_delayed', 'email.failed']) {
      const harness = webhookHarness({ job: delivered });
      const result = await processVerifiedResendWebhook(
        harness.executor,
        { providerEventId: `msg_${type}`, payload: event(type) },
        harness.dependencies
      );
      expect(result).toMatchObject({ deliveryStatus: 'delivered' });
      expect(harness.calls).not.toContain('update-resend-delivery-status');
    }
  });

  it.each([
    [
      'email.bounced',
      'bounced',
      {
        bounce: {
          type: 'Permanent',
          subType: 'General',
          message: 'provider text',
        },
      },
      'hard_bounce',
    ],
    ['email.complained', 'complained', {}, 'complaint'],
    ['email.suppressed', 'suppressed', {}, 'provider_suppression'],
  ] as const)(
    'promotes post-delivery %s to the operational stop status',
    async (type, status, details, stopReason) => {
      const harness = webhookHarness({
        job: jobRow({ delivery_status: 'delivered' }),
      });
      const result = await processVerifiedResendWebhook(
        harness.executor,
        {
          providerEventId: `msg_post_delivery_${type}`,
          payload: event(type, details),
        },
        harness.dependencies
      );

      expect(result).toMatchObject({ deliveryStatus: status });
      expect(harness.calls).toContain('update-resend-delivery-status');
      expect(harness.stopContact).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ reason: stopReason })
      );
    }
  );

  it('makes an identical provider event replay inert', async () => {
    const data = {
      provider: 'resend',
      provider_event_id: 'msg_delivered',
      provider_email_id: providerEmailId,
      event_type: 'email.delivered',
      category: 'delivered',
    };
    const harness = webhookHarness({
      existingActivity: {
        event_key: 'resend:msg_delivered',
        contact_id: contactId,
        project_id: null,
        kind: 'delivery.delivered',
        occurred_at: now,
        data,
      },
    });

    const result = await processVerifiedResendWebhook(
      harness.executor,
      { providerEventId: 'msg_delivered', payload: event('email.delivered') },
      harness.dependencies
    );

    expect(result).toEqual({ applied: false, reason: 'replay' });
    expect(harness.calls).not.toContain('update-resend-delivery-status');
    expect(harness.stopContact).not.toHaveBeenCalled();
  });

  it('revisits binding reconciliation on duplicate provider events without duplicating delivery activity', async () => {
    const h = webhookHarness({
      existingActivity: {
        event_key: 'resend:msg_duplicate_binding',
        contact_id: contactId,
        project_id: null,
        kind: 'delivery.sent',
        occurred_at: now,
        data: {
          provider: 'resend',
          provider_event_id: 'msg_duplicate_binding',
          provider_email_id: providerEmailId,
          event_type: 'email.sent',
          category: 'sent',
        },
      },
    });
    await expect(
      processVerifiedResendWebhook(
        h.executor,
        {
          providerEventId: 'msg_duplicate_binding',
          payload: event('email.sent', { message_id: '<actual@resend.dev>' }),
        },
        h.dependencies
      )
    ).resolves.toEqual({ applied: false, reason: 'replay' });
    expect(h.dependencies.bindProviderMessageId).toHaveBeenCalledOnce();
    expect(h.calls).not.toContain('insert-resend-webhook-activity');
  });

  it('fails conflicting reuse of a provider event ID before status mutation', async () => {
    const harness = webhookHarness({
      existingActivity: {
        event_key: 'resend:msg_conflict',
        contact_id: contactId,
        project_id: null,
        kind: 'delivery.failed',
        occurred_at: now,
        data: { provider: 'resend', provider_event_id: 'msg_conflict' },
      },
    });
    await expect(
      processVerifiedResendWebhook(
        harness.executor,
        { providerEventId: 'msg_conflict', payload: event('email.delivered') },
        harness.dependencies
      )
    ).rejects.toThrow(/event id conflict/iu);
    expect(harness.calls).not.toContain('update-resend-delivery-status');
  });

  it('fails conflicting provider event ID reuse even when the new provider email ID is unknown', async () => {
    const existing = {
      event_key: 'resend:msg_reused',
      contact_id: contactId,
      project_id: null,
      kind: 'delivery.delivered',
      occurred_at: now,
      data: {
        provider: 'resend',
        provider_event_id: 'msg_reused',
        provider_email_id: providerEmailId,
        event_type: 'email.delivered',
        category: 'delivered',
      },
    };
    const harness = executorWith({
      'read-resend-webhook-activity': () => ({ rows: [existing] }),
      'discover-resend-webhook-job': () => ({ rows: [] }),
    });

    await expect(
      processVerifiedResendWebhook(harness.executor, {
        providerEventId: 'msg_reused',
        payload: event('email.delivered', { email_id: 'different-email-id' }),
      })
    ).rejects.toThrow(/event id conflict/iu);
  });

  it.each([
    [
      { type: 'email.delivered', created_at: 'not-a-date', data: {} },
      /payload/iu,
    ],
    [event('email.delivered', { email_id: 'x'.repeat(257) }), /payload/iu],
    [
      event('email.delivered', {
        to: Array.from({ length: 51 }, () => 'a@b.com'),
      }),
      /payload/iu,
    ],
    [event('email.delivered', { subject: 'x'.repeat(501) }), /payload/iu],
    [event('email.delivered', { headers: {} }), /payload/iu],
    [
      event('email.bounced', {
        bounce: { type: 'x'.repeat(101), subType: 'x', message: 'x' },
      }),
      /payload/iu,
    ],
    [
      event('email.delivered', { failed: { reason: 'unexpected' } }),
      /payload/iu,
    ],
  ] as const)(
    'rejects malformed or oversized verified provider payload %#',
    async (payload, error) => {
      const harness = executorWith({});
      await expect(
        processVerifiedResendWebhook(harness.executor, {
          providerEventId: 'msg_invalid',
          payload,
        })
      ).rejects.toThrow(error);
      expect(harness.calls).toEqual([]);
    }
  );

  it('bounds the provider event ID so derived stop keys remain valid', async () => {
    const harness = executorWith({});
    await expect(
      processVerifiedResendWebhook(harness.executor, {
        providerEventId: `msg_${'x'.repeat(240)}`,
        payload: event('email.complained'),
      })
    ).rejects.toThrow(/payload/iu);
    expect(harness.calls).toEqual([]);
  });
});
