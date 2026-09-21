# Mobile Above-the-Fold Hero Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the threadplane.ai homepage hero legible and persuasive on a 375x812 phone — a three-line H1 that names Angular, a demo that autoplays and is not sliced, and Angular in the `<title>`.

**Architecture:** Copy is single-sourced in `positioning.ts` and changed only there. The four-line H1 is fixed in CSS by overriding the shared `clamp(48px, 6vw, 72px)` token floor on `.hero-heading` and letting the line spans flow at phone width. Mobile autoplay is a one-constant change in `HeroDemo.tsx`. The sliced poster is re-recorded with a new top-edge guard in its recorder so the drift cannot recur silently.

**Tech Stack:** Next.js (App Router) + React, Nx, Vitest (`@nx/vitest`), Playwright, Satori (`next/og`) for card images, `sharp` for poster resizing.

**Spec:** `docs/superpowers/specs/2026-09-18-mobile-above-fold-design.md`

---

## File Structure

| File | Change | Responsibility |
| --- | --- | --- |
| `apps/website/src/lib/positioning.ts` | Modify | The only home for homepage copy |
| `apps/website/src/lib/positioning.spec.ts` | Modify | Pins the exact hero strings |
| `apps/website/src/lib/site-metadata.spec.ts` | Modify | Pins the tagline used site-wide |
| `apps/website/src/components/landing/Hero.spec.tsx` | Verify | Reads copy from positioning; should need no edit |
| `apps/website/src/app/card/card.spec.ts` | Verify | Asserts alt *contains* the tagline; should need no edit |
| `apps/website/src/styles/landing.css` | Modify | Phone type ramp + span flow |
| `apps/website/src/components/landing/HeroDemo.tsx` | Modify | Autoplay gate + coupling comments |
| `apps/website/e2e/home-hero.spec.ts` | Modify | Inverts the mobile gate test; adds the fold guard |
| `examples/chat/angular/e2e/record-hero-poster-mobile.record.ts` | Modify | Adds the top-edge guard, then re-records |
| `apps/website/public/screenshots/hero-walkthrough-poster-mobile.webp` | Regenerate | The mobile LCP still |
| `apps/website/e2e/website.spec.ts` | Modify | Hard-codes the H1 and guards "Angular" on the eyebrow |
| `apps/website/src/lib/site-metadata.ts` | Modify | Hand-duplicated tagline in the site-wide OG alt |
| `apps/website/src/app/opengraph-image.tsx` | Modify | Card eyebrow, now duplicating the H1 |
| `apps/website/src/app/github-card/route.tsx` | Modify | Card eyebrow, now duplicating the H1 |
| `docs/gtm/messaging.md`, `gtm.md`, `README.md` | Modify | Record the shipped hero, resolving the drift |

Tasks 1–7 are ordered so the suite is green at every commit.

---

### Task 1: Hero copy in positioning.ts

**Files:**
- Modify: `apps/website/src/lib/positioning.ts:5-7`, `:46`
- Test: `apps/website/src/lib/positioning.spec.ts:49-65`

- [x] **Step 1: Update the failing test first**

In `apps/website/src/lib/positioning.spec.ts`, replace the first two `it` blocks
of `describe('positioning: hero copy')` with:

