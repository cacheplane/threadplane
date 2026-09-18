# Social Image Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace GitHub's generic auto-generated link card with a branded 1280x640 social preview built from the existing card kit, add X attribution to every page, and clear the retired brand colours still shipping on public npm pages.

**Architecture:** A new statically-rendered Next.js route composes the existing `app/card/chrome.tsx` primitives at GitHub's 1280x640 ratio. A Node script fetches that route and commits the PNG, which a maintainer uploads to repository settings (GitHub exposes no API for it). Separately, `brand-assets.spec.ts` gains a retired-hex scan that goes red before each colour sweep and green after it.

**Tech Stack:** Next.js App Router, `next/og` (Satori), vitest, Node 20 (`fetch`, `node:fs`).

**Spec:** `docs/superpowers/specs/2026-09-17-social-image-surfaces-design.md`

---

## Background the engineer needs

**Satori is not a browser.** The card is rendered by `next/og`, which runs Satori
over the JSX. Two rules bite constantly:

1. **Every element needs an explicit `display`.** A `div` with more than one
   child and no `display` is rejected at render time. `app/card/chrome.tsx`
   sets `display: 'flex'` on literally every node for this reason. Do the same.
2. **CSS variables do not resolve.** Satori cannot read `var(--color-accent)`.
   The palette is hand-copied into `app/card/tokens.ts`, and
   `app/card/card.spec.ts` asserts those literals still match `theme.css`.

**Render time vs build time.** A request-time route turns a Satori markup
mistake into a production 500. `blog/[slug]/opengraph-image.tsx` prerenders for
exactly this reason — the comment there records that a byline shipped broken
that way. The new route therefore sets `export const dynamic = 'force-static'`,
so a mistake fails `nx build website` instead of failing in public.

**Running the website tests.** The vitest config's `include` globs are relative
to `apps/website`, so a per-file filter only matches when you run from there:

```bash
cd apps/website && npx vitest run --config vite.config.mts src/lib/brand-assets.spec.ts
```

Running it from the repo root prints `No test files found` — that is the
working directory being wrong, not a missing test.

**Do not touch history.** `CHANGELOG.md` and roughly 40 files under
`docs/superpowers/` also contain the retired hex values. They are historical
records. The colour guard uses an explicit file list and must never become a
repo-wide scan.

---

## File Structure

**Created:**
- `apps/website/src/app/github-card/route.tsx` — the 1280x640 card. Composes `card/chrome.tsx`; owns only layout and copy selection.
- `apps/website/src/app/card/github-card.spec.ts` — constrains the card's size, copy sourcing and type floor.
- `scripts/export-github-card.mjs` — fetches the route, writes the PNG. No rendering logic of its own.
- `docs/brand/github-social-preview.png` — the committed artifact a maintainer uploads.
- `docs/brand/README.md` — the manual upload runbook.

**Modified:**
- `apps/website/src/lib/site-metadata.ts` — two handle constants; `createPageMetadata` emits them.
- `apps/website/src/app/layout.tsx:66-71` — root `twitter` block emits them.
- `apps/website/src/lib/site-metadata.spec.ts` — attribution assertions.
- `apps/website/src/lib/brand-assets.spec.ts` — the retired-hex scan.
- `README.md` + 6 library READMEs — badge palette.
- `apps/website/public/assets/hero.svg`, `arch-diagram.svg`, 3 files under `public/blog/diagrams/` — retired navy.
- `package.json` — the `card:github` script.

---

## Task 1: X attribution on every card

**Files:**
- Modify: `apps/website/src/lib/site-metadata.ts`
- Modify: `apps/website/src/app/layout.tsx:66-71`
- Test: `apps/website/src/lib/site-metadata.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/website/src/lib/site-metadata.spec.ts`:

```ts
describe('X attribution', () => {
  /**
   * Without these, X renders the card with no attribution byline at all —
   * the link reads as unowned. They live in site-metadata rather than being
   * typed into layout.tsx so the root layout and every createPageMetadata
   * page cannot disagree about who publishes the card.
   */
  it('names the brand account and the author', () => {
    expect(SITE_X_SITE).toBe('@threadplane');
    expect(SITE_X_CREATOR).toBe('@blovedev');
  });

  it('puts both on every page built by createPageMetadata', () => {
    const meta = createPageMetadata({
      title: 'Test',
      description: 'Test description.',
      pathname: '/test',
    });

    expect(meta.twitter).toMatchObject({
      card: 'summary_large_image',
      site: SITE_X_SITE,
      creator: SITE_X_CREATOR,
    });
  });
});
```

