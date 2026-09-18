import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  clampMetaDescription,
  DEFAULT_META_DESCRIPTION,
  HERO_SUBHEAD,
  HOME_DESCRIPTION,
  HOME_TITLE,
  LONG_SUBHEAD,
  POSITIONING_PROOF_POINTS,
  PRIMARY_TAGLINE,
  SHORT_POSITIONING_DESCRIPTION,
  SITE_NAME,
  SITE_X_SITE,
  SITE_X_CREATOR,
  createPageMetadata,
} from './site-metadata';
import { resolveWebsiteDir } from './website-dir';

describe('site positioning copy', () => {
  it('exports the approved primary tagline and supporting copy', () => {
    expect(PRIMARY_TAGLINE).toBe('Threadplane — The open-source thread-plane for agents');
    expect(LONG_SUBHEAD).toContain('open-source thread-plane for agents');
    expect(LONG_SUBHEAD).toContain('LangGraph and AG-UI');
    expect(HERO_SUBHEAD).toBe(
      'Make agent work persistent, durable, visible, reviewable, and resumable.',
    );
    expect(POSITIONING_PROOF_POINTS.map((p) => p.label)).toEqual([
      'LangGraph + AG-UI',
      'Durable threads',
      'Interrupts',
      'Subagents',
      'Planning + memory',
      'json-render + A2UI',
    ]);
    expect(POSITIONING_PROOF_POINTS.map((p) => p.href)).toEqual([
      '/docs/choosing-an-adapter',
      '/docs/langgraph/guides/persistence',
      '/docs/langgraph/guides/interrupts',
      '/docs/langgraph/guides/subgraphs',
      '/docs/langgraph/guides/memory',
      '/docs/render/concepts/json-render-vs-a2ui',
    ]);
    expect(DEFAULT_META_DESCRIPTION).toBe(SHORT_POSITIONING_DESCRIPTION);
  });

  it('uses canonical copy in generated page metadata', () => {
    const metadata = createPageMetadata({
      title: PRIMARY_TAGLINE,
      description: DEFAULT_META_DESCRIPTION,
      pathname: '/',
      type: 'website',
    });

    expect(metadata.title).toBe(PRIMARY_TAGLINE);
    expect(metadata.description).toBe(DEFAULT_META_DESCRIPTION);
    expect(metadata.openGraph?.description).toBe(DEFAULT_META_DESCRIPTION);
    expect(metadata.twitter?.description).toBe(DEFAULT_META_DESCRIPTION);
  });

  it('homepage metadata uses the category title and an un-clamped description', () => {
    const metadata = createPageMetadata({
      title: HOME_TITLE,
      description: HOME_DESCRIPTION,
      pathname: '/',
      type: 'website',
    });

    expect(metadata.title).toBe('Threadplane — The open-source thread-plane for agents');
    expect(metadata.description).toBe(HOME_DESCRIPTION);
  });
});

describe('clampMetaDescription', () => {
  it('passes short descriptions through untouched', () => {
    expect(clampMetaDescription('Short and sweet.')).toBe('Short and sweet.');
  });

  it('collapses internal whitespace', () => {
    expect(clampMetaDescription('  a \n  b  ')).toBe('a b');
  });

  it('prefers a sentence boundary once past 60% of the budget', () => {
    const first = 'This first sentence lands comfortably past the sixty percent mark of the one-sixty budget so the clamp should end exactly on it.';
    const result = clampMetaDescription(`${first} This trailing sentence pushes the whole thing well over the limit.`);
    expect(result).toBe(first);
  });

  it('falls back to a word boundary with an ellipsis', () => {
    const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    const result = clampMetaDescription(words);
    expect(result.length).toBeLessThanOrEqual(160);
    expect(result.endsWith('\u2026')).toBe(true);
    // never a mid-word cut: everything before the ellipsis is a whole word
    expect(words.startsWith(result.slice(0, -1))).toBe(true);
    expect(words[result.length - 1]).toBe(' ');
  });

  it('never exceeds the budget', () => {
    const long = 'x'.repeat(400);
    expect(clampMetaDescription(long).length).toBeLessThanOrEqual(160);
  });
});

describe('createPageMetadata description clamp', () => {
  it('clamps the meta and OpenGraph descriptions centrally', () => {
    const metadata = createPageMetadata({
      title: 'T',
      description: `${'Lead sentence that is deliberately made long enough to pass the sixty percent sentence-boundary threshold of the budget for this clamp.'} Overflow text beyond the snippet budget.`,
      pathname: '/x',
    });
    expect(String(metadata.description).length).toBeLessThanOrEqual(160);
    expect(metadata.openGraph?.description).toBe(metadata.description);
  });
});