```ts
  it('names the exact category in eyebrow, H1, title and description', () => {
    expect(HERO_EYEBROW).toBe('LangGraph & AG-UI');
    expect(HERO_H1).toBe('The open-source thread-plane for Angular agents.');
    expect(HERO_SUBHEAD).toBe(
      'Make agent work persistent, durable, visible, reviewable, and resumable.',
    );
    expect(HOME_TITLE).toBe('Threadplane — The open-source thread-plane for Angular agents');
    expect(HOME_DESCRIPTION).toBe(
      'The open-source thread-plane for agents: chat, durable threads, persistence, human approvals, and generative UI for Angular, on LangGraph and AG-UI.',
    );
    expect(HOME_DESCRIPTION.length).toBeLessThanOrEqual(160);
  });

  it('H1 lines join back to HERO_H1 on three lines that fit the card columns', () => {
    expect(HERO_H1_LINES).toHaveLength(3);
    expect(HERO_H1_LINES.join(' ')).toBe(HERO_H1);
    // Pinned exactly, because this array is also the line-breaking for
    // opengraph-image.tsx and github-card/route.tsx, whose H1 columns are
    // ~536px and ~588px at 60px and 62px Archivo Black. Canvas-measured at 60px
    // with -0.02em tracking: 538 / 513 / 507px. The cards are centred at fixed
    // height, so a line that overflows collides with the pills below rather
    // than pushing them down.
    //
    // Pinned rather than computed: character count is NOT a proxy for width
    // here — 'thread-plane for' is one character longer than 'The open-source'
    // and 25px narrower. Re-measure in Archivo Black before changing a line.
    expect(HERO_H1_LINES).toEqual([
      'The open-source',
      'thread-plane for',
      'Angular agents.',
    ]);
  });
```

`HOME_DESCRIPTION` is deliberately unchanged: it already contains "Angular" and
sits within its 160-character budget.

- [x] **Step 2: Run the test to verify it fails**

Run: `npx nx test website -- positioning.spec`

Expected: FAIL, with `expected 'Angular · LangGraph & AG-UI' to be 'LangGraph & AG-UI'`.

- [x] **Step 3: Change the copy**

In `apps/website/src/lib/positioning.ts`, replace lines 5–12 (`HERO_EYEBROW`
through the `HERO_H1_LINES` declaration) with:

```ts
export const HERO_EYEBROW = 'LangGraph & AG-UI';
export const HERO_H1 = 'The open-source thread-plane for Angular agents.';
/**
 * The H1 broken where it is meant to break: three lines, one thought each.
 * HERO_H1 stays the single source of truth — positioning.spec.ts asserts the
 * lines join back to it with single spaces, so the rendered heading, the
 * <title> and the social card cannot drift apart.
 *
 * The split is load-bearing for two generated images: opengraph-image.tsx and
 * github-card/route.tsx stack these as fixed lines at 60px and 62px. Measured
 * in Archivo Black at 60px with -0.02em tracking: 538 / 513 / 507px against a
 * ~536px column. "The open-source" is the widest and already shipped before
 * "Angular" was added, so the worst case did not move. Below 767px the spans
 * are flowed inline (landing.css) and the browser breaks the sentence instead.
 */
export const HERO_H1_LINES: readonly string[] = [
  'The open-source',
  'thread-plane for',
  'Angular agents.',
];
```

Then change line 46 (`PRIMARY_TAGLINE`) to:

```ts
export const PRIMARY_TAGLINE = 'Threadplane — The open-source thread-plane for Angular agents';
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npx nx test website -- positioning.spec`

Expected: PASS.

- [x] **Step 5: Fix the site-metadata spec**

`site-metadata.spec.ts:23` and `:70` hard-code the old tagline. Change both
occurrences of:

```ts
'Threadplane — The open-source thread-plane for agents'
```

to:

```ts
'Threadplane — The open-source thread-plane for Angular agents'
```

Leave `expect(LONG_SUBHEAD).toContain('open-source thread-plane for agents')`
alone — `LONG_SUBHEAD` is unchanged and still contains that phrase.

- [x] **Step 6: Run the full website unit suite**

Run: `npx nx test website`

Expected: PASS. `Hero.spec.tsx` and `card/card.spec.ts` read their strings from
`positioning`, so they should pass untouched. If either fails, it hard-coded a
string — fix the hard-coding, do not revert the copy.

- [x] **Step 7: Check for the generated-file rewrite, then commit**

`nx test` rewrites a generated package-version file. Check before staging:

```bash
git status --short
```

If `libs/*/src/lib/package-version.ts` (or similar) appears, revert it:

```bash
git checkout -- $(git diff --name-only -- '*package-version.ts')
```

Then commit only the four intended files:

```bash
git add apps/website/src/lib/positioning.ts apps/website/src/lib/positioning.spec.ts apps/website/src/lib/site-metadata.spec.ts
git commit -m "copy(website): name Angular in the hero H1 and the title"
```

---