Add `SITE_X_SITE` and `SITE_X_CREATOR` to the existing import of
`./site-metadata` at the top of that spec file.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/website && npx vitest run --config vite.config.mts src/lib/site-metadata.spec.ts
```

Expected: FAIL. The import of `SITE_X_SITE` is undefined, so the first
assertion reports `expected undefined to be '@threadplane'`.

- [ ] **Step 3: Add the constants**

In `apps/website/src/lib/site-metadata.ts`, directly below `export const SITE_NAME = 'Threadplane';`:

```ts
/**
 * X attribution. `site` is the account that owns the card, `creator` the
 * human byline. Both are needed: with neither set, X renders the card with no
 * attribution row, which is what every threadplane.ai link did until now.
 */
export const SITE_X_SITE = '@threadplane';
export const SITE_X_CREATOR = '@blovedev';
```

- [ ] **Step 4: Emit them from `createPageMetadata`**

In the `twitter` block of `createPageMetadata` (around line 162), add the two
fields:

```ts
    twitter: {
      card: 'summary_large_image',
      site: SITE_X_SITE,
      creator: SITE_X_CREATOR,
      title,
      description,
      images: [image ?? DEFAULT_SOCIAL_IMAGE_META],
    },
```

- [ ] **Step 5: Emit them from the root layout**

In `apps/website/src/app/layout.tsx`, add `SITE_X_CREATOR` and `SITE_X_SITE` to
the existing import from `../lib/site-metadata`, then update the `twitter`
block (lines 66-71):

```ts
  twitter: {
    card: 'summary_large_image',
    site: SITE_X_SITE,
    creator: SITE_X_CREATOR,
    title: 'Threadplane',
    description: LONG_SUBHEAD,
    images: [DEFAULT_SOCIAL_IMAGE_META],
  },
```

- [ ] **Step 6: Run the tests**

```bash
cd apps/website && npx vitest run --config vite.config.mts src/lib/site-metadata.spec.ts
```

Expected: PASS, including both new tests.

- [ ] **Step 7: Commit**

```bash
git add apps/website/src/lib/site-metadata.ts apps/website/src/lib/site-metadata.spec.ts apps/website/src/app/layout.tsx
git commit -m "feat(website): attribute social cards to @threadplane and @blovedev"
```

---

## Task 2: Retired-colour guard, and the README badge sweep

The guard is introduced here covering only the README files, then extended in
Tasks 3 and 4 as each further group is swept. That keeps the suite green at
every commit while still writing the failing test first each time.

**Files:**
- Modify: `apps/website/src/lib/brand-assets.spec.ts`
- Modify: `README.md`, `libs/a2ui/README.md`, `libs/ag-ui/README.md`, `libs/chat/README.md`, `libs/langgraph/README.md`, `libs/render/README.md`, `libs/telemetry/README.md`

- [ ] **Step 1: Write the failing guard**

Append to `apps/website/src/lib/brand-assets.spec.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd apps/website && npx vitest run --config vite.config.mts src/lib/brand-assets.spec.ts
```

Expected: FAIL, 7 of the new cases red. `README.md still uses: 6C8EFF, 080B14`
and the same for each library README.

- [ ] **Step 3: Sweep the badge palette**

`6C8EFF` is the shields.io fill colour and `080B14` the label colour. Replace
with scope navy and ink — both real tokens in
`libs/design-tokens/src/lib/theme.css` (`--color-scope`, `--color-ink`).
White shields text sits legibly on navy; signal yellow `#FFAF00` is 1.84:1 on
white and is fill-only by the project's own accent rule, so it is not a
candidate here.

From the repository root:

```bash
sed -i '' 's/6C8EFF/15253E/g; s/080B14/0A0A0A/g' \
  README.md \
  libs/a2ui/README.md \
  libs/ag-ui/README.md \
  libs/chat/README.md \
  libs/langgraph/README.md \
  libs/render/README.md \
  libs/telemetry/README.md
```

Expected replacement counts, as a check that nothing was missed: 3 of each in
every file except `libs/a2ui/README.md`, which has 2 of each.

- [ ] **Step 4: Run the guard to verify it passes**

```bash
cd apps/website && npx vitest run --config vite.config.mts src/lib/brand-assets.spec.ts
```

