import { describe, expect, it } from 'vitest';
import sitemap from '../app/sitemap';
import { getAllPosts } from './blog';
import {
  getPostLastModified,
  getSitemapEntries,
  hasGitHistory,
  parseGitLog,
  sourcePathsForRoute,
  getPostsByRoute,
} from './sitemap-dates';
import { getSitemapRoutes } from './site-metadata';
import { execFileSync } from 'node:child_process';
import { resolveWebsiteDir } from './website-dir';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const GRAFT = 'c'.repeat(40);

function header(seconds: number, sha: string): string {
  return `commit-time ${seconds} ${sha}`;
}

describe('parseGitLog', () => {
  it('takes the newest commit that touched each path', () => {
    const log = [
      header(3000, SHA_A),
      'apps/website/content/docs/a.mdx',
      '',
      header(1000, SHA_B),
      'apps/website/content/docs/a.mdx',
      'apps/website/content/docs/b.mdx',
      '',
    ].join('\n');

    const times = parseGitLog(log, 'apps/website/', new Set());

    expect(Object.fromEntries(times)).toEqual({
      'content/docs/a.mdx': 3000,
      'content/docs/b.mdx': 1000,
    });
  });

  it('drops every file a grafted shallow-boundary commit claims to have changed', () => {
    const log = [
      header(9000, GRAFT),
      'content/docs/a.mdx',
      'content/docs/b.mdx',
      '',
    ].join('\n');

    const times = parseGitLog(log, '', new Set([GRAFT]));

    // Not "dated 9000" — a graft reports the whole tree, so those dates are
    // clone time, not change time, and must not be emitted at all.
    expect(times.size).toBe(0);
  });

  it('keeps real commits in a stream that also contains a graft', () => {
    const log = [
      header(4000, SHA_A),
      'content/docs/a.mdx',
      '',
      header(9000, GRAFT),
      'content/docs/a.mdx',
      'content/docs/b.mdx',
      '',
    ].join('\n');

    const times = parseGitLog(log, '', new Set([GRAFT]));

    expect(Object.fromEntries(times)).toEqual({ 'content/docs/a.mdx': 4000 });
  });

  it('handles a merge commit that lists no files', () => {
    const log = [
      header(5000, SHA_A),
      '',
      header(4000, SHA_B),
      'content/docs/a.mdx',
      '',
    ].join('\n');

    expect(Object.fromEntries(parseGitLog(log, '', new Set()))).toEqual({
      'content/docs/a.mdx': 4000,
    });
  });

  it('takes paths verbatim, including non-ASCII and leading whitespace', () => {
    const log = [
      header(7000, SHA_A),
      'content/blog/café niño.mdx',
      ' leading-space.mdx',
      '',
    ].join('\n');

    expect(Object.fromEntries(parseGitLog(log, '', new Set()))).toEqual({
      'content/blog/café niño.mdx': 7000,
      ' leading-space.mdx': 7000,
    });
  });

  it('treats a path that begins with the marker text as a path, not a header', () => {
    const log = [
      header(8000, SHA_A),
      'commit-time notes.mdx',
      'commit-time 123 nonsense',
      '',
    ].join('\n');

    expect(Object.fromEntries(parseGitLog(log, '', new Set()))).toEqual({
      'commit-time notes.mdx': 8000,
      'commit-time 123 nonsense': 8000,
    });
  });

  it('ignores files listed before any commit header', () => {
    expect(parseGitLog('stray.mdx\n', '', new Set()).size).toBe(0);
  });
});