### Task 2: Phone type ramp

**Files:**
- Modify: `apps/website/src/styles/landing.css` (after the `.hero-heading-line` rule, ~line 29)

- [x] **Step 1: Add the media query**

Insert immediately after the existing `.hero-heading-line { display: block; }`
rule:

```css
/* Phone width. Two coupled parts, both required:
 *
 * 1. font-size. --text-h1 is `clamp(48px, 6vw, 72px)` in the shared
 *    design-tokens theme. At 375px, 6vw is 22.5px, so the clamp FLOOR of 48px
 *    is what renders — at which "thread-plane" alone nearly fills the 335px
 *    column. The token is shared by many pages, so the override lives here on
 *    .hero-heading rather than in the token.
 * 2. display: inline. The spans are the desktop and social-card line-breaking.
 *    Left as blocks at phone width they put "The open-source" on a line of its
 *    own, which then wraps again — that is the four-line, 207px H1 this fixes.
 *    Flowed, the browser breaks the sentence to the column: three lines, 117px.
 *
 * Measured at 375x812: 4 lines / 207px before, 3 lines / 117px after. The 90px
 * reclaimed is 11% of the fold, and e2e/home-hero.spec.ts budgets it absolutely.
 */
@media (max-width: 767px) {
  .hero-heading {
    font-size: 36px;
    line-height: 1.08;
  }
  .hero-heading-line {
    display: inline;
  }
}
```

These rules must stay **unlayered** like the rest of the file — see the file
header. Do not wrap them in `@layer`.

- [x] **Step 2: Verify in a real browser at 375x812**

Start the dev server and measure. Do not judge by eye alone, and per
`feedback_cold_next_dev_drops_fragment_scroll`, load the route once to warm it
before measuring.

Run: `npx nx serve website`

Then in a browser at exactly 375x812, on `/`, evaluate:

```js
const h = document.querySelector('.hero-heading');
const d = document.querySelector('[data-hero-demo]');
JSON.stringify({
  fontSize: getComputedStyle(h).fontSize,
  h1Height: h.getBoundingClientRect().height,
  demoTop: d.getBoundingClientRect().top + window.scrollY,
});
```

Expected: `fontSize: "36px"`, `h1Height` about 117 (must be <= 130),
`demoTop` about 501 (must be <= 530).

- [x] **Step 3: Verify desktop did not regress**

At 1280x800 on `/`, confirm the H1 still renders as three forced lines and no
line wraps a second time. Expected computed `font-size`: `72px`.

- [x] **Step 4: Commit**

```bash
git add apps/website/src/styles/landing.css
git commit -m "fix(website): fit the hero H1 to three lines on a phone"
```

---

### Task 3: Enable mobile autoplay

**Files:**
- Modify: `apps/website/src/components/landing/HeroDemo.tsx:22-30`
- Modify: `apps/website/src/styles/landing.css` (the `@media (max-width: 767px)` block near the `.hero-demo-stage` rules, ~line 1964)

- [x] **Step 1: Change the constant and its comment**

In `HeroDemo.tsx`, replace the `MIN_AUTOPLAY_WIDTH` line and the
`HERO_POSTER_MOBILE_MEDIA` comment block (lines 22–30) with:

```ts
/**
 * 0, not 768: phones autoplay too. The poster is a capture displayed at ~0.86
 * scale, but a live iframe lays out at the stage's real width, so its type
 * renders at its designed size — mobile autoplay improves legibility by
 * construction, not just motion. Kept as a named constant so the floor can be
 * restored if the iframe ever costs too much on a phone.
 */
const MIN_AUTOPLAY_WIDTH = 0;
/**
 * Kept in lockstep with the `@media (max-width: 767px)` block in landing.css
 * that gives `.hero-demo-stage` its 3:5 portrait ratio. This pair is coupled to
 * the PHONE POSTER'S GEOMETRY (390x650, shipped 585x975) — the poster is served
 * exactly where the stage is portrait, so `object-fit: cover` crops nothing.
 *
 * It used to be a triple including MIN_AUTOPLAY_WIDTH, which is no longer part
 * of it: autoplay is now width-independent and this breakpoint no longer has
 * anything to do with whether the iframe mounts.
 */
export const HERO_POSTER_MOBILE_MEDIA = '(max-width: 767px)';
```

