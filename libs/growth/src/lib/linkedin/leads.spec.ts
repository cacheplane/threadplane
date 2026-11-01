import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';

import {
  decideLead,
  deleteLead,
  listLeads,
  recordEngagement,
  resolvePost,
  scoreLead,
} from './leads.ts';
import { executorWith } from '../inbox-test-support.ts';

const now = new Date('2026-11-01T12:00:00Z');
const actor = {
  displayName: 'Jane Doe',
  headline: 'CTO at Acme',
  profileUrl: 'https://www.linkedin.com/in/jane',
  commentText: 'Nice post',
};

test('scoreLead applies the design weights', () => {
  expect(
    scoreLead({
      engagements: [{ kind: 'comment', postId: 'p1' }],
      headline: '',
    })
  ).toBe(30);
  expect(
    scoreLead({
      engagements: [
        { kind: 'comment', postId: 'p1' },
        { kind: 'reaction', postId: 'p2' },
      ],
      headline: 'Staff Angular Engineer',
    })
  ).toBe(30 + 5 + 10 + 20);
  expect(
    scoreLead({
      engagements: [{ kind: 'repost', postId: 'p1' }],
      headline: 'Recruiter',
    })
  ).toBe(15 - 20);
});

test('resolvePost reuses an existing post row', async () => {
  const { executor, calls } = executorWith({
    'linkedin-post-resolve': () => ({ rows: [{ id: 'post-1' }] }),
  });
  const id = await executor.transaction((tx) =>
    resolvePost(tx, { urn: 'urn:li:activity:1', url: null }, now)
  );
  expect(id).toBe('post-1');
  expect(calls).toHaveLength(1);
  expect(calls[0].params).toEqual(['urn:li:activity:1', null]);
});

test('resolvePost links a marketing queue row when inserting', async () => {
  const { executor, calls } = executorWith({
    'linkedin-post-resolve': () => ({
      rows: [{ id: 'mkt-1', source: 'marketing' }],
    }),
    'linkedin-post-insert': () => ({ rows: [{ id: 'post-2' }] }),
  });
  const id = await executor.transaction((tx) =>
    resolvePost(tx, { urn: 'urn:li:activity:1', url: null }, now)
  );
  expect(id).toBe('post-2');
  expect(calls[1].params).toEqual(['urn:li:activity:1', null, 'mkt-1', now]);
});

test('resolvePost inserts a bare post when nothing matches', async () => {
  const { executor, calls } = executorWith({
    'linkedin-post-resolve': () => ({ rows: [] }),
    'linkedin-post-insert': () => ({ rows: [{ id: 'post-3' }] }),
  });
  const id = await executor.transaction((tx) =>
    resolvePost(
      tx,
      { urn: 'urn:li:activity:2', url: 'https://x.example/p' },
      now
    )
  );
  expect(id).toBe('post-3');
  expect(calls[1].params).toEqual([
    'urn:li:activity:2',
    'https://x.example/p',
    null,
    now,
  ]);
});

test('resolvePost throws when the reference is empty', async () => {
  const { executor } = executorWith({});
  await expect(
    executor.transaction((tx) => resolvePost(tx, { urn: null, url: null }, now))
  ).rejects.toThrow();
});

function engagementExecutor(insertRows: unknown[]) {
  return executorWith({
    'linkedin-lead-upsert': () => ({
      rows: [{ id: 'lead-1', created: true }],
    }),
    'linkedin-engagement-insert': () => ({ rows: insertRows as never[] }),
    'linkedin-lead-engagements': () => ({
      rows: [{ kind: 'comment', post_id: 'p1' }],
    }),
    'linkedin-lead-score': () => ({ rows: [] }),
  });
}

test('recordEngagement hashes comment text and scores the lead', async () => {
  const { executor, calls } = engagementExecutor([{ id: 'e1' }]);
  const result = await executor.transaction((tx) =>
    recordEngagement(tx, {
      actor,
      kind: 'comment',
      postId: 'p1',
      occurredAt: now,
      receiptId: 'r1',
    })
  );
  expect(result).toEqual({
    outcome: 'recorded',
    leadId: 'lead-1',
    created: true,
  });
  const insert = calls.find((c) => c.marker === 'linkedin-engagement-insert');
  expect(insert?.params[3]).toBe(
    createHash('sha256').update('Nice post').digest('hex')
  );
  const upsert = calls.find((c) => c.marker === 'linkedin-lead-upsert');
  expect(upsert?.params).toContain('Acme');
  const score = calls.find((c) => c.marker === 'linkedin-lead-score');
  expect(score?.params).toEqual(['lead-1', 30 + 20]);
});