describe('getSitemapEntries', () => {
  it('covers every sitemap route with a valid date, or none at all', () => {
    const entries = getSitemapEntries();
    expect(entries.length).toBeGreaterThan(100);

    const invalid = entries.filter(
      (e) =>
        e.lastModified !== undefined && Number.isNaN(e.lastModified.getTime())
    );
    expect(invalid.map((e) => e.route)).toEqual([]);

    const unresolved = entries.filter((e) => !e.lastModified);
    if (hasGitHistory()) {
      // New, uncommitted pages legitimately have no commit date. Every omitted
      // date must lack committed source evidence, rather than hiding a mapping bug.
      const posts = getPostsByRoute();
      for (const entry of unresolved) {
        const sources = sourcePathsForRoute(entry.route, posts);
        const committed = execFileSync(
          'git',
          ['log', '-1', '--format=%ct', '--', ...sources],
          { cwd: resolveWebsiteDir(), encoding: 'utf8' }
        ).trim();
        expect(committed, entry.route).toBe('');
      }
    } else {
      // Degraded environment (no git, or shallow): blog posts still date
      // themselves from frontmatter, and nothing is fabricated.
      expect(
        entries
          .filter((e) => e.lastModified)
          .every((e) => e.route.startsWith('/blog/'))
      ).toBe(true);
    }
  });

  it('dates a blog route no earlier than its publish date', () => {
    const entry = getSitemapEntries().find(
      (e) => e.route === '/blog/angular-chat-app-tutorial-with-ag-ui'
    );
    expect(entry?.lastModified).toBeInstanceOf(Date);
    // lastmod is last *modified*: the post's own file may have been edited after
    // it was published, never before.
    expect(entry?.lastModified?.getTime()).toBeGreaterThanOrEqual(
      Date.parse('2026-08-13T00:00:00Z')
    );
  });

  it('never claims a route changed in the future', () => {
    const now = Date.now();
    const future = getSitemapEntries().filter(
      (e) => (e.lastModified?.getTime() ?? 0) > now
    );
    expect(future.map((e) => e.route)).toEqual([]);
  });

  it('indexes /about, dated from its committed page source', () => {
    // The Person entity is only discoverable if the route is in the sitemap,
    // and it dates from git like any other hand-written page.
    const entry = getSitemapEntries().find((e) => e.route === '/about');
    expect(entry).toBeDefined();
    if (hasGitHistory()) expect(entry?.lastModified).toBeInstanceOf(Date);
  });

  it('resolves the special docs pages whose route shape differs from library docs', () => {
    const entry = getSitemapEntries().find(
      (e) => e.route === '/docs/choosing-an-adapter'
    );
    if (hasGitHistory()) expect(entry?.lastModified).toBeInstanceOf(Date);
  });
});

describe('sitemap route', () => {
  it('emits lastModified only — Google ignores changefreq and priority', () => {
    const urls = sitemap();
    expect(urls.length).toBeGreaterThan(100);

    for (const url of urls) {
      expect(url.url.startsWith('https://')).toBe(true);
      expect('changeFrequency' in url).toBe(false);
      expect('priority' in url).toBe(false);
    }

    if (hasGitHistory()) {
      const posts = getPostsByRoute();
      for (const url of urls.filter((item) => !item.lastModified)) {
        const route = new URL(url.url).pathname;
        const committed = execFileSync(
          'git',
          [
            'log',
            '-1',
            '--format=%ct',
            '--',
            ...sourcePathsForRoute(route, posts),
          ],
          { cwd: resolveWebsiteDir(), encoding: 'utf8' }
        ).trim();
        expect(committed, route).toBe('');
      }
    }
  });
});

describe('getPostLastModified', () => {
  // The point of the helper: the blog page's JSON-LD `dateModified`, its
  // `article:modified_time`, and the sitemap's `<lastmod>` are three published
  // claims about one fact. They agree only if all three ask the same question,
  // so this pins the single-post shortcut against the full sitemap index.
  it('agrees with the sitemap entry for the same route', () => {
    const posts = getAllPosts();
    expect(posts.length).toBeGreaterThan(0);

    const entries = new Map(
      getSitemapEntries().map((entry) => [entry.route, entry.lastModified])
    );
    for (const post of posts) {
      const route = `/blog/${post.slug}`;
      // Without these, an absent route and an undateable post both read as
      // `undefined` and the comparison below passes on nothing.
      expect([route, entries.has(route)]).toEqual([route, true]);
      expect([route, entries.get(route) instanceof Date]).toEqual([
        route,
        true,
      ]);

      expect([post.slug, getPostLastModified(post)?.toISOString()]).toEqual([
        post.slug,
        entries.get(route)?.toISOString(),
      ]);
    }
  });
});

describe('canonical privacy policy discovery', () => {
  it('publishes /privacy in the sitemap route inventory', () => {
    expect(getSitemapRoutes()).toContain('/privacy');
  });

  it('emits /privacy as a real sitemap entry', () => {
    expect(sitemap().map((entry) => new URL(entry.url).pathname)).toContain(
      '/privacy'
    );
  });
});