Leave `autoplayAllowed()` itself unchanged — with the constant at 0 the width
check is inert, and the `prefers-reduced-motion` check still governs. Leave
`needsClick`, the `playRequested` state and `.hero-demo-play` in place: they are
now the reduced-motion path at any width.

- [x] **Step 2: Update the matching CSS comment**

In `landing.css`, the comment above the `@media (max-width: 767px)` block near
`.hero-demo-stage` ends with:

```
 * The breakpoint is shared three ways and must move as one: this ratio, the
 * <source media> in HeroDemo.tsx, and MIN_AUTOPLAY_WIDTH. */
```

Replace those two lines with:

```
 * The breakpoint is shared two ways and must move as one: this ratio and the
 * <source media> in HeroDemo.tsx. MIN_AUTOPLAY_WIDTH is no longer part of it —
 * the iframe autoplays at every width now. */
```

In the same block, the `.hero-demo-play` comment says the control is shown on
"the only viewport that shows it: autoplay is off below 768px", which is now
false. Change that parenthetical to "(now the reduced-motion path only)".

- [x] **Step 3: Verify the iframe mounts at 375x812**

With `npx nx serve website` running, at 375x812 on `/`, scroll the demo into
view, wait 3 seconds, then evaluate:

```js
const d = document.querySelector('[data-hero-demo]');
JSON.stringify({ state: d.dataset.state, iframes: d.querySelectorAll('iframe').length });
```

Expected: `iframes: 1` and `state` reaching `"ready"`. The frame needs the
visibility handshake to start replaying, so confirm visually that the chat
animates rather than sitting on "How can I help?".

- [x] **Step 4: Measure LCP before shipping it**

This is the spec's named risk. At 375x812, with the network throttled to Fast
3G, load `/` and record LCP:

```js
new PerformanceObserver((l) => {
  for (const e of l.getEntries()) console.log('LCP', e.startTime, e.element);
}).observe({ type: 'largest-contentful-paint', buffered: true });
```

Expected: the LCP element is still the poster `<img>`, and its `startTime` has
not regressed against the same measurement taken with `MIN_AUTOPLAY_WIDTH = 768`.
If it has regressed materially, **stop and report it** — restoring the 768 floor
is the documented fallback. Do not ship a regression quietly.

- [x] **Step 5: Commit**

```bash
git add apps/website/src/components/landing/HeroDemo.tsx apps/website/src/styles/landing.css
git commit -m "feat(website): autoplay the hero demo on phones"
```

---

### Task 4: E2E — invert the mobile gate and add the fold guard

**Files:**
- Modify: `apps/website/e2e/home-hero.spec.ts:24-44`

- [x] **Step 1: Replace the two demo tests**

Replace the `poster renders before the frame…` and `mobile shows Play
walkthrough…` tests with:

```ts
  test('poster renders before the frame and the frame mounts on desktop', async ({ page }) => {
    await page.goto('/');
    const demo = page.locator('[data-hero-demo]');
    await expect(demo.locator('img')).toHaveAttribute('src', '/screenshots/hero-walkthrough-poster.webp');
    // The frame mounts on a 25%-visibility threshold and the hero sits above
    // it, so scroll it in — this asserts the mount, not the fold position.
    await demo.scrollIntoViewIfNeeded();
    await expect(demo.locator('iframe')).toHaveAttribute('src', 'https://demo.threadplane.ai/hero');
  });

  test('the frame mounts on a phone without scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    // No scrollIntoViewIfNeeded, deliberately. Shortening the H1 lifted the demo
    // to y=501 of an 812px fold, so 51% of the stage is visible on load and the
    // 25% IntersectionObserver threshold is met without any scroll. Asserting
    // the mount from a standing start is what proves that; scrolling first
    // would hide a regression that pushed the stage back below the fold.
    const demo = page.locator('[data-hero-demo]');
    await expect(demo.locator('iframe')).toHaveAttribute('src', 'https://demo.threadplane.ai/hero');
  });

  test('the hero fits the fold at 375x812', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    // Absolute budgets, not a comparison against whatever currently renders: a
    // relative guard passes vacuously once the thing it guards drifts, which is
    // how the four-line H1 and the sliced poster both shipped unnoticed.
    //
    // Three lines at 36px/1.08 measure 117px; 130 leaves headroom for font
    // loading and metric variance. The demo stage lands at ~502px against an
    // 812px fold; 530 trips on a single extra H1 line, which 560 would not.
    const heading = page.locator('.hero-heading');
    await expect(heading).toBeVisible();
    const headingHeight = (await heading.boundingBox())!.height;
    expect(headingHeight).toBeLessThanOrEqual(130);

    // Measure [data-hero-demo], the same element the 502px projection was taken
    // from. .hero-demo-stage sits ~48px lower inside the BrowserFrame chrome,
    // so budgeting the stage at this number would be a far tighter guard.
    const demo = page.locator('[data-hero-demo]');
    await expect(demo).toBeVisible();
    const demoTop = (await demo.boundingBox())!.y;
    expect(demoTop).toBeLessThanOrEqual(530);
  });
```

- [x] **Step 2: Run the hero e2e suite**

Run: `npx nx e2e website --grep "homepage hero"`

Expected: all four tests PASS.

**Do not use `-- home-hero`.** This target is `@nx/playwright:playwright` with
only a `config` option, so a positional does not pass through and the run dies
with `error: unknown option '--_=home-hero'`. Use `--grep` as above.

Per `feedback_examples_chat_e2e_orphan_servers`, an orphaned dev server from an
earlier task will break the run — but not in the way you would expect. The
failure is `Unable to acquire lock at .../apps/website/.next/dev/lock`, and the
lock is on `.next/dev` regardless of which port the orphan is serving, so a
port-matched pkill misses it. Kill by worktree instead:

```bash
pkill -f "clever-sammet-6ce520.*next dev" || true
```

Check `preview_list` first if you have browser tools — do not kill a managed
preview server out from under the session.

- [x] **Step 3: Prove the fold guard is not vacuous**

A guard that passes before the fix is worthless. Temporarily revert Task 2 by
commenting out the `font-size: 36px` line in `landing.css`, then run:

Run: `npx nx e2e website --grep "homepage hero"`

Expected: `the hero fits the fold at 375x812` FAILS with `headingHeight` about
**259**, exceeding the 130 budget.

Note 259, not the 311 quoted in `landing.css`. Both are real and they are
different mutations: 311px is blocks AND no font-size override (three spans each
wrapping at 48px); commenting out only `font-size` leaves `display: inline`, so
the sentence reflows to 5 lines at the 48px clamp floor — 5 x 48 x 1.08 = 259.2.
The guard bites either way.

The heading assertion aborts the test before `demoTop` is reached, so to prove
that budget too, measure it in a throwaway spec during the same mutated run
(then delete it). Under this mutation it reads **643.94** against the 530
budget. Both budgets are non-vacuous.

Restore the line and re-run to confirm PASS.

- [x] **Step 4: Commit**

```bash
git add apps/website/e2e/home-hero.spec.ts
git commit -m "test(website): budget the hero fold at 375x812 and assert phone autoplay"
```

---

### Task 5: Guard the poster's top edge, then re-record

**Files:**
- Modify: `examples/chat/angular/e2e/record-hero-poster-mobile.record.ts:60-77`
- Regenerate: `apps/website/public/screenshots/hero-walkthrough-poster-mobile.webp`

The recorder's header already documents that the recorded answer's opening line
must fit one line at 390px "or the whole block shifts up and the first line is
sliced off the top edge." Nothing enforces it. That is why the shipped poster
slices a tool-result table across its top edge.

- [x] **Step 1: Add the top-edge assertion**

In the test body, immediately after the existing
`await expect(page.locator('a2ui-surface')).toHaveCount(0);` line, add:

```ts
  // The guard the header asks for and never encoded. The beat is only correct
  // if the conversation block starts BELOW the top edge; when the recorded
  // answer's opening line wraps at 390px the whole block shifts up and the
  // first element is sliced, which every assertion above still passes.
  // The ANSWER, not the first message: the user's prompt above it may legitimately
  // scroll out of frame, but the header's whole height budget is that the answer
  // "fits from its first line". `chat-message` is the element selector exported by
  // libs/chat (primitives/chat-message/chat-message.component.ts).
  const answer = page.locator('[data-hero-surface] chat-message').last();
  await expect(answer).toBeVisible();
  const box = await answer.boundingBox();
  if (!box) throw new Error('answer block has no box');
  if (box.y < 0) {
    throw new Error(
      `the answer is sliced by the top edge (y=${box.y}). Its opening line no ` +
        `longer fits one line at 390px, so the block has shifted up — re-check ` +
        `the height budget in this file's header against public/hero-replay.json.`,
    );
  }
```

Before trusting this, run the recorder once and confirm from the DOM that the
last `chat-message` is the answer the header describes, not a later element. If
the selector is wrong, fix the selector — do not weaken the assertion to make it
pass.

- [x] **Step 2: Run the recorder**

Run:

```bash
npx playwright test --config examples/chat/angular/e2e/record-hero.config.ts record-hero-poster-mobile
```

Expected: PASS, printing `wrote .../hero-walkthrough-poster-mobile.webp`.

If it fails on the new guard, the height budget genuinely no longer holds. Per
the spec, raise the capture height until the beat frames whole, then move
`POSTER_MOBILE_W`/`POSTER_MOBILE_H` in `HeroDemo.tsx`, `SHIP_WIDTH` here, and
the `aspect-ratio` in `landing.css` together, preserving the 3:5 ratio that
makes `object-fit: cover` a no-op. Per the header, runs drift by up to a second,
so re-run once before retuning any timing.

- [x] **Step 3: Inspect the regenerated poster**

Open `apps/website/public/screenshots/hero-walkthrough-poster-mobile.webp` and
confirm by eye: nothing is sliced at the top edge, and no line of prose wraps to
four lines. This is a judgement the assertion cannot make.

- [x] **Step 4: Commit**

```bash
git add examples/chat/angular/e2e/record-hero-poster-mobile.record.ts apps/website/public/screenshots/hero-walkthrough-poster-mobile.webp
git commit -m "fix(website): re-record the mobile hero poster and guard its top edge"
```

---

### Task 6: Regenerate the card images

**Files:**
- Verify: `apps/website/src/app/opengraph-image.tsx`
- Verify: `apps/website/src/app/github-card/route.tsx`

Neither file needs a code change — both map `HERO_H1_LINES`, which stays
length-3. This task is verification plus the manual upload.

- [x] **Step 1: Render both cards and check for overflow**

With `npx nx serve website` running, open in a browser:

- `http://localhost:3000/opengraph-image`
- `http://localhost:3000/github-card`

Expected on both: the H1 renders as three lines, and neither the subhead nor the
pills below it are overlapped. The measurement in the spec predicts no change to
the vertical rhythm — confirm that is what you see.

- [x] **Step 1b: Drop the now-duplicated eyebrow from both cards**

Both renderers hard-code `const EYEBROW = 'OPEN SOURCE · ANGULAR'` —
`opengraph-image.tsx:31` and `github-card/route.tsx:35` — rendered immediately
above an H1 that now reads "…for **Angular** agents." This is exactly the
redundancy that justified stripping "Angular ·" from `HERO_EYEBROW` in Task 1
(spec §5.1), and the rationale carries over verbatim.

Change both to:

```tsx
const EYEBROW = 'OPEN SOURCE';
```

Re-render both cards afterwards and confirm the rail still reads well at its
reduced length. (Found by the Task 1 code-quality review; not in the original
spec.)

- [x] **Step 2: Regenerate the GitHub social preview**

```bash
node scripts/export-github-card.mjs --origin http://localhost:3000
```

**Not the bare `npm run card:github`.** That script defaults to fetching
`https://threadplane.ai` — production, which still serves the OLD copy — so
running it before deploy regenerates the card from the very copy this work
replaces, and it looks like it worked. Point it at the local dev server.