test('recordEngagement hashes null text as empty and reports duplicates', async () => {
  const { executor, calls } = engagementExecutor([]);
  const result = await executor.transaction((tx) =>
    recordEngagement(tx, {
      actor: { ...actor, commentText: null },
      kind: 'reaction',
      postId: 'p1',
      occurredAt: now,
      receiptId: null,
    })
  );
  expect(result).toEqual({ outcome: 'duplicate', leadId: 'lead-1' });
  const insert = calls.find((c) => c.marker === 'linkedin-engagement-insert');
  expect(insert?.params[3]).toBe('');
  expect(calls.some((c) => c.marker === 'linkedin-lead-score')).toBe(false);
});

const leadRow = {
  id: 'lead-1',
  status: 'new',
  profile_url: 'https://www.linkedin.com/in/jane',
  headline: 'CTO at Acme',
  company_name: 'acme',
};

function decideExecutor(opts: { status?: string; deny?: string | null } = {}) {
  return executorWith({
    'linkedin-lead-lock': () => ({
      rows: [{ ...leadRow, status: opts.status ?? 'new' }],
    }),
    'linkedin-deny-match': () => ({
      rows: opts.deny ? [{ id: opts.deny }] : [],
    }),
    'linkedin-lead-decide': () => ({ rows: [] }),
    'linkedin-deny-add': () => ({ rows: [{ id: 'd-new' }] }),
  });
}

test('decideLead approve enforces variant limits', async () => {
  const { executor } = decideExecutor();
  await expect(
    decideLead(executor, {
      leadId: 'lead-1',
      decision: 'approve',
      variant: 'connection',
      text: 'x'.repeat(301),
      decidedBy: 'brian',
      now,
    })
  ).rejects.toThrow();
  await expect(
    decideLead(executor, {
      leadId: 'lead-1',
      decision: 'approve',
      variant: 'message',
      text: 'x'.repeat(601),
      decidedBy: 'brian',
      now,
    })
  ).rejects.toThrow();
});

test('decideLead approve rejects empty or whitespace-only text', async () => {
  const { executor, calls } = decideExecutor();
  for (const text of ['', '   \n\t '])
    await expect(
      decideLead(executor, {
        leadId: 'lead-1',
        decision: 'approve',
        variant: 'message',
        text,
        decidedBy: 'brian',
        now,
      })
    ).rejects.toThrow(/empty/);
  expect(calls).toHaveLength(0);
});

test('decideLead approve applies and stores the variant text', async () => {
  const { executor, calls } = decideExecutor();
  const result = await decideLead(executor, {
    leadId: 'lead-1',
    decision: 'approve',
    variant: 'connection',
    text: 'x'.repeat(300),
    decidedBy: 'brian',
    now,
  });
  expect(result).toBe('applied');
  const update = calls.find((c) => c.marker === 'linkedin-lead-decide');
  expect(update?.params).toEqual([
    'lead-1',
    'approved',
    'brian',
    now,
    'connection',
    'x'.repeat(300),
  ]);
});

test('decideLead approve re-checks the deny list', async () => {
  const { executor, calls } = decideExecutor({ deny: 'deny-1' });
  const result = await decideLead(executor, {
    leadId: 'lead-1',
    decision: 'approve',
    variant: 'message',
    text: 'hello',
    decidedBy: 'brian',
    now,
  });
  expect(result).toBe('denied_by_list');
  const update = calls.find((c) => c.marker === 'linkedin-lead-decide');
  expect(update?.params.slice(0, 2)).toEqual(['lead-1', 'denied']);
});

test('decideLead deny adds profile_url and company_name deny rows', async () => {
  const { executor, calls } = decideExecutor();
  const result = await decideLead(executor, {
    leadId: 'lead-1',
    decision: 'deny',
    decidedBy: 'brian',
    now,
  });
  expect(result).toBe('applied');
  const adds = calls.filter((c) => c.marker === 'linkedin-deny-add');
  expect(adds.map((c) => c.params.slice(0, 2))).toEqual([
    ['profile_url', 'https://www.linkedin.com/in/jane'],
    ['company_name', 'acme'],
  ]);
  expect(adds[0].params[2]).toBe('founder_deny_forever');
  expect(adds[0].params[3]).toBe('brian');
  const update = calls.find((c) => c.marker === 'linkedin-lead-decide');
  expect(update?.params.slice(0, 2)).toEqual(['lead-1', 'denied']);
});

