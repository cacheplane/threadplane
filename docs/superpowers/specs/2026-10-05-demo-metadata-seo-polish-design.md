# Demo metadata and SEO polish — design

**Date:** 2026-10-05
**Scope:** the two deployed demos only — `demo.threadplane.ai`
(`examples/chat/angular`, the LangGraph canonical demo) and
`ag-ui.threadplane.ai` (`examples/ag-ui/angular`, the AG-UI itinerary demo).
The cockpit examples under `examples.threadplane.ai` are out of scope.

## Problem

Both demos were audited live on 2026-10-05. They share the same defects:

- **Favicon is the Nx default.** Both ship a byte-identical copy of the Nx
  starter `favicon.ico` (the blue "Nx" mark). The website ships a brand
  `favicon.ico` plus an `icon.svg` (yellow rounded square, black plane).
- **No description, no social metadata.** Neither head carries
  `<meta name="description">`, Open Graph, Twitter card, `theme-color`, or a
  canonical link. A shared link unfurls as a bare URL.
- **`robots.txt` and `sitemap.xml` return the SPA.** Both paths fall through
  the Vercel filesystem handle to `index.html` with `200 text/html`.
- **Titles are repo vocabulary.** "Threadplane chat — canonical demo" and
  "AG-UI Chat — Threadplane Example" describe the examples to contributors,
  not to a visitor or a search result. The AG-UI demo is a trip-itinerary
  planner with a map; the title says none of that.
- **Iframe-only routes are indexable.** The homepage embeds
  `demo.threadplane.ai/hero` and `/stage`. Those routes exist to be framed
  and would be poor standalone search results.

Not defects, noted for completeness: `__build.json` at the LangGraph demo
root is intentional build metadata; `retention-policy.md` is demo content the
graph references; `app-mode-preview.jpg` is used by each demo's App-mode
promo component.

## Decisions

1. **Indexing policy: index the root, hide the rest.** The root (and therefore
   every mode route, via canonical) is indexable with real metadata. `/hero`
   and `/stage` get `X-Robots-Tag: noindex`. `robots.txt` stays allow-all,
   because `noindex` only takes effect on pages a crawler is allowed to fetch.
2. **Social card image: generated, demo-specific, committed.** Rendered by the
   website's existing card chrome so the two demos and the main site share
   one brand, exported to a PNG in each demo's `public/`, and committed so the
   bytes are reviewable in a diff and the demo does not depend on a website
   deploy.
3. **Copy.** Titles follow the website's "Page — Threadplane" convention.

   | Demo | Title | Description |
   | --- | --- | --- |
   | LangGraph | `LangGraph chat demo — Threadplane` | `Live Angular chat on LangGraph: streaming, durable threads, human approvals, tool progress, and generative UI. Embed, popup, and sidebar layouts.` |
   | AG-UI | `AG-UI itinerary demo — Threadplane` | `Live Angular demo on an AG-UI backend: an agent plans a trip and edits a live itinerary and map while you watch. Streaming, client tools, and approvals.` |

   Both descriptions are under the 160-character snippet budget enforced by
   the website's `clampMetaDescription`.
4. **Approach: static head plus committed assets.** No Angular runtime
   metadata code. Crawlers and link unfurlers read the static head, not the
   post-bootstrap DOM, so runtime `Title`/`Meta` services would add nothing
   they see. Per-route runtime titles are explicitly out of scope.

## Section 1 — head metadata, icons, robots

### `src/index.html` (both demos)

After the viewport meta, in this order:

- `<meta name="description" content="…">` — the approved copy.
- `<link rel="canonical" href="https://<origin>/">` — one HTML file serves
  every route, so `/embed`, `/popup`, `/sidebar` and thread URLs all
  canonicalize to the root. That is the intent.
- `<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0f1116">`
  and `<meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff">`
  — the `--demo-page-bg` values in each demo's `styles.css`.
- Open Graph: `og:type` `website`, `og:site_name` `Threadplane`, `og:url`,
  `og:title`, `og:description`, `og:image` as an absolute URL
  `https://<origin>/social-card.png`, `og:image:width` `1200`,
  `og:image:height` `630`, `og:image:alt`.
