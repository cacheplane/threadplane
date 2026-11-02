import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getAllPosts, type Post } from './blog';
import { specialDocsPages } from './docs-config';
import { getSitemapRoutes } from './site-metadata';
import { resolveWebsiteDir } from './website-dir';
import { readApiIndex, readApiSymbol, resolveApiPage } from './api-reference';
import { apiSymbolFileName } from './api-reference-model';

/** A sitemap URL plus the honest last-modified time of the source it renders from. */
export interface SitemapEntry {
  route: string;
  /**
   * Omitted when no honest value can be determined. An absent `<lastmod>` is
   * valid sitemap XML; a fabricated one (e.g. "now" on every build, which is
   * what file mtimes give you on any fresh checkout) teaches crawlers to ignore
   * the signal across the whole site.
   */
  lastModified?: Date;
}

/** Website-relative source paths that a route's content is rendered from. */
export function sourcePathsForRoute(
  route: string,
  postsByRoute: ReadonlyMap<string, Post>
): string[] {
  if (route === '/docs/api' || route.startsWith('/docs/api/')) {
    const index = readApiIndex();
    const page = resolveApiPage(
      route === '/docs/api'
        ? []
        : route.slice('/docs/api/'.length).split('/').map(decodeURIComponent),
      index
    );
    const entries = page?.entrypoint ? [page.entrypoint] : index.entrypoints;
    const summaries =
      page?.kind === 'symbol'
        ? [page.symbol]
        : index.symbols.filter(
            (symbol) =>
              !page?.entrypoint || symbol.entrypointId === page.entrypoint.id
          );
    const sources = summaries.flatMap((summary) => {
      const symbol = readApiSymbol(summary.entrypointId, summary.name);
      return symbol?.source ? [`../../${symbol.source.path}`] : [];
    });
    return [
      ...new Set([
        path.join('content', 'api', 'index.json'),
        ...(page?.kind === 'symbol'
          ? [
              path.join(
                'content',
                'api',
                page.entrypoint.id,
                apiSymbolFileName(page.symbol.name)
              ),
            ]
          : []),
        ...entries.map((entry) => `../../libs/${entry.project}/package.json`),
        ...sources,
      ]),
    ];
  }
  const post = postsByRoute.get(route);
  if (post) return [path.join('content', 'blog', post.filename)];

  const special = specialDocsPages.find((page) => page.path === route);
  if (special) return [path.join('content', 'docs', special.contentPath)];

  if (route.startsWith('/docs/')) {
    const [, , library, section, slug] = route.split('/');
    if (library && section && slug) {
      return [path.join('content', 'docs', library, section, `${slug}.mdx`)];
    }
    // Anything else under /docs is a hand-written route, dated like any other.
  }

  if (route.startsWith('/solutions/')) {
    // Programmatic pages: one dynamic route template rendering data from a
    // single module, so a change to either re-renders the page.
    return [
      path.join('src', 'app', 'solutions', '[slug]', 'page.tsx'),
      path.join('src', 'lib', 'solutions-data.ts'),
    ];
  }

  const routeDir = route === '/' ? '' : route.replace(/^\//, '');
  return [path.join('src', 'app', routeDir, 'page.tsx')];
}

/** Absolute path for a website-relative source path, or null when it is missing. */
function resolveSourcePath(relativePath: string): string | null {
  const candidate = path.join(resolveWebsiteDir(), relativePath);
  return fs.existsSync(candidate) ? candidate : null;
}

const GIT_LOG_MARKER = 'commit-time ';
const GIT_LOG_HEADER = /^(\d+) ([0-9a-f]{40})$/;
const GIT_TIMEOUT_MS = 30_000;

export interface GitTimes {
  /** Last commit time (epoch seconds) keyed by website-relative path. */
  times: Map<string, number>;
  /**
   * False when the clone is shallow. It says nothing about whether a given file
   * appears in `times` — an absent path may be uncommitted, or may simply
   * predate the visible history — which is why nothing here ever falls back to
   * a file mtime. It only sharpens the build-log diagnostic.
   */
  hasFullHistory: boolean;
}

/**
 * Parse `git log --format='commit-time %ct %H' --name-only` output into last
 * commit time (epoch seconds) per repo path, with `prefix` stripped.
 *
 * Files attributed to a grafted (shallow-boundary) commit are dropped: such a
 * commit has no parent, so git reports the *entire tree* as changed at its
 * timestamp. Emitting those would claim the whole site changed at clone time,
 * which is exactly the fabrication this module exists to avoid.
 */
export function parseGitLog(
  text: string,
  prefix: string,
  graftedShas: ReadonlySet<string>
): Map<string, number> {
  const times = new Map<string, number>();
  let commitTime = 0;

  for (const line of text.split('\n')) {
    if (line.startsWith(GIT_LOG_MARKER)) {
      const header = GIT_LOG_HEADER.exec(line.slice(GIT_LOG_MARKER.length));
      // A path can legitimately begin with the marker text; only a well-formed
      // "<epoch> <sha1>" remainder is a commit header.
      if (header) {
        commitTime = graftedShas.has(header[2]) ? 0 : Number(header[1]);
        continue;
      }
    }
    // Paths are emitted verbatim (core.quotePath=false), so leading whitespace
    // is part of the name; only truly empty lines are separators.
    if (line.length === 0 || !commitTime) continue;
    const relative =
      prefix && line.startsWith(prefix) ? line.slice(prefix.length) : line;
    // `git log` walks newest-first, so the first mention of a path wins.
    if (!times.has(relative)) times.set(relative, commitTime);
  }

  return times;
}

/**
 * Read last-commit times for the website's content and sources from git.
 *
 * Returns null when git history yields nothing usable (no git, not a repo, a
 * clone so shallow that only grafted commits are visible, or a git invocation
 * that overflows its buffer or times out — all of which throw rather than
 * returning partial output).
 */
function computeGitTimes(): GitTimes | null {
  try {
    const git = (args: string[], cwd: string): string =>
      execFileSync(
        'git',
        [
          // Emit paths verbatim instead of octal-escaping non-ASCII and quoting
          // them, which would make every such path miss its lookup.
          '-c',
          'core.quotePath=false',
          // A user's `log.showSignature=true` would interleave `gpg:` lines
          // into the file list.
          '-c',
          'log.showSignature=false',
          ...args,
        ],
        {
          cwd,
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
          timeout: GIT_TIMEOUT_MS,
          killSignal: 'SIGKILL',
          stdio: ['ignore', 'pipe', 'ignore'],
        }
      );

    const root = git(['rev-parse', '--show-toplevel'], process.cwd()).trim();
    const graftedShas = new Set<string>();
    const shallow =
      git(['rev-parse', '--is-shallow-repository'], root).trim() === 'true';
    if (shallow) {
      // Must be the COMMON git dir, not `--absolute-git-dir`: in a linked
      // worktree those differ (`.git/worktrees/<name>` vs `.git`) and `shallow`
      // only ever lives in the common dir. Output can be relative, and git runs
      // with cwd=root, so resolve it against root.
      const commonDir = path.resolve(
        root,
        git(['rev-parse', '--git-common-dir'], root).trim()
      );
      const shallowFile = path.join(commonDir, 'shallow');
      if (!fs.existsSync(shallowFile)) return null;
      for (const sha of fs.readFileSync(shallowFile, 'utf8').split('\n')) {
        if (sha.trim()) graftedShas.add(sha.trim());
      }
    }

    const prefix = fs.existsSync(path.join(root, 'apps', 'website'))
      ? 'apps/website/'
      : '';
    const log = git(
      [
        'log',
        `--format=${GIT_LOG_MARKER}%ct %H`,
        '--name-only',
        '--',
        `${prefix}content`,
        `${prefix}src/app`,
        `${prefix}src/lib`,
        'libs',
      ],
      root
    );

    const times = parseGitLog(log, prefix, graftedShas);
    return times.size > 0 ? { times, hasFullHistory: !shallow } : null;
  } catch {
    return null;
  }
}

let gitTimesCache: GitTimes | null | undefined;

function getGitTimes(): GitTimes | null {
  if (gitTimesCache !== undefined) return gitTimesCache;
  gitTimesCache = computeGitTimes();

  if (gitTimesCache === null) {
    // Visible in the build log: the sitemap will carry `lastmod` only for blog
    // posts (which date themselves in frontmatter) until history is available.
    console.warn(
      '[sitemap] git history unavailable; omitting <lastmod> for file-derived routes.'
    );
  } else if (!gitTimesCache.hasFullHistory) {
    console.warn(
      '[sitemap] shallow clone; omitting <lastmod> for routes older than the visible history.'
    );
  }

  return gitTimesCache;
}

/** True when git can date at least some sources. Exposed for tests. */
export function hasGitHistory(): boolean {
  return getGitTimes() !== null;
}

/**
 * Newest commit time across a route's sources, or undefined when git cannot
 * date any of them. File mtimes are deliberately never consulted: any fresh
 * clone — shallow or not — rewrites every mtime to checkout time, so a single
 * lookup miss would silently publish a build-time `lastmod`.
 */
function sourceModifiedTime(relativePaths: string[]): Date | undefined {
  const git = getGitTimes();
  if (!git) return undefined;

  let newest: number | undefined;
  for (const relativePath of relativePaths) {
    if (!resolveSourcePath(relativePath)) continue;
    const normalized = relativePath.split(path.sep).join('/');
    const seconds = git.times.get(
      normalized.startsWith('../../libs/') ? normalized.slice(6) : normalized
    );
    if (seconds === undefined) continue;
    if (newest === undefined || seconds > newest) newest = seconds;
  }

  return newest === undefined ? undefined : new Date(newest * 1000);
}

/** Frontmatter publish date as UTC midnight, or undefined when unparseable. */
export function publishedDate(post: Post): Date | undefined {
  const date = new Date(`${post.frontmatter.date}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Index the posts a caller wants visible, keyed by route path. */
export function getPostsByRoute(
  options: { includeDrafts?: boolean } = {}
): Map<string, Post> {
  return new Map(
    getAllPosts(options).map((post) => [`/blog/${post.slug}`, post])
  );
}

/**
 * Honest last-modified time for one route, or undefined when nothing can date
 * it. Shared by the sitemap and by article metadata (`article:modified_time`),
 * so both surfaces make the same freshness claim for the same route.
 *
 * `postsByRoute` is required rather than defaulted: a route's answer depends on
 * whether its post is visible in the map (a missing one loses its frontmatter
 * date and falls through to a page source that does not exist for blog posts),
 * so every caller states which posts it means instead of inheriting a drafts
 * policy chosen here. Build it with {@link getPostsByRoute}, or pass a
 * single-entry map when the post is already in hand.
 */
export function getRouteLastModified(
  route: string,
  postsByRoute: ReadonlyMap<string, Post>
): Date | undefined {
  const committed = sourceModifiedTime(
    sourcePathsForRoute(route, postsByRoute)
  );

  // "Modified" means last *modified*, so an edited post outranks its own
  // publish date; the frontmatter date still covers posts git cannot date.
  const post = postsByRoute.get(route);
  const published = post ? publishedDate(post) : undefined;
  return committed && published
    ? committed > published
      ? committed
      : published
    : committed ?? published;
}

/**
 * Honest last-modified time for one already-resolved post.
 *
 * Both `generateMetadata` (for `article:modified_time`) and the page body (for
 * the BlogPosting `dateModified`) need this, and they run as separate functions
 * over the same request. Deriving it here — rather than each rebuilding the
 * single-entry map — is what keeps the two surfaces from ever disagreeing about
 * the same fact, and keeps both aligned with the sitemap's `<lastmod>`, which
 * asks {@link getRouteLastModified} the same question via the full post index.
 */
export function getPostLastModified(post: Post): Date | undefined {
  const route = `/blog/${post.slug}`;
  return getRouteLastModified(route, new Map([[route, post]]));
}

/**
 * Honest last-modified time for a docs route.
 *
 * The empty post index is the honest argument: {@link getRouteLastModified}
 * consults it only to recognise a blog route, and no /docs route is ever a post,
 * so supplying a real index would cost a blog-directory read and change nothing.
 * The route then dates itself from its MDX source — the same path the sitemap
 * takes for the same route, so the two `lastmod`/`dateModified` claims agree.
 */
export function getDocLastModified(pathname: string): Date | undefined {
  return getRouteLastModified(pathname, new Map());
}

export function getSitemapEntries(): SitemapEntry[] {
  // Drafts are not in `getSitemapRoutes()`, so they are not indexed either.
  const postsByRoute = getPostsByRoute();

  return getSitemapRoutes().map((route) => {
    const lastModified = getRouteLastModified(route, postsByRoute);
    return lastModified ? { route, lastModified } : { route };
  });
}
