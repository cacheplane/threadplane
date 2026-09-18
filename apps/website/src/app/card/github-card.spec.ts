import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIN_READABLE_PX } from './tokens';
import { GITHUB_CARD_SIZE } from '../github-card/route';
import { HERO_SUBHEAD } from '../../lib/positioning';

const ROUTE = join(__dirname, '..', 'github-card', 'route.tsx');
const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');
const EXPORT_SCRIPT = join(REPO_ROOT, 'scripts', 'export-github-card.mjs');

describe('github card', () => {
  /**
   * GitHub's documented social preview size. Not the 1200x630 of the feed
   * card: a 1200x630 image uploaded here is letterboxed by GitHub rather
   * than filling the frame.
   */
  it('renders at GitHub social preview size', () => {
    expect(GITHUB_CARD_SIZE).toEqual({ width: 1280, height: 640 });
  });

  /**
   * The card states the product's positioning. Inlining that copy is how a
   * brand asset ends up asserting a tagline that was replaced months ago —
   * which is the exact failure brand-assets.spec.ts exists to catch, and it
   * cannot catch a string typed into a .tsx file it does not scan.
   */
  it('takes its copy from positioning.ts, not from string literals', () => {
    const source = readFileSync(ROUTE, 'utf8');
    expect(source).toContain("from '../../lib/positioning'");
    expect(source).not.toContain(HERO_SUBHEAD);
  });

  /**
   * Timelines and unfurls downscale this image hard. Below the floor a glyph
   * stops being read and becomes texture.
   */
  it('sets no type below the readable floor', () => {
    const source = readFileSync(ROUTE, 'utf8');
    const sizes = [...source.matchAll(/fontSize:\s*(\d+)/gu)].map((m) => Number(m[1]));

    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(MIN_READABLE_PX);
  });

  /**
   * Satori rejects a multi-child element with no explicit display, and a
   * static route turns that into a build failure rather than a 500 — but
   * only if the route is actually static.
   */
  it('renders at build time, not per request', () => {
    const source = readFileSync(ROUTE, 'utf8');
    expect(source).toContain("export const dynamic = 'force-static'");
  });

  /**
   * scripts/export-github-card.mjs cannot import GITHUB_CARD_SIZE — it is a
   * plain .mjs outside the Next app's TypeScript module graph, and the
   * repo-root scripts/ directory runs under no lint or test target of its
   * own. A comment there says the two are kept in sync BY HAND; this test is
   * the thing that actually checks it, by reading the script's EXPECTED
   * literal back out and comparing it to the route's real size.
   */
  it('keeps the export script EXPECTED size in sync with GITHUB_CARD_SIZE', () => {
    const source = readFileSync(EXPORT_SCRIPT, 'utf8');
    const match = source.match(/EXPECTED\s*=\s*\{\s*width:\s*(\d+),\s*height:\s*(\d+)\s*\}/u);

    // A guard that silently stops matching is worse than no guard: fail loudly
    // rather than let an empty/failed match pass this test vacuously.
    if (!match) {
      throw new Error(
        `Could not find an EXPECTED = { width, height } literal in ${EXPORT_SCRIPT}. ` +
          'Update this regex if the script changed shape.',
      );
    }

    const scriptSize = { width: Number(match[1]), height: Number(match[2]) };
    expect(scriptSize).toEqual(GITHUB_CARD_SIZE);
  });
});