Expected: PASS, all cases green.

- [ ] **Step 5: Eyeball one badge row**

Open `README.md` and confirm the badge row still reads as a row — same badges,
same order, navy fill. `sed` cannot break the markup here, but a colour change
is the kind of thing a test can call correct while it looks wrong.

- [ ] **Step 6: Commit**

```bash
git add apps/website/src/lib/brand-assets.spec.ts README.md libs/*/README.md
git commit -m "fix(brand): repaint README badges in scope navy, and guard the retired hex"
```

---

## Task 3: The SVG navy sweep

`hero.svg` is the README banner; the three blog diagrams are published on the
website. All four use `#004090`, a navy that is not a design token.

**Files:**
- Modify: `apps/website/public/assets/hero.svg` (2 occurrences)
- Modify: `apps/website/public/blog/diagrams/ag-ui-event-flow.svg` (7)
- Modify: `apps/website/public/blog/diagrams/agent-contract-boundary.svg` (4)
- Modify: `apps/website/public/blog/diagrams/langgraph-threads-and-runs.svg` (4)
- Test: `apps/website/src/lib/brand-assets.spec.ts`

- [ ] **Step 1: Extend the guard's list (the failing test)**

In `apps/website/src/lib/brand-assets.spec.ts`, add four entries to
`COLOUR_SCANNED_ASSETS`, after the library READMEs:

```ts
  'apps/website/public/assets/hero.svg',
  'apps/website/public/blog/diagrams/ag-ui-event-flow.svg',
  'apps/website/public/blog/diagrams/agent-contract-boundary.svg',
  'apps/website/public/blog/diagrams/langgraph-threads-and-runs.svg',
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd apps/website && npx vitest run --config vite.config.mts src/lib/brand-assets.spec.ts
```

Expected: FAIL, 4 new cases red with `still uses: 004090`.

- [ ] **Step 3: Sweep**

From the repository root:

```bash
sed -i '' 's/#004090/#15253E/g' \
  apps/website/public/assets/hero.svg \
  apps/website/public/blog/diagrams/ag-ui-event-flow.svg \
  apps/website/public/blog/diagrams/agent-contract-boundary.svg \
  apps/website/public/blog/diagrams/langgraph-threads-and-runs.svg
```

Then confirm nothing survived in another case form:

```bash
grep -ri 004090 apps/website/public | cat
```

Expected: no output.

- [ ] **Step 4: Run the guard to verify it passes**

```bash
cd apps/website && npx vitest run --config vite.config.mts src/lib/brand-assets.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Look at all four SVGs**

Open each file in a browser or preview pane. These are diagrams: navy is
darker than the blue it replaces, so check that any white or light text sitting
**on** a filled shape is still legible, and that a stroke used to separate two
elements has not gone so dark it reads as a border. If any single diagram looks
wrong, fix that file's specific shapes rather than reverting the sweep.

`hero.svg` in particular is the README banner and sits directly above the
badge row changed in Task 2 — check the two now agree.

- [ ] **Step 6: Commit**

```bash
git add apps/website/src/lib/brand-assets.spec.ts apps/website/public/assets/hero.svg apps/website/public/blog/diagrams
git commit -m "fix(brand): move the banner and blog diagrams onto token navy"
```

---

## Task 4: Re-theme the architecture diagram

**Revised mid-execution.** The plan originally specified a colour substitution
here, the same as Task 3. Rendering the file first proved that wrong, and the
revision is recorded rather than quietly swapped in.

`arch-diagram.svg` is the only dark asset in the repository: a full-bleed
`#080B14` ground carrying `#6C8EFF` accents (9 strokes, 7 text fills),
`#4A527A` muted text and `#EEF1FF` headings. A flat `6C8EFF` -> `15253E`
would have painted every accent dark navy **on a near-black ground** and left
the diagram unreadable — and the colour guard would have passed, because it
only asserts that retired hex is absent.

It is also the odd one out. The three diagrams swept in Task 3 are light, so
is `hero.svg` directly above it in the README, so is the card kit, so is the
site. This task re-themes it onto that same light ground.

**Files:**
- Modify: `apps/website/public/assets/arch-diagram.svg`
- Test: `apps/website/src/lib/brand-assets.spec.ts`

- [ ] **Step 1: Extend the guard's list (the failing test)**