test('decideLead reject applies from new and returns already_decided for approved', async () => {
  const fresh = decideExecutor();
  expect(
    await decideLead(fresh.executor, {
      leadId: 'lead-1',
      decision: 'reject',
      decidedBy: 'brian',
      now,
    })
  ).toBe('applied');
  const approved = decideExecutor({ status: 'approved' });
  expect(
    await decideLead(approved.executor, {
      leadId: 'lead-1',
      decision: 'reject',
      decidedBy: 'brian',
      now,
    })
  ).toBe('already_decided');
  expect(approved.calls.some((c) => c.marker === 'linkedin-lead-decide')).toBe(
    false
  );
});

test('decideLead returns not_found when the lead is missing', async () => {
  const { executor } = executorWith({
    'linkedin-lead-lock': () => ({ rows: [] }),
  });
  expect(
    await decideLead(executor, {
      leadId: 'nope',
      decision: 'reject',
      decidedBy: 'brian',
      now,
    })
  ).toBe('not_found');
});

test('listLeads maps rows, clamps the limit and passes the status filter', async () => {
  const { executor, calls: allCalls } = executorWith({
    'linkedin-deny-company-names': () => ({ rows: [] }),
    'linkedin-leads-list': () => ({
      rows: [
        {
          id: 'lead-1',
          profile_url: 'https://www.linkedin.com/in/jane',
          display_name: 'Jane Doe',
          headline: 'CTO at Acme',
          company_name: 'acme',
          status: 'new',
          score: 50,
          first_seen_at: now,
          last_seen_at: now,
          decided_at: null,
          approved_variant: null,
          approved_text: null,
          engagements: [
            {
              kind: 'comment',
              comment_text: 'Nice',
              occurred_at: '2026-11-01T11:00:00Z',
              post_urn: 'urn:li:activity:1',
              post_url: null,
            },
          ],
        },
      ],
    }),
  });
  const leads = await listLeads(executor, { status: 'new', limit: 999 });
  const calls = allCalls.filter((c) => c.marker === 'linkedin-leads-list');
  expect(calls[0].params).toEqual(['new', 200]);
  expect(leads[0].engagements).toEqual([
    {
      kind: 'comment',
      commentText: 'Nice',
      occurredAt: new Date('2026-11-01T11:00:00Z'),
      postUrn: 'urn:li:activity:1',
      postUrl: null,
    },
  ]);
  expect(leads[0].displayName).toBe('Jane Doe');
  await listLeads(executor, {});
  expect(
    allCalls.filter((c) => c.marker === 'linkedin-leads-list')[1].params
  ).toEqual([null, 50]);
});

test('listLeads excludes leads matching an active deny row', async () => {
  const row = (id: string, company_name: string | null) => ({
    id,
    profile_url: `https://www.linkedin.com/in/${id}`,
    display_name: id,
    headline: '',
    company_name,
    status: 'new',
    score: 10,
    first_seen_at: now,
    last_seen_at: now,
    decided_at: null,
    approved_variant: null,
    approved_text: null,
    engagements: [],
  });
  const { executor, calls } = executorWith({
    'linkedin-deny-company-names': () => ({ rows: [{ value: 'acme' }] }),
    'linkedin-leads-list': () => ({
      rows: [
        row('a', 'Acme AI'),
        row('b', 'Globex'),
        row('c', null),
        row('d', 'Acmeco'),
      ],
    }),
  });
  const leads = await listLeads(executor, { status: 'new' });
  expect(leads.map((lead) => lead.id)).toEqual(['b', 'c', 'd']);
  const list = calls.find((c) => c.marker === 'linkedin-leads-list')!;
  expect(list.sql.replace(/\s+/g, ' ')).toContain(
    "not exists ( select 1 from growth_linkedin_deny d where d.kind = 'profile_url' and d.removed_at is null and d.value = l.profile_url)"
  );
  const denied = await listLeads(executor, { status: 'denied' });
  expect(denied.map((lead) => lead.id)).toEqual(['a', 'b', 'c', 'd']);
});

test('deleteLead reports whether a lead was removed', async () => {
  const { executor, calls } = executorWith({
    'linkedin-lead-delete': () => ({ rows: [{ id: 'lead-1' }] }),
  });
  expect(
    await deleteLead(executor, { profileUrl: 'https://linkedin.com/in/Jane/' })
  ).toBe(true);
  expect(calls[0].params).toEqual(['https://www.linkedin.com/in/jane']);
});
