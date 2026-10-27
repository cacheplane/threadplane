import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEMOS } from './demos';
import { DEMO_META, SOCIAL_CARD_PATH, SOCIAL_CARD_SIZE, canonicalUrl, demoMeta, socialCardUrl } from './demo-meta';
import { SITE_X_CREATOR, SITE_X_SITE, clampMetaDescription } from './site-metadata';

describe('demo meta', () => {
  it('covers exactly the demos the website links to', () => {
    // Mutation guard: an emptied list would pass every per-entry assertion.
    expect(DEMO_META.length).toBe(2);
    expect(DEMO_META.map((m) => m.key).sort()).toEqual(DEMOS.map((d) => d.key).sort());
  });

  it.each(DEMO_META)('$key origin is the link registry href', (meta) => {
    expect(meta.origin).toBe(DEMOS.find((d) => d.key === meta.key)?.href);
    expect(meta.origin).toMatch(/^https:\/\/[a-z0-9.-]+$/u);
  });

  it.each(DEMO_META)('$key title follows the "Page — Threadplane" convention', (meta) => {
    expect(meta.title).toMatch(/ — Threadplane$/u);
    expect(meta.title.length).toBeLessThanOrEqual(60);
  });

  it.each(DEMO_META)('$key description fits a search snippet untruncated', (meta) => {
    expect(clampMetaDescription(meta.description)).toBe(meta.description);
  });

  it.each(DEMO_META)('$key card copy is populated', (meta) => {
    expect(meta.cardEyebrow).toBe('LIVE DEMO');
    expect(meta.cardHeadlineLines.length).toBeGreaterThanOrEqual(2);
    expect(meta.cardSubhead.length).toBeGreaterThan(20);
    expect(meta.runtimeLabel).toMatch(/^(LangGraph|AG-UI)$/u);
    expect(meta.cardAlt).toContain(new URL(meta.origin).host);
  });

  it('derives the canonical and card URLs from the origin', () => {
    const lg = demoMeta('langgraph');
    expect(canonicalUrl(lg)).toBe('https://demo.threadplane.ai/');
    expect(socialCardUrl(lg)).toBe(`https://demo.threadplane.ai${SOCIAL_CARD_PATH}`);
    expect(SOCIAL_CARD_SIZE).toEqual({ width: 1200, height: 630 });
  });

  it('throws for an unknown key rather than returning undefined', () => {
    expect(() => demoMeta('nope' as never)).toThrow(/nope/u);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * The deployed demos' files, read off disk.
 *
 * The demos' heads are static HTML and cannot import demo-meta.ts, so the
 * copy is duplicated there. These tests make that duplication safe: change
 * the title in the module and forget the HTML, and this fails.
 * ──────────────────────────────────────────────────────────────────────── */

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const DEMO_DIRS: Record<string, string> = {
  langgraph: join(REPO_ROOT, 'examples', 'chat', 'angular'),
  'ag-ui': join(REPO_ROOT, 'examples', 'ag-ui', 'angular'),
};

function parseHead(key: string): Document {
  const html = readFileSync(join(DEMO_DIRS[key], 'src', 'index.html'), 'utf8');
  return new DOMParser().parseFromString(html, 'text/html');
}
const content = (doc: Document, selector: string): string | null =>
  doc.querySelector(selector)?.getAttribute('content') ?? null;

function pngSize(path: string): { width: number; height: number } | null {
  const buffer = readFileSync(path);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buffer.subarray(0, 8).equals(signature)) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

describe('deployed demo index.html mirrors demo-meta', () => {
  it.each(DEMO_META)('$key head carries the title, description and canonical', (meta) => {
    const doc = parseHead(meta.key);
    expect(doc.querySelector('title')?.textContent).toBe(meta.title);
    expect(content(doc, 'meta[name="description"]')).toBe(meta.description);
    expect(doc.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(canonicalUrl(meta));
  });

  it.each(DEMO_META)('$key head carries complete Open Graph tags', (meta) => {
    const doc = parseHead(meta.key);
    expect(content(doc, 'meta[property="og:type"]')).toBe('website');
    expect(content(doc, 'meta[property="og:site_name"]')).toBe('Threadplane');
    expect(content(doc, 'meta[property="og:url"]')).toBe(canonicalUrl(meta));
    expect(content(doc, 'meta[property="og:title"]')).toBe(meta.title);
    expect(content(doc, 'meta[property="og:description"]')).toBe(meta.description);
    expect(content(doc, 'meta[property="og:image"]')).toBe(socialCardUrl(meta));
    expect(content(doc, 'meta[property="og:image:width"]')).toBe(String(SOCIAL_CARD_SIZE.width));
    expect(content(doc, 'meta[property="og:image:height"]')).toBe(String(SOCIAL_CARD_SIZE.height));
    expect(content(doc, 'meta[property="og:image:alt"]')).toBe(meta.cardAlt);
  });

  it.each(DEMO_META)('$key head carries complete Twitter card tags', (meta) => {
    const doc = parseHead(meta.key);
    expect(content(doc, 'meta[name="twitter:card"]')).toBe('summary_large_image');
    expect(content(doc, 'meta[name="twitter:site"]')).toBe(SITE_X_SITE);
    expect(content(doc, 'meta[name="twitter:creator"]')).toBe(SITE_X_CREATOR);
    expect(content(doc, 'meta[name="twitter:title"]')).toBe(meta.title);
    expect(content(doc, 'meta[name="twitter:description"]')).toBe(meta.description);
    expect(content(doc, 'meta[name="twitter:image"]')).toBe(socialCardUrl(meta));
    expect(content(doc, 'meta[name="twitter:image:alt"]')).toBe(meta.cardAlt);
  });

  it.each(DEMO_META)('$key head links both icon formats', (meta) => {
    const doc = parseHead(meta.key);
    expect(doc.querySelector('link[rel="icon"][href="favicon.ico"]')).not.toBeNull();
    expect(doc.querySelector('link[rel="icon"][type="image/svg+xml"][href="icon.svg"]')).not.toBeNull();
  });

  it.each(DEMO_META)('$key theme-color matches the page background tokens', (meta) => {
    const doc = parseHead(meta.key);
    expect(content(doc, 'meta[name="theme-color"][media="(prefers-color-scheme: dark)"]')).toBe('#0f1116');
    expect(content(doc, 'meta[name="theme-color"][media="(prefers-color-scheme: light)"]')).toBe('#ffffff');
  });
});

describe('deployed demo public assets', () => {
  /**
   * Both demos shipped the Nx starter favicon for months. The brand icon is
   * copied in by hand, so this is what stops a regenerated example from
   * quietly bringing the Nx one back.
   */
  it.each(DEMO_META)('$key favicon.ico and icon.svg are the website brand files', (meta) => {
    const dir = join(DEMO_DIRS[meta.key], 'public');
    expect(readFileSync(join(dir, 'favicon.ico'))).toEqual(
      readFileSync(join(REPO_ROOT, 'apps', 'website', 'public', 'favicon.ico')),
    );
    expect(readFileSync(join(dir, 'icon.svg'), 'utf8')).toBe(
      readFileSync(join(REPO_ROOT, 'apps', 'website', 'src', 'app', 'icon.svg'), 'utf8'),
    );
  });

  it.each(DEMO_META)('$key robots.txt allows crawling (noindex rides on the route header)', (meta) => {
    const robots = readFileSync(join(DEMO_DIRS[meta.key], 'public', 'robots.txt'), 'utf8');
    expect(robots).toMatch(/^User-agent: \*\nAllow: \/\n$/u);
  });

  it.each(DEMO_META)('$key ships the social card at the advertised size', (meta) => {
    expect(pngSize(join(DEMO_DIRS[meta.key], 'public', 'social-card.png'))).toEqual(SOCIAL_CARD_SIZE);
  });
});