Add one entry to `COLOUR_SCANNED_ASSETS`:

```ts
  'apps/website/public/assets/arch-diagram.svg',
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd apps/website && npx vitest run --config vite.config.mts src/lib/brand-assets.spec.ts
```

Expected: FAIL, one new case: `still uses: 6C8EFF, 080B14`.

- [ ] **Step 3: Adopt the sibling diagrams' design system**

`apps/website/public/blog/diagrams/agent-contract-boundary.svg` is the
reference. Read it first. It establishes the whole vocabulary, and this task
is to bring `arch-diagram.svg` into it rather than to invent anything:

| Role | Value |
|------|-------|
| Card ground / box fill | `#ffffff` |
| Outer border | `#e5e5e5`, `rx="12"` |
| Box border | `#d4d4d4`, `rx="8"` |
| Highlighted box fill | `#f2f5f9` with `#c3d1e2` border |
| Eyebrow text | `#737373`, 11.5px, weight 700, `letter-spacing: 0.09em` |
| Heading text | `#1c1c1c`, 17px, weight 600 |
| Box title (mono) | `#1c1c1c`, 15px, weight 600 |
| Meta text | `#464646`, 13px |
| Edge label | `#15253E`, 12.5px, weight 600 |
| Connector stroke | `#15253E`, `stroke-width: 1.7` |
| Caption | `#737373`, 13px |
| De-emphasized rail | `#a3a3a3` |

Those files define these once in a `<style>` block as classes (`.t-eyebrow`,
`.t-head`, `.t-title`, `.t-meta`, `.t-edge`, `.t-caption`, `.edge`) rather
than repeating literals per element. Do the same — the current file repeats
`fill="#4A527A"` thirteen times, which is how it drifted.

Fonts are generic stacks (`system-ui`, `ui-mono`), never the site's webfonts:
GitHub serves this as a bare image and no stylesheet of ours ever loads.

**Preserve the diagram's meaning exactly.** Every box, label, arrow, dashed
reactive-update edge and the legend must survive with the same text and the
same topology. This is a re-theme, not a redraw — if you find yourself
changing what the diagram *says*, stop and report.

Two specifics carried over from the dark version:
- The solid-vs-dashed distinction (`call / dispatch` vs `reactive update`)
  is semantic and must remain legible as two distinct edge styles.
- `agent()` is the emphasized node. On the light ground use the `#f2f5f9` /
  `#c3d1e2` highlighted-box treatment the sibling diagrams use for their
  emphasized node, not a colour the others do not use.

- [ ] **Step 4: Run the guard to verify it passes**

```bash
cd apps/website && npx vitest run --config vite.config.mts src/lib/brand-assets.spec.ts
```

Expected: PASS, all cases green.

- [ ] **Step 5: Report for visual review**

You cannot see this render and the controller will check it. Report: the
final colour census (`grep -ohE '#[0-9a-fA-F]{6}' <file> | sort | uniq -c`),
confirmation that every value in it appears in the table above, and a list of
anything you changed beyond colour and the `<style>` refactor.

- [ ] **Step 6: Commit**

```bash
git add apps/website/src/lib/brand-assets.spec.ts apps/website/public/assets/arch-diagram.svg
git commit -m "fix(brand): re-theme the architecture diagram onto the light ground"
```

---

## Task 5: The GitHub card route

**Files:**
- Create: `apps/website/src/app/github-card/route.tsx`
- Test: `apps/website/src/app/card/github-card.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/website/src/app/card/github-card.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIN_READABLE_PX } from './tokens';
import { GITHUB_CARD_SIZE, alt } from '../github-card/route';
import { HERO_SUBHEAD, PRIMARY_TAGLINE } from '../../lib/positioning';

const ROUTE = join(__dirname, '..', 'github-card', 'route.tsx');

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

  /** A card with no alt text is a card no screen reader can announce. */
  it('describes what the card shows', () => {
    expect(alt).toContain(PRIMARY_TAGLINE);
    expect(alt.length).toBeGreaterThan(80);
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
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd apps/website && npx vitest run --config vite.config.mts src/app/card/github-card.spec.ts
```

Expected: FAIL — the import of `../github-card/route` cannot be resolved.

- [ ] **Step 3: Write the route**

Create `apps/website/src/app/github-card/route.tsx`:

```tsx
/**
 * The repository's GitHub Social Preview card.
 *
 * GitHub serves an auto-generated card — avatar, repo name, description, star
 * count — for any repository with no preview image uploaded. That generic card
 * is what a link to this repo rendered as on X, and no amount of website
 * metadata changes it: GitHub's og:image points at its own renderer, and it
 * never reads the README's banner.
 *
 * There is no API for the upload. `scripts/export-github-card.mjs` writes this
 * route's output to docs/brand/github-social-preview.png and a maintainer
 * uploads it by hand (see docs/brand/README.md).
 *
 * Built from the same primitives as the feed card in `../opengraph-image.tsx`,
 * so the two cannot drift into two different brands. It is not a resized copy
 * of it — see the ratio and type notes below.
 */
import { ImageResponse } from 'next/og';
import { HERO_H1_LINES, HERO_SUBHEAD, POSITIONING_PROOF_POINTS, PRIMARY_TAGLINE } from '../../lib/positioning';
import { loadCardFonts } from '../og-font';
import { CARD } from '../card/tokens';
import { Conversation, Frame, Pills, Rail, Wordmark } from '../card/chrome';

/**
 * Static, so a Satori markup error fails `nx build website` instead of
 * 500ing in public — the lesson recorded in blog/[slug]/opengraph-image.tsx.
 */
export const dynamic = 'force-static';
export const runtime = 'nodejs';

/** GitHub's documented social preview size. */
export const GITHUB_CARD_SIZE = { width: 1280, height: 640 } as const;

const RUNTIMES = POSITIONING_PROOF_POINTS[0].label;
const EYEBROW = 'OPEN SOURCE · ANGULAR';

export const alt = `${PRIMARY_TAGLINE}. ${HERO_SUBHEAD} Beside the copy, a browser frame shows the product pausing for a human: an agent proposes deleting three backups, with Approve and Decline. Works with ${RUNTIMES}.`;

export async function GET() {
  const fonts = await loadCardFonts({ mono: true });

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          background: CARD.ground,
          fontFamily: 'Archivo, sans-serif',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* 1280x640 is 2.0:1, where the feed card is 1.905:1. Some clients
            crop a 2:1 preview back toward 1.91:1, which takes roughly 12px
            off the top and bottom. The vertical padding absorbs that: the
            extra height over the feed card goes to margin, not to content. */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: 660,
            padding: '68px 0 68px 72px',
            justifyContent: 'center',
          }}
        >
          <Rail text={EYEBROW} />
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              marginTop: 22,
              fontFamily: 'Archivo Black, sans-serif',
              fontSize: 62,
              lineHeight: 1.04,
              letterSpacing: '-0.02em',
              color: CARD.ink,
            }}
          >
            {HERO_H1_LINES.map((line) => (
              <div key={line} style={{ display: 'flex' }}>
                {line}
              </div>
            ))}
          </div>
          {/* The column is centred in a fixed-height card, so copy that runs
              one line long collides with the pills below rather than pushing
              them down. 560 is the widest the 660px column's 72px left
              padding allows and holds the subhead to three lines. */}
          <div style={{ display: 'flex', marginTop: 20, fontSize: 21, lineHeight: 1.45, color: CARD.inkSecondary, maxWidth: 560 }}>
            {HERO_SUBHEAD}
          </div>
          <div style={{ display: 'flex', marginTop: 26 }}>
            <Pills runtimes={RUNTIMES} />
          </div>
          <div style={{ display: 'flex', marginTop: 30 }}>
            <Wordmark />
          </div>
        </div>

        {/* Absolutely positioned so the frame keeps its size whatever the
            copy does. */}
        <div style={{ display: 'flex', position: 'absolute', top: 152, left: 726 }}>
          <Frame width={490}>
            <Conversation />
          </Frame>
        </div>
      </div>
    ),
    { ...GITHUB_CARD_SIZE, fonts },
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/website && npx vitest run --config vite.config.mts src/app/card/github-card.spec.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Verify it actually renders**

A passing spec here proves the route's *shape*, not that Satori accepts the
markup. Build the site:

```bash
npx nx build website
```

Expected: build succeeds. A Satori rejection surfaces here as a build error
naming the route — if it does, the cause is almost always an element with more
than one child and no explicit `display`.

- [ ] **Step 6: Look at the card**

```bash
npx nx serve website
```

Open `http://localhost:3000/github-card`. Check, at 100% and again zoomed out
to roughly a third: the three headline lines do not collide with the subhead,
the subhead holds three lines and does not overlap the pills, the browser
frame is fully inside the canvas on all sides, and nothing important sits
within ~12px of the top or bottom edge.

