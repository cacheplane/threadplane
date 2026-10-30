// @vitest-environment node
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';

vi.mock('fs');
const mockedFs = vi.mocked(fs);

const post1 = `---
title: "First Post"
description: "First description"
date: 2026-05-01
author: brian
tags: [tutorial, streaming]
---
Body one.`;

const post2 = `---
title: "Second Post"
description: "Second description"
date: 2026-05-10
author: brian
featured: true
---
Body two.`;

const draft = `---
title: "Draft Post"
description: "Draft description"
date: 2026-05-20
author: brian
draft: true
---
Body draft.`;

const missingFields = `---
title: "Missing"
date: 2026-05-15
---
Body missing.`;

function setupFs(files: Record<string, string>) {
  mockedFs.existsSync.mockImplementation((p) => {
    const str = String(p);
    return str.endsWith('/content/blog') || Object.keys(files).some((k) => str.endsWith(k));
  });
  mockedFs.readdirSync.mockReturnValue(
    Object.keys(files).map((k) => k.split('/').pop()!) as never,
  );
  mockedFs.readFileSync.mockImplementation((p) => {
    const name = String(p).split('/').pop()!;
    const match = Object.entries(files).find(([k]) => k.endsWith(name));
    if (!match) throw new Error(`no fixture for ${p}`);
    return match[1];
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('blog.ts', () => {
  it('getAllPosts returns posts sorted desc by date', async () => {
    setupFs({
      '2026-05-01-first-post.mdx': post1,
      '2026-05-10-second-post.mdx': post2,
    });
    const { getAllPosts } = await import('./blog');
    const posts = getAllPosts();
    expect(posts.map((p) => p.slug)).toEqual(['second-post', 'first-post']);
  });

  it('getPostBySlug returns a known post', async () => {
    setupFs({
      '2026-05-01-first-post.mdx': post1,
      '2026-05-10-second-post.mdx': post2,
    });
    const { getPostBySlug } = await import('./blog');
    const post = getPostBySlug('second-post');
    expect(post?.frontmatter.title).toBe('Second Post');
    expect(post?.date).toBe('2026-05-10');
  });

  it('getPostBySlug returns null for unknown slug', async () => {
    setupFs({ '2026-05-01-first-post.mdx': post1 });
    const { getPostBySlug } = await import('./blog');
    expect(getPostBySlug('nope')).toBeNull();
  });

  it('throws when required frontmatter is missing', async () => {
    setupFs({ '2026-05-15-missing.mdx': missingFields });
    const { getAllPosts } = await import('./blog');
    expect(() => getAllPosts()).toThrow(/missing required frontmatter/i);
  });

  it('drafts excluded by default, included with includeDrafts', async () => {
    setupFs({
      '2026-05-10-second-post.mdx': post2,
      '2026-05-20-draft-post.mdx': draft,
    });
    const { getAllPosts } = await import('./blog');
    expect(getAllPosts().map((p) => p.slug)).toEqual(['second-post']);
    expect(getAllPosts({ includeDrafts: true }).map((p) => p.slug)).toEqual([
      'draft-post',
      'second-post',
    ]);
  });

  it('getFeaturedPost returns the first featured post', async () => {
    setupFs({
      '2026-05-01-first-post.mdx': post1,
      '2026-05-10-second-post.mdx': post2,
    });
    const { getFeaturedPost } = await import('./blog');
    expect(getFeaturedPost()?.slug).toBe('second-post');
  });

  it('getFeaturedPost falls back to latest when none featured', async () => {
    setupFs({ '2026-05-01-first-post.mdx': post1 });
    const { getFeaturedPost } = await import('./blog');
    expect(getFeaturedPost()?.slug).toBe('first-post');
  });

  it('getAllTags counts tags across posts', async () => {
    setupFs({
      '2026-05-01-first-post.mdx': post1,
      '2026-05-10-second-post.mdx': post2,
    });
    const { getAllTags } = await import('./blog');
    const tags = getAllTags();
    expect(tags.find((t) => t.tag === 'tutorial')?.count).toBe(1);
    expect(tags.find((t) => t.tag === 'streaming')?.count).toBe(1);
  });

  it('ignores files that do not match the date-prefix regex', async () => {
    setupFs({
      '2026-05-01-first-post.mdx': post1,
      'not-a-post.mdx': post1,
      'README.md': 'readme',
    });
    const { getAllPosts } = await import('./blog');
    expect(getAllPosts().map((p) => p.slug)).toEqual(['first-post']);
  });

  it('getRecentPosts returns newest-first, including featured', async () => {
    setupFs({
      '2026-05-01-first-post.mdx': post1,
      '2026-05-10-second-post.mdx': post2,
    });
    const { getRecentPosts } = await import('./blog');
    // post2 is featured; it should still appear (sorted first by date).
    expect(getRecentPosts().map((p) => p.slug)).toEqual(['second-post', 'first-post']);
  });

  it('getRecentPosts caps at the limit', async () => {
    setupFs({
      '2026-05-01-first-post.mdx': post1,
      '2026-05-05-extra-a.mdx': post1.replace('First Post', 'Extra A'),
      '2026-05-06-extra-b.mdx': post1.replace('First Post', 'Extra B'),
      '2026-05-07-extra-c.mdx': post1.replace('First Post', 'Extra C'),
      '2026-05-10-second-post.mdx': post2,
    });
    const { getRecentPosts } = await import('./blog');
    const result = getRecentPosts(3);
    expect(result).toHaveLength(3);
    // Should be the three newest by date.
    expect(result.map((p) => p.slug)).toEqual(['second-post', 'extra-c', 'extra-b']);
  });

  it('getRecentPosts returns [] when no posts exist', async () => {
    setupFs({});
    const { getRecentPosts } = await import('./blog');
    expect(getRecentPosts()).toEqual([]);
  });

  describe('future-dated posts', () => {
    const tomorrowPost = `---
title: "Tomorrow Post"
description: "Tomorrow description"
date: 2026-10-30
author: brian
---
Body tomorrow.`;
    const todayPost = `---
title: "Today Post"
description: "Today description"
date: 2026-10-29
author: brian
---
Body today.`;
    const now = new Date('2026-10-29T16:00:00Z');
    const files = {
      '2026-10-29-today-post.mdx': todayPost,
      '2026-10-30-tomorrow-post.mdx': tomorrowPost,
    };

    it('getAllPosts hides a post dated tomorrow and shows one dated today', async () => {
      setupFs(files);
      const { getAllPosts } = await import('./blog');
      expect(getAllPosts({ now }).map((p) => p.slug)).toEqual(['today-post']);
      expect(getAllPosts({ now: new Date('2026-10-30T07:00:00Z') }).map((p) => p.slug)).toEqual([
        'tomorrow-post',
        'today-post',
      ]);
    });

    it('without publishAt a post appears at Pacific midnight of its date', async () => {
      const nov = todayPost.replace('2026-10-29', '2026-11-03');
      setupFs({ '2026-11-03-today-post.mdx': nov });
      const { getAllPosts } = await import('./blog');
      expect(getAllPosts({ now: new Date('2026-11-03T07:59:59Z') })).toHaveLength(0);
      expect(getAllPosts({ now: new Date('2026-11-03T08:00:00Z') })).toHaveLength(1);
    });

    it('uses the PDT offset before the November change', async () => {
      setupFs(files);
      const { getAllPosts } = await import('./blog');
      expect(getAllPosts({ now: new Date('2026-10-29T06:59:59Z') })).toHaveLength(0);
      expect(getAllPosts({ now: new Date('2026-10-29T07:00:00Z') })).toHaveLength(1);
    });

    it('publishAt hides a post until that instant', async () => {
      const timed = todayPost.replace('author: brian', 'author: brian\npublishAt: 2026-11-03T17:00:00.000Z');
      setupFs({ '2026-10-29-today-post.mdx': timed });
      const { getAllPosts, getPostBySlug } = await import('./blog');
      expect(getAllPosts({ now: new Date('2026-11-03T16:59:59.999Z') })).toHaveLength(0);
      expect(getPostBySlug('today-post', { now: new Date('2026-11-03T16:59:59.999Z') })).toBeNull();
      expect(getAllPosts({ now: new Date('2026-11-03T17:00:00.000Z') })).toHaveLength(1);
    });

    it('invalid publishAt falls back to date', async () => {
      const bad = todayPost.replace('author: brian', 'author: brian\npublishAt: not-a-date');
      setupFs({ '2026-10-29-today-post.mdx': bad });
      const { getAllPosts } = await import('./blog');
      expect(getAllPosts({ now })).toHaveLength(1);
      expect(getAllPosts({ now: new Date('2026-10-29T06:00:00Z') })).toHaveLength(0);
    });

    it('getAllPosts includes future posts with includeDrafts', async () => {
      setupFs(files);
      const { getAllPosts } = await import('./blog');
      expect(getAllPosts({ now, includeDrafts: true }).map((p) => p.slug)).toContain('tomorrow-post');
    });

    it('getPostBySlug returns null for a future post and the post for today', async () => {
      setupFs(files);
      const { getPostBySlug } = await import('./blog');
      expect(getPostBySlug('tomorrow-post', { now })).toBeNull();
      expect(getPostBySlug('today-post', { now })?.slug).toBe('today-post');
    });

    it('getPostBySlug still returns drafts that are not future-dated', async () => {
      setupFs({ '2026-05-20-draft-post.mdx': draft });
      const { getPostBySlug } = await import('./blog');
      expect(getPostBySlug('draft-post', { now })?.slug).toBe('draft-post');
    });

    it('getAllSlugs excludes future posts', async () => {
      setupFs({ '2026-05-10-second-post.mdx': post2, '2999-01-01-far-future.mdx': tomorrowPost.replace('2026-10-30', '2999-01-01') });
      const { getAllSlugs } = await import('./blog');
      expect(getAllSlugs()).toEqual(['second-post']);
    });

    it('the RSS feed route excludes future posts', async () => {
      setupFs({ '2026-05-10-second-post.mdx': post2, '2999-01-01-far-future.mdx': tomorrowPost.replace('2026-10-30', '2999-01-01') });
      const { GET } = await import('../app/blog/rss.xml/route');
      const xml = await (await GET()).text();
      expect(xml).toContain('/blog/second-post');
      expect(xml).not.toContain('far-future');
    });
  });
});
