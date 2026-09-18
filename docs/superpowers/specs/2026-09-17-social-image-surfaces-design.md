# Social image surfaces: GitHub preview, X attribution, brand-colour drift

Date: 2026-09-17
Status: approved, ready for planning

## Problem

A link to `github.com/cacheplane/threadplane` posted to X renders GitHub's
generic auto-generated card. Confirmed at the source:

```
og:image → https://opengraph.githubassets.com/<hash>/cacheplane/threadplane
og:image:width → 1200
og:image:height → 600
```

`opengraph.githubassets.com` is GitHub's fallback renderer — avatar, repo name,
description, star and fork counts. GitHub serves it because **no Social Preview
image has been uploaded** to the repository. It has nothing to do with the
website's metadata, and nothing to do with the README banner: GitHub never uses
README images for link previews.

The website's own cards are already correct. `threadplane.ai` serves a branded
1200x630 card from `apps/website/src/app/opengraph-image.tsx` with width,
height, alt text and `summary_large_image`; blog posts carry per-post cards.
This is a GitHub-side gap plus a set of brand-consistency bugs found alongside
it.

## Audit

| # | Surface | State |
|---|---------|-------|
| 1 | GitHub repo social preview | **Absent** — the reported bug |
| 2 | Website `og:image` (home) | Correct |
| 3 | Per-post blog cards | Correct |
| 4 | `twitter:site` / `twitter:creator` | **Missing** — no attribution on any card |
| 5 | README hero banner (`hero.svg`) | Layout and copy on-brand and kept in step with the card kit; its accent is not — see 7 |
| 6 | Badge palette, root README + 6 library READMEs | **Stale brand** — `#6C8EFF` / `#080B14` |
| 7 | `hero.svg`, `arch-diagram.svg`, 3 blog diagram SVGs | **`#004090` — not a design token at all** |
| 8 | Library route cards | Inherit the home card — **deferred, out of scope** |

Items 6 and 7 are visible on public npm package pages right now.

## Constraint

**GitHub's Social Preview has no API** — not REST, not GraphQL. The image is
generated, verified and committed here; a human uploads it once at repository
Settings -> General -> Social preview -> Edit. Every other item in this spec
lands end to end.

## Design

### 1. The GitHub card

New route `apps/website/src/app/github-card/route.tsx`: a `GET` returning an
`ImageResponse` at **1280x640**, GitHub's documented social preview size,
served at the stable URL `threadplane.ai/github-card`.

It imports `Rail`, `Wordmark`, `Pills`, `Frame` and `Conversation` from
`app/card/chrome.tsx`, `CARD` and `MIN_READABLE_PX` from `app/card/tokens.ts`,
and fonts via `loadCardFonts` from `app/og-font.ts` — the same primitives the
feed card uses. There is one definition of what a Threadplane card looks like;
this is a second composition of it, not a second design. Copy comes from
`lib/positioning.ts`, so the public-copy contract already covers it.

It is not a resized clone of the feed card. Two differences drive the layout:

- **2.0:1, not 1.905:1.** A client that crops a 2:1 image toward 1.905:1 trims
  WIDTH, about 30px off each side — a 2:1 image is wider than 1.905:1, so the
  vertical axis cannot be the one cut. (This bullet originally said 12px off
  the top and bottom, which is geometrically impossible; corrected during
  implementation.) Both margins clear the trim: the left column's padding is
  72px and the browser frame ends about 65px short of the right edge.
- **Different reading distance.** The feed card is tuned for X's ~500px
  render. The GitHub preview is also unfurled near full width by LinkedIn and
  Slack. `MIN_READABLE_PX` remains the floor for anything a human must read.

### 2. Export path

`scripts/export-github-card.mjs` fetches the route and writes
`docs/brand/github-social-preview.png`. It defaults to the production origin
and accepts `--origin http://localhost:3000` for local iteration.

The PNG is committed. The exact bytes destined for GitHub are then reviewable
in the diff, and regenerating after a brand change is one command producing a
visible change. On success the script prints the manual upload steps.

### 3. Attribution

`twitter:site` = `@threadplane`, `twitter:creator` = `@blovedev`, defined as
constants in `lib/site-metadata.ts` and consumed by `app/layout.tsx`.

Assumption to verify before merge: `@threadplane` is registered and controlled
by the project. X serves a JavaScript shell to logged-out fetches, so this
could not be confirmed programmatically. If the handle is not ours, cards still
render — the attribution link is simply dead.

