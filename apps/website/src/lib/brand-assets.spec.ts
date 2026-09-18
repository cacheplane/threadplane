import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RETIRED_POSITIONING } from './public-copy-contract';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

/**
 * Artifacts that state the product's positioning but are not generated from
 * `positioning.ts`. Each is a file a human has to remember to update, which
 * is exactly why this test exists: the README banner and the whitepaper cover
 * both went months asserting a tagline that had been replaced.
 */
const BRAND_ASSETS = [
  'README.md',
  'apps/website/public/assets/hero.svg',
  'apps/website/public/whitepaper-preview.html',
  'apps/website/scripts/generate-whitepaper.ts',
  'libs/a2ui/README.md',
  'libs/ag-ui/README.md',
  'libs/chat/README.md',
  'libs/langgraph/README.md',
  'libs/middleware/README.md',
  'libs/render/README.md',
  'libs/telemetry/README.md',
];

describe('brand assets carry current positioning', () => {
  it.each(BRAND_ASSETS)('%s states no retired positioning', (relative) => {
    const text = readFileSync(join(REPO_ROOT, relative), 'utf8');
    const found = RETIRED_POSITIONING.filter((phrase) => text.includes(phrase));
    expect(found, `${relative} still says: ${found.join(', ')}`).toEqual([]);
  });

  it('names phrases to look for, so the scan cannot pass by being empty', () => {
    // A guard whose list is empty passes every file and reports nothing. This
    // is the mutation check the list itself cannot perform.
    expect(RETIRED_POSITIONING.length).toBeGreaterThan(3);
  });
});

/**
 * Brand colours that have been replaced.
 *
 * `#6C8EFF` and `#080B14` are the pre-ATC blue and near-black; `#004090` is a
 * navy that was never a design token at all. The sibling scan above catches
 * retired *copy* in these same files. Retired *colour* got through for one
 * reason: nothing looked. Badges carrying it render on public npm package
 * pages, where a stale palette is the first thing a reader sees.
 *
 * Deliberately NOT a repo-wide scan. CHANGELOG.md and the plans and specs
 * under docs/superpowers/ are historical records and keep their original
 * values.
 */
const RETIRED_BRAND_COLORS = ['6C8EFF', '080B14', '004090'];

/**
 * Its own list, not BRAND_ASSETS. That list exists for the copy scan and is a
 * different set: it includes middleware/README.md and the whitepaper files,
 * which carry no colour, and omits the diagrams, which carry plenty. Widening
 * the copy scan to match would change what the copy guard covers, which is a
 * separate decision.
 */
const COLOUR_SCANNED_ASSETS = [
  'README.md',
  'libs/a2ui/README.md',
  'libs/ag-ui/README.md',
  'libs/chat/README.md',
  'libs/langgraph/README.md',
  'libs/render/README.md',
  'libs/telemetry/README.md',
];

describe('brand assets carry current colours', () => {
  it.each(COLOUR_SCANNED_ASSETS)('%s uses no retired brand colour', (relative) => {
    const text = readFileSync(join(REPO_ROOT, relative), 'utf8').toUpperCase();
    const found = RETIRED_BRAND_COLORS.filter((hex) => text.includes(hex.toUpperCase()));
    expect(found, `${relative} still uses: ${found.join(', ')}`).toEqual([]);
  });

  it('names colours to look for, so the scan cannot pass by being empty', () => {
    // Same mutation check the copy scan carries: an empty needle list passes
    // every file and reports nothing.
    expect(RETIRED_BRAND_COLORS.length).toBeGreaterThan(2);
  });
});