Stop the server when done.

- [ ] **Step 7: Commit**

```bash
git add apps/website/src/app/github-card/route.tsx apps/website/src/app/card/github-card.spec.ts
git commit -m "feat(website): add the 1280x640 GitHub social preview card"
```

---

## Task 6: Export the PNG

**Files:**
- Create: `scripts/export-github-card.mjs`
- Create: `docs/brand/github-social-preview.png`
- Modify: `package.json`

- [ ] **Step 1: Write the script**

Create `scripts/export-github-card.mjs`:

```js
/**
 * Writes the GitHub Social Preview PNG that a maintainer uploads by hand.
 *
 * GitHub exposes no API for the social preview — not REST, not GraphQL — so
 * this is as far as automation reaches. The PNG is committed so the exact
 * bytes destined for the repository settings are reviewable in a diff, and so
 * regenerating after a brand change produces a visible change rather than a
 * silent one.
 *
 * Usage:
 *   node scripts/export-github-card.mjs
 *   node scripts/export-github-card.mjs --origin http://localhost:3000
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = join(REPO_ROOT, 'docs', 'brand', 'github-social-preview.png');
const DEFAULT_ORIGIN = 'https://threadplane.ai';

/** GitHub's documented size. Mirrors GITHUB_CARD_SIZE in the route. */
const EXPECTED = { width: 1280, height: 640 };

function parseOrigin(argv) {
  const at = argv.indexOf('--origin');
  return at === -1 ? DEFAULT_ORIGIN : argv[at + 1];
}

/**
 * Reads width and height out of the PNG's IHDR chunk, which is always the
 * first chunk: 8 bytes of signature, 4 of length, 4 of type, then the two
 * big-endian 32-bit dimensions. Guards against committing a card the route
 * silently resized, and against writing an HTML error page as a .png.
 */
function readPngSize(buffer) {
  const isPng = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!isPng) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

const origin = parseOrigin(process.argv.slice(2));
const url = new URL('/github-card', origin).toString();

const response = await fetch(url);
if (!response.ok) {
  console.error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  process.exit(1);
}

const buffer = Buffer.from(await response.arrayBuffer());
const size = readPngSize(buffer);

if (!size) {
  console.error(`${url} did not return a PNG. Got content-type: ${response.headers.get('content-type')}`);
  process.exit(1);
}

if (size.width !== EXPECTED.width || size.height !== EXPECTED.height) {
  console.error(
    `${url} returned ${size.width}x${size.height}, expected ${EXPECTED.width}x${EXPECTED.height}.`,
  );
  process.exit(1);
}

await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, buffer);

console.log(`Wrote ${OUTPUT} (${size.width}x${size.height}, ${buffer.length} bytes) from ${url}`);
console.log('');
console.log('GitHub has no API for this. Upload it by hand:');
console.log('  1. https://github.com/cacheplane/threadplane/settings');
console.log('  2. General -> Social preview -> Edit -> Upload an image');
console.log('  3. Select docs/brand/github-social-preview.png');
console.log('');
console.log('Then confirm with:');
console.log('  curl -sL https://github.com/cacheplane/threadplane | grep \'og:image\"\'');
console.log('Expect a repository-images.githubusercontent.com URL, not opengraph.githubassets.com.');
```

- [ ] **Step 2: Add the npm script**

In `package.json`, inside `scripts`, next to the other `generate-*` entries:

```json
    "card:github": "node scripts/export-github-card.mjs",
```

- [ ] **Step 3: Run it against a local server**

In one terminal:

```bash
npx nx serve website
```

In another, from the repository root:

```bash
npm run card:github -- --origin http://localhost:3000
```

Expected: `Wrote .../docs/brand/github-social-preview.png (1280x640, <n> bytes)`
followed by the upload instructions. Stop the server.

- [ ] **Step 4: Prove the guards work**

Confirm the size and content-type checks are not decorative:

```bash
npm run card:github -- --origin http://localhost:9999
```

Expected: a non-zero exit with a fetch failure, not a written file.

```bash
npm run card:github -- --origin https://threadplane.ai
```

Expected: this **fails** with a 404 until the route is deployed. That is the
correct behaviour and confirms the response check works — the committed PNG
stays the local one for now.