### 4. Colour drift

The affected files, enumerated rather than assumed. Note the scope of the
search that produced this list: it covered `.md` and `.svg` only. That was too
narrow — see "Known gap" below.

- Badges, `#6C8EFF` -> `#15253E` (`--color-scope`) and `#080B14` -> `#0A0A0A`
  (`--color-ink`): `README.md` and the READMEs of `a2ui`, `ag-ui`, `chat`,
  `langgraph`, `render`, `telemetry`. Six libraries, not ten — `middleware`
  and the unpublished internal libraries carry no badge row.
- `#004090` -> `#15253E`: `apps/website/public/assets/hero.svg` and
  `arch-diagram.svg` (both embedded in the root README), plus the three
  published blog diagrams under `public/blog/diagrams/`.

`CHANGELOG.md` and everything under `docs/superpowers/` also contain retired
hex values. Both are historical records and are left alone; the guard's file
list is explicit for exactly this reason, and must not become a repo-wide scan.

Navy fill with ink label, not signal yellow: shields.io renders white text on
the fill colour, and `#FFAF00` sits at 1.84:1 against white. The existing
accent-split rule — yellow is fill-only, never a text or contrast-bearing
surface — already forbids it.

### 5. The guard

`lib/brand-assets.spec.ts` today scans exactly these files for retired
*copy*, because the README banner and whitepaper cover once spent months
asserting a replaced tagline. Stale colour got through for the same reason,
one attribute over: nothing looked.

Add a parallel scan for retired *hex* —
`RETIRED_BRAND_COLORS = ['6C8EFF', '080B14', '004090']` — carrying the same
non-empty-list assertion that spec already uses to stop an empty list from
passing every file silently.

The existing `BRAND_ASSETS` list is close but not identical to the set of files
that carry colour: it includes `middleware/README.md` and two whitepaper files,
and omits `arch-diagram.svg` and the blog diagrams. The colour scan therefore
gets its own list rather than reusing `BRAND_ASSETS` as-is. Extending the copy
scan's list to match would silently widen what the copy guard covers, which is
a separate decision from this one.

## Testing

`app/card/github-card.spec.ts`, alongside the existing `card.spec.ts`:

- the export is 1280x640
- headline and subhead trace to `positioning.ts` rather than being inlined
- every type size clears `MIN_READABLE_PX`
- the palette still resolves to the values in `theme.css`

Plus the retired-colour guard in `brand-assets.spec.ts`.

A card spec that passes while the image looks wrong is the failure mode here,
so the rendered PNG is reviewed by a human before this is called done. Tests
constrain the card; they do not certify it.

## Known gap: `marketing/assets`

Found by the final review, after the work was complete, and recorded here
rather than quietly fixed.

`marketing/assets/src/brand.ts` carries the full pre-ATC palette — `#004090`
accent, `#1a1a2e` ink, an `#eaf3ff` gradient, EB Garamond and Inter — and its
header comment claims the palette was "lifted verbatim from
`apps/website/src/app/opengraph-image.tsx`", which stopped being true at the
ATC re-theme.

It is not dead code. `renderCard()` produces the PNGs the X channel adapter
embeds directly in `Draft.media`, so the exact failure this spec set out to
fix — a stale palette on a public social surface — is still live on a surface
this spec did not look at.

The audit missed it because the colour census was run with `--include="*.md"
--include="*.svg"`, so no TypeScript file was ever scanned. The lesson is the
one this document already argues elsewhere: a guard, or an audit, only covers
what it was pointed at.

Re-theming it is a job the size of the `arch-diagram.svg` re-theme, not a
substitution — it has its own satori/resvg render pipeline, fonts and layout.
It is left as follow-up work rather than folded in here.

## Out of scope

Per-library route cards. `/chat`, `/langgraph`, `/render` and `/ag-ui`
continue to preview as the homepage. Deferred deliberately, not overlooked.

## Definition of done

1. `/github-card` renders at 1280x640 from the shared card kit.
2. `docs/brand/github-social-preview.png` is committed and matches the route.
3. The rendered PNG has been reviewed and approved by a human.
4. `twitter:site` and `twitter:creator` are served on every route.
5. No retired brand hex remains in any brand asset, and the guard fails if one
   returns.
6. The image is uploaded to repository settings — **manual, by the maintainer**
   — and a fresh post to X shows the branded card.