describe('createPageMetadata article fields', () => {
  it('emits openGraph article dates, authors, and tags', () => {
    const metadata = createPageMetadata({
      title: 'Post — Threadplane',
      description: 'A post.',
      pathname: '/blog/post',
      type: 'article',
      article: {
        publishedTime: '2026-08-13',
        modifiedTime: '2026-08-14',
        authors: ['Brian Love'],
        tags: ['angular', 'ag-ui'],
      },
    });
    const openGraph = metadata.openGraph as Record<string, unknown>;
    expect(openGraph['publishedTime']).toBe('2026-08-13');
    expect(openGraph['modifiedTime']).toBe('2026-08-14');
    expect(openGraph['authors']).toEqual(['Brian Love']);
    expect(openGraph['tags']).toEqual(['angular', 'ag-ui']);
  });

  it('ships the default card with dimensions and alt, not a bare URL', () => {
    // A bare string overrides Next's file-convention metadata, so og:image:width,
    // og:image:height and og:image:alt never reached the HTML.
    const metadata = createPageMetadata({ title: 't', description: 'd', pathname: '/', type: 'website' });
    const openGraph = metadata.openGraph as { images: { url: string; width: number; height: number; alt: string }[] };
    expect(openGraph.images[0].url).toBe('/opengraph-image');
    expect(openGraph.images[0].width).toBe(1200);
    expect(openGraph.images[0].height).toBe(630);
    expect(openGraph.images[0].alt).toMatch(/open-source thread-plane for agents/);
  });

  it('accepts a page-specific social image', () => {
    const metadata = createPageMetadata({
      title: 'Post — Threadplane',
      description: 'A post.',
      pathname: '/blog/post',
      image: '/blog/post/opengraph-image',
    });
    const openGraph = metadata.openGraph as { images: string[] };
    expect(openGraph.images).toEqual(['/blog/post/opengraph-image']);
  });
});

describe('createPageMetadata article fallback', () => {
  it('advertises the publish date as the modification when none is known', () => {
    const metadata = createPageMetadata({
      title: 'Post — Threadplane',
      description: 'A post.',
      pathname: '/blog/post',
      article: { publishedTime: '2026-08-13T00:00:00.000Z' },
    });
    const openGraph = metadata.openGraph as Record<string, unknown>;
    expect(openGraph['modifiedTime']).toBe('2026-08-13T00:00:00.000Z');
  });

  it('omits article fields entirely for a non-article page', () => {
    const metadata = createPageMetadata({
      title: 'Home — Threadplane',
      description: 'A page.',
      pathname: '/',
      type: 'website',
    });
    const openGraph = metadata.openGraph as Record<string, unknown>;
    // Absent, not undefined: Next emits a meta tag for a present-but-undefined
    // key in some shapes, and a landing page has no publication to date.
    expect('publishedTime' in openGraph).toBe(false);
    expect('modifiedTime' in openGraph).toBe(false);
    expect('authors' in openGraph).toBe(false);
    expect('tags' in openGraph).toBe(false);
  });
});

describe('brand name', () => {
  // Built at runtime so this spec file — which lives under a scanned root —
  // does not match its own needle.
  const MISSPELLING = new RegExp(['Thread', 'Plane'].join(''), 'g');
  const SCAN_ROOTS = ['src', 'content', 'scripts', 'e2e'];
  const ALLOWED = new Set([
    // A deliberate mixed-case URL fixture for host-case normalization.
    path.join('scripts', 'gsc', 'analysis.spec.ts'),
  ]);
  const SKIP_DIRS = new Set(['node_modules', '.next', 'dist']);

  function walk(dir: string, root: string, out: string[]): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full, root, out);
      } else if (entry.isFile()) {
        out.push(path.relative(root, full));
      }
    }
    return out;
  }

  it('is spelled the same way everywhere it ships', () => {
    const websiteDir = resolveWebsiteDir();
    const offenders: string[] = [];

    for (const root of SCAN_ROOTS) {
      const rootDir = path.join(websiteDir, root);
      if (!fs.existsSync(rootDir)) continue;
      for (const relative of walk(rootDir, websiteDir, [])) {
        if (ALLOWED.has(relative)) continue;
        if (MISSPELLING.test(fs.readFileSync(path.join(websiteDir, relative), 'utf8'))) {
          offenders.push(relative);
        }
        MISSPELLING.lastIndex = 0;
      }
    }

    expect(offenders).toEqual([]);
    expect(SITE_NAME).toBe('Threadplane');
  });
});

describe('blog frontmatter description budget', () => {
  it('every post description fits a search snippet without clamping', () => {
    // The runtime clamp guards the meta tag, but a hand-written description
    // that needs clamping loses its author's chosen ending — keep the source
    // honest. (Reads the real content files; blog.spec.ts mocks fs.)
    const blogDir = path.join(resolveWebsiteDir(), 'content', 'blog');
    const offenders: string[] = [];
    for (const file of fs.readdirSync(blogDir).filter((f) => f.endsWith('.mdx'))) {
      const source = fs.readFileSync(path.join(blogDir, file), 'utf8');
      const description = source
        .match(/^---\n[\s\S]*?^description:\s*['"]?(?<d>[^'"\n]+?)['"]?\s*$/m)
        ?.groups?.['d'];
      if (description && description.length > 160) {
        offenders.push(`${file} (${description.length} chars)`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('X attribution', () => {
  /**
   * Without these, X renders the card with no attribution byline at all —
   * the link reads as unowned. They live in site-metadata rather than being
   * typed into layout.tsx so the root layout and every createPageMetadata
   * page cannot disagree about who publishes the card.
   */
  it('names the brand account and the author', () => {
    expect(SITE_X_SITE).toBe('@threadplane');
    expect(SITE_X_CREATOR).toBe('@blovedev');
  });

  it('puts both on every page built by createPageMetadata', () => {
    const meta = createPageMetadata({
      title: 'Test',
      description: 'Test description.',
      pathname: '/test',
    });

    expect(meta.twitter).toMatchObject({
      card: 'summary_large_image',
      site: SITE_X_SITE,
      creator: SITE_X_CREATOR,
    });
  });
});