- [ ] **Step 5: Look at the PNG**

Open `docs/brand/github-social-preview.png`. It is what everyone who shares
this repository will see. Confirm it matches what you approved in Task 5 and
that nothing is clipped at the edges.

- [ ] **Step 6: Commit**

```bash
git add scripts/export-github-card.mjs package.json docs/brand/github-social-preview.png
git commit -m "feat(brand): export the GitHub social preview PNG"
```

---

## Task 7: The upload runbook

The one step no code can take. Without written instructions this becomes
folklore, and the next brand change silently leaves the old card in place.

**Files:**
- Create: `docs/brand/README.md`

- [ ] **Step 1: Write the runbook**

Create `docs/brand/README.md`:

````markdown
# Brand assets

## `github-social-preview.png`

The card every link to this repository renders as — on X, LinkedIn, Slack,
Discord, iMessage and Teams. Generated from `/github-card` on the website, so
it stays in step with the social card kit rather than being a separate design.

**GitHub exposes no API for the social preview.** Not REST, not GraphQL. The
upload is manual, and it is the only manual step in this pipeline.

### Regenerating

```bash
npm run card:github                                  # from production
npm run card:github -- --origin http://localhost:3000  # from a local serve
```

The script refuses to write anything that is not a 1280x640 PNG, so a 404 or
an error page cannot be committed as a card.

### Uploading

1. Open <https://github.com/cacheplane/threadplane/settings>
2. General -> Social preview -> Edit -> Upload an image
3. Select `docs/brand/github-social-preview.png`

### Verifying

```bash
curl -sL https://github.com/cacheplane/threadplane | grep 'og:image"'
```

A `repository-images.githubusercontent.com` URL means the upload took. An
`opengraph.githubassets.com` URL means GitHub is still serving its generic
auto-generated card.

Then check the real thing, because X and LinkedIn cache aggressively:

- <https://cards-dev.twitter.com/validator>
- <https://www.linkedin.com/post-inspector/>

### When to redo it

Any change to `apps/website/src/app/card/`, to the positioning copy in
`apps/website/src/lib/positioning.ts`, or to the brand palette. Regenerate,
review the PNG, commit it, and upload again — the uploaded copy does not
update itself.
````

- [ ] **Step 2: Commit**

```bash
git add docs/brand/README.md
git commit -m "docs(brand): document the manual GitHub social preview upload"
```

---

## Task 8: Full verification

**Files:** none modified.

- [ ] **Step 1: Run the full website suite**

```bash
cd apps/website && npx vitest run --config vite.config.mts
```

Expected: all green. If something unrelated is red, check the branch and that
`npm ci` has been run in this worktree before treating it as a regression.

- [ ] **Step 2: Build**

```bash
npx nx build website
```

Expected: success. `nx test` and `nx lint` do **not** typecheck this app — only
the build does — so this step is the one that catches a type error in the new
route.

- [ ] **Step 3: Lint**

```bash
npx nx lint website
```

Expected: no errors. Warnings are pre-existing and are not a gate.

- [ ] **Step 4: Confirm the retired hex is gone from shipping assets**

```bash
grep -rniE "6C8EFF|080B14|004090" README.md libs/*/README.md apps/website/public | cat
```

Expected: no output. Hits under `docs/` or in `CHANGELOG.md` are historical
and intentionally untouched.

- [ ] **Step 5: Confirm attribution is served**

```bash
npx nx serve website
curl -s http://localhost:3000 | grep -oE '<meta name="twitter:(site|creator)"[^>]*>'
```

Expected: both meta tags, `@threadplane` and `@blovedev`. Stop the server.

- [ ] **Step 6: Hand off the manual steps**

These cannot be completed by the implementing engineer and must be stated
plainly in the PR description rather than implied as done:

1. **Verify `@threadplane` is a real account you control.** X serves a
   JavaScript shell to logged-out fetches, so this could not be confirmed
   programmatically. If the handle is not ours, change `SITE_X_SITE` in
   `apps/website/src/lib/site-metadata.ts` before merging — a card with a dead
   attribution link is worse than one with none.
2. **After deploy, regenerate from production** — `npm run card:github` — and
   confirm the committed PNG is unchanged.
3. **Upload the PNG** per `docs/brand/README.md`.
4. **Post a link to the repository on X** and confirm the branded card renders.
   Until that happens, this work is not done: the card served to the public is
   still GitHub's generic one.
