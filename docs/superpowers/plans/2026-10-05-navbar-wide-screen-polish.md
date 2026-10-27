# Navbar Wide-Screen Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the website's desktop navbar and its hover panels from spreading across a wide viewport: constrain the bar to the page's 1200px container, put the four triggers beside the logo, and make each panel intrinsic-width and anchored under its trigger.

**Architecture:** The bar row keeps one DOM structure; CSS in `chrome.css` gives marketing routes a centered max-width and splits `NavDesktop` into a left trigger group and a right actions group. A pure `clampPanelLeft()` computes where an open panel's left edge goes (under its trigger, pulled left only as far as the row's content box requires), and a layout effect in `NavDesktop` writes that value into a `--nav-panel-left` custom property on the panel shell. Geometry is verified in Playwright because jsdom has no layout.

**Tech Stack:** Next.js (React 19) in `apps/website`, Tailwind v4 utilities plus unlayered author CSS in `src/styles/*.css`, Vitest + jsdom for unit tests, Playwright for browser tests.

**Spec:** `docs/superpowers/specs/2026-10-05-navbar-wide-screen-polish-design.md`

**Working directory for every command:** the repo root (`/Users/blove/repos/angular-agent-framework/.claude/worktrees/founder-email-campaign-0cdecc`) unless a step says otherwise.

**Browser tests against a running dev server.** A dev server for the website already runs on `http://localhost:3000` (started with the `website-dev` launch config). The Playwright config skips its own web server whenever `BASE_URL` is set, so the nav specs run in seconds:

```bash
cd apps/website && BASE_URL=http://localhost:3000 npx playwright test e2e/nav-panels.spec.ts
```

If no server is running, `npx nx e2e website -- e2e/nav-panels.spec.ts` starts `next dev` on port 4308 itself (slower first run).

---

## File map

| File | Responsibility | Task |
| --- | --- | --- |
| `apps/website/src/components/shared/nav-panel-position.ts` | `clampPanelLeft()`: pure arithmetic for the panel's left offset | 1 |
| `apps/website/src/components/shared/nav-panel-position.spec.ts` | Unit tests for the clamp | 1 |
| `apps/website/src/styles/chrome.css` | Marketing row max-width; trigger/actions groups; shell `left` var; panel `max-content`; column tracks; Libraries 2×2 step | 2, 3 |
| `apps/website/src/components/shared/NavDesktop.tsx` | Two groups in the row; layout effect that positions the open shell | 2, 3 |
| `apps/website/e2e/nav-panels.spec.ts` | Browser assertions for row layout and panel anchoring | 2, 3 |

---

### Task 1: The clamp function

**Files:**
- Create: `apps/website/src/components/shared/nav-panel-position.ts`
- Test: `apps/website/src/components/shared/nav-panel-position.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/website/src/components/shared/nav-panel-position.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { clampPanelLeft } from './nav-panel-position';

// A 1264px row (the 1200px container plus its 32px padding on each side) at
// the 1440px design viewport. Offsets are relative to the row's padding box,
// which is what HTMLElement.offsetLeft reports for the triggers and the shell.
const row = { rowWidth: 1264, rowPaddingLeft: 32, rowPaddingRight: 32 };

describe('clampPanelLeft', () => {
  it('keeps a panel under its trigger when there is room to the right', () => {
    // Solutions: trigger at 508, panel 596 wide → right edge 1104 < 1232.
    expect(
      clampPanelLeft({ ...row, triggerLeft: 508, panelWidth: 596 })
    ).toBe(508);
  });

  it('pulls a panel left just far enough to stay inside the content box', () => {
    // Libraries: trigger at 296, panel 1122 wide → would end at 1418.
    // The content box ends at 1264 - 32 = 1232, so left = 1232 - 1122.
    expect(
      clampPanelLeft({ ...row, triggerLeft: 296, panelWidth: 1122 })
    ).toBe(110);
  });

  it('pins a panel wider than the content box to the left padding', () => {
    expect(
      clampPanelLeft({ ...row, triggerLeft: 296, panelWidth: 1400 })
    ).toBe(32);
  });

  it('never moves a panel left of the row padding even when the trigger is there', () => {
    expect(
      clampPanelLeft({ ...row, triggerLeft: 10, panelWidth: 300 })
    ).toBe(32);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
npx nx test website -- src/components/shared/nav-panel-position.spec.ts
```

Expected: FAIL — `Failed to resolve import "./nav-panel-position"`.

