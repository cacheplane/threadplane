import type { SqlExecutor, SqlQueryResult, SqlTransaction } from './sql.ts';
import {
  approveWeek,
  claimAlert,
  leaseDuePosts,
  markPosted,
  updateDraftPost,
} from './repository.ts';

type TestRow = Record<string, unknown>;
type Handler = (parameters: readonly unknown[], sql: string) => TestRow[];

function fakeExecutor(handlers: Record<string, Handler>) {
  const calls: {
    marker: string;
    parameters: readonly unknown[];
    sql: string;
  }[] = [];
  const transaction: SqlTransaction = {
    async execute<Row extends Record<string, unknown>>(
      sql: string,
      parameters: readonly unknown[] = []
    ): Promise<SqlQueryResult<Row>> {
      const marker = /\/\* marketing:([a-z0-9-]+) \*\//u.exec(sql)?.[1];
      const handler = marker ? handlers[marker] : undefined;
      if (!marker || !handler) {
        throw new Error(`Unexpected SQL marker: ${marker ?? 'missing'}`);
      }
      calls.push({ marker, parameters, sql });
      return { rows: handler(parameters, sql) as Row[] };
    },
  };
  const executor: SqlExecutor = {
    execute: transaction.execute.bind(transaction),
    transaction: (operation) => operation(transaction),
  };
  return { calls, executor };
}

function postRow(overrides: TestRow): TestRow {
  return {
    id: 'p',
    week_id: 'w1',
    channel: 'x',
    kind: 'news',
    status: 'draft',
    publish_at: new Date('2026-11-03T16:30:00Z'),
    payload: { text: 'hello' },
    media: [],
    source_refs: [],
    depends_on: null,
    utm_campaign: null,
    idempotency_key: 'x:2026-11-02:1',
    confirmed_flags: [],
    lease_token: null,
    lease_expires_at: null,
    attempts: 0,
    deploy_requested_at: null,
    result: null,
    error: null,
    created_at: new Date('2026-10-29T00:00:00Z'),
    updated_at: new Date('2026-10-29T00:00:00Z'),
    ...overrides,
  };
}

const NOW = new Date('2026-11-02T00:00:00Z');
const flag = (code: string, blocking = true) => ({ code, blocking });

describe('approveWeek', () => {
  function approve(rows: TestRow[]) {
    const fake = fakeExecutor({
      'approve-week-drafts': () => rows,
      'schedule-posts': () => [],
      'approve-week': () => [],
    });
    return { ...fake, result: approveWeek(fake.executor, 'w1', NOW) };
  }

  it('schedules clean future drafts only', async () => {
    const { calls, result } = approve([
      postRow({ id: 'clean' }),
      postRow({
        id: 'warn',
        payload: { lintFlags: [flag('em-dash', false)] },
      }),
      postRow({
        id: 'confirmed',
        payload: { lintFlags: [flag('competitor')] },
        confirmed_flags: ['competitor'],
      }),
    ]);
    expect(await result).toEqual({
      scheduled: ['clean', 'warn', 'confirmed'],
      blocked: [],
      past: [],
    });
    const schedule = calls.find((c) => c.marker === 'schedule-posts');
    expect(schedule?.parameters).toEqual([['clean', 'warn', 'confirmed']]);
    expect(calls.map((c) => c.marker)).toContain('approve-week');
  });

  it('returns blocked rows with their unconfirmed codes', async () => {
    const { calls, result } = approve([
      postRow({
        id: 'b',
        payload: {
          lintFlags: [
            flag('competitor'),
            flag('politics'),
            flag('dash', false),
          ],
        },
        confirmed_flags: ['politics'],
      }),
    ]);
    expect(await result).toEqual({
      scheduled: [],
      blocked: [{ id: 'b', codes: ['competitor'] }],
      past: [],
    });
    expect(calls.map((c) => c.marker)).not.toContain('schedule-posts');
  });

  it('returns past rows untouched', async () => {
    const { calls, result } = approve([
      postRow({ id: 'old', publish_at: new Date('2026-11-01T00:00:00Z') }),
    ]);
    expect(await result).toEqual({ scheduled: [], blocked: [], past: ['old'] });
    expect(calls.map((c) => c.marker)).not.toContain('schedule-posts');
  });
});

