import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { uploadMedia } from './blob.ts';
import { openContext } from './cli/context.ts';
import { add, addBlog } from './cli/commands/draft.ts';
import { approve } from './cli/commands/manage.ts';
import { report } from './cli/commands/report.ts';
import { setDevtoKey } from './cli/commands/devto-key.ts';
import { parseArgs, type CommandDeps } from './cli/commands/shared.ts';
import { unseal } from './crypto.ts';
import { defaultSlots } from './schedule.ts';
import type { SqlExecutor, SqlQueryResult, SqlTransaction } from './sql.ts';

type Row = Record<string, unknown>;

/** In-memory stand-in for the marketing tables, keyed on the SQL marker comments. */
function fakeDb() {
  const weeks: Row[] = [];
  const posts: Row[] = [];
  const metrics: Row[] = [];
  const credentials: Row[] = [];
  const tx: SqlTransaction = {
    async execute<R extends Record<string, unknown>>(
      sql: string,
      p: readonly unknown[] = []
    ): Promise<SqlQueryResult<R>> {
      const marker = /\/\* marketing:([a-z0-9-]+) \*\//u.exec(sql)?.[1];
      const out = (rows: Row[]) => ({ rows: rows as R[] });
      switch (marker) {
        case 'upsert-week': {
          let week = weeks.find((w) => w['week_start'] === p[1]);
          if (!week) {
            week = { id: p[0], week_start: p[1], status: 'drafting', created_at: new Date() };
            weeks.push(week);
          }
          return out([week]);
        }
        case 'find-week':
          return out(weeks.filter((w) => w['week_start'] === p[0]));
        case 'insert-draft-post': {
          if (posts.some((x) => x['idempotency_key'] === p[10])) throw new Error('duplicate idempotency_key');
          const row: Row = {
            id: p[0], week_id: p[1], channel: p[2], kind: p[3], status: 'draft',
            publish_at: p[4], payload: JSON.parse(p[5] as string), media: JSON.parse(p[6] as string),
            source_refs: [], depends_on: p[8], utm_campaign: p[9], idempotency_key: p[10],
            confirmed_flags: [], attempts: 0, created_at: new Date(), updated_at: new Date(),
          };
          posts.push(row);
          return out([row]);
        }
        case 'approve-week-drafts':
          return out(posts.filter((x) => x['week_id'] === p[0] && x['status'] === 'draft'));
        case 'schedule-posts':
          for (const x of posts) if ((p[0] as string[]).includes(x['id'] as string)) x['status'] = 'scheduled';
          return out([]);
        case 'approve-week':
          return out([]);
        case 'list-posts':
          return out(posts);
        case 'insert-post-metrics':
          metrics.push({ post_id: p[0], metrics: JSON.parse(p[2] as string) });
          return out([]);
        case 'upsert-channel-credentials':
          credentials.push({ channel: p[0], sealed: p[1] });
          return out([]);
        default:
          throw new Error(`Unexpected SQL marker: ${marker ?? 'missing'}`);
      }
    },
  };
  const ex: SqlExecutor = { execute: tx.execute, transaction: (op) => op(tx) };
  return { ex, weeks, posts, metrics, credentials };
}

const WEEK = '2026-11-02';
const NOW = new Date('2026-11-02T20:00:00Z'); // Mon 12:00 Pacific: x-mon (08:30) is past

function harness(files: Record<string, string | Buffer> = {}) {
  const db = fakeDb();
  const lines: string[] = [];
  const uploads: { pathname: string; size: number }[] = [];
  const deps: CommandDeps = {
    ex: db.ex,
    now: NOW,
    stdout: (l) => lines.push(l),
    readFile: async (path) => {
      const f = files[path];
      if (f === undefined) throw new Error(`ENOENT ${path}`);
      return Buffer.from(f);
    },
    upload: async (bytes, pathname) => {
      uploads.push({ pathname, size: bytes.length });
      return `https://blob.example/${pathname}`;
    },
  };
  return { db, lines, uploads, deps };
}

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

