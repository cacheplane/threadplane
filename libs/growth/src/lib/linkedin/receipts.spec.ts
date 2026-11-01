import { expect, test, vi } from 'vitest';

import { INBOX_FORWARD_TO } from '../inbox-forward.ts';
import type { InboxReceivedEmail } from '../inbox-replies.ts';
import { executorWith } from '../inbox-test-support.ts';
import type { LinkedInParser } from './parser.ts';
import {
  admitLinkedInReceipt,
  buildLinkedInForward,
  forwardLinkedInReceipt,
  ingestManualEngagement,
  processLinkedInReceipt,
  scrubLinkedInReceipts,
} from './receipts.ts';

const created_at = '2026-11-01T12:00:00Z';
const now = new Date('2026-11-01T13:00:00Z');
const cfg = {
  enabled: true as const,
  address: 'linkedin@threadplane.ai',
  forwardNotifications: false,
};
const actor = (n: string) => ({
  displayName: `Person ${n}`,
  headline: 'CTO at Acme',
  profileUrl: `https://www.linkedin.com/in/${n}`,
  commentText: null,
});
const trustedHeaders = {
  'Authentication-Results': 'mx; spf=pass; dkim=pass',
};
const email = (over: Partial<InboxReceivedEmail> = {}): InboxReceivedEmail => ({
  id: 'e1',
  to: ['linkedin@threadplane.ai'],
  from: 'LinkedIn <notifications@linkedin.com>',
  created_at,
  headers: trustedHeaders,
  subject: 'Jane commented',
  text: 'body text',
  html: '<p>body</p>',
  ...over,
});
const pending = {
  'linkedin-receipt-lock': () => ({ rows: [{ status: 'pending' }] }),
};

test('admit ignores events not addressed to the ingest address and defers to the reply inbox when both are listed', async () => {
  const { executor, calls } = executorWith({
    'linkedin-receipt-admit': () => ({ rows: [] }),
  });
  const ev = (to: string[]) => ({
    type: 'email.received',
    data: { email_id: 'e1', to, created_at },
  });
  expect(
    await admitLinkedInReceipt(executor, ev(['other@threadplane.ai']), cfg)
  ).toBeNull();
  expect(
    await admitLinkedInReceipt(
      executor,
      ev(['linkedin@threadplane.ai', 'brian@threadplane.ai']),
      cfg
    )
  ).toBeNull();
  expect(calls).toHaveLength(0);
  expect(
    await admitLinkedInReceipt(executor, ev(['LinkedIn@threadplane.ai']), cfg)
  ).toBe('e1');
  expect(calls).toHaveLength(1);
  expect(calls[0].params).toEqual([
    'e1',
    'linkedin@threadplane.ai',
    new Date(created_at),
  ]);
});

test('an untrusted sender is stored headers-only and marked for forwarding', async () => {
  const { executor, calls } = executorWith({
    ...pending,
    'linkedin-receipt-unparsed': () => ({ rows: [] }),
  });
  const parse = vi.fn<LinkedInParser>(() => ({
    outcome: 'unparsed',
    reason: 'untrusted_sender',
  }));
  const out = await processLinkedInReceipt(executor, 'e1', cfg, {
    getReceived: async () => email({ from: 'x@evil.example', headers: {} }),
    parse,
    now: () => now,
  });
  expect(out).toBe('unparsed');
  const call = calls.find((c) => c.marker === 'linkedin-receipt-unparsed');
  expect(call?.params).toEqual([
    'e1',
    'untrusted_sender',
    'x@evil.example',
    JSON.stringify({}),
    null,
    null,
    null,
    true,
  ]);
});

test('a trusted unparsed notification keeps its raw body', async () => {
  const { executor, calls } = executorWith({
    ...pending,
    'linkedin-receipt-unparsed': () => ({ rows: [] }),
  });
  const out = await processLinkedInReceipt(executor, 'e1', cfg, {
    getReceived: async () => email(),
    parse: () => ({ outcome: 'unparsed', reason: 'no_fixtures_yet' }),
    now: () => now,
  });
  expect(out).toBe('unparsed');
  const params = calls.find(
    (c) => c.marker === 'linkedin-receipt-unparsed'
  )!.params;
  expect(params[1]).toBe('no_fixtures_yet');
  expect(params.slice(4)).toEqual([
    'Jane commented',
    'body text',
    '<p>body</p>',
    true,
  ]);
});

