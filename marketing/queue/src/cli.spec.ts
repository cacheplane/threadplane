import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { uploadMedia } from './blob.ts';
import { openContext } from './cli/context.ts';
import { add, addBlog, lintFile, relintBlog } from './cli/commands/draft.ts';
import { approve, confirm, resolve, revisions } from './cli/commands/manage.ts';
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
  const revs: Row[] = [];
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
        case 'list-slot-rows':
          return out(posts.filter((x) => x['idempotency_key'] === p[0] || String(x['idempotency_key']).startsWith(`${p[0]}:r`)));
        case 'approve-post-draft':
          return out(posts.filter((x) => x['id'] === p[0] && x['status'] === 'draft'));
        case 'get-post':
        case 'lock-post-for-update':
          return out(posts.filter((x) => x['id'] === p[0]));
        case 'update-draft-post': {
          const row = posts.find((x) => x['id'] === p[0]) as Row;
          if (p[1] !== null) row['payload'] = JSON.parse(p[1] as string);
          if (p[5]) row['confirmed_flags'] = [];
          row['status'] = p[6];
          return out([row]);
        }
        case 'insert-revision':
          revs.push({ id: p[0], post_id: p[1], before: JSON.parse(p[2] as string), after: JSON.parse(p[3] as string), created_at: new Date(`2026-11-0${revs.length + 1}T00:00:00Z`) });
          return out([]);
        case 'list-recent-revisions':
          return out(
            [...revs].reverse().slice(0, Number(p[0])).map((r) => ({ ...r, channel: posts.find((x) => x['id'] === r['post_id'])?.['channel'] }))
          );
        case 'cancel-post': {
          const row = posts.find((x) => x['id'] === p[0] && ['draft', 'scheduled'].includes(x['status'] as string));
          if (row) row['status'] = 'cancelled';
          return out(row ? [row] : []);
        }
        case 'list-blog-rows-by-slug':
          return out(posts.filter((x) => x['channel'] === 'blog' && (x['payload'] as Row)['slug'] === p[0]));
        case 'resolve-post': {
          const row = posts.find(
            (x) =>
              x['id'] === p[0] &&
              (x['status'] === 'failed' ||
                (x['status'] === 'posting' &&
                  (x['lease_expires_at'] == null || (x['lease_expires_at'] as Date) < (p[3] as Date))))
          );
          if (row) {
            row['status'] = p[1];
            if (p[2] !== null) row['result'] = JSON.parse(p[2] as string);
            row['lease_token'] = null;
            row['lease_expires_at'] = null;
          }
          return out(row ? [row] : []);
        }
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
  return { ex, weeks, posts, metrics, credentials, revs };
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

  it('confirm refuses a [BRIAN: ...] marker, so the row stays blocked', async () => {
    const { db, deps } = harness({ 'd.json': JSON.stringify({ text: 'out now in [BRIAN: version]' }) });
    await add(parseArgs(['add', `--week=${WEEK}`, '--channel=x', '--slot=x-wed', '--kind=release', '--file=d.json']), deps);
    const id = db.posts[0]['id'] as string;
    await expect(confirm(parseArgs(['confirm', id, '--codes=brian_marker']), deps)).rejects.toThrow(/cannot be confirmed/);
    await approve(parseArgs(['approve', `--week=${WEEK}`]), deps);
    expect(db.posts[0]['status']).toBe('draft');
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

  it('add --at creates an adhoc row at that instant', async () => {
    const { db, deps } = harness({ 'd.json': '{"text":"hello"}' });
    // Wed 2026-11-04 10:00 Pacific -> week of Monday 2026-11-02
    await add(parseArgs(['add', '--channel=x', '--at=2026-11-04T18:00:00Z', '--kind=news', '--file=d.json']), deps);
    const row = db.posts[0];
    expect(new Date(row['publish_at'] as Date).toISOString()).toBe('2026-11-04T18:00:00.000Z');
    expect(row['idempotency_key']).toBe('x:2026-11-02:adhoc:2026-11-04T18:00:00.000Z');
    expect(db.weeks[0]['week_start']).toBe('2026-11-02');
    await expect(
      add(parseArgs(['add', '--channel=x', '--at=2026-11-04T18:00:00Z', '--slot=x-mon', '--kind=news', '--file=d.json']), deps)
    ).rejects.toThrow('mutually exclusive');
  });

  it('add refills a slot whose row was cancelled', async () => {
    const { db, deps } = harness({ 'd.json': '{"text":"one"}' });
    const a = ['add', `--week=${WEEK}`, '--channel=x', '--slot=x-fri', '--kind=take', '--file=d.json'];
    await add(parseArgs(a), deps);
    await expect(add(parseArgs(a), deps)).rejects.toThrow('already has a live row');
    db.posts[0]['status'] = 'cancelled';
    await add(parseArgs(a), deps);
    expect(db.posts[1]['idempotency_key']).toBe(`x:${WEEK}:x-fri:r1`);
    db.posts[1]['status'] = 'cancelled';
    await add(parseArgs(a), deps);
    expect(db.posts[2]['idempotency_key']).toBe(`x:${WEEK}:x-fri:r2`);
  });

  it('approve --id schedules only that row', async () => {
    const { db, deps } = harness({ 'a.json': '{"text":"a"}', 'b.json': '{"text":"b"}' });
    await add(parseArgs(['add', `--week=${WEEK}`, '--channel=x', '--slot=x-tue', '--kind=take', '--file=a.json']), deps);
    await add(parseArgs(['add', `--week=${WEEK}`, '--channel=x', '--slot=x-wed', '--kind=take', '--file=b.json']), deps);
    await approve(parseArgs(['approve', `--id=${db.posts[0]['id']}`]), deps);
    expect(db.posts.map((x) => x['status'])).toEqual(['scheduled', 'draft']);
  });

  it('approve --id rejects past publish_at', async () => {
    const { db, deps, lines } = harness({ 'a.json': '{"text":"a"}', 'b.json': '{"text":"CopilotKit"}' });
    await add(parseArgs(['add', `--week=${WEEK}`, '--channel=x', '--slot=x-mon', '--kind=take', '--file=a.json']), deps);
    await add(parseArgs(['add', `--week=${WEEK}`, '--channel=x', '--slot=x-wed', '--kind=take', '--file=b.json']), deps);
    await approve(parseArgs(['approve', `--id=${db.posts[0]['id']}`]), deps);
    await approve(parseArgs(['approve', `--id=${db.posts[1]['id']}`]), deps);
    expect(db.posts.map((x) => x['status'])).toEqual(['draft', 'draft']);
    expect(lines.join('\n')).toContain('past (left as draft; reschedule or cancel): 1');
    expect(lines.join('\n')).toContain('competitor_name');
  });

  it('lint prints flags without a database', async () => {
    const lines: string[] = [];
    const files: Record<string, string> = {
      'd.json': JSON.stringify({ threadParts: ['one', 'two \u2014 CopilotKit'] }),
      'p.mdx': '---\ntitle: T\ndescription: D\n---\n\nThe election is near.\n',
    };
    const io = { readFile: async (p: string) => Buffer.from(files[p]), stdout: (l: string) => lines.push(l) };
    await lintFile(parseArgs(['lint', '--channel=x', '--file=d.json']), io);
    await lintFile(parseArgs(['lint', '--channel=blog', '--file=p.mdx']), io);
    const text = lines.join('\n');
    expect(text).toContain('lint: competitor_name (blocking)');
    expect(text).toContain('lint: em_dash (warning)');
    expect(text).toContain('lint: politics (blocking) "election"');
  });

  it('relint-blog recomputes flags, resets confirmations, and demotes a scheduled row', async () => {
    const slot = defaultSlots(WEEK).find((s) => s.slot === 'blog') as { publishAt: Date };
    const mdx = (body: string, at = slot.publishAt.toISOString()) =>
      `---\ntitle: 'Post'\ndescription: 'Desc'\ndate: 2026-11-03\ntags: [a]\nauthor: brian\npublishAt: ${at}\n---\n\n${body}\n`;
    const { db, deps } = harness({ 'a.mdx': mdx('Fine.'), 'b.mdx': mdx('See CopilotKit.'), 'c.mdx': mdx('x', '2026-11-03T12:00:00.000Z') });
    await addBlog(parseArgs(['add-blog', `--week=${WEEK}`, '--mdx=/c/2026-11-03-p.mdx']), { ...deps, readFile: async () => Buffer.from(mdx('Fine.')) });
    const blog = db.posts[0];
    blog['status'] = 'scheduled';
    blog['confirmed_flags'] = ['politics'];
    await relintBlog(parseArgs(['relint-blog', blog['id'] as string, '--mdx=b.mdx']), deps);
    expect((blog['payload'] as { lintFlags: { code: string }[]; slug: string }).lintFlags[0].code).toBe('competitor_name');
    expect((blog['payload'] as { slug: string }).slug).toBe('p');
    expect(blog['status']).toBe('draft');
    expect(blog['confirmed_flags']).toEqual([]);
    expect(db.revs).toHaveLength(1);
    await expect(relintBlog(parseArgs(['relint-blog', blog['id'] as string, '--mdx=c.mdx']), deps)).rejects.toThrow('does not match');
  });

  it('revisions prints recent before and after text', async () => {
    const { db, deps, lines } = harness({ 'a.json': '{"text":"old"}', 'b.json': '{"text":"new"}' });
    await add(parseArgs(['add', `--week=${WEEK}`, '--channel=x', '--slot=x-sat', '--kind=take', '--file=a.json']), deps);
    const { edit } = await import('./cli/commands/draft.ts');
    await edit(parseArgs(['edit', db.posts[0]['id'] as string, '--file=b.json']), deps);
    lines.length = 0;
    await revisions(parseArgs(['revisions', '--limit=5']), deps);
    const text = lines.join('\n');
    expect(text).toContain(`${db.posts[0]['id']} x`);
    expect(text).toContain('before: old');
    expect(text).toContain('after:  new');
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

describe('blog-linking drafts', () => {
  const LINK = 'https://threadplane.ai/blog/my-post?utm_source=x&utm_medium=social&utm_campaign=my-post';
  function withBlog(status: string) {
    const h = harness({
      'thread.json': JSON.stringify({ threadParts: ['New post on streaming', `Read it ${LINK}`] }),
    });
    h.db.posts.push({
      id: 'blog-1', week_id: 'w', channel: 'blog', kind: 'guide', status,
      publish_at: new Date('2026-11-03T17:00:00Z'), payload: { slug: 'my-post' }, media: [],
      source_refs: [], depends_on: null, utm_campaign: null, idempotency_key: `blog:${WEEK}:blog`,
      confirmed_flags: [], attempts: 0, created_at: new Date(), updated_at: new Date(),
    });
    return h;
  }
  const addThread = (deps: CommandDeps, extra: string[] = []) =>
    add(parseArgs(['add', `--week=${WEEK}`, '--channel=x', '--slot=x-wed', '--kind=guide', '--file=thread.json', ...extra]), deps);

  it('add refuses a blog link without depends-on while the blog is unposted', async () => {
    const { db, deps } = withBlog('scheduled');
    await expect(addThread(deps)).rejects.toThrow('--depends-on=blog-1');
    await expect(addThread(deps, ['--depends-on=other'])).rejects.toThrow('blog row blog-1');
    deps.readFile = async () => Buffer.from(JSON.stringify({ text: 'Out now: threadplane.ai/blog/my-post.' }));
    await expect(addThread(deps)).rejects.toThrow('--depends-on=blog-1');
    expect(db.posts).toHaveLength(1);
  });

  it('add accepts it with the right depends-on', async () => {
    const { db, deps } = withBlog('draft');
    await addThread(deps, ['--depends-on=blog-1']);
    expect(db.posts[1]).toMatchObject({ channel: 'x', depends_on: 'blog-1' });
  });

  it('add allows a link to an already posted blog', async () => {
    const { db, deps } = withBlog('posted');
    await addThread(deps);
    expect(db.posts[1]).toMatchObject({ channel: 'x', depends_on: null });
  });
});

describe('resolve', () => {
  function withRow(status: string, leaseExpiresAt: Date | null) {
    const h = harness();
    h.db.posts.push({
      id: 'r1', week_id: 'w', channel: 'x', kind: 'take', status,
      publish_at: new Date('2026-11-02T16:30:00Z'), payload: { text: 'hi' }, media: [],
      source_refs: [], depends_on: null, utm_campaign: null, idempotency_key: 'x:r1',
      confirmed_flags: [], attempts: 1, lease_token: leaseExpiresAt ? 'tok' : null,
      lease_expires_at: leaseExpiresAt, created_at: new Date(), updated_at: new Date(),
    });
    return h;
  }

  it('resolve marks a stuck posting row posted with its url', async () => {
    const { db, deps, lines } = withRow('posting', new Date(NOW.getTime() - 60_000));
    await resolve(parseArgs(['resolve', 'r1', '--as=posted', '--url=https://x.com/brian/status/9']), deps);
    expect(db.posts[0]).toMatchObject({
      status: 'posted',
      lease_token: null,
      lease_expires_at: null,
      result: { url: 'https://x.com/brian/status/9', postedAt: NOW.toISOString() },
    });
    expect(lines).toContain('resolved r1 as posted (https://x.com/brian/status/9)');
  });

  it('resolve marks a failed row cancelled', async () => {
    const { db, deps } = withRow('failed', null);
    await resolve(parseArgs(['resolve', 'r1', '--as=cancelled']), deps);
    expect(db.posts[0]['status']).toBe('cancelled');
  });

  it('resolve refuses a scheduled row', async () => {
    const { db, deps } = withRow('scheduled', null);
    await expect(resolve(parseArgs(['resolve', 'r1', '--as=cancelled']), deps)).rejects.toThrow('cannot be resolved');
    expect(db.posts[0]['status']).toBe('scheduled');
  });

  it('resolve refuses a posting row whose lease is still live', async () => {
    const { db, deps } = withRow('posting', new Date(NOW.getTime() + 60_000));
    await expect(
      resolve(parseArgs(['resolve', 'r1', '--as=posted', '--url=https://x.com/a/status/1']), deps)
    ).rejects.toThrow('cannot be resolved');
    expect(db.posts[0]['status']).toBe('posting');
  });

  it('resolve as posted requires --url', async () => {
    const { deps } = withRow('failed', null);
    await expect(resolve(parseArgs(['resolve', 'r1', '--as=posted']), deps)).rejects.toThrow('--url is required');
    await expect(resolve(parseArgs(['resolve', 'r1', '--as=gone']), deps)).rejects.toThrow('--as must be');
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
