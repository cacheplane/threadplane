import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { resolveWebsiteDir } from './website-dir';

export interface PostFrontmatter {
  title: string;
  description: string;
  date: string;
  tags?: string[];
  author: string;
  featured?: boolean;
  draft?: boolean;
  /** A picture of the work for feeds; defaults to the post's first image. */
  image?: string;
  /** A hand-made 1200x630 share card; replaces the generated opengraph-image. */
  ogImage?: string;
}

export interface Post {
  slug: string;
  date: string;
  frontmatter: PostFrontmatter;
  content: string;
  filename: string;
}

const FILENAME_RE = /^(\d{4}-\d{2}-\d{2})-(.+)\.mdx$/;

function resolveBlogDir(): string {
  return path.join(resolveWebsiteDir(), 'content', 'blog');
}

function readPost(dir: string, filename: string): Post | null {
  const match = filename.match(FILENAME_RE);
  if (!match) return null;
  const [, date, slug] = match;
  const full = path.join(dir, filename);
  const raw = fs.readFileSync(full, 'utf8') as unknown as string;
  const { data, content } = matter(raw);
  const fm = data as Partial<PostFrontmatter> & { date?: unknown };
  if (!fm.title || !fm.description || !fm.date || !fm.author) {
    throw new Error(
      `Blog post ${filename} missing required frontmatter (title, description, date, author).`,
    );
  }
  // YAML parses unquoted ISO dates as Date objects; normalize to string.
  const rawDate: unknown = fm.date;
  const dateString =
    rawDate instanceof Date ? rawDate.toISOString().slice(0, 10) : String(rawDate);
  const normalized: PostFrontmatter = {
    ...(fm as PostFrontmatter),
    date: dateString,
  };
  return {
    slug,
    date,
    frontmatter: normalized,
    content,
    filename,
  };
}

/** A post is future-dated when its frontmatter date (UTC midnight for YYYY-MM-DD) is after `now`; today's posts are visible. */
function isFuture(post: Post, now: Date): boolean {
  const t = new Date(post.frontmatter.date).getTime();
  return !Number.isNaN(t) && t > now.getTime();
}

export function getAllPosts(opts: { includeDrafts?: boolean; now?: Date } = {}): Post[] {
  const dir = resolveBlogDir();
  if (!fs.existsSync(dir)) return [];
  const now = opts.now ?? new Date();
  const files = fs.readdirSync(dir).filter((f) => typeof f === 'string' && (f as string).endsWith('.mdx'));
  const posts: Post[] = [];
  for (const f of files) {
    const post = readPost(dir, f as string);
    if (!post) continue;
    if (post.frontmatter.draft && !opts.includeDrafts) continue;
    if (isFuture(post, now) && !opts.includeDrafts) continue;
    posts.push(post);
  }
  return posts.sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function getPostBySlug(slug: string, opts: { now?: Date } = {}): Post | null {
  const now = opts.now ?? new Date();
  const post = getAllPosts({ includeDrafts: true, now }).find((p) => p.slug === slug) ?? null;
  return post && !isFuture(post, now) ? post : null;
}

export function getFeaturedPost(): Post | null {
  const posts = getAllPosts();
  return posts.find((p) => p.frontmatter.featured) ?? posts[0] ?? null;
}

export function getAllTags(): { tag: string; count: number }[] {
  const tags = new Map<string, number>();
  for (const p of getAllPosts()) {
    for (const t of p.frontmatter.tags ?? []) {
      tags.set(t, (tags.get(t) ?? 0) + 1);
    }
  }
  return [...tags.entries()].map(([tag, count]) => ({ tag, count }));
}

export function getAllSlugs(): string[] {
  return getAllPosts().map((p) => p.slug);
}

/**
 * Format an ISO date string (YYYY-MM-DD from frontmatter) as a human date.
 *
 * Parses as UTC midnight and formats with timeZone: 'UTC' so a date like
 * '2026-05-21' never renders as 'May 20' for readers west of UTC.
 */
export function formatPostDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Compact card date: "May 17" when the post is in the current year,
 * "May 17, 2025" otherwise. Matches the article-page tone but shaves
 * visual noise on landing cards where the year is redundant.
 *
 * Parses as UTC midnight and uses timeZone: 'UTC' for stability across
 * reader locales.
 */
export function formatCardDate(iso: string, now: Date = new Date()): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const sameYear = d.getUTCFullYear() === now.getUTCFullYear();
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  });
}

/**
 * Estimate reading time in minutes from a markdown source.
 *
 * Strips fenced code blocks (not real reading), normalizes markdown
 * punctuation, counts whitespace-separated tokens, and divides by 220 wpm.
 * Returns at least 1.
 */
export function readingTimeMin(markdown: string): number {
  const words = markdown
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[#*_`>-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

/**
 * Most recent posts, including any flagged `featured`.
 *
 * Used by the home page "Recent articles" section. `getAllPosts()` already
 * sorts newest-first and excludes drafts, so this is just a slice on top.
 *
 * @param limit Maximum number of posts to return. Defaults to 3.
 */
export function getRecentPosts(limit = 3): Post[] {
  return getAllPosts().slice(0, limit);
}