- Twitter: `twitter:card` `summary_large_image`, `twitter:site`
  `@threadplane`, `twitter:creator` `@blovedev`, `twitter:title`,
  `twitter:description`, `twitter:image`, `twitter:image:alt`.
- Icons: `<link rel="icon" href="favicon.ico" sizes="32x32">` and
  `<link rel="icon" type="image/svg+xml" href="icon.svg">`. The existing
  `<link rel="icon" type="image/x-icon" …>` is replaced. No apple-touch-icon;
  this matches what the website ships.

The pre-bootstrap color-scheme script and the Material Symbols links are
untouched.

### `public/` (both demos)

- `favicon.ico` — replaced with a byte-for-byte copy of
  `apps/website/public/favicon.ico`.
- `icon.svg` — byte-for-byte copy of `apps/website/src/app/icon.svg`.
- `robots.txt` — `User-agent: *` / `Allow: /`. No sitemap line; a one-URL
  site does not need a sitemap and `sitemap.xml` is left to fall through
  like any other unknown path.
- `social-card.png` — the exported card (Section 2).

Nothing else in `public/` changes.

### Vercel route table

`scripts/assemble-demo.ts` and `scripts/assemble-ag-ui-demo.ts` currently
inline near-identical route tables. The table moves into
`scripts/demo-routes.ts`, exporting a function that takes the API route
source pattern and returns the full table:

```
[
  { src: '^/(hero|stage)(/.*)?$', headers: { 'X-Robots-Tag': 'noindex' }, continue: true },
  { src: <api pattern>, dest: '/api/[[...path]]', check: true },
  { handle: 'filesystem' },
  { src: '.*', dest: '/index.html' },
]
```

The AG-UI demo has no `/hero` or `/stage` routes; the shared table keeps the
two assemblers identical rather than special-casing one. The `headers` +
`continue: true` shape is the one `scripts/assemble-examples.ts` already uses.

`scripts/demo-routes.spec.ts` asserts the noindex pattern matches `/hero`,
`/stage`, `/hero/anything`, and does not match `/`, `/embed`, `/popup`,
`/sidebar`, or `/heroic`; and that both assemblers' API patterns produce a
table whose last two entries are the filesystem handle and the SPA fallback.

## Section 2 — social cards and the drift guard

### Single source of truth: `apps/website/src/lib/demo-meta.ts`

```ts
export interface DemoMeta {
  key: 'langgraph' | 'ag-ui';
  origin: string;            // from DEMOS in demos.ts — hrefs cannot drift
  title: string;             // <title>, og:title, twitter:title
  description: string;       // meta description, og:description, twitter:description
  cardEyebrow: string;       // e.g. 'LIVE DEMO'
  cardHeadlineLines: readonly string[];
  cardSubhead: string;
  runtimeLabel: string;      // Pills label: 'LangGraph' | 'AG-UI'
  cardAlt: string;           // og:image:alt / twitter:image:alt
}
export const DEMO_META: readonly DemoMeta[];
export const SOCIAL_CARD_PATH = '/social-card.png';
export const SOCIAL_CARD_SIZE = { width: 1200, height: 630 } as const;
```

The website owns the copy because it already owns positioning, the card
chrome, and the brand-asset guards. The demos' `index.html` files are static
and cannot import it, so the copy is duplicated there and guarded (below).

### Card routes

- `apps/website/src/app/demo-card/langgraph/route.tsx`
- `apps/website/src/app/demo-card/ag-ui/route.tsx`

Each is `dynamic = 'force-static'`, `runtime = 'nodejs'`, and returns
`renderDemoCard(meta)` from `apps/website/src/app/card/demo-card.tsx`. Static
so a Satori markup error fails `nx build website` rather than 500ing in
public, the lesson recorded on the existing card routes.

