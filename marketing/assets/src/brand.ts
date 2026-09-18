/**
 * Card palette + type stacks, in the website card kit's vocabulary.
 *
 * The palette below is copied from the `CARD` object in
 * `apps/website/src/app/card/tokens.ts`, which itself resolves the light
 * `--color-*` tokens in `libs/design-tokens/src/lib/theme.css` to literals.
 * The type stacks are not in `tokens.ts` at all: they are the `--font-display`
 * / `--font-sans` / `--font-mono` families from that same theme.css, named
 * here the way `card/chrome.tsx` names them to satori.
 *
 * The values are DUPLICATED rather than imported for two reasons: this is a
 * separate package with no dependency on apps/website, and satori cannot read
 * CSS variables, so a card palette has to be literals wherever it lives.
 *
 * Duplication that a comment promises to keep in sync is duplication that
 * drifts — this file spent an ATC re-theme claiming to be "lifted verbatim"
 * from a file whose palette had already changed underneath it. So the promise
 * is mechanical now: `brand.spec.ts` reads `card/tokens.ts` off disk and fails
 * if a colour stops matching the `CARD` token it was copied from, and fails
 * too if a colour is added here that no guard accounts for. Note the limit of
 * that: it compares COLOURS. The type stacks, the wordmark and the default
 * eyebrow below have no counterpart in `tokens.ts` and are not compared to
 * anything — changing one is a judgement call, not a drift the suite can spot.
 *
 * The plane logo is not a bundled asset any more: satori renders inline SVG,
 * so the mark lives as the `Plane` component in `templates/card-shell.tsx`,
 * copied from the kit's `chrome.tsx` and pinned to `public/brand/mark.svg` by
 * a test.
 */
export const brand = {
  /** CARD.ground — flat, like the kit. The old blue gradient is retired. */
  ground: '#fbfbfb',
  /** CARD.ink / inkSecondary / inkMuted */
  ink: '#0a0a0a',
  inkSecondary: '#464646',
  inkMuted: '#737373',
  /** CARD.borderStrong, the neutral pill's outline. */
  borderStrong: '#c8c8c8',
  /** CARD.accent — scope navy — and its surface/border tints. */
  accent: '#15253e',
  accentSurface: 'rgba(255, 175, 0, 0.10)',
  accentBorder: 'rgba(255, 175, 0, 0.35)',
  /**
   * Not a CARD token: this one IS a design token in its own right
   * (`--color-angular-red`), so it is exempted by name in brand.spec.ts
   * rather than compared.
   */
  angular: '#DD0031',
  wordmark: 'Threadplane',
  /**
   * `--font-display` / `--font-sans` / `--font-mono`, named as `chrome.tsx`
   * names them. Archivo Black is a single-weight family: never ask for a bold
   * of it, or satori goes hunting for a face that does not exist.
   */
  display: 'Archivo Black',
  sans: 'Archivo',
  mono: 'JetBrains Mono',
  defaultEyebrow: 'OPEN SOURCE · ANGULAR',
} as const;