describe('marketing:queue CLI', () => {
  it('approve rejects past publish_at', async () => {
    const { db, deps, lines } = harness({
      'past.json': JSON.stringify({ text: 'already gone' }),
      'future.json': JSON.stringify({ text: 'still ahead' }),
    });
    await add(parseArgs(['add', `--week=${WEEK}`, '--channel=x', '--slot=x-mon', '--kind=take', '--file=past.json']), deps);
    await add(parseArgs(['add', `--week=${WEEK}`, '--channel=x', '--slot=x-tue', '--kind=take', '--file=future.json']), deps);
    await approve(parseArgs(['approve', `--week=${WEEK}`]), deps);
    const [past, future] = db.posts;
    expect(past['status']).toBe('draft');
    expect(future['status']).toBe('scheduled');
    expect(lines.join('\n')).toContain(`past (left as draft; reschedule or cancel): 1\n  ${past['id']}`);
  });

  it('approve leaves unconfirmed blocking flags blocked', async () => {
    const { db, deps, lines } = harness({ 'd.json': JSON.stringify({ text: 'versus CopilotKit' }) });
    await add(parseArgs(['add', `--week=${WEEK}`, '--channel=x', '--slot=x-wed', '--kind=take', '--file=d.json']), deps);
    await approve(parseArgs(['approve', `--week=${WEEK}`]), deps);
    expect(db.posts[0]['status']).toBe('draft');
    expect(lines.join('\n')).toContain('competitor_name');
  });

  it('add stores lint flags and refuses an invalid draft', async () => {
    const { db, deps, lines, uploads } = harness({
      'ok.json': JSON.stringify({ text: 'Signals — nice #a #b' }),
      'long.json': JSON.stringify({ text: 'x'.repeat(300) }),
      'card.png': PNG,
    });
    await add(
      parseArgs(['add', `--week=${WEEK}`, '--channel=x', '--slot=x-thu', '--kind=release', '--file=ok.json', '--media=card.png', '--alt=A card']),
      deps
    );
    const row = db.posts[0];
    expect((row['payload'] as { lintFlags: { code: string }[] }).lintFlags.map((f) => f.code).sort()).toEqual(['em_dash', 'hashtags']);
    expect(row['idempotency_key']).toBe(`x:${WEEK}:x-thu`);
    expect(row['media']).toEqual([{ url: `https://blob.example/marketing/${WEEK}/x-thu.png`, alt: 'A card' }]);
    expect(uploads).toEqual([{ pathname: `marketing/${WEEK}/x-thu.png`, size: PNG.length }]);
    expect(lines.join('\n')).toContain('lint: em_dash (warning)');

    await expect(
      add(parseArgs(['add', `--week=${WEEK}`, '--channel=x', '--slot=x-fri', '--kind=take', '--file=long.json', '--media=card.png', '--alt=A']), deps)
    ).rejects.toThrow(/280/u);
    expect(db.posts).toHaveLength(1);
    expect(uploads).toHaveLength(1);
  });

  it('add requires alt text with media', async () => {
    const { deps } = harness({ 'd.json': '{"text":"hi"}', 'c.png': PNG });
    await expect(
      add(parseArgs(['add', `--week=${WEEK}`, '--channel=x', '--slot=x-sat', '--kind=take', '--file=d.json', '--media=c.png']), deps)
    ).rejects.toThrow('--alt is required');
  });

  it('production target requires the production URL var', () => {
    expect(() =>
      openContext(['list', '--target=production'], { MARKETING_DATABASE_URL_PREVIEW: 'postgres://u:p@preview.example/db' }, () => undefined)
    ).toThrow('MARKETING_DATABASE_URL_PRODUCTION');
    expect(() => openContext(['list'], {}, () => undefined)).toThrow('--target');
  });

  describe('add-blog', () => {
    const slot = defaultSlots(WEEK).find((s) => s.slot === 'blog') as { publishAt: Date };
    const mdx = (publishAt?: string) =>
      `---\ntitle: 'Post'\ndescription: 'Desc'\ndate: 2026-11-03\ntags: [Angular]\nauthor: brian\n${publishAt ? `publishAt: ${publishAt}\n` : ''}---\n\nHello there.\nSecond line.\n`;

    it('inserts blog and dependent devto rows', async () => {
      const { db, deps } = harness({ '/c/2026-11-03-my-post.mdx': mdx(slot.publishAt.toISOString()) });
      await addBlog(parseArgs(['add-blog', `--week=${WEEK}`, '--mdx=/c/2026-11-03-my-post.mdx']), deps);
      const [blog, devto] = db.posts;
      expect(blog['payload']).toMatchObject({ slug: 'my-post', canonicalUrl: 'https://threadplane.ai/blog/my-post' });
      expect(devto['depends_on']).toBe(blog['id']);
      expect(devto['idempotency_key']).toBe(`devto:${WEEK}:devto`);
      expect(devto['utm_campaign']).toBe('my-post');
      expect(devto['payload']).toMatchObject({
        article: { title: 'Post', tags: ['angular'], canonicalUrl: 'https://threadplane.ai/blog/my-post' },
      });
      expect((devto['payload'] as { text: string }).text).toContain('Hello there.\n\nSecond line.');
    });

    it('refuses a missing or mismatched publishAt', async () => {
      const { db, deps } = harness({
        '/c/2026-11-03-a.mdx': mdx(),
        '/c/2026-11-03-b.mdx': mdx('2026-11-03T12:00:00.000Z'),
      });
      await expect(addBlog(parseArgs(['add-blog', `--week=${WEEK}`, '--mdx=/c/2026-11-03-a.mdx']), deps)).rejects.toThrow('needs publishAt');
      await expect(addBlog(parseArgs(['add-blog', `--week=${WEEK}`, '--mdx=/c/2026-11-03-b.mdx']), deps)).rejects.toThrow('does not match');
      expect(db.posts).toHaveLength(0);
    });
  });

  it('set-devto-key seals the stdin key', async () => {
    const { db, deps } = harness();
    const key = randomBytes(32);
    await setDevtoKey(deps, key, async () => 'secret-key\n');
    expect(db.credentials[0]['channel']).toBe('devto');
    expect(JSON.parse(unseal(db.credentials[0]['sealed'] as string, key))).toEqual({ apiKey: 'secret-key' });
    await expect(setDevtoKey(deps, key, async () => '  \n')).rejects.toThrow('stdin');
  });

  it('set-devto-key production requires --yes', async () => {
    const { db, deps } = harness();
    const key = randomBytes(32);
    await expect(setDevtoKey(deps, key, async () => 'k', { target: 'production', yes: false })).rejects.toThrow('--yes');
    expect(db.credentials).toHaveLength(0);
    await setDevtoKey(deps, key, async () => 'k', { target: 'production', yes: true });
    expect(db.credentials).toHaveLength(1);
  });

  it('report lists outcomes and stores dev.to metrics', async () => {
    const { db, deps, lines } = harness();
    const base = { week_id: 'w', kind: 'guide', publish_at: new Date(), payload: {}, media: [], confirmed_flags: [], attempts: 1, created_at: new Date(), updated_at: new Date() };
    db.weeks.push({ id: 'w', week_start: WEEK });
    db.posts.push(
      { ...base, id: 'p1', channel: 'devto', status: 'posted', idempotency_key: 'a', result: { postId: '42', url: 'https://dev.to/a' } },
      { ...base, id: 'p2', channel: 'x', status: 'failed', idempotency_key: 'b', error: 'HTTP 403' },
      { ...base, id: 'p3', channel: 'linkedin', status: 'posting', idempotency_key: 'c', lease_expires_at: new Date('2026-11-03T00:00:00Z') }
    );
    await report(parseArgs(['report', `--week=${WEEK}`]), deps, async (postId) => ({
      postId, impressions: 10, replies: 2, shares: 3, fetchedAt: '2026-11-05T00:00:00.000Z',
    }));
    const text = lines.join('\n');
    expect(text).toContain('devto p1 https://dev.to/a');
    expect(text).toContain('x p2 HTTP 403');
    expect(text).toContain('linkedin p3');
    expect(db.metrics).toHaveLength(1);
    expect(db.metrics[0]).toMatchObject({ post_id: 'p1', metrics: { impressions: 10 } });
  });
});

describe('uploadMedia', () => {
  it('PUTs the pathname with blob headers and returns the url', async () => {
    const calls: { url: string; init: { method: string; headers: Record<string, string> } }[] = [];
    const url = await uploadMedia(PNG, 'marketing/2026-11-02/x-mon.png', 'tok', async (u, init) => {
      calls.push({ url: u, init });
      return { ok: true, status: 200, json: async () => ({ url: 'https://blob/x.png' }) };
    });
    expect(url).toBe('https://blob/x.png');
    expect(calls[0].url).toBe('https://blob.vercel-storage.com/marketing/2026-11-02/x-mon.png');
    expect(calls[0].init.method).toBe('PUT');
    expect(calls[0].init.headers).toEqual({
      authorization: 'Bearer tok',
      'x-content-type': 'image/png',
      'x-add-random-suffix': '0',
      'x-api-version': '7',
    });
  });

  it('throws on a failed upload', async () => {
    await expect(
      uploadMedia(PNG, 'p.png', 't', async () => ({ ok: false, status: 500, json: async () => ({}) }))
    ).rejects.toThrow('HTTP 500');
  });
});
