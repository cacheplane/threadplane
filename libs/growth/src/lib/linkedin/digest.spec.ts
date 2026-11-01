import { expect, test } from 'vitest';

import {
  enqueueLinkedInDigestJob,
  markLinkedInDigestSent,
  readLinkedInDigestContext,
  readLinkedInDigestLeads,
} from './digest.ts';
import { executorWith } from '../inbox-test-support.ts';

const now = new Date('2026-11-02T17:00:00Z');
const since = new Date('2026-11-01T17:00:00Z');
const input = {
  now,
  idempotencyKey: 'linkedin_digest:2026-11-02',
  businessDate: '2026-11-02',
};
const contextRow = (over: Record<string, unknown> = {}) => ({
  rows: [
    {
      since,
      unparsed: '0',
      drops: '0',
      ingest: '3',
      forward_backlog: '0',
      ...over,
    },
  ],
});
const leadRow = (over: Record<string, unknown> = {}) => ({
  id: 'l1',
  profile_url: 'https://www.linkedin.com/in/jane',
  display_name: 'Jane',
  headline: 'CTO at Acme Inc',
  company_name: 'Acme Inc',
  status: 'new',
  score: 30,
  first_seen_at: since,
  last_seen_at: now,
  decided_at: null,
  approved_variant: null,
  approved_text: null,
  engagements: [],
  ...over,
});

test('context maps counts and passes now', async () => {
  const { executor, calls } = executorWith({
    'linkedin-digest-context': () =>
      contextRow({ unparsed: '2', drops: '1', forward_backlog: '4' }),
  });
  const context = await executor.transaction((tx) =>
    readLinkedInDigestContext(tx, { now })
  );
  expect(context).toEqual({
    since,
    unparsedCount: 2,
    dropCount: 1,
    ingestCount: 3,
    forwardBacklog: 4,
  });
  expect(calls[0].params).toEqual([now]);
});

test('leads drop denied companies by normalized name and flag rejected', async () => {
  const { executor } = executorWith({
    'linkedin-digest-deny-names': () => ({ rows: [{ value: 'acme' }] }),
    'linkedin-digest-leads': () => ({
      rows: [
        leadRow(),
        leadRow({ id: 'l2', company_name: 'Globex', status: 'rejected' }),
        leadRow({ id: 'l3', company_name: null }),
      ],
    }),
  });
  const leads = await executor.transaction((tx) => readLinkedInDigestLeads(tx));
  expect(leads.map((l) => [l.id, l.previouslyRejected])).toEqual([
    ['l2', true],
    ['l3', false],
  ]);
});

test('enqueue skips when the job exists', async () => {
  const { executor, calls } = executorWith({
    'linkedin-digest-job-exists': () => ({ rows: [{}] }),
  });
  expect(
    await executor.transaction((tx) => enqueueLinkedInDigestJob(tx, input))
  ).toBeNull();
  expect(calls).toHaveLength(1);
  expect(calls[0].params).toEqual([input.idempotencyKey]);
});

test('enqueue skips when there are no leads and zero counts', async () => {
  const { executor, calls } = executorWith({
    'linkedin-digest-job-exists': () => ({ rows: [] }),
    'linkedin-digest-deny-names': () => ({ rows: [] }),
    'linkedin-digest-leads': () => ({ rows: [] }),
    'linkedin-digest-context': () => contextRow({ forward_backlog: '9' }),
  });
  expect(
    await executor.transaction((tx) => enqueueLinkedInDigestJob(tx, input))
  ).toBeNull();
  expect(calls.some((c) => c.marker === 'enqueue-linkedin-digest')).toBe(false);
});

test('enqueue inserts the digest job', async () => {
  const { executor, calls } = executorWith({
    'linkedin-digest-job-exists': () => ({ rows: [] }),
    'linkedin-digest-deny-names': () => ({ rows: [] }),
    'linkedin-digest-leads': () => ({ rows: [leadRow()] }),
    'linkedin-digest-context': () => contextRow(),
    'enqueue-linkedin-digest': () => ({ rows: [{ id: 'job-1' }] }),
  });
  expect(
    await executor.transaction((tx) => enqueueLinkedInDigestJob(tx, input))
  ).toBe('job-1');
  const insert = calls.find((c) => c.marker === 'enqueue-linkedin-digest');
  expect(insert?.params).toEqual([now, input.idempotencyKey, '2026-11-02']);
  expect(insert?.sql).toContain(`'digest_kind', 'linkedin_leads'`);
});

test('enqueue also fires on unparsed receipts alone', async () => {
  const { executor } = executorWith({
    'linkedin-digest-job-exists': () => ({ rows: [] }),
    'linkedin-digest-deny-names': () => ({ rows: [] }),
    'linkedin-digest-leads': () => ({ rows: [] }),
    'linkedin-digest-context': () => contextRow({ unparsed: '1' }),
    'enqueue-linkedin-digest': () => ({ rows: [{ id: 'job-2' }] }),
  });
  expect(
    await executor.transaction((tx) => enqueueLinkedInDigestJob(tx, input))
  ).toBe('job-2');
});

test('enqueue validates the key prefix and date', async () => {
  const { executor } = executorWith({});
  await expect(
    executor.transaction((tx) =>
      enqueueLinkedInDigestJob(tx, { ...input, idempotencyKey: 'other:1' })
    )
  ).rejects.toThrow('linkedin_digest:');
  await expect(
    executor.transaction((tx) =>
      enqueueLinkedInDigestJob(tx, { ...input, businessDate: '11/02/2026' })
    )
  ).rejects.toThrow('YYYY-MM-DD');
});

test('markLinkedInDigestSent records the counts', async () => {
  const { executor, calls } = executorWith({
    'linkedin-digest-sent': () => ({ rows: [] }),
  });
  await executor.transaction((tx) =>
    markLinkedInDigestSent(tx, {
      businessDate: '2026-11-02',
      jobId: 'job-1',
      sentAt: now,
      leadCount: 5,
      context: {
        since,
        unparsedCount: 2,
        dropCount: 1,
        ingestCount: 3,
        forwardBacklog: 4,
      },
    })
  );
  expect(calls[0].params).toEqual(['2026-11-02', 'job-1', now, 5, 2, 1, 3]);
});