- [ ] **Step 3: Write the implementation**

Create `apps/website/src/components/shared/nav-panel-position.ts`:

```ts
/**
 * Where an open nav panel's left edge goes, in px from the left edge of the
 * row's padding box (`.nav-bar > div`), which is the containing block of
 * `.nav-panel-shell` and the offsetParent of every trigger.
 *
 * A panel opens with its left edge under its trigger. When that would carry
 * its right edge past the row's content box it slides left exactly as far as
 * it has to; a panel wider than the content box pins to the left padding and
 * lets `.nav-panel`'s own max-width deal with the rest. Pure so jsdom can
 * test the arithmetic — the geometry it is fed only exists in a real browser.
 */
export function clampPanelLeft(input: {
  readonly triggerLeft: number;
  readonly panelWidth: number;
  readonly rowWidth: number;
  readonly rowPaddingLeft: number;
  readonly rowPaddingRight: number;
}): number {
  const maxLeft = input.rowWidth - input.rowPaddingRight - input.panelWidth;
  return Math.max(
    input.rowPaddingLeft,
    Math.min(input.triggerLeft, maxLeft)
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
npx nx test website -- src/components/shared/nav-panel-position.spec.ts
```

Expected: `✓ 4 passed`.

Note: `nx test website` rewrites `apps/website/src/lib/package-version.ts` (see memory). Before staging, run `git status --short` and, if that file shows as modified, `git checkout -- apps/website/src/lib/package-version.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/website/src/components/shared/nav-panel-position.ts apps/website/src/components/shared/nav-panel-position.spec.ts
git commit -m "feat(website): clamp a nav panel's left edge to the row's content box

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Constrain the row and regroup it

**Files:**
- Modify: `apps/website/src/components/shared/NavDesktop.tsx` (the returned JSX, lines ~74–177)
- Modify: `apps/website/src/styles/chrome.css` (the `.nav-bar[data-route='docs'] > div` block at ~line 186 and the `.nav-desktop` block at ~line 529)
- Test: `apps/website/e2e/nav-panels.spec.ts`

- [ ] **Step 1: Write the failing browser test**

Append to `apps/website/e2e/nav-panels.spec.ts` (after the last `});`):

```ts
/**
 * The row's content box: its padding box minus the horizontal padding
 * Tailwind's px-6 / md:px-8 puts on it. Panels and triggers are positioned
 * against this box, so the assertions below are phrased in its terms.
 */
async function rowContentBox(page: Page) {
  const row = page.locator('.nav-bar > div');
  const box = await row.boundingBox();
  if (!box) throw new Error('Nav row has no box');
  const [padLeft, padRight] = await row.evaluate((el) => {
    const style = getComputedStyle(el);
    return [parseFloat(style.paddingLeft), parseFloat(style.paddingRight)];
  });
  return { left: box.x + padLeft, right: box.x + box.width - padRight };
}

test.describe('desktop nav row on a wide screen', () => {
  test('shares the page container and puts the triggers beside the logo', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1000 });
    await page.goto('/');

    const content = await rowContentBox(page);
    const logo = await page.locator('.nav-logo-link').boundingBox();
    const heroDemo = await page.locator('.hero-demo').boundingBox();
    const libraries = await page.getByRole('button', { name: 'Libraries' }).boundingBox();
    const cta = await page.getByRole('link', { name: 'Talk to Us' }).boundingBox();
    if (!logo || !heroDemo || !libraries || !cta) throw new Error('Nav row has no box');

    // The bar's content box is the same 1200px container the hero stage uses:
    // at 1920 both start at x=360. Today the logo sits at x=32.
    expect(Math.abs(logo.x - heroDemo.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(content.left - heroDemo.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(content.right - (heroDemo.x + heroDemo.width))).toBeLessThanOrEqual(1);

    // The first trigger follows the logo after a 40px lead, not a 1200px one.
    expect(libraries.x - (logo.x + logo.width)).toBeGreaterThanOrEqual(38);
    expect(libraries.x - (logo.x + logo.width)).toBeLessThanOrEqual(42);

    // The CTA still closes the row at the content box's right edge.
    expect(Math.abs(cta.x + cta.width - content.right)).toBeLessThanOrEqual(1);
  });

  test('stays full-bleed on docs, where the shell is full-bleed too', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1000 });
    await page.goto('/docs');

    const row = await page.locator('.nav-bar > div').boundingBox();
    const logo = await page.locator('.nav-logo-link').boundingBox();
    if (!row || !logo) throw new Error('Nav row has no box');
    expect(row.width).toBe(1920);
    expect(logo.x).toBeLessThan(48);
  });
});
```

Change the first line of the file to import the `Page` type:

```ts
import { test, expect, type Page } from '@playwright/test';
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd apps/website && BASE_URL=http://localhost:3000 npx playwright test e2e/nav-panels.spec.ts -g "wide screen"
```

Expected: the first test FAILS on `expect(Math.abs(logo.x - heroDemo.x)).toBeLessThanOrEqual(1)` (received ~328, the logo is at x=32 and the stage at x=360). The docs test passes already.

- [ ] **Step 3: Regroup the row in NavDesktop**

In `apps/website/src/components/shared/NavDesktop.tsx`, replace the returned JSX's outer wrapper and the two trailing elements. The current shape is:

```tsx
  return (
    <div
      className="hidden lg:flex items-center gap-8 nav-desktop"
      onMouseLeave={scheduleClose}
    >
      {NAV_TRIGGERS.map((trigger) =>
        ...
      )}

      <a
        href={GITHUB_REPO_URL}
        ...
      >
        <GitHubIcon />
      </a>
      <Button
        ...
      >
        Talk to Us
      </Button>
    </div>
  );