test('a parsed notification writes drops for denied actors and engagements for the rest', async () => {
  let n = 0;
  const { executor, calls } = executorWith({
    ...pending,
    'linkedin-post-resolve': () => ({ rows: [{ id: 'post-1' }] }),
    'linkedin-deny-match': () => ({
      rows: n++ === 0 ? [{ id: 'deny-1' }] : [],
    }),
    'linkedin-drop': () => ({ rows: [] }),
    'linkedin-lead-upsert': () => ({ rows: [{ id: 'lead-1', created: true }] }),
    'linkedin-engagement-insert': () => ({ rows: [{ id: 'eng-1' }] }),
    'linkedin-lead-engagements': () => ({
      rows: [{ kind: 'comment', post_id: 'post-1', headline: 'CTO at Acme' }],
    }),
    'linkedin-lead-score': () => ({ rows: [] }),
    'linkedin-receipt-parsed': () => ({ rows: [] }),
  });
  const out = await processLinkedInReceipt(
    executor,
    'e1',
    { ...cfg, forwardNotifications: false },
    {
      getReceived: async () => email(),
      parse: () => ({
        outcome: 'parsed',
        kind: 'comment',
        actors: [actor('a'), actor('b')],
        post: { urn: 'urn:li:activity:1', url: null },
        aggregateCount: null,
      }),
      now: () => now,
    }
  );
  expect(out).toBe('parsed');
  const drops = calls.filter((c) => c.marker === 'linkedin-drop');
  expect(drops).toHaveLength(1);
  expect(drops[0].params.slice(0, 2)).toEqual(['e1', 'deny-1']);
  expect(calls.filter((c) => c.marker === 'linkedin-lead-upsert')).toHaveLength(
    1
  );
  const parsed = calls.find((c) => c.marker === 'linkedin-receipt-parsed')!;
  expect(parsed.params[1]).toBe('comment');
  expect(parsed.params.at(-1)).toBe(false);
});

test('parsed with zero actors is unparsed as no_actor', async () => {
  const { executor, calls } = executorWith({
    ...pending,
    'linkedin-receipt-unparsed': () => ({ rows: [] }),
  });
  await processLinkedInReceipt(executor, 'e1', cfg, {
    getReceived: async () => email(),
    parse: () => ({
      outcome: 'parsed',
      kind: 'reaction',
      actors: [],
      post: { urn: 'u', url: null },
      aggregateCount: 3,
    }),
    now: () => now,
  });
  expect(
    calls.find((c) => c.marker === 'linkedin-receipt-unparsed')!.params[1]
  ).toBe('no_actor');
});

test('a second delivery of the same receipt is already_processed', async () => {
  const { executor, calls } = executorWith({
    'linkedin-receipt-lock': () => ({ rows: [{ status: 'parsed' }] }),
  });
  const out = await processLinkedInReceipt(executor, 'e1', cfg, {
    getReceived: async () => email(),
    parse: () => ({ outcome: 'unparsed', reason: 'no_fixtures_yet' }),
    now: () => now,
  });
  expect(out).toBe('already_processed');
  expect(calls.map((c) => c.marker)).toEqual(['linkedin-receipt-lock']);
});

test('a provider fetch failure records processing_failed and throws a redacted error', async () => {
  const { executor, calls } = executorWith({
    'linkedin-receipt-failed': () => ({ rows: [] }),
  });
  await expect(
    processLinkedInReceipt(executor, 'e1', cfg, {
      getReceived: async () => {
        throw new Error('secret body');
      },
      parse: () => ({ outcome: 'unparsed', reason: 'no_fixtures_yet' }),
      now: () => now,
    })
  ).rejects.toThrow(/^LinkedIn receipt processing failed$/);
  expect(
    calls.find((c) => c.marker === 'linkedin-receipt-failed')?.params
  ).toEqual(['e1']);
});

const fwdDeps = (over = {}) => ({
  environment: 'test',
  getReceived: async () =>
    email({ raw: { download_url: 'https://x.example/raw' } }),
  getRaw: async () => new Uint8Array([1, 2]),
  send: vi.fn(async () => 'f-new'),
  now: () => now,
  ...over,
});
const receiptRow = (over = {}) => ({
  forward_required: true,
  forward_provider_id: null,
  sender: 'notifications@linkedin.com',
  headers: {},
  ...over,
});

