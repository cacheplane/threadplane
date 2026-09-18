/**
 * Card palette + type stacks, in the website card kit's vocabulary.
 *
 * Source of record: `apps/website/src/app/card/tokens.ts` (the `CARD` object),
 * which itself resolves the design tokens in `libs/design-tokens/src/lib/theme.css`
 * to literals. The values are DUPLICATED here rather than imported for two
 * reasons: this is a separate package with no dependency on apps/website, and
 * satori cannot read CSS variables, so a card palette has to be literals
 * wherever it lives.
 *
 * Duplication that a comment promises to keep in sync is duplication that
 * drifts — this file spent an ATC re-theme claiming to be "lifted verbatim"
 * from a file whose palette had already changed underneath it. So the promise
 * is mechanical now: `brand.spec.ts` reads `card/tokens.ts` off disk and fails
 * if any value below stops matching the `CARD` token it was copied from.
 *
 * The plane logo is not a bundled asset any more: satori renders inline SVG,
 * so the mark lives as the `Plane` component in `templates/card-shell.tsx`,
 * copied from the kit's `chrome.tsx`.
 */
export const brand = {
  /** CARD.ground — flat, like the kit. The old blue gradient is retired. */
  ground: '#fbfbfb',
  /** CARD.canvas */
  canvas: '#ffffff',
  /** CARD.ink / inkSecondary / inkMuted */
  ink: '#0a0a0a',
  inkSecondary: '#464646',
  inkMuted: '#737373',
  /** CARD.border / borderStrong */
  border: '#e5e5e5',
  borderStrong: '#c8c8c8',
  /** CARD.accent — scope navy — and its surface/border tints. */
  accent: '#15253e',
  accentSurface: 'rgba(255, 175, 0, 0.10)',
  accentBorder: 'rgba(255, 175, 0, 0.35)',
  /**
   * Not a CARD token, and so not covered by brand.spec.ts: this one IS a real
   * design token (`--color-angular-red`) and is deliberately kept.
   */
  angular: '#DD0031',
  wordmark: 'Threadplane',
  /**
   * `--font-display` / `--font-sans` / `--font-mono`, matching `chrome.tsx`.
   * Archivo Black is a single-weight family: never ask for a bold of it, or
   * satori goes hunting for a face that does not exist.
   */
  display: 'Archivo Black',
  sans: 'Archivo',
  mono: 'JetBrains Mono',
  defaultEyebrow: 'OPEN SOURCE · ANGULAR',
} as const;