`renderDemoCard` lays out a 1200x630 card from the existing chrome: `Rail`
(eyebrow), headline lines in Archivo Black, subhead, `Pills` with the runtime
label, `Wordmark`, and a `Frame` on the right. No type below
`MIN_READABLE_PX`.

Chrome changes in `apps/website/src/app/card/chrome.tsx`:

- `Frame` gains an optional `url` prop, defaulting to the current hardcoded
  `demo.threadplane.ai`, so the AG-UI card shows `ag-ui.threadplane.ai`.
- New `Itinerary` component: a right-aligned user bubble asking for a trip,
  then three drawn day rows (day label, one activity line each) the agent
  filled in. Drawn, not screenshotted, for the readability reasons recorded
  on `Conversation`.

The LangGraph card frames `Conversation` (the approval loop, which that demo
really has). The AG-UI card frames `Itinerary`.

### Export script: `scripts/export-demo-cards.mjs`

Mirrors `scripts/export-github-card.mjs`:

- `--origin` flag, default `https://threadplane.ai`.
- Fetches `/demo-card/langgraph` and `/demo-card/ag-ui`.
- Verifies each response is a PNG whose IHDR reads 1200x630; exits non-zero
  with a readable message otherwise, including the connection-refused case.
- Writes `examples/chat/angular/public/social-card.png` and
  `examples/ag-ui/angular/public/social-card.png`.

`package.json` gains `"card:demos": "node scripts/export-demo-cards.mjs"`.
`docs/brand/README.md` gains a short section mirroring the GitHub card one.
The first export in this change runs against a local website serve, since
production does not have the routes until this lands; the committed PNGs are
what deploys.

### Guards (vitest, website project)

`apps/website/src/lib/demo-meta.spec.ts`:

- For each `DEMO_META` entry, read the demo's `src/index.html` from disk and
  assert `<title>`, `meta[name=description]`, `link[rel=canonical]`,
  `og:title`, `og:description`, `og:url`, `og:image` (= origin +
  `SOCIAL_CARD_PATH`), `og:image:width/height`, `og:image:alt`,
  `twitter:site`, `twitter:creator`, `twitter:image:alt` all equal the module.
- Assert `description === clampMetaDescription(description)` (fits the
  snippet budget without truncation).
- Assert each demo's `public/favicon.ico` is byte-identical to
  `apps/website/public/favicon.ico` and `public/icon.svg` to
  `apps/website/src/app/icon.svg`, so the Nx icon cannot creep back.
- Assert each demo's `public/robots.txt` exists and allows `/`.
- Assert each demo's `public/social-card.png` exists and its IHDR reads
  `SOCIAL_CARD_SIZE`.
- Mutation guard: `DEMO_META.length === 2`, so an emptied list cannot pass.

`apps/website/src/app/card/demo-card.spec.ts` mirrors `github-card.spec.ts`:
size constant, no `fontSize` below `MIN_READABLE_PX` in `demo-card.tsx` or
the new `Itinerary` chrome, and the route files import their copy from
`demo-meta.ts` rather than containing the title or description literals.

## Deployment

- Edits under `examples/chat/**`, `examples/ag-ui/**`, and the two assemble
  scripts all match the existing demo-deploy change gates in `ci.yml`, so
  both demos redeploy on merge. `scripts/demo-routes.ts` is a new file the
  gates do not name; it is only ever imported by the two assemblers, which
  change in the same commit, so this does not create a gap today. Adding it
  to both gate patterns is a one-line hardening included in this change.
- The website redeploys for the new routes and specs.
- Post-deploy verification: `curl -sI` on `/hero` shows the `X-Robots-Tag`
  header and `/` does not; `/robots.txt` returns `text/plain`; `/favicon.ico`
  hashes equal the website's; `/social-card.png` is 1200x630; the head
  carries the new tags.

## Out of scope

- Per-route runtime titles or metadata via Angular services.
- `apple-touch-icon` or a web manifest.
- A sitemap for a one-URL site.
- Removing the duplicate `app-mode-preview.jpg`; each demo's promo component
  uses its own copy.
- The cockpit examples at `examples.threadplane.ai`.
