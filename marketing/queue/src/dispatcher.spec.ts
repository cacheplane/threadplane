import { randomBytes } from 'node:crypto';
import type {
  AdapterOptions,
  ChannelAdapter,
  ChannelId,
  Draft,
} from '@threadplane-internal/marketing-channels';
import { createAlertSender } from './alerts.ts';
import { seal, unseal } from './crypto.ts';
import { loadAdapterOptions } from './credentials.ts';
import {
  dispatchMarketingPosts,
  type MarketingDispatchDependencies,
} from './dispatcher.ts';
import { claimAlert, releaseAlertClaim } from './repository.ts';
import type { SqlExecutor, SqlQueryResult, SqlTransaction } from './sql.ts';

type TestRow = Record<string, unknown>;

/** Stateful in-memory stand-in for the marketing_* tables, keyed by SQL marker. */
function fakeDatabase(seed: TestRow[], credentials: Record<string, TestRow> = {}) {
  const rows = new Map(seed.map((row) => [row['id'] as string, { ...row }]));
  const claimed = new Set<string>();
  const events: string[] = [];
  let transactions = 0;
  let tokens = 0;

  const leased = (id: string, token: unknown) => {
    const row = rows.get(id);
    return row && row['status'] === 'posting' && row['lease_token'] === token
      ? row
      : undefined;
  };
  const finish = (
    parameters: readonly unknown[],
    apply: (row: TestRow) => void
  ): TestRow[] => {
    const row = leased(parameters[0] as string, parameters[1]);
    if (!row) return [];
    apply(row);
    return [{ id: row['id'] }];
  };
  const handlers: Record<string, (p: readonly unknown[]) => TestRow[]> = {
    'lease-due-posts': ([now, limit, leaseMs]) => {
      const dueAt = (row: TestRow) =>
        ((row['next_attempt_at'] ?? row['publish_at']) as Date).getTime();
      const due = [...rows.values()]
        .filter(
          (row) =>
            row['status'] === 'scheduled' &&
            dueAt(row) <= (now as Date).getTime()
        )
        .sort((a, b) => dueAt(a) - dueAt(b))
        .slice(0, limit as number);
      for (const row of due) {
        tokens += 1;
        row['status'] = 'posting';
        row['lease_token'] = `lease-${tokens}`;
        row['lease_expires_at'] = new Date(
          (now as Date).getTime() + (leaseMs as number)
        );
        row['attempts'] = (row['attempts'] as number) + 1;
      }
      return due.map((row) => ({ ...row }));
    },
    'release-to-scheduled': (p) =>
      finish(p, (row) => {
        row['status'] = 'scheduled';
        row['lease_token'] = null;
        row['lease_expires_at'] = null;
        row['attempts'] = (row['attempts'] as number) - 1;
        row['next_attempt_at'] = new Date(
          (p[2] as Date).getTime() + (p[3] as number)
        );
      }),
    'mark-posted': (p) =>
      finish(p, (row) => {
        row['status'] = 'posted';
        row['result'] = JSON.parse(p[2] as string);
        row['lease_token'] = null;
        row['lease_expires_at'] = null;
      }),
    'mark-failed': (p) =>
      finish(p, (row) => {
        row['status'] = 'failed';
        row['error'] = p[2];
        row['lease_token'] = null;
        row['lease_expires_at'] = null;
      }),
    'mark-deploy-requested': (p) => {
      const row = leased(p[0] as string, p[1]);
      if (!row) return [];
      row['deploy_requested_at'] = p[2];
      return [{ id: row['id'] }];
    },
    'release-alert-claim': ([key]) => {
      claimed.delete(key as string);
      return [];
    },
    'claim-alert': ([key]) => {
      if (claimed.has(key as string)) return [];
      claimed.add(key as string);
      return [{ key }];
    },
    'get-post': ([id]) => {
      const row = rows.get(id as string);
      return row ? [{ ...row }] : [];
    },
    'list-expired-posting-leases': ([now]) =>
      [...rows.values()]
        .filter(
          (row) =>
            row['status'] === 'posting' &&
            row['lease_expires_at'] != null &&
            (row['lease_expires_at'] as Date).getTime() <
              (now as Date).getTime()
        )
        .map((row) => ({ ...row })),
    'get-channel-credentials': ([channel]) => {
      const row = credentials[channel as string];
      return row ? [row] : [];
    },
    'upsert-channel-credentials': ([channel, sealed, expiresAt]) => {
      credentials[channel as string] = { sealed, expires_at: expiresAt };
      events.push(`persisted:${channel as string}`);
      return [];
    },
  };
  const transaction: SqlTransaction = {
    async execute<Row extends Record<string, unknown>>(
      sql: string,
      parameters: readonly unknown[] = []
    ): Promise<SqlQueryResult<Row>> {
      const marker = /\/\* marketing:([a-z0-9-]+) \*\//u.exec(sql)?.[1];
      const handler = marker ? handlers[marker] : undefined;
      if (!handler) throw new Error(`Unexpected SQL marker: ${marker}`);
      return { rows: handler(parameters) as Row[] };
    },
  };
  const executor: SqlExecutor = {
    execute: transaction.execute.bind(transaction),
    transaction: (operation) => {
      transactions += 1;
      return operation(transaction);
    },
  };
  return {
    executor,
    rows,
    credentials,
    events,
    transactions: () => transactions,
  };
}

