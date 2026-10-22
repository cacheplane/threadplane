import { expect, test, vi } from 'vitest';

import { buildInboxForward, forwardInboxReceipt } from './inbox-forward.ts';
import { executorWith } from './inbox-test-support.ts';

test('forwarding goes only to Brian and preserves original content in an eml attachment', () => {
  const email = {
    id: 'incoming-1',
    from: 'Reader <reader@example.com>',
    to: ['brian@threadplane.ai'],
    created_at: '2026-10-22T00:00:00Z',
    headers: {},
    subject: 'Hello',
    text: 'Body',
  };

  const payload = buildInboxForward(
    email,
    Buffer.from('original MIME'),
    'production'
  );

  expect(payload).toMatchObject({
    from: 'Brian at Threadplane <brian@threadplane.ai>',
    to: 'brian@cacheplane.ai',
    replyTo: email.from,
    subject: 'Fwd: Hello',
    text: 'Body',
    attachments: [
      {
        filename: 'original.eml',
        content: Buffer.from('original MIME').toString('base64'),
      },
    ],
    tags: expect.arrayContaining([
      { name: 'app', value: 'threadplane' },
      { name: 'environment', value: 'production' },
    ]),
  });
});

test('a forwarded receipt is not resent during webhook replay or recovery', async () => {
  const send = vi.fn();
  const { executor } = executorWith({
    'inbox-forward-receipt': () => ({
      rows: [
        {
          id: 'incoming-1',
          recipient: 'brian@threadplane.ai',
          forward_provider_id: 'already-forwarded',
        },
      ],
    }),
  });

  expect(
    await forwardInboxReceipt(executor, 'incoming-1', {
      environment: 'production',
      isErasedSender: async () => false,
      getReceived: vi.fn(),
      getRaw: vi.fn(),
      send,
    })
  ).toBe('already-forwarded');
  expect(send).not.toHaveBeenCalled();
});

test('erasure during raw fetching prevents subsequent forwarding', async () => {
  const send = vi.fn();
  let reads = 0;
  const { executor } = executorWith({
    'inbox-forward-receipt': () => ({
      rows: [
        {
          recipient: 'brian@threadplane.ai',
          forward_provider_id: null,
          last_error_code: reads++ ? 'contact_deleted' : null,
        },
      ],
    }),
    'inbox-forward-accepted': () => ({ rows: [] }),
    'provider-attempt-insert': () => ({ rows: [] }),
    'provider-attempt-lock': () => ({
      rows: [{ provider_email_id: 'accepted-1' }],
    }),
  });
  const getReceived = async () => ({
    id: 'incoming-1',
    to: ['BRIAN@THREADPLANE.AI'],
    from: 'reader@example.com',
    created_at: '2026-10-22T00:00:00Z',
    headers: {},
    raw: { download_url: 'https://example.com/raw' },
  });

  expect(
    await forwardInboxReceipt(executor, 'incoming-1', {
      environment: 'production',
      isErasedSender: async () => false,
      getReceived,
      getRaw: async () => Buffer.from('mime'),
      send,
    })
  ).toBeNull();

  expect(send).not.toHaveBeenCalled();
});

test('known provider acceptance completes the receipt without refetching expired content', async () => {
  const getReceived = vi.fn();
  const send = vi.fn();
  const { executor } = executorWith({
    'inbox-forward-receipt': () => ({
      rows: [
        {
          recipient: 'brian@threadplane.ai',
          forward_provider_id: null,
          last_error_code: null,
        },
      ],
    }),
    'inbox-forward-accepted': () => ({
      rows: [{ provider_email_id: 'accepted-1' }],
    }),
    'inbox-forward-complete': () => ({ rows: [{ id: 'incoming-1' }] }),
  });

  expect(
    await forwardInboxReceipt(executor, 'incoming-1', {
      environment: 'production',
      isErasedSender: async () => false,
      getReceived,
      getRaw: vi.fn(),
      send,
    })
  ).toBe('accepted-1');

  expect(getReceived).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});