- [x] **Step 3: Flag the manual upload**

GitHub's social preview has no API (`project_github_social_preview_pipeline`).
The generated card must be uploaded by hand at
`https://github.com/cacheplane/threadplane/settings`. Note this explicitly in
the PR description as a required manual step — it cannot be automated and will
otherwise be forgotten.

- [x] **Step 4: Commit any regenerated asset**

```bash
git status --short
git add docs/brand/github-social-preview.png
git commit -m "chore(website): regenerate social cards for the new H1"
```

If `git status` shows nothing, skip the commit — the cards are rendered on
demand and there may be no checked-in artifact.

---

### Task 7: Resolve the messaging.md drift

**Files:**
- Modify: `docs/gtm/messaging.md:9-21`

- [x] **Step 1: Replace the stale hero section**

Replace the `## Hero (locked for Spec 2 to implement)` section, through the
"Subline under proof row" line, with:

```markdown
## Hero (as shipped)

**H1:** The open-source thread-plane for Angular agents.

**Eyebrow:** `LangGraph & AG-UI`

**Subhead:** Make agent work persistent, durable, visible, reviewable, and resumable. (Each capability links to its documentation.)

**Primary CTA:** `Install Threadplane` — opens the install dialog, which carries
the per-runtime commands. Fires `marketing:cta_click` with
`cta_id=hero_install_open`, `track=developer`.

**Secondary CTA:** `See it running in the docs →` — routes to
`/docs/chat/guides/generative-ui?mode=run`, fires `marketing:cta_click` with
`cta_id=hero_live_demo`, `track=developer`.

**Trust line:** `MIT · Angular <range> · no account, no cloud` (the range is
generated from the supported majors, not typed).

> Copy is single-sourced in `apps/website/src/lib/positioning.ts`. Change it
> there; this section records what ships, and is not itself the source.
>
> This replaces an earlier locked hero — H1 "Ship production agent UIs in
> Angular." with a `Talk to our engineers` enterprise CTA fork — which the site
> had drifted away from. The drift was resolved deliberately in
> `docs/superpowers/specs/2026-09-18-mobile-above-fold-design.md` §4: keep the
> category claim and add the stack to it.
```

- [x] **Step 1a: Fix the README banner, which mirrors the social cards**

`apps/website/public/assets/hero.svg:25` hard-codes `OPEN SOURCE · ANGULAR` and
its header comment says it is "Kept in step with the social card." Task 6 changed
both cards to `OPEN SOURCE`, so it is now stale against the thing it claims to
mirror. Change the SVG's text to `OPEN SOURCE`.

It also carries the tagline, so check the whole file for the pre-Angular wording
while you are in it.

Note why nothing caught this: `brand-assets.spec.ts` checks brand assets against
`RETIRED_POSITIONING` in `public-copy-contract.ts`, and that list holds only six
retired *positioning* phrases — the eyebrow and the tagline are not in it. The
guard passes happily over this drift. Do not add the old strings to
`RETIRED_POSITIONING` as a fix: that list is for phrases barred from public copy,
and "OPEN SOURCE · ANGULAR" is not barred, it is merely superseded here.

- [x] **Step 1b: Update the other two places that state the tagline**

The Task 1 code-quality review found the plan had under-scoped this. Two more
tracked files assert the old tagline as fact:

- `gtm.md:15` — `- **Tagline (2026-09-06):** "The open-source thread-plane for agents."`
  This file presents itself as the authority on the tagline, so leaving it is
  worse than leaving `messaging.md` was. Update the tagline to
  `"The open-source thread-plane for Angular agents."` and change the date
  marker to `(2026-09-18)`. Leave the description sentence that follows it
  alone — it matches `HOME_DESCRIPTION`, which this work deliberately did not
  change.
- `README.md:4` (the logo `alt`), `:10` (the `<em>` tagline) and `:36` (the bold
  opening claim) — update all three to "for Angular agents", preserving each
  one's existing capitalisation and punctuation.

- [x] **Step 2: Commit**