const PUBLISH_AT = new Date('2026-11-03T16:30:00Z');
const at = (minutes: number) =>
  new Date(PUBLISH_AT.getTime() + minutes * 60_000);
const CANONICAL = 'https://threadplane.ai/blog/streaming-state';

function postRow(overrides: TestRow): TestRow {
  return {
    id: 'p',
    week_id: 'w1',
    channel: 'x',
    kind: 'news',
    status: 'scheduled',
    publish_at: PUBLISH_AT,
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
    next_attempt_at: null,
    result: null,
    error: null,
    created_at: new Date('2026-10-29T00:00:00Z'),
    updated_at: new Date('2026-10-29T00:00:00Z'),
    ...overrides,
  };
}

const OPTIONS: AdapterOptions = {
  x: {
    credentials: {
      clientId: 'cid',
      clientSecret: 'csecret',
      accessToken: 'xa',
      refreshToken: 'xr',
      userHandle: 'brian',
    },
  },
  linkedin: {
    credentials: {
      accessToken: 'la',
      authorUrn: 'urn:li:person:1',
      expiresAt: new Date('2027-01-15T00:00:00Z'),
    },
  },
  devto: { credentials: { apiKey: 'dk' } },
};

function harness(
  overrides: Partial<MarketingDispatchDependencies> & {
    now?: () => Date;
    post?: (draft: Draft, options?: AdapterOptions) => Promise<unknown>;
  } = {}
) {
  const posts: { channel: ChannelId; draft: Draft }[] = [];
  const created: { channel: ChannelId; options?: AdapterOptions }[] = [];
  const alerts: { key: string; subject: string; body: string }[] = [];
  const calls = {
    loadAdapterOptions: 0,
    triggerDeploy: 0,
    checkLive: [] as string[],
    devtoHasCanonical: [] as string[],
  };
  let clock = at(5);
  const deps: MarketingDispatchDependencies = {
    now: () => clock,
    createAdapter: ((channel: ChannelId, options?: AdapterOptions) => {
      created.push({ channel, options });
      const adapter: ChannelAdapter = {
        id: channel,
        async post(draft) {
          posts.push({ channel, draft });
          if (overrides.post) await overrides.post(draft, options);
          return {
            channel,
            postId: `${channel}-1`,
            url: `https://${channel}.example/1`,
            postedAt: clock.toISOString(),
          };
        },
        metrics: async () => {
          throw new Error('unused');
        },
      };
      return adapter;
    }) as MarketingDispatchDependencies['createAdapter'],
    loadAdapterOptions: async () => {
      calls.loadAdapterOptions += 1;
      return OPTIONS;
    },
    fetchMedia: async (url) => Buffer.from(`png:${url}`),
    checkLive: async (url) => {
      calls.checkLive.push(url);
      return true;
    },
    devtoHasCanonical: async (url) => {
      calls.devtoHasCanonical.push(url);
      return null;
    },
    triggerDeploy: async () => {
      calls.triggerDeploy += 1;
    },
    alert: async (key, subject, body) => {
      alerts.push({ key, subject, body });
    },
    ...overrides,
  };
  return {
    deps,
    posts,
    created,
    alerts,
    calls,
    setNow: (date: Date) => {
      clock = date;
    },
  };
}