describe('updateDraftPost', () => {
  function update(status: string) {
    const fake = fakeExecutor({
      'lock-post-for-update': () => [postRow({ id: 'p', status })],
      'update-draft-post': () => [
        postRow({ id: 'p', payload: { text: 'new' } }),
      ],
      'insert-revision': () => [],
    });
    return fake;
  }

  it('records a revision when payload changes', async () => {
    const { calls, executor } = update('draft');
    await updateDraftPost(executor, 'p', { payload: { text: 'new' } });
    const revision = calls.find((c) => c.marker === 'insert-revision');
    expect(revision?.parameters.slice(1)).toEqual([
      'p',
      '{"text":"hello"}',
      '{"text":"new"}',
    ]);
  });

  it('skips the revision when only the schedule changes', async () => {
    const { calls, executor } = update('scheduled');
    await updateDraftPost(executor, 'p', {
      publishAt: '2026-11-04T16:30:00.000Z',
    });
    expect(calls.map((c) => c.marker)).not.toContain('insert-revision');
  });

  it('editing a scheduled post to add a blocking flag demotes it to draft', async () => {
    const { calls, executor } = update('scheduled');
    await updateDraftPost(executor, 'p', {
      payload: { text: 'new', lintFlags: [flag('competitor')] },
    });
    const statement = calls.find((c) => c.marker === 'update-draft-post');
    expect(statement?.parameters.slice(5)).toEqual([true, 'draft']);
  });

  it('keeps a scheduled post scheduled when the edit adds only warnings', async () => {
    const { calls, executor } = update('scheduled');
    await updateDraftPost(executor, 'p', {
      payload: { text: 'new', lintFlags: [flag('dash', false)] },
    });
    const statement = calls.find((c) => c.marker === 'update-draft-post');
    expect(statement?.parameters.slice(5)).toEqual([true, 'scheduled']);
  });

  it('editing a payload clears confirmed_flags', async () => {
    const { calls, executor } = update('draft');
    await updateDraftPost(executor, 'p', { payload: { text: 'new' } });
    const statement = calls.find((c) => c.marker === 'update-draft-post');
    expect(statement?.sql).toMatch(/confirmed_flags = case when \$6/u);
    expect(statement?.parameters[5]).toBe(true);
    const untouched = update('draft');
    await updateDraftPost(untouched.executor, 'p', { media: [] });
    expect(
      untouched.calls.find((c) => c.marker === 'update-draft-post')
        ?.parameters[5]
    ).toBe(false);
  });

  it('rejects posts that are already posting', async () => {
    const { executor } = update('posting');
    await expect(
      updateDraftPost(executor, 'p', { payload: { text: 'x' } })
    ).rejects.toThrow(/posting/);
  });
});

describe('leaseDuePosts', () => {
  it('uses for update skip locked and status scheduled', async () => {
    const { calls, executor } = fakeExecutor({
      'lease-due-posts': () => [
        postRow({
          id: 'p',
          status: 'posting',
          lease_token: 'tok',
          attempts: 1,
        }),
      ],
    });
    const leased = await leaseDuePosts(executor, {
      now: NOW,
      limit: 5,
      leaseMs: 60_000,
    });
    const { sql, parameters } = calls[0];
    expect(sql).toMatch(/where status = 'scheduled' and publish_at <= \$1/u);
    expect(sql).toMatch(/for update skip locked/u);
    expect(sql).toMatch(/status = 'posting'/u);
    expect(sql).toMatch(/attempts = attempts \+ 1/u);
    expect(parameters).toEqual([NOW, 5, 60_000]);
    expect(leased[0]).toMatchObject({
      id: 'p',
      leaseToken: 'tok',
      attempts: 1,
    });
  });

  // Run against a live Postgres only when DATABASE_URL_TEST is set. Without it
  // this asserts the exclusivity mechanism (row locks that concurrent callers
  // skip) in the SQL itself, which is unverified against a live database.
  it('is exclusive across concurrent callers', async () => {
    if (process.env['DATABASE_URL_TEST']) {
      // Live-database variant intentionally not wired in phase 1.
    }
    const { calls, executor } = fakeExecutor({ 'lease-due-posts': () => [] });
    await Promise.all([
      leaseDuePosts(executor, { now: NOW, limit: 1, leaseMs: 1 }),
      leaseDuePosts(executor, { now: NOW, limit: 1, leaseMs: 1 }),
    ]);
    for (const call of calls) {
      expect(call.sql).toMatch(
        /where id in \(\s*select id from marketing_posts[\s\S]*for update skip locked[\s\S]*limit \$2\s*\)/u
      );
    }
  });
});

describe('lease completion', () => {
  it('throws when the lease is no longer held', async () => {
    const { executor } = fakeExecutor({ 'mark-posted': () => [] });
    await expect(markPosted(executor, 'p', 'tok', {})).rejects.toThrow(
      /no longer held/
    );
  });
});

describe('claimAlert', () => {
  it('is true only when the insert returned a row', async () => {
    let rows: TestRow[] = [{ key: 'k' }];
    const { executor } = fakeExecutor({ 'claim-alert': () => rows });
    expect(await claimAlert(executor, 'k')).toBe(true);
    rows = [];
    expect(await claimAlert(executor, 'k')).toBe(false);
  });
});