```bash
git add docs/gtm/messaging.md gtm.md README.md
git commit -m "docs(gtm): record the shipped hero and retire the drifted one"
```

---

### Task 8: Full verification

- [x] **Step 1: Build — the only typecheck**

`nx test` and `nx lint` do **not** typecheck this app. Only the build catches a
broken production build.

Run: `GROWTH_FORM_POLICY=growth_v1 npx nx build website`

Expected: succeeds.

**The env var is required.** Without it the build fails during export with
`Error: GROWTH_FORM_POLICY must be growth_v1` from
`apps/website/src/lib/growth/form-policy.ts`. This is a pre-existing environment
gate, unrelated to this work — but a bare `npx nx build website` in a fresh
worktree looks like this change broke the build when it did not.

Per `feedback_next_dev_dir_breaks_prod_build`, if this fails with a Turbopack
root panic, remove the stale dev directory and retry:

```bash
rm -rf apps/website/.next/dev && npx nx build website
```

- [x] **Step 1b: Build the example app too**

Run: `npx nx build examples-chat-angular`

Expected: succeeds.

This is not optional and it is not covered by anything else. `examples/chat/angular`'s
`tsconfig.app.json` includes `src/**/*.ts`, which pulls in `.spec.ts` files, and its
lib set is `["es2022", "dom"]` with no `dom.iterable`. So a spec that spreads a
`NodeListOf` (`[...el.querySelectorAll(...)]`) fails with TS2488 and breaks the
app build while `nx test examples-chat-angular` stays green — `nx test` does not
typecheck. That exact break shipped during this plan's Task 5b and was only found
when a later task could not start the dev server.

- [x] **Step 2: Unit and lint**

Run: `npx nx test website && npx nx lint website`

Expected: both PASS. Per `feedback_ci_lint_errors_vs_warnings_apidocs`, lint
warnings are acceptable; errors are not.

- [x] **Step 3: Full website e2e, including the public-copy gate**

The public-copy contract gate runs in production mode only:

```bash
GROWTH_FORM_POLICY=growth_v1 npx nx build website
WEBSITE_E2E_MODE=production npx nx e2e website
```

Expected: PASS, including `public-copy.spec.ts`. The new H1 and tagline make no
absolute claim and name no retired route, so this should be clean.

- [x] **Step 4: Final browser verification at 375x812**

Against the production build, not `next dev`:

```bash
GROWTH_FORM_POLICY=growth_v1 npx nx build website && npx nx serve website --configuration=production
```

At exactly 375x812 on `/`, capture evidence:

```js
const h = document.querySelector('.hero-heading');
const d = document.querySelector('[data-hero-demo]');
JSON.stringify({
  h1Text: h.textContent,
  h1Height: h.getBoundingClientRect().height,
  h1Lines: Math.round(h.getBoundingClientRect().height / parseFloat(getComputedStyle(h).lineHeight)),
  demoTop: d.getBoundingClientRect().top + window.scrollY,
  demoState: d.dataset.state,
  title: document.title,
});
```

Expected: `h1Lines: 3`, `h1Height <= 130`, `demoTop <= 530`, `demoState` reaching
`"ready"`, and `title` containing "Angular". Take a screenshot as evidence.

- [x] **Step 5: Check for generated-file drift and push**

```bash
git status --short
```

Revert any `package-version.ts` rewrite, then push the branch and open a PR. The
PR description **must** name the manual GitHub social-preview upload from Task 6
Step 3 as an outstanding action.

---

## Notes for the implementer

- **Copy lives in one place.** If you find yourself editing a hero string in a
  component, a spec, or a card renderer, you are in the wrong file. The only
  exception is a test that pins the exact expected string.
- **Do not weaken a guard to make it pass.** The two defects this plan fixes both
  shipped past a green suite. If the new top-edge guard or the fold budget fails,
  that is the guard working.
- **Verify end state, not exit code** (`feedback_verify_end_state_not_exit_code`).
  A passing recorder is not proof the poster looks right — Task 5 Step 3 exists
  for that reason.
- **Stay in one checkout.** This is a worktree; do not `cd` to the primary
  repository.
