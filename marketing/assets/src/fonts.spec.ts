import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadFonts } from './fonts';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const KIT_FONTS = join(REPO_ROOT, 'apps', 'website', 'src', 'app', 'card', 'fonts');
const OUR_FONTS = join(__dirname, '..', 'fonts');

const FACES = [
  'ArchivoBlack-Regular.ttf',
  'Archivo-Regular.ttf',
  'Archivo-SemiBold.ttf',
  'JetBrainsMono-Bold.ttf',
];

describe('loadFonts', () => {
  it('returns four font entries with expected names + weights', async () => {
    const fonts = await loadFonts();
    expect(fonts).toHaveLength(4);
    const byName = fonts.map((f) => `${f.name}:${f.weight}`);
    // Archivo Black is single-weight, so it registers at 400: a 700 entry here
    // would send satori looking for a bold the face does not contain.
    expect(byName).toContain('Archivo Black:400');
    expect(byName).toContain('Archivo:400');
    expect(byName).toContain('Archivo:600');
    expect(byName).toContain('JetBrains Mono:700');
    for (const f of fonts) {
      expect(f.data.byteLength).toBeGreaterThan(1000);
      expect(f.style).toBe('normal');
    }
  });

  it('memoizes — second call returns the same array reference', async () => {
    const a = await loadFonts();
    const b = await loadFonts();
    expect(a).toBe(b);
  });
});

/**
 * The design premise of this package is now "the same faces the site's card
 * kit uses", so assert exactly that rather than anything weaker.
 *
 * Byte equality subsumes three separate hazards in one comparison:
 *
 *  - A substituted or truncated face. Satori does not fail on a font it cannot
 *    use for a given family — it silently falls back — so a wrong file is
 *    invisible until a human looks at a rendered card and finds the mono
 *    eyebrow set in something else.
 *  - A variable font. Satori throws "Cannot read properties of undefined
 *    (reading '256')" on one. The kit's faces are instanced and stripped of
 *    `fvar` by `scripts/build-card-fonts.py`; matching them byte for byte
 *    inherits that property instead of re-checking it.
 *  - Drift from the kit, which is the whole reason this package was re-themed.
 *
 * Replaces the longer-hand bundled-and-not-variable checks in
 * `apps/website/src/app/card/card.spec.ts:55-78`, which guard the kit copies.
 */
describe('bundled faces are the kit copies', () => {
  it.each(FACES)('%s is byte-identical to the card kit copy', (name) => {
    const ours = readFileSync(join(OUR_FONTS, name));
    const theirs = readFileSync(join(KIT_FONTS, name));
    expect(
      ours.equals(theirs),
      `marketing/assets/fonts/${name} differs from apps/website/src/app/card/fonts/${name} ` +
        `(${ours.byteLength} vs ${theirs.byteLength} bytes). Re-copy it from the kit.`,
    ).toBe(true);
  });

  it('names the faces it compares, so the scan cannot pass by being empty', () => {
    // An empty FACES list makes `it.each` generate no cases and the suite
    // still goes green.
    expect(FACES).toHaveLength(4);
  });
});