test('an erased sender is never forwarded even without a classified contact', async () => {
  const send = vi.fn();
  const isErasedSender = vi.fn(async () => true);
  const { executor } = executorWith({
    'inbox-forward-receipt': () => ({
      rows: [
        {
          recipient: 'brian@threadplane.ai',
          forward_provider_id: null,
          last_error_code: null,
        },
      ],
    }),
    'inbox-forward-accepted': () => ({ rows: [] }),
    'provider-attempt-insert': () => ({ rows: [] }),
    'provider-attempt-lock': () => ({
      rows: [{ provider_email_id: 'accepted-1' }],
    }),
    'inbox-forward-complete': () => ({ rows: [{ id: 'incoming-1' }] }),
    'inbox-forward-erased': () => ({ rows: [] }),
  });

  const result = await forwardInboxReceipt(executor, 'incoming-1', {
    environment: 'production',
    isErasedSender,
    getReceived: async () => ({
      id: 'incoming-1',
      to: ['brian@threadplane.ai'],
      from: 'Reader <reader@example.com>',
      created_at: '2026-10-22T00:00:00Z',
      headers: {},
      raw: { download_url: 'https://example.com/raw' },
    }),
    getRaw: async () => Buffer.from('mime'),
    send,
  });

  expect(result).toBeNull();
  expect(isErasedSender).toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});

for (const original of [
  { from: 'brian@cacheplane.ai', headers: {} },
  { from: 'Brian <brian@threadplane.ai>', headers: {} },
  {
    from: 'reader@example.com',
    headers: {
      'X-Threadplane-Forwarded': 'original',
      'Auto-Submitted': 'auto-generated',
    },
  },
]) {
  test(`suppresses forwarding loops from ${JSON.stringify(
    original
  )}`, async () => {
    const { executor } = executorWith({
      'inbox-forward-receipt': () => ({
        rows: [
          { recipient: 'brian@threadplane.ai', forward_provider_id: null },
        ],
      }),
      'inbox-forward-accepted': () => ({ rows: [] }),
      'inbox-forward-suppressed': () => ({ rows: [] }),
    });
    const send = vi.fn();
    const getRaw = vi.fn();
    expect(
      await forwardInboxReceipt(executor, 'incoming-1', {
        environment: 'production',
        isErasedSender: async () => false,
        getReceived: async () => ({
          id: 'incoming-1',
          to: ['brian@threadplane.ai'],
          created_at: '2026-10-22T00:00:00Z',
          ...original,
        }),
        getRaw,
        send,
      })
    ).toBeNull();
    expect(getRaw).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
}

test('forwards third-party auto-submitted notices with no Threadplane loop marker', async () => {
  const now = new Date('2026-10-22T01:00:00Z');
  let digest: unknown;
  const { executor } = executorWith({
    'inbox-forward-receipt': () => ({
      rows: [
        {
          recipient: 'brian@threadplane.ai',
          forward_provider_id: null,
          last_error_code: null,
        },
      ],
    }),
    'inbox-forward-accepted': () => ({ rows: [] }),
    'provider-attempt-insert': (params) => {
      digest = params[2];
      return { rows: [] };
    },
    'provider-attempt-lock': () => ({
      rows: [
        {
          first_attempted_at: now,
          payload_sha256: digest,
          provider_email_id: null,
        },
      ],
    }),
    'provider-attempt-complete': () => ({
      rows: [{ idempotency_key: 'accepted' }],
    }),
    'inbox-forward-complete': () => ({ rows: [{ id: 'incoming-1' }] }),
    'inbox-forward-suppressed': () => ({ rows: [] }),
  });
  const send = vi.fn(async () => 'forwarded-1');
  expect(
    await forwardInboxReceipt(executor, 'incoming-1', {
      environment: 'production',
      now: () => now,
      isErasedSender: async () => false,
      getReceived: async () => ({
        id: 'incoming-1',
        to: ['brian@threadplane.ai'],
        from: 'postmaster@example.com',
        created_at: now.toISOString(),
        headers: { 'Auto-Submitted': 'auto-generated' },
        raw: { download_url: 'https://example.com/raw' },
        text: 'Automated notice',
      }),
      getRaw: async () => Buffer.from('mime'),
      send,
    })
  ).toBe('forwarded-1');
  expect(send).toHaveBeenCalledOnce();
});
