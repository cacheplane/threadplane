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
 * compares. The pattern is the one in `apps/website/src/app/card/card.spec.ts`
 * (`tokenValue`, lines 18-23), which does the same job one level up — it
 * regexes `theme.css` to check that `tokens.ts` itself has not drifted from
 * the design tokens. This is that check extended one hop further out.
 *
 * Both share the rule that matters: a regex that finds nothing throws, rather
 * than returning empty and passing. A guard that quietly stops finding what it
 * watches is worse than no guard at all.
 */
const REPO_ROOT = join(__dirname, '..', '..', '..');
const TOKENS = 'apps/website/src/app/card/tokens.ts';

/** `brand.ts` key → the `CARD` key it was copied from. */
const COPIED_FROM_CARD: Record<string, string> = {
  ground: 'ground',
  ink: 'ink',
  inkSecondary: 'inkSecondary',
  inkMuted: 'inkMuted',
  borderStrong: 'borderStrong',
  accent: 'accent',
  accentSurface: 'accentSurface',
  accentBorder: 'accentBorder',
};

/**
 * Colour-valued keys that deliberately have no `CARD` counterpart. Each needs
 * a reason, because the point of the sweep below is that a new colour has to
 * be an explicit decision rather than an omission.
 */
const NOT_FROM_CARD: Record<string, string> = {
  // A real design token in its own right (`--color-angular-red`), and not part
  // of the card palette, so tokens.ts has no key to compare it against.
  angular: '#DD0031',
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

  /**
   * The comparison map above is a list, and a list only guards what someone
   * remembered to add to it — a colour added here tomorrow would simply not
   * be checked, which is the same silence this whole branch exists to remove. So
   * drive it from `brand` itself: every colour-valued key must be accounted
   * for, either by the map or by a named exemption.
   */
  it('accounts for every colour in brand.ts', () => {
    const colourKeys = Object.entries(brand)
      .filter(([, value]) => typeof value === 'string' && /#|rgba\(/.test(value))
      .map(([key]) => key);
    // Not a floor chosen by hand: if this finds nothing, the filter has stopped
    // matching and every assertion below it is vacuous.
    expect(colourKeys.length).toBeGreaterThan(0);

    const accounted = new Set([...Object.keys(COPIED_FROM_CARD), ...Object.keys(NOT_FROM_CARD)]);
    const unguarded = colourKeys.filter((key) => !accounted.has(key));
    expect(
      unguarded,
      `brand.ts has colour(s) no guard covers: ${unguarded.join(', ')}. Add each to ` +
        `COPIED_FROM_CARD if it comes from the card kit, or to NOT_FROM_CARD with a reason.`,
    ).toEqual([]);
  });

  it.each(Object.entries(NOT_FROM_CARD))(
    'brand.%s is the exempted value it is documented as',
    (key, value) => {
      expect(brand[key as keyof typeof brand]).toBe(value);
    },
  );
});

/**
 * The mark now exists in three places: `public/brand/mark.svg` (the file the
 * site serves), the kit's `Plane` in `chrome.tsx`, and our own `Plane` in
 * `templates/card-shell.tsx`. Each carries a comment claiming to be identical
 * to the others, which is precisely the mechanism that failed for the palette.
 */
describe('the inlined plane matches the served mark', () => {
  it('uses the same path data as public/brand/mark.svg', () => {
    const svg = readFileSync(
      join(REPO_ROOT, 'apps', 'website', 'public', 'brand', 'mark.svg'),
      'utf8',
    );
    const match = /\bd="([^"]+)"/.exec(svg);
    if (!match) {
      throw new Error(
        'apps/website/public/brand/mark.svg: no `d` attribute found. The mark guard ' +
          'cannot read its source — update this regex rather than deleting the test.',
      );
    }
    const shell = readFileSync(join(__dirname, 'templates', 'card-shell.tsx'), 'utf8');
    expect(
      shell,
      `the Plane in card-shell.tsx has drifted from public/brand/mark.svg (d="${match[1]}")`,
    ).toContain(match[1]);
  });
});
