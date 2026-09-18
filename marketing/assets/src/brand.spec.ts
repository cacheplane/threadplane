import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { brand } from './brand';

/**
 * `brand.ts` duplicates the website card kit's palette, because this package
 * does not depend on apps/website and satori needs literals either way. A
 * comment used to be the whole mechanism keeping the two in step, and it
 * failed: the file claimed to be "lifted verbatim" from the site's OG image
 * right through an entire re-theme, and shipped the pre-ATC palette into the
 * media of live X posts.
 *
 * So the promise is mechanical now. This reads `card/tokens.ts` off disk and
 * compares. Follows the house pattern in
 * `apps/website/src/lib/brand-assets.spec.ts`: resolve the repo root by
 * relative path, regex the values out, and fail loudly when a regex matches
 * nothing rather than passing vacuously — a guard that quietly stops finding
 * what it watches is worse than no guard at all.
 */
const REPO_ROOT = join(__dirname, '..', '..', '..');
const TOKENS = 'apps/website/src/app/card/tokens.ts';

/** `brand.ts` key → the `CARD` key it was copied from. */
const COPIED_FROM_CARD: Record<string, string> = {
  ground: 'ground',
  canvas: 'canvas',
  ink: 'ink',
  inkSecondary: 'inkSecondary',
  inkMuted: 'inkMuted',
  border: 'border',
  borderStrong: 'borderStrong',
  accent: 'accent',
  accentSurface: 'accentSurface',
  accentBorder: 'accentBorder',
};

const tokensSource = readFileSync(join(REPO_ROOT, TOKENS), 'utf8');

/** The `CARD = { ... }` body, so a same-named key elsewhere in the file
 * cannot answer for a token. Throws rather than returning empty: if the shape
 * of tokens.ts changes, this test must go red, not quiet. */
function cardBody(): string {
  const match = /export const CARD = \{([\s\S]*?)\n\} as const;/.exec(tokensSource);
  if (!match) {
    throw new Error(
      `${TOKENS}: could not find the \`export const CARD = { ... } as const;\` block. ` +
        `The palette guard cannot read its source — update this regex rather than deleting the test.`,
    );
  }
  return match[1];
}

function cardToken(key: string): string {
  const match = new RegExp(`^\\s*${key}:\\s*'([^']+)',`, 'm').exec(cardBody());
  if (!match) {
    throw new Error(
      `${TOKENS}: no \`${key}\` in the CARD object. marketing/assets/src/brand.ts ` +
        `copies it, so either the token was renamed (update both) or removed (drop it here).`,
    );
  }
  return match[1];
}

describe('brand palette still matches the card kit it was copied from', () => {
  it('finds the CARD object in tokens.ts', () => {
    expect(cardBody().length).toBeGreaterThan(100);
  });

  it.each(Object.entries(COPIED_FROM_CARD))(
    'brand.%s equals CARD.%s',
    (brandKey, cardKey) => {
      const expected = cardToken(cardKey);
      expect(
        brand[brandKey as keyof typeof brand],
        `brand.${brandKey} has drifted from CARD.${cardKey} in ${TOKENS}`,
      ).toBe(expected);
    },
  );

  it('watches a real set of keys, so the comparison cannot pass by being empty', () => {
    // The mutation check the map cannot perform on itself: an empty map makes
    // `it.each` generate no cases at all and the suite still goes green.
    expect(Object.keys(COPIED_FROM_CARD).length).toBeGreaterThan(8);
  });

  it('keeps the Angular red, which is a design token rather than a CARD one', () => {
    // `--color-angular-red`. Deliberately not in the map above: tokens.ts has
    // no such key, so a lookup would throw.
    expect(brand.angular).toBe('#DD0031');
  });
});