test('forward is skipped when not required and reused when already sent', async () => {
  const deps = fwdDeps();
  let row = receiptRow({ forward_required: false });
  const { executor } = executorWith({
    'linkedin-forward-receipt': () => ({ rows: [row] }),
  });
  expect(await forwardLinkedInReceipt(executor, 'e1', deps)).toBeNull();
  row = receiptRow({ forward_provider_id: 'f1' });
  expect(await forwardLinkedInReceipt(executor, 'e1', deps)).toBe('f1');
  expect(deps.send).not.toHaveBeenCalled();
});

test('a forward sends once, records the attempt and the provider id', async () => {
  const deps = fwdDeps();
  let digest = '';
  const { executor, calls } = executorWith({
    'linkedin-forward-receipt': () => ({ rows: [receiptRow()] }),
    'linkedin-forward-accepted': () => ({ rows: [] }),
    'provider-attempt-insert': (params) => {
      digest = String(params[2]);
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
    'provider-attempt-complete': () => ({ rows: [{ idempotency_key: 'k' }] }),
    'linkedin-forward-complete': () => ({ rows: [{ id: 'e1' }] }),
  });
  const result = await forwardLinkedInReceipt(executor, 'e1', deps);
  expect(result).toBe('f-new');
  expect(deps.send).toHaveBeenCalledTimes(1);
  const payload = (deps.send.mock.calls[0] as unknown[])[0] as ReturnType<
    typeof buildLinkedInForward
  >;
  expect(payload.subject).toBe('Fwd: [LinkedIn] Jane commented');
  expect(payload.to).toBe(INBOX_FORWARD_TO);
  expect(payload.tags).toContainEqual({
    name: 'job_kind',
    value: 'linkedin_forward',
  });
  expect(calls.at(-1)?.marker).toBe('linkedin-forward-complete');
  expect(calls.at(-1)?.params).toEqual(['e1', 'f-new']);
});

test('a forward loop is suppressed', async () => {
  const deps = fwdDeps({
    getReceived: async () =>
      email({ headers: { 'X-Threadplane-Forwarded': 'z' } }),
  });
  const { executor, calls } = executorWith({
    'linkedin-forward-receipt': () => ({
      rows: [receiptRow({ headers: { 'x-threadplane-forwarded': 'z' } })],
    }),
    'linkedin-forward-accepted': () => ({ rows: [] }),
    'linkedin-forward-suppressed': () => ({ rows: [] }),
  });
  expect(await forwardLinkedInReceipt(executor, 'e1', deps)).toBeNull();
  expect(deps.send).not.toHaveBeenCalled();
  expect(calls.some((c) => c.marker === 'linkedin-forward-suppressed')).toBe(
    true
  );
});

test('a required forward that fails throws', async () => {
  const deps = fwdDeps({
    send: vi.fn(async () => {
      throw new Error('boom');
    }),
  });
  let digest = '';
  const { executor } = executorWith({
    'linkedin-forward-receipt': () => ({ rows: [receiptRow()] }),
    'linkedin-forward-accepted': () => ({ rows: [] }),
    'provider-attempt-insert': (params) => {
      digest = String(params[2]);
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
  });
  await expect(forwardLinkedInReceipt(executor, 'e1', deps)).rejects.toThrow(
    'boom'
  );
  expect(deps.send).toHaveBeenCalledTimes(1);
});

test('scrub targets receipts older than 30 days', async () => {
  const { executor, calls } = executorWith({
    'linkedin-receipts-scrub': () => ({ rows: [{ id: 'a' }, { id: 'b' }] }),
  });
  expect(await scrubLinkedInReceipts(executor, { now })).toBe(2);
  expect(calls[0].params[0]).toEqual(new Date(now.getTime() - 30 * 86400000));
  expect(calls[0].params[1]).toEqual(now);
  for (const column of ['raw_subject', 'raw_text', 'raw_html'])
    expect(calls[0].sql).toContain(`${column} = null`);
});

test('manual ingest inserts a synthetic receipt and applies the deny loop', async () => {
  let n = 0;
  const { executor, calls } = executorWith({
    'linkedin-receipt-manual': () => ({ rows: [{ id: 'm1' }] }),
    'linkedin-post-resolve': () => ({ rows: [{ id: 'post-1' }] }),
    'linkedin-deny-match': () => ({
      rows: n++ === 0 ? [{ id: 'deny-1' }] : [],
    }),
    'linkedin-drop': () => ({ rows: [] }),
    'linkedin-lead-upsert': () => ({ rows: [{ id: 'lead-1', created: true }] }),
    'linkedin-engagement-insert': () => ({ rows: [{ id: 'eng-1' }] }),
    'linkedin-lead-engagements': () => ({
      rows: [{ kind: 'reaction', post_id: 'post-1', headline: '' }],
    }),
    'linkedin-lead-score': () => ({ rows: [] }),
  });
  const result = await ingestManualEngagement(executor, {
    receiptId: 'm1',
    receivedAt: now,
    kind: 'reaction',
    actors: [actor('a'), actor('b')],
    post: { urn: null, url: 'https://www.linkedin.com/posts/x' },
  });
  expect(result).toEqual({ recorded: 1, dropped: 1 });
  expect(calls[0].marker).toBe('linkedin-receipt-manual');
  expect(calls[0].params.slice(0, 2)).toEqual(['m1', now]);
});

test('manual ingest of an already-recorded receipt id touches nothing', async () => {
  const { executor, calls } = executorWith({
    'linkedin-receipt-manual': () => ({ rows: [] }),
  });
  const result = await ingestManualEngagement(executor, {
    receiptId: 'm1',
    receivedAt: now,
    kind: 'reaction',
    actors: [actor('a')],
    post: { urn: 'u', url: null },
  });
  expect(result).toEqual({ recorded: 0, dropped: 0 });
  expect(calls.map((c) => c.marker)).toEqual(['linkedin-receipt-manual']);
});

test('a parsed result from an untrusted sender is downgraded to untrusted_sender', async () => {
  const { executor, calls } = executorWith({
    ...pending,
    'linkedin-receipt-unparsed': () => ({ rows: [] }),
  });
  const out = await processLinkedInReceipt(executor, 'e1', cfg, {
    getReceived: async () => email({ from: 'x@evil.example', headers: {} }),
    parse: () => ({
      outcome: 'parsed',
      kind: 'comment',
      actors: [actor('a')],
      post: { urn: 'u', url: null },
      aggregateCount: null,
    }),
    now: () => now,
  });
  expect(out).toBe('unparsed');
  const params = calls.find(
    (c) => c.marker === 'linkedin-receipt-unparsed'
  )!.params;
  expect(params[1]).toBe('untrusted_sender');
  expect(params.slice(4)).toEqual([null, null, null, true]);
  expect(calls.some((c) => c.marker === 'linkedin-lead-upsert')).toBe(false);
});

test('forward finishes from an already-accepted attempt without sending', async () => {
  const deps = fwdDeps();
  const { executor, calls } = executorWith({
    'linkedin-forward-receipt': () => ({ rows: [receiptRow()] }),
    'linkedin-forward-accepted': () => ({
      rows: [{ provider_email_id: 'f-old' }],
    }),
    'linkedin-forward-complete': () => ({ rows: [{ id: 'e1' }] }),
  });
  expect(await forwardLinkedInReceipt(executor, 'e1', deps)).toBe('f-old');
  expect(deps.send).not.toHaveBeenCalled();
  expect(calls.at(-1)?.params).toEqual(['e1', 'f-old']);
});

test('a forward from the operator address is loop suppressed', async () => {
  const deps = fwdDeps();
  const { executor, calls } = executorWith({
    'linkedin-forward-receipt': () => ({
      rows: [receiptRow({ sender: INBOX_FORWARD_TO })],
    }),
    'linkedin-forward-accepted': () => ({ rows: [] }),
    'linkedin-forward-suppressed': () => ({ rows: [] }),
  });
  expect(await forwardLinkedInReceipt(executor, 'e1', deps)).toBeNull();
  expect(deps.send).not.toHaveBeenCalled();
  expect(calls.some((c) => c.marker === 'linkedin-forward-suppressed')).toBe(
    true
  );
});
