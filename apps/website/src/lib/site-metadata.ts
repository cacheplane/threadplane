import type { Metadata } from 'next';
import { getAllSolutionSlugs } from './solutions-data';
import { docsConfig, specialDocsPages } from './docs-config';
import { getAllPosts } from './blog';
import { SITE_ORIGIN } from './site-origin';

export { SITE_ORIGIN };
export const SITE_NAME = 'Threadplane';

/**
 * X attribution. `site` is the account that owns the card, `creator` the
 * human byline. Both are needed: with neither set, X renders the card with no
 * attribution row, which is what every threadplane.ai link did until now.
 */
export const SITE_X_SITE = '@threadplane';
export const SITE_X_CREATOR = '@blovedev';
export const DEFAULT_SOCIAL_IMAGE = '/opengraph-image';

/**
 * The default card as an object, not a bare URL.
 *
 * Next's file-convention metadata (the `alt`/`size` exports in
 * `app/opengraph-image.tsx`) is overridden the moment `openGraph.images` is set
 * explicitly, so a bare string shipped `og:image` alone — no dimensions for a
 * platform to lay the card out before fetching it, and no alt text at all.
 */
export const DEFAULT_SOCIAL_IMAGE_META = {
  url: DEFAULT_SOCIAL_IMAGE,
  width: 1200,
  height: 630,
  alt: 'Threadplane — the open-source thread-plane for Angular agents. Beside the tagline, a browser frame shows the product pausing for a human: an agent proposes deleting three backups, with Approve and Decline.',
} as const;
export {
  CODING_AGENT_PROMPT,
  COMPONENT_SNIPPET,
  DEFAULT_META_DESCRIPTION,
  HERO_EYEBROW,
  HERO_H1,
  HERO_SECONDARY_HREF,
  HERO_SUBHEAD,
  HERO_TRUST_LINE,
  HOME_DESCRIPTION,
  HOME_TITLE,
  INSTALL_OPTIONS,
  LONG_SUBHEAD,
  POSITIONING_PROOF_POINTS,
  PRIMARY_TAGLINE,
  SHORT_POSITIONING_DESCRIPTION,
} from './positioning';

/**
 * Path of a blog post's per-post OpenGraph card.
 *
 * Single source of truth: `blog/[slug]/page.tsx` feeds it to
 * `createPageMetadata` (og:image / twitter:image) and `blogPostingJsonLd`
 * feeds it to the BlogPosting `image`. Building the string in both places
 * independently let them drift with both test suites still green.
 */
export function ogImagePath(slug: string): string {
  return `/blog/${slug}/opengraph-image`;
}

/**
 * Clamp a meta description to what search results actually display.
 *
 * Google truncates snippets around 155-160 characters; anything longer gets
 * cut mid-sentence with Google's own ellipsis, which reads worse than a
 * deliberate ending (GSC follow-up to #826). Prefer ending on a sentence
 * boundary once past 60% of the budget; otherwise cut at a word boundary and
 * add a real ellipsis. Never truncates mid-word.
 */
export const META_DESCRIPTION_MAX = 160;

export function clampMetaDescription(text: string, max = META_DESCRIPTION_MAX): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;

  const slice = normalized.slice(0, max);
  const sentenceEnd = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('? '),
  );
  if (sentenceEnd >= max * 0.6) return slice.slice(0, sentenceEnd + 1);

  const wordEnd = slice.lastIndexOf(' ');
  const cut = slice.slice(0, wordEnd > 0 ? wordEnd : max - 1).replace(/[,;:\u2014-]+$/, '');
  return `${cut}\u2026`;
}

export function getCanonicalPath(pathname: string): string {
  if (pathname === '/') return '/';
  return `/${pathname.replace(/^\/+|\/+$/g, '')}`;
}

export function getCanonicalUrl(pathname: string): string {
  return new URL(getCanonicalPath(pathname), SITE_ORIGIN).toString();
}

/** Article-specific OpenGraph fields (freshness + attribution signals). */
export interface ArticleMetadata {
  /** ISO 8601 publish date or timestamp. */
  publishedTime: string;
  /**
   * ISO 8601 last-modified timestamp. Omit when no modification is known; it
   * then falls back to `publishedTime`.
   */
  modifiedTime?: string;
  authors?: string[];
  tags?: string[];
}

/**
 * The "unmodified" rule, in one place: a page with no known modification
 * advertises its publish date as the modification date.
 *
 * Shared by `article:modified_time` here and by the BlogPosting `dateModified`
 * in `structured-data.ts`. Those are two published claims about one fact, so
 * they resolve it with one implementation rather than two that happen to agree.
 */
export function resolveModifiedTime(publishedTime: string, modifiedTime?: string): string {
  return modifiedTime ?? publishedTime;
}

/** Options for {@link createPageMetadata}. */
export interface PageMetadataOptions {
  title: string;
  description: string;
  pathname: string;
  type?: 'article' | 'website';
  /** Social image path; resolved against `metadataBase` from the root layout.
   *  Omit to get {@link DEFAULT_SOCIAL_IMAGE_META}, which carries dimensions and alt. */
  image?: string;
  /** Present only for article-type pages; omitted entirely for landing pages. */
  article?: ArticleMetadata;
}

export function createPageMetadata({
  title,
  description,
  pathname,
  type = 'article',
  image,
  article,
}: PageMetadataOptions): Metadata {
  const canonicalPath = getCanonicalPath(pathname);
  // Central guard: every page's meta/OG description fits a search snippet.
  description = clampMetaDescription(description);

  return {
    title,
    description,
    alternates: {
      canonical: canonicalPath,
    },
    openGraph: {
      title,
      description,
      url: canonicalPath,
      siteName: SITE_NAME,
      type,
      images: [image ?? DEFAULT_SOCIAL_IMAGE_META],
      ...(article && {
        publishedTime: article.publishedTime,
        modifiedTime: resolveModifiedTime(article.publishedTime, article.modifiedTime),
        authors: article.authors,
        tags: article.tags,
      }),
    },
    twitter: {
      card: 'summary_large_image',
      site: SITE_X_SITE,
      creator: SITE_X_CREATOR,
      title,
      description,
      images: [image ?? DEFAULT_SOCIAL_IMAGE_META],
    },
  };
}

export function getSitemapRoutes(): string[] {
  const staticRoutes = ['/', '/langgraph', '/render', '/chat', '/ag-ui', '/pricing', '/solutions', '/pilot-to-prod', '/docs', '/blog', '/about', '/contact', '/privacy'];
  const solutionRoutes = getAllSolutionSlugs().map((slug) => `/solutions/${slug}`);
  const docsRoutes = docsConfig.flatMap((library) =>
    library.sections.flatMap((section) =>
      section.pages.map((page) => `/docs/${library.id}/${page.section}/${page.slug}`),
    ),
  );
  const specialDocsRoutes = specialDocsPages.map((page) => page.path);
  const blogRoutes = getAllPosts().map((p) => `/blog/${p.slug}`);

  return [...staticRoutes, ...solutionRoutes, ...docsRoutes, ...specialDocsRoutes, ...blogRoutes];
}