```

Change it to (the `NAV_TRIGGERS.map(...)` body, the `<a>` and the `<Button>` are unchanged — only the wrappers move):

```tsx
  return (
    <div
      className="hidden lg:flex items-center nav-desktop"
      onMouseLeave={scheduleClose}
    >
      {/* Triggers follow the logo; actions sit at the row's far edge. Both
       * groups stay unpositioned so a trigger's offsetLeft keeps measuring
       * from `.nav-bar > div`, which is what Task 3's positioning reads. */}
      <div className="flex items-center gap-8 nav-desktop-primary">
        {NAV_TRIGGERS.map((trigger) =>
          /* unchanged */
        )}
      </div>

      <div className="flex items-center gap-8 nav-desktop-actions">
        <a
          href={GITHUB_REPO_URL}
          /* unchanged */
        >
          <GitHubIcon />
        </a>
        <Button
          /* unchanged */
        >
          Talk to Us
        </Button>
      </div>
    </div>
  );
```

- [ ] **Step 4: Add the row CSS**

In `apps/website/src/styles/chrome.css`, directly after the `.nav-bar[data-route='docs'] > div { ... }` block (~line 186–189), add:

```css
/* Marketing rows share the page's container. Every homepage section centres a
 * 1200px content box; the bar used to span the viewport, which on a 1920px
 * screen put the logo at x=32 and the links at x=1315 with nothing between.
 * The max-width is the content box plus the row's own md:px-8 padding, so the
 * logo's left edge lands on the sections' left edge. Docs stays full-bleed:
 * its shell is full-bleed (rail at x=56) and the logo sits over the rail. */
.nav-bar[data-route='marketing'] > div {
  max-width: calc(1200px + 2 * 32px);
  margin-inline: auto;
}
```

Then replace the `.nav-desktop { ... }` block (~line 529–543, keep its comment) so it reads:

```css
.nav-desktop {
  position: static;
  /* (existing align-self comment stays here, unchanged) */
  align-self: stretch;
  /* Fill the row so .nav-desktop-actions can reach its right edge. */
  flex: 1 1 auto;
}
.nav-desktop-primary {
  margin-left: 40px;
}
.nav-desktop-actions {
  margin-left: auto;
}
```

- [ ] **Step 5: Run the browser tests to verify they pass**

Run:

```bash
cd apps/website && BASE_URL=http://localhost:3000 npx playwright test e2e/nav-panels.spec.ts e2e/nav-height.spec.ts
```

Expected: every test passes, including the pre-existing panel geometry tests and the `--nav-h` ladder (the row's height did not change: padding and the 40px CTA set it).

- [ ] **Step 6: Run the unit suite for the nav**

Run:

```bash
npx nx test website -- src/components/shared
```

Expected: all pass. Revert `apps/website/src/lib/package-version.ts` if `git status --short` shows it modified.

- [ ] **Step 7: Commit**

```bash
git add apps/website/src/components/shared/NavDesktop.tsx apps/website/src/styles/chrome.css apps/website/e2e/nav-panels.spec.ts
git commit -m "feat(website): constrain the nav row to the page container and seat the triggers beside the logo

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Intrinsic-width panels anchored under their trigger

