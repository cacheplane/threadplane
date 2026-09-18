# @threadplane-internal/marketing-assets

Branded social-card rendering for the marketing pipeline. `renderCard()` turns typed input into a PNG via satori (JSX→SVG) + @resvg/resvg-js (SVG→PNG). No Next.js dependency — runs anywhere Node does.

## Usage

```ts
import { renderCard } from '@threadplane-internal/marketing-assets';

const card = await renderCard({
  template: 'x-card',
  title: 'Build a streaming chat UI in Angular with LangGraph',
  subtitle: 'Signal-native streaming, wired to a LangGraph backend.',
});
// card.png is a Buffer; card.width / card.height / card.contentType describe it.
```

The X channel adapter embeds `card.png` directly in `Draft.media`.

## Templates

| id | size | use |
|----|------|-----|
| `x-card` | 1200×675 | X in-stream image (16:9) |
| `og-card` | 1200×630 | standard OpenGraph / Dev.to cover |

Both share `CardShell`, which is styled in the vocabulary of the website's card kit
(`apps/website/src/app/card/` — `tokens.ts` for the palette, `chrome.tsx` for the
chrome), so a card and the page it opens read as one product: a 92×3 ink rail over a
mono eyebrow, an Archivo Black headline, an optional subtitle, and a footer with the
trust pills (or an author byline) opposite the plane + "Threadplane" wordmark.

## Input

- `title` (required) — headline
- `subtitle` — supporting line
- `eyebrow` — kicker under the rail, uppercased in mono; defaults to "OPEN SOURCE · ANGULAR"
- `author` — `{ name, role? }`; when set, replaces the trust pills

## Assets

- Fonts: bundled static TTFs in `fonts/` — Archivo Black (display, single weight),
  Archivo 400/600 (body), JetBrains Mono 700 (eyebrow + pills). No runtime fetch.
  Byte-identical to `apps/website/src/app/card/fonts/`, which `src/fonts.spec.ts`
  asserts: those are instanced to one weight and stripped of the variable tables
  satori cannot parse, so matching them exactly inherits both properties.
- Logo: an inline `<svg>` (the `Plane` component in `src/templates/card-shell.tsx`,
  kept identical to `apps/website/public/brand/mark.svg`). Satori renders inline SVG,
  so there is no bundled PNG any more and no `brand/` directory.
- `fonts/` is the only directory copied into `dist/` by the Nx build assets array.

### Keeping the palette honest

`src/brand.ts` duplicates the card kit's palette, because this package does not depend
on apps/website and satori needs literals either way. `src/brand.spec.ts` reads
`apps/website/src/app/card/tokens.ts` off disk and fails if a value drifts — a comment
alone was the mechanism once, and the file went through an entire re-theme still
claiming to match a palette that had changed underneath it, shipping retired colour
into the media of live X posts. `marketing/assets/src/brand.ts` is also in the
retired-hex scan in `apps/website/src/lib/brand-assets.spec.ts`.

The same spec sweeps `brand`'s own keys, so a colour added here has to be either
compared against a `CARD` token or exempted by name with a reason — a guard that
only checks a hand-written list stops covering whatever the list forgot. The
inlined plane is pinned the same way: its path data is asserted to match
`apps/website/public/brand/mark.svg`, rather than a comment claiming they agree.

## Adding a template

1. Add a TSX wrapper in `src/templates/` calling `CardShell` with size params.
2. Register it in `src/templates/registry.ts` with width/height.
3. Add its id to `TemplateId` in `src/types.ts`.
4. Add a sample to `scripts/preview.ts`.

## Preview

```bash
npx tsx --tsconfig marketing/assets/tsconfig.lib.json marketing/assets/scripts/preview.ts
```

The `--tsconfig` flag points tsx at the JSX runtime config for the `.tsx` templates (the workspace-root tsconfig has no `jsx` setting). Writes sample PNGs to `marketing/assets/preview/` (gitignored). Open them to eyeball layout/fonts/mark.

## See also

- Spec: `docs/superpowers/specs/marketing/2026-05-17-brand-assets-design.md`
- Meta: `docs/superpowers/specs/marketing/2026-05-17-marketing-meta-design.md`