const tick = (
  db: ReturnType<typeof fakeDatabase>,
  deps: MarketingDispatchDependencies,
  signal = new AbortController().signal,
  limit = 10
) => dispatchMarketingPosts(db.executor, { limit, signal }, deps);

/** The real alert sender, claiming keys in the fake database. */
function claimingSender(
  db: ReturnType<typeof fakeDatabase>,
  send: (input: { subject: string; text: string }) => Promise<void> = async () => undefined
) {
  const emails: { subject: string; text: string }[] = [];
  const alert = createAlertSender({
    resend: {
      async send(input) {
        await send(input);
        emails.push(input);
        return { error: null };
      },
    },
    from: 'alerts@threadplane.ai',
    to: 'founder@example.com',
    claim: (key) => claimAlert(db.executor, key),
    release: (key) => releaseAlertClaim(db.executor, key),
  });
  return { alert, emails };
}

describe('dispatchMarketingPosts', () => {
  it('posts a due x row and marks posted', async () => {
    const db = fakeDatabase([
      postRow({
        id: 'x1',
        payload: {
          channel: 'x',
          text: 'Streaming state, explained',
          threadParts: ['Read it here'],
          link: { url: 'https://threadplane.ai/blog/a?utm_source=x' },
          lintFlags: [{ code: 'em-dash', blocking: false }],
          notes: 'internal',
        },
        media: [{ url: 'https://blob.example/card.png', alt: 'Card' }],
      }),
    ]);
    const h = harness();
    const result = await tick(db, h.deps);

    expect(result).toEqual({
      posted: 1,
      waiting: 0,
      failed: 0,
      alerts: [],
      alertErrors: [],
    });
    expect(h.created).toEqual([
      { channel: 'x', options: { ...OPTIONS, signal: expect.any(AbortSignal) } },
    ]);
    expect(h.posts).toEqual([
      {
        channel: 'x',
        draft: {
          channel: 'x',
          text: 'Streaming state, explained',
          threadParts: ['Read it here'],
          link: { url: 'https://threadplane.ai/blog/a?utm_source=x' },
          media: [
            {
              png: Buffer.from('png:https://blob.example/card.png'),
              alt: 'Card',
            },
          ],
        },
      },
    ]);
    expect(db.rows.get('x1')).toMatchObject({
      status: 'posted',
      lease_token: null,
      result: {
        postId: 'x-1',
        url: 'https://x.example/1',
        postedAt: at(5).toISOString(),
      },
    });
    expect(db.transactions()).toBe(0);
  });

  it('a row in posting state is never re-posted', async () => {
    const db = fakeDatabase([
      postRow({ id: 'done', idempotency_key: 'x:1' }),
      postRow({
        id: 'inflight',
        status: 'posting',
        lease_token: 'other-tick',
        lease_expires_at: at(20),
        idempotency_key: 'x:2',
      }),
      postRow({
        id: 'stale',
        status: 'posting',
        lease_token: 'dead-tick',
        lease_expires_at: at(-30),
        idempotency_key: 'x:3',
      }),
    ]);
    const h = harness();
    await tick(db, h.deps);
    h.setNow(at(60));
    await tick(db, h.deps);

    expect(h.posts.map((p) => p.draft.text)).toEqual(['hello']);
    expect(db.rows.get('done')?.['status']).toBe('posted');
    expect(db.rows.get('inflight')).toMatchObject({
      status: 'posting',
      lease_token: 'other-tick',
    });
    expect(db.rows.get('stale')).toMatchObject({
      status: 'posting',
      lease_token: 'dead-tick',
    });
  });

  it('adapter throw marks failed and alerts once', async () => {
    const db = fakeDatabase([postRow({ id: 'x1' })]);
    const { alert, emails } = claimingSender(db);
    const h = harness({
      alert,
      post: async () => {
        throw new Error('X returned 503 after send');
      },
    });

    const first = await tick(db, h.deps);
    expect(first).toEqual({
      posted: 0,
      waiting: 0,
      failed: 1,
      alerts: ['post_failed:x1'],
      alertErrors: [],
    });
    expect(h.posts).toHaveLength(1);
    expect(db.rows.get('x1')).toMatchObject({
      status: 'failed',
      error: 'X returned 503 after send',
    });

    // Same tick logic again: a failed row is not leased, so post() is not
    // re-called. Even if a human requeues it and it fails again, the
    // already-claimed alert key sends no second email.
    await tick(db, h.deps);
    expect(h.posts).toHaveLength(1);
    const requeued = db.rows.get('x1');
    if (requeued) requeued['status'] = 'scheduled';
    await tick(db, h.deps);
    expect(h.posts).toHaveLength(2);

    expect(emails).toHaveLength(1);
    expect(emails[0].subject).toContain('x1');
    expect(emails[0].text).toContain('X returned 503 after send');
    expect(emails[0].text).toContain(PUBLISH_AT.toISOString());
    expect(emails[0].text).not.toContain('csecret');
  });

  it('rotated X tokens persist before posting', async () => {
    const key = randomBytes(32);
    const db = fakeDatabase([postRow({ id: 'x1' })], {
      x: {
        sealed: seal(
          JSON.stringify({ accessToken: 'a1', refreshToken: 'r1' }),
          key
        ),
        expires_at: null,
      },
    });
    const h = harness({
      loadAdapterOptions: () =>
        loadAdapterOptions(db.executor, key, {
          X_CLIENT_ID: 'cid',
          X_CLIENT_SECRET: 'cs',
          X_USER_HANDLE: 'brian',
        }),
      // Mirrors XAdapter: a 401 triggers XAuth.refresh(), which awaits the
      // rotation hook before the create request goes out.
      post: async (_draft, options) => {
        db.events.push('refresh');
        await options?.x?.onTokensRotated?.({
          accessToken: 'a2',
          refreshToken: 'r2',
        });
        db.events.push('create');
      },
    });

    const result = await tick(db, h.deps);

    expect(result.posted).toBe(1);
    expect(db.events).toEqual(['refresh', 'persisted:x', 'create']);
    expect(db.transactions()).toBe(0);
    expect(
      JSON.parse(unseal(db.credentials['x']['sealed'] as string, key))
    ).toEqual({ accessToken: 'a2', refreshToken: 'r2' });
  });

  it('blog row triggers deploy once then posts when live', async () => {
    const db = fakeDatabase([
      postRow({
        id: 'b1',
        channel: 'blog',
        kind: 'guide',
        payload: { canonicalUrl: CANONICAL, slug: 'streaming-state' },
      }),
    ]);
    let live = false;
    const h = harness({
      checkLive: async () => live,
    });

    const first = await tick(db, h.deps);
    expect(first).toMatchObject({ posted: 0, waiting: 1 });
    expect(h.calls.triggerDeploy).toBe(1);
    expect(db.rows.get('b1')).toMatchObject({
      status: 'scheduled',
      deploy_requested_at: at(5),
      attempts: 0,
    });

    h.setNow(at(40));
    expect(await tick(db, h.deps)).toMatchObject({ posted: 0, waiting: 1 });
    expect(h.calls.triggerDeploy).toBe(1);

    h.setNow(at(181));
    const late = await tick(db, h.deps);
    expect(late.alerts).toEqual(['blog_not_live:b1']);

    live = true;
    h.setNow(at(215));
    expect(await tick(db, h.deps)).toMatchObject({ posted: 1, waiting: 0 });
    expect(h.calls.triggerDeploy).toBe(1);
    expect(db.rows.get('b1')).toMatchObject({
      status: 'posted',
      result: { url: CANONICAL },
    });
    expect(h.created).toEqual([]);
    expect(h.calls.loadAdapterOptions).toBe(0);
  });

  it('dependent waits for canonical 200 and alerts after 3h', async () => {
    const db = fakeDatabase([
      postRow({
        id: 'blog',
        channel: 'blog',
        status: 'draft',
        payload: { canonicalUrl: CANONICAL },
        idempotency_key: 'blog:1',
      }),
      postRow({
        id: 'dev1',
        channel: 'devto',
        depends_on: 'blog',
        payload: {
          channel: 'devto',
          text: 'body',
          article: { title: 'Streaming state', canonicalUrl: CANONICAL },
        },
        idempotency_key: 'devto:1',
      }),
    ]);
    let live = false;
    const h = harness({
      checkLive: async (url) => {
        h.calls.checkLive.push(url);
        return live;
      },
    });

    // Dependency not posted yet.
    h.setNow(at(60));
    expect(await tick(db, h.deps)).toEqual({
      posted: 0,
      waiting: 1,
      failed: 0,
      alerts: [],
      alertErrors: [],
    });
    expect(h.calls.checkLive).toEqual([]);

    // Dependency posted, but the canonical URL does not return 200 yet.
    const blog = db.rows.get('blog');
    if (blog) blog['status'] = 'posted';
    h.setNow(at(120));
    expect(await tick(db, h.deps)).toMatchObject({ waiting: 1, alerts: [] });
    expect(h.calls.checkLive).toEqual([CANONICAL]);

    h.setNow(at(181));
    expect(await tick(db, h.deps)).toMatchObject({
      waiting: 1,
      alerts: ['dependency_not_live:dev1'],
    });
    expect(h.posts).toEqual([]);
    expect(db.rows.get('dev1')?.['status']).toBe('scheduled');

    live = true;
    h.setNow(at(215));
    expect(await tick(db, h.deps)).toMatchObject({ posted: 1 });
    expect(h.posts.map((p) => p.channel)).toEqual(['devto']);
    expect(h.posts[0].draft.article).toEqual({
      title: 'Streaming state',
      canonicalUrl: CANONICAL,
    });
  });

  it('dependent alerts after 3h when its dependency never posts', async () => {
    const db = fakeDatabase([
      postRow({
        id: 'blog',
        channel: 'blog',
        status: 'draft',
        idempotency_key: 'blog:1',
      }),
      postRow({
        id: 'x2',
        depends_on: 'blog',
      }),
    ]);
    const h = harness();
    h.setNow(at(181));
    expect(await tick(db, h.deps)).toMatchObject({
      waiting: 1,
      alerts: ['dependency_not_live:x2'],
    });
    expect(h.posts).toEqual([]);
  });

  it('devto skips posting when dev.to already has the canonical', async () => {
    const db = fakeDatabase([
      postRow({
        id: 'dev1',
        channel: 'devto',
        payload: {
          channel: 'devto',
          text: 'body',
          article: { title: 'T', canonicalUrl: CANONICAL },
        },
      }),
    ]);
    const h = harness({
      devtoHasCanonical: async () => 'https://dev.to/brian/streaming-state-1',
    });
    expect(await tick(db, h.deps)).toMatchObject({ posted: 1 });
    expect(h.created).toEqual([]);
    expect(h.calls.loadAdapterOptions).toBe(0);
    expect(db.rows.get('dev1')).toMatchObject({
      status: 'posted',
      result: { url: 'https://dev.to/brian/streaming-state-1' },
    });
  });

  it('expired posting lease alerts post_outcome_unknown and leaves the row', async () => {
    const stuck = postRow({
      id: 'stuck',
      status: 'posting',
      lease_token: 'dead',
      lease_expires_at: at(-1),
      attempts: 1,
    });
    const db = fakeDatabase([stuck]);
    const h = harness();
    const result = await tick(db, h.deps);
    expect(result.alerts).toEqual(['post_outcome_unknown:stuck']);
    expect(h.alerts[0].body).toContain('stuck');
    expect(db.rows.get('stuck')).toEqual(stuck);
    expect(h.posts).toEqual([]);
  });

  it('linkedin expiring inside 7 days alerts with expiry date key', async () => {
    const expiresAt = new Date(at(5).getTime() + 3 * 24 * 60 * 60_000);
    const db = fakeDatabase([
      postRow({ id: 'li1', channel: 'linkedin', payload: { text: 'hi' } }),
    ]);
    const h = harness({
      loadAdapterOptions: async () => ({
        ...OPTIONS,
        linkedin: {
          credentials: {
            accessToken: 'li-secret-token',
            authorUrn: 'u',
            expiresAt,
          },
        },
      }),
    });
    const result = await tick(db, h.deps);
    expect(result).toMatchObject({
      posted: 1,
      alerts: ['linkedin_expiring:2026-11-06:2026-11-03'],
    });
    expect(h.alerts[0].body).toContain('2026-11-06');
    expect(h.alerts[0].body).not.toContain('li-secret-token');

    const fresh = harness();
    const db2 = fakeDatabase([
      postRow({ id: 'li2', channel: 'linkedin', payload: { text: 'hi' } }),
    ]);
    expect((await tick(db2, fresh.deps)).alerts).toEqual([]);
  });

  it('missing channel credentials release the row and alert', async () => {
    const db = fakeDatabase([
      postRow({ id: 'li1', channel: 'linkedin', idempotency_key: 'l:1' }),
      postRow({ id: 'x1', idempotency_key: 'x:1' }),
    ]);
    const h = harness({ loadAdapterOptions: async () => ({ x: OPTIONS.x }) });
    const result = await tick(db, h.deps);
    expect(result).toEqual({
      posted: 1,
      waiting: 1,
      failed: 0,
      alerts: ['credentials_unavailable:linkedin:2026-11-03'],
      alertErrors: [],
    });
    expect(db.rows.get('li1')).toMatchObject({
      status: 'scheduled',
      attempts: 0,
    });
  });

  it('credential load failure releases every adapter row and loads once', async () => {
    let loads = 0;
    const db = fakeDatabase([
      postRow({ id: 'x1', idempotency_key: 'x:1' }),
      postRow({ id: 'x2', idempotency_key: 'x:2', publish_at: at(1) }),
    ]);
    const h = harness({
      loadAdapterOptions: async () => {
        loads += 1;
        throw new Error('MARKETING_CREDENTIALS_KEY must be set');
      },
    });
    const result = await tick(db, h.deps);
    expect(loads).toBe(1);
    expect(result).toEqual({
      posted: 0,
      waiting: 2,
      failed: 0,
      alerts: ['credentials_unavailable:x:2026-11-03'],
      alertErrors: [],
    });
    expect(h.posts).toEqual([]);
    expect(db.rows.get('x2')?.['status']).toBe('scheduled');
  });

  it('media fetch failure releases the row and alerts', async () => {
    const db = fakeDatabase([
      postRow({
        id: 'x1',
        media: [{ url: 'https://blob.example/gone.png', alt: 'Card' }],
      }),
    ]);
    const h = harness({
      fetchMedia: async () => {
        throw new Error('404 from blob store');
      },
    });
    expect(await tick(db, h.deps)).toEqual({
      posted: 0,
      waiting: 1,
      failed: 0,
      alerts: ['media_unavailable:x1'],
      alertErrors: [],
    });
    expect(h.posts).toEqual([]);
    expect(db.rows.get('x1')?.['status']).toBe('scheduled');
  });

  it('second X row in a tick uses the rotated refresh token', async () => {
    const key = randomBytes(32);
    const db = fakeDatabase(
      [
        postRow({ id: 'x1', idempotency_key: 'x:1' }),
        postRow({ id: 'x2', idempotency_key: 'x:2', publish_at: at(1) }),
      ],
      {
        x: {
          sealed: seal(JSON.stringify({ accessToken: 'a1', refreshToken: 'r1' }), key),
          expires_at: null,
        },
      }
    );
    const seen: { accessToken?: string; refreshToken?: string }[] = [];
    let rotated = false;
    const h = harness({
      loadAdapterOptions: () =>
        loadAdapterOptions(db.executor, key, {
          X_CLIENT_ID: 'cid',
          X_CLIENT_SECRET: 'cs',
          X_USER_HANDLE: 'brian',
        }),
      post: async (_draft, options) => {
        const c = options?.x?.credentials;
        seen.push({ accessToken: c?.accessToken, refreshToken: c?.refreshToken });
        if (!rotated) {
          rotated = true;
          // The first row's 401 refresh: X rotates r1 into r2.
          await options?.x?.onTokensRotated?.({ accessToken: 'a2', refreshToken: 'r2' });
        }
      },
    });

    const result = await tick(db, h.deps);

    expect(result.posted).toBe(2);
    expect(h.created).toHaveLength(2);
    expect(seen).toEqual([
      { accessToken: 'a1', refreshToken: 'r1' },
      { accessToken: 'a2', refreshToken: 'r2' },
    ]);
  });

  it('passes the step signal to every adapter it builds', async () => {
    const controller = new AbortController();
    const db = fakeDatabase([postRow({ id: 'x1' })]);
    const h = harness();
    await tick(db, h.deps, controller.signal);
    expect(h.created[0].options?.signal).toBe(controller.signal);
  });

  it('an aborted signal before post() releases the row without calling post', async () => {
    const controller = new AbortController();
    const db = fakeDatabase([
      postRow({ id: 'x1', media: [{ url: 'https://blob.example/a.png', alt: 'a' }] }),
    ]);
    const h = harness({
      // The budget runs out while the media is being fetched.
      fetchMedia: async () => {
        controller.abort();
        return Buffer.from('png');
      },
    });
    const result = await tick(db, h.deps, controller.signal);
    expect(h.posts).toHaveLength(0);
    expect(result).toMatchObject({ posted: 0, waiting: 1, failed: 0 });
    expect(db.rows.get('x1')).toMatchObject({
      status: 'scheduled',
      lease_token: null,
      attempts: 0,
    });
  });

  it('stops before the next row once the signal aborts and releases the rest', async () => {
    const controller = new AbortController();
    const db = fakeDatabase([
      postRow({ id: 'x1', idempotency_key: 'x:1' }),
      postRow({ id: 'x2', idempotency_key: 'x:2', publish_at: at(1) }),
    ]);
    const h = harness({
      post: async () => {
        controller.abort();
      },
    });
    const result = await tick(db, h.deps, controller.signal);
    expect(result).toMatchObject({ posted: 1 });
    expect(h.posts).toHaveLength(1);
    expect(db.rows.get('x2')).toMatchObject({
      status: 'scheduled',
      lease_token: null,
    });
  });

  it('does not lease when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const db = fakeDatabase([postRow({ id: 'x1' })]);
    const h = harness();
    await tick(db, h.deps, controller.signal);
    expect(db.rows.get('x1')).toMatchObject({
      status: 'scheduled',
      attempts: 0,
    });
  });
  it('five held rows do not starve a fresh due row', async () => {
    const held = [1, 2, 3, 4, 5].map((n) =>
      postRow({
        id: `held${n}`,
        depends_on: 'blog',
        publish_at: at(-n),
        idempotency_key: `x:held${n}`,
      })
    );
    const db = fakeDatabase([
      postRow({
        id: 'blog',
        channel: 'blog',
        status: 'draft',
        idempotency_key: 'blog:1',
      }),
      ...held,
      postRow({ id: 'fresh', publish_at: at(0), idempotency_key: 'x:fresh' }),
    ]);
    const h = harness();
    const signal = new AbortController().signal;

    expect(await tick(db, h.deps, signal, 5)).toMatchObject({
      posted: 0,
      waiting: 5,
    });
    expect(db.rows.get('fresh')?.['status']).toBe('scheduled');

    h.setNow(at(10));
    expect(await tick(db, h.deps, signal, 5)).toMatchObject({
      posted: 1,
      waiting: 0,
    });
    expect(db.rows.get('fresh')?.['status']).toBe('posted');
  });

  it('released row is not leased again until next_attempt_at', async () => {
    const db = fakeDatabase([
      postRow({
        id: 'blog',
        channel: 'blog',
        status: 'draft',
        idempotency_key: 'blog:1',
      }),
      postRow({ id: 'x1', depends_on: 'blog', idempotency_key: 'x:1' }),
    ]);
    const h = harness();
    await tick(db, h.deps);
    expect(db.rows.get('x1')).toMatchObject({
      status: 'scheduled',
      next_attempt_at: at(35),
    });

    h.setNow(at(34));
    expect(await tick(db, h.deps)).toMatchObject({ posted: 0, waiting: 0 });

    const blog = db.rows.get('blog');
    if (blog) blog['status'] = 'posted';
    h.setNow(at(35));
    expect(await tick(db, h.deps)).toMatchObject({ posted: 1 });
  });

  it('dependency in failed state fails the dependent and alerts dependency_failed', async () => {
    for (const status of ['failed', 'cancelled', null]) {
      const db = fakeDatabase([
        ...(status
          ? [
              postRow({
                id: 'blog',
                channel: 'blog',
                status,
                idempotency_key: 'blog:1',
              }),
            ]
          : []),
        postRow({ id: 'dev1', channel: 'devto', depends_on: 'blog' }),
      ]);
      const h = harness();
      expect(await tick(db, h.deps)).toEqual({
        posted: 0,
        waiting: 0,
        failed: 1,
        alerts: ['dependency_failed:dev1'],
        alertErrors: [],
      });
      expect(db.rows.get('dev1')).toMatchObject({
        status: 'failed',
        error: `dependency blog is ${status ?? 'missing'}`,
      });
      expect(h.posts).toEqual([]);
      expect(h.calls.checkLive).toEqual([]);
    }
  });

  it('credentials_unavailable re-fires on a different Pacific day', async () => {
    const db = fakeDatabase([postRow({ id: 'li1', channel: 'linkedin' })]);
    const { alert, emails } = claimingSender(db);
    const h = harness({ alert, loadAdapterOptions: async () => ({}) });

    expect((await tick(db, h.deps)).alerts).toEqual([
      'credentials_unavailable:linkedin:2026-11-03',
    ]);
    h.setNow(at(60));
    await tick(db, h.deps);
    expect(emails).toHaveLength(1);

    // 2026-11-04 08:40 Pacific.
    h.setNow(at(24 * 60 + 10));
    expect((await tick(db, h.deps)).alerts).toEqual([
      'credentials_unavailable:linkedin:2026-11-04',
    ]);
    expect(emails).toHaveLength(2);
  });

  it('failed alert send releases the claim so the next tick retries', async () => {
    const db = fakeDatabase([
      postRow({
        id: 'x1',
        media: [{ url: 'https://blob.example/gone.png', alt: 'Card' }],
      }),
    ]);
    let down = true;
    const { alert, emails } = claimingSender(db, async () => {
      if (down) throw new Error('resend 500');
    });
    const h = harness({
      alert,
      fetchMedia: async () => {
        throw new Error('404');
      },
    });

    const first = await tick(db, h.deps);
    expect(first.alertErrors).toEqual([
      'media_unavailable:x1: Marketing alert media_unavailable:x1 could not be sent: resend 500',
    ]);
    expect(emails).toHaveLength(0);

    down = false;
    h.setNow(at(40));
    const second = await tick(db, h.deps);
    expect(second.alertErrors).toEqual([]);
    expect(emails).toHaveLength(1);
  });

  it('alert transport failure does not stop the tick', async () => {
    const db = fakeDatabase([
      postRow({
        id: 'x1',
        idempotency_key: 'x:1',
        media: [{ url: 'https://blob.example/gone.png', alt: 'Card' }],
      }),
      postRow({ id: 'x2', idempotency_key: 'x:2', publish_at: at(1) }),
    ]);
    const h = harness({
      alert: async () => {
        throw new Error('transport down');
      },
      fetchMedia: async (url) => {
        if (url.includes('gone')) throw new Error('404');
        return Buffer.from('png');
      },
    });
    const result = await tick(db, h.deps);
    expect(result).toEqual({
      posted: 1,
      waiting: 1,
      failed: 0,
      alerts: ['media_unavailable:x1'],
      alertErrors: ['media_unavailable:x1: transport down'],
    });
    expect(db.rows.get('x2')?.['status']).toBe('posted');
  });
});