**Files:**
- Modify: `apps/website/src/components/shared/NavDesktop.tsx` (imports, refs, a new layout effect, the shell's `ref`)
- Modify: `apps/website/src/styles/chrome.css` (`.nav-panel-shell`, `.nav-panel`, `.nav-panel-cols`, `.nav-panel[data-columns='1'] .nav-panel-col`)
- Test: `apps/website/e2e/nav-panels.spec.ts`

- [ ] **Step 1: Write the failing browser tests**

Append to `apps/website/e2e/nav-panels.spec.ts`:

```ts
/** Opens a panel, waits for its entrance animation, measures, and closes it. */
async function openAndMeasure(page: Page, name: string) {
  const trigger = page.getByRole('button', { name });
  await trigger.click();
  const panel = page.locator('.nav-panel');
  await expect(panel).toBeVisible();
  await panel.evaluate((el) =>
    Promise.all(el.getAnimations().map((animation) => animation.finished)),
  );
  const triggerBox = await trigger.boundingBox();
  const panelBox = await panel.boundingBox();
  if (!triggerBox || !panelBox) throw new Error(`${name} has no box`);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  return { triggerBox, panelBox };
}

test.describe('desktop nav panels sit under their triggers', () => {
  test('at 1440 Docs and Solutions open at their trigger; Libraries clamps to the row', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const content = await rowContentBox(page);

    for (const name of ['Docs', 'Solutions']) {
      const { triggerBox, panelBox } = await openAndMeasure(page, name);
      expect(Math.abs(panelBox.x - triggerBox.x)).toBeLessThanOrEqual(2);
      expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(content.right + 1);
      // Intrinsic width: nowhere near the 1440px sheet this used to be.
      expect(panelBox.width).toBeLessThan(1000);
    }

    // Four library cards side by side are wider than the room to the right of
    // the Libraries trigger, so the panel slides left until its right edge
    // meets the content box — and still covers the trigger that opened it.
    const { triggerBox, panelBox } = await openAndMeasure(page, 'Libraries');
    expect(panelBox.x).toBeLessThan(triggerBox.x);
    expect(Math.abs(panelBox.x + panelBox.width - content.right)).toBeLessThanOrEqual(1);
    expect(panelBox.x).toBeGreaterThanOrEqual(content.left - 1);
  });

  test('at 1024 the Docs panel still fits inside the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto('/');
    const content = await rowContentBox(page);

    const { triggerBox, panelBox } = await openAndMeasure(page, 'Docs');
    expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(content.right + 1);
    expect(panelBox.x).toBeGreaterThanOrEqual(content.left - 1);
    expect(panelBox.x).toBeLessThanOrEqual(triggerBox.x);
  });

  test('at 1920 a panel is narrower than the viewport and starts at its trigger', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1000 });
    await page.goto('/');

    const { triggerBox, panelBox } = await openAndMeasure(page, 'Solutions');
    expect(Math.abs(panelBox.x - triggerBox.x)).toBeLessThanOrEqual(2);
    expect(panelBox.width).toBeLessThan(800);
  });

  test('below 1200 the four library cards fall into two rows of two', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Libraries' }).click();
    const items = page.locator('.nav-panel .nav-panel-col .nav-panel-item');
    await expect(items).toHaveCount(4);
    await page.locator('.nav-panel').evaluate((el) =>
      Promise.all(el.getAnimations().map((animation) => animation.finished)),
    );
    const boxes = [];
    for (let index = 0; index < 4; index += 1) {
      const box = await items.nth(index).boundingBox();
      if (!box) throw new Error(`Library item ${index} has no box`);
      boxes.push(box);
    }
    expect(Math.abs(boxes[1].y - boxes[0].y)).toBeLessThanOrEqual(2);
    expect(boxes[2].y).toBeGreaterThan(boxes[0].y);
    expect(Math.abs(boxes[2].x - boxes[0].x)).toBeLessThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
cd apps/website && BASE_URL=http://localhost:3000 npx playwright test e2e/nav-panels.spec.ts -g "sit under their triggers"
```

Expected: all four FAIL — the panel's x is the row's left padding and its width is the full row (e.g. `expect(panelBox.width).toBeLessThan(1000)` receives 1264).

- [ ] **Step 3: Position the shell from NavDesktop**

In `apps/website/src/components/shared/NavDesktop.tsx`:

Change the React import line to:

```tsx
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
```

Add, after the `NavPanelBody` import:

```tsx
import { clampPanelLeft } from './nav-panel-position';
```

Inside `NavDesktop`, after `const closeTimer = useRef<number | null>(null);`, add:

```tsx
  const shellRef = useRef<HTMLDivElement | null>(null);
```

After the existing Escape-key `useEffect` (the one that ends `}, [clearTimers, openId]);`), add:

```tsx
  // Seat the open panel under its trigger. `.nav-panel-shell` is absolutely
  // positioned against `.nav-bar > div` and reads `--nav-panel-left` for its
  // left edge; a trigger's offsetLeft is measured from that same box because
  // nothing between them is positioned (see .nav-desktop in chrome.css). A
  // layout effect runs before paint, so the panel never flashes at left:0.
  useLayoutEffect(() => {
    if (!openId) return undefined;
    const position = () => {
      const shell = shellRef.current;
      const trigger = triggerRefs.current.get(openId);
      const row = shell?.offsetParent;
      const panel = shell?.firstElementChild;
      if (
        !shell ||
        !trigger ||
        !(row instanceof HTMLElement) ||
        !(panel instanceof HTMLElement)
      ) {
        return;
      }
      const rowStyle = getComputedStyle(row);
      const left = clampPanelLeft({
        triggerLeft: trigger.offsetLeft,
        panelWidth: panel.offsetWidth,
        rowWidth: row.clientWidth,
        rowPaddingLeft: Number.parseFloat(rowStyle.paddingLeft) || 0,
        rowPaddingRight: Number.parseFloat(rowStyle.paddingRight) || 0,
      });
      shell.style.setProperty('--nav-panel-left', `${left}px`);
    };
    position();
    window.addEventListener('resize', position);
    return () => window.removeEventListener('resize', position);
  }, [openId]);
```

Give the shell its ref — change:

```tsx
              <div
                className="nav-panel-shell"
                onMouseEnter={clearTimers}
                onMouseLeave={scheduleClose}
              >
```

to:

```tsx
              <div
                ref={shellRef}
                className="nav-panel-shell"
                onMouseEnter={clearTimers}
                onMouseLeave={scheduleClose}
              >
```

- [ ] **Step 4: Size and anchor the panel in CSS**

In `apps/website/src/styles/chrome.css`:

Replace `.nav-panel-shell { ... }` (keep its hit-area comment) with:

```css
.nav-panel-shell {
  position: absolute;
  /* (existing hit-area comment stays here, unchanged) */
  top: calc(100% - var(--nav-row-pad));
  padding-top: var(--nav-row-pad);
  /* The left edge is written by NavDesktop's layout effect: the trigger's
   * offsetLeft, pulled left only when the panel would otherwise leave the
   * row's content box (clampPanelLeft). No `right`, so the shell shrinks to
   * the panel instead of spanning the row. */
  left: var(--nav-panel-left, 0);
  z-index: 60;
}
```

Replace `.nav-panel { ... }` with:

```css
.nav-panel {
  background: var(--color-surface-tinted, #fafafa);
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(10, 10, 10, 0.08), 0 8px 24px rgba(10, 10, 10, 0.06);
  padding: 28px 24px 24px;
  /* As wide as its columns, never the bar. The max-width is a last resort for
   * a panel wider than the viewport itself; clampPanelLeft handles the rest. */
  width: max-content;
  max-width: calc(100vw - 48px);
  animation: nav-panel-in 140ms ease-out;
}
```

Replace `.nav-panel-cols { ... }` with:

```css
.nav-panel-cols {
  display: grid;
  gap: 20px;
  grid-auto-flow: column;
  /* Fixed tracks, not 1fr: inside a max-content panel 1fr would size each
   * column to its own widest item and the columns would come out ragged.
   * 264px keeps every panel inside the content box from its trigger at
   * 1440 (Docs: 3 × 264 + 2 × 20 + 48 = 880 from x≈423 ends at 1303 < 1320).
   * Longer descriptions wrap to a second line. */
  grid-auto-columns: 16.5rem;
}
```

Replace `.nav-panel[data-columns='1'] .nav-panel-col { ... }` with:

```css
.nav-panel[data-columns='1'] .nav-panel-col {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 16.5rem;
  gap: 6px;
}
/* Four cards across is ~1122px, which is the whole content box below 1200px
 * and more than it below ~1190. Two rows of two keeps the cards readable;
 * e2e/nav-panels.spec.ts pins four-across at 1440 and two-by-two at 1100. */
@media (max-width: 1199px) {
  .nav-panel[data-columns='1'] .nav-panel-col {
    grid-auto-flow: row;
    grid-template-columns: repeat(2, 16.5rem);
    grid-auto-columns: auto;
  }
}
```

Update the `.nav-desktop` comment: replace the sentence in the comment above `.nav-desktop` that reads

```
 * pins the element's position and defeats any future `relative` utility added
 * here — keeping .nav-panel-shell's containing block on .nav-bar > div below. */
```

with

```
 * pins the element's position and defeats any future `relative` utility added
 * here — keeping .nav-panel-shell's containing block on .nav-bar > div below,
 * which is also the offsetParent the triggers' offsetLeft is measured from.
 * NavDesktop's layout effect relies on both being the same box. */
```

- [ ] **Step 5: Run the browser tests to verify they pass**

Run:

```bash
cd apps/website && BASE_URL=http://localhost:3000 npx playwright test e2e/nav-panels.spec.ts e2e/nav-height.spec.ts e2e/nav-surface.spec.ts
```

Expected: every test passes — the four new anchoring tests, the row tests from Task 2, the original five panel tests (four-across at 1440 and `spanned > panel.width * 0.8` still hold because the panel is now exactly as wide as its cards), the hover-bridge test (the pointer drops straight from the trigger's centre into a shell whose left edge is at or left of that trigger), the `--nav-h` ladder, and the surface tests.

- [ ] **Step 6: Run the unit suite and lint**

Run:

```bash
npx nx test website -- src/components/shared
npx nx lint website
```

Expected: tests pass; lint reports no errors (warnings are not a gate — strip ANSI before grepping if you pipe it). Revert `apps/website/src/lib/package-version.ts` if `git status --short` shows it modified.

- [ ] **Step 7: Commit**

```bash
git add apps/website/src/components/shared/NavDesktop.tsx apps/website/src/styles/chrome.css apps/website/e2e/nav-panels.spec.ts
git commit -m "feat(website): intrinsic-width nav panels anchored under their trigger

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Look at it, then verify the broader surface

**Files:** none modified unless a defect is found.

- [ ] **Step 1: Inspect every panel at 1920, 1440, and 1024 in the browser pane**

Using the `website-dev` preview tab: resize to 1920×1000, open `/`, open Libraries, Docs, and Solutions in turn, and take a screenshot of each. Repeat at 1440×900 and 1024×800. Then open `/docs/langgraph/getting-started/quickstart` at 1920 and open the Docs panel. Check for:

- A panel whose left edge visibly sits under its trigger (or at the row's right edge for Libraries).
- No panel wider than its columns; no description wrapping past two lines.
- Libraries four-across at 1920/1440 and two-by-two at 1100.
- Row height unchanged (81px marketing, 58px docs) — the nav-height spec already asserts this, so this is a visual sanity check.
- Hover from Libraries to Docs to Solutions switches panels without a flash at `left: 0`.

Fix anything found inline, re-run Task 3 Step 5, and amend nothing — make a small follow-up commit instead.

- [ ] **Step 2: Reset the preview viewport**

Call `resize_window` with preset `desktop` on the preview tab.

- [ ] **Step 3: Run the whole website unit suite and a production build**

Run:

```bash
npx nx test website
npx nx build website
```

Expected: tests pass; the build succeeds. `nx test website` and `nx lint website` do not typecheck — only the build does, which is why it runs here. Revert `apps/website/src/lib/package-version.ts` afterwards if modified.

- [ ] **Step 4: Run the full website e2e suite against the dev server**

Run:

```bash
cd apps/website && BASE_URL=http://localhost:3000 npx playwright test
```

Expected: all pass. Fixture-backed specs that need the local Playwright web server skip themselves when `BASE_URL` is set; that is expected and documented in `playwright.config.ts`.

- [ ] **Step 5: Review the diff against the spec**

Run `git diff main...HEAD --stat` and read `git diff main...HEAD -- apps/website/src apps/website/e2e`. Confirm each spec decision has code behind it: marketing max-width, docs full-bleed, triggers beside the logo, actions right, `--nav-panel-left` clamp, `max-content` panel, 264px tracks, Libraries 2×2 below 1200. Confirm nothing in the "What does not change" list moved.
