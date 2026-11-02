import { test, expect, type Page } from '@playwright/test';

/**
 * jsdom has no CSS and no layout engine, so `src/components/shared/Nav.spec.tsx`
 * can exercise every state transition of the mobile drawer (push, pop, focus,
 * Escape) without ever being able to catch what only a real browser renders:
 * the overlay's `top: calc(var(--nav-h) - 1px)` landing in the wrong place, an
 * overlay host swallowing or mispositioning pointer events over a row (a
 * failure mode this repo has shipped before), an `lg:hidden` regression
 * leaking the hamburger onto desktop, or a scroll lock that never engages or
 * never releases. These assertions are about geometry and real pointer
 * delivery, so — like e2e/nav-panels.spec.ts for the desktop panels — they
 * only mean anything in a real browser.
 */

const dialog = (page: Page) =>
  page.getByRole('dialog', { name: 'Mobile navigation' });

test.describe('mobile nav drawer', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test('opens the root drawer with its composition flush under the nav', async ({
    page,
  }) => {
    await test.step('opens and shows the four root rows', async () => {
      await page.goto('/');
      await page.getByRole('button', { name: 'Open menu' }).click();

      const drawer = dialog(page);
      await expect(drawer).toBeVisible();

      await expect(
        drawer.getByRole('button', { name: 'Libraries' })
      ).toBeVisible();
      await expect(drawer.getByRole('button', { name: 'Docs' })).toBeVisible();
      await expect(
        drawer.getByRole('button', { name: 'Solutions' })
      ).toBeVisible();

      const pricing = drawer.getByRole('link', { name: 'Pricing' });
      await expect(pricing).toBeVisible();
      await expect(pricing).toHaveAttribute('href', '/pricing');
    });
    await test.step('sits flush under the nav', async () => {
      const drawer = dialog(page);
      await expect(drawer).toBeVisible();

      const navBox = await page.locator('nav.nav-bar').boundingBox();
      const drawerBox = await drawer.boundingBox();
      if (!navBox || !drawerBox) throw new Error('nav or drawer has no box');

      // `top: calc(var(--nav-h) - 1px)` exists precisely so the drawer overlaps
      // the nav's own 1px border rather than leaving a gap or an overshoot —
      // the class of offset bug that has shipped on this repo before.
      // `boundingBox()` returns {x, y, width, height} — not `bottom` — so the
      // nav's bottom edge is derived, not read directly.
      const navBottom = navBox.y + navBox.height;
      expect(Math.abs(drawerBox.y - navBottom)).toBeLessThanOrEqual(1);
    });
  });

  test('a click on the Libraries row actually reaches it', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Open menu' }).click();

    const drawer = dialog(page);
    const librariesRow = drawer.getByRole('button', { name: 'Libraries' });
    await expect(librariesRow).toBeVisible();

    // Independent of whether .click() "succeeds": ask the browser what
    // element is actually topmost at the row's centre. An invisible overlay
    // host sitting over the row — the exact failure mode this repo has
    // shipped before — would still let Playwright's actionability checks
    // pass (the row is visible and unobscured *by Playwright's own reading of
    // the DOM*), but elementFromPoint reports what a real finger would hit.
    const box = await librariesRow.boundingBox();
    if (!box) throw new Error('Libraries row has no box');
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const topmostIsRow = await page.evaluate(
      ({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        return Boolean(el?.closest('.nav-mobile-row'));
      },
      centre,
    );
    expect(topmostIsRow).toBe(true);

    await librariesRow.click();

    // The level actually pushed: the four package links are showing, not
    // just "the click handler ran" (which jsdom already proves).
    await expect(drawer.getByRole('button', { name: 'Back to menu' })).toBeVisible();
    await expect(drawer.getByRole('link', { name: /@threadplane\/langgraph/ })).toBeVisible();
    await expect(drawer.getByRole('link', { name: /@threadplane\/ag-ui/ })).toBeVisible();
    await expect(drawer.getByRole('link', { name: /@threadplane\/chat/ })).toBeVisible();
    await expect(drawer.getByRole('link', { name: /@threadplane\/render/ })).toBeVisible();
    await expect(drawer.getByText('Not sure which one?')).toBeVisible();
    await expect(drawer.getByRole('link', { name: /Choosing an adapter/ })).toBeVisible();
  });

  test('pushes into Libraries and pops back to the root rows', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Open menu' }).click();

    const drawer = dialog(page);
    await drawer.getByRole('button', { name: 'Libraries' }).click();

    await expect(drawer.getByRole('button', { name: 'Back to menu' })).toBeVisible();
    await expect(drawer.getByRole('link', { name: /@threadplane\/langgraph/ })).toBeVisible();

    await drawer.getByRole('button', { name: 'Back to menu' }).click();

    await expect(drawer.getByRole('button', { name: 'Libraries' })).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Docs' })).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Solutions' })).toBeVisible();
    await expect(drawer.getByRole('link', { name: /@threadplane\/langgraph/ })).toHaveCount(0);
  });

  test('locks body scroll while open and releases it on close', async ({ page }) => {
    await page.goto('/');

    expect(
      await page.evaluate(() => document.body.style.overflow),
    ).not.toBe('hidden');

    await page.getByRole('button', { name: 'Open menu' }).click();
    await expect(dialog(page)).toBeVisible();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');

    await page.getByRole('button', { name: 'Close menu' }).click();
    await expect(dialog(page)).toBeHidden();
    expect(
      await page.evaluate(() => document.body.style.overflow),
    ).not.toBe('hidden');
  });

  test('the hamburger is not present at desktop width', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeHidden();
  });

  test('opens pre-pushed to the docs level on /docs', async ({ page }) => {
    await page.goto('/docs');
    await page.getByRole('button', { name: 'Open menu' }).click();

    const drawer = dialog(page);
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Back to menu' })).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Search docs' })).toBeVisible();

    // It opened at the docs level, not the root list of site triggers.
    await expect(drawer.getByRole('button', { name: 'Libraries' })).toHaveCount(0);
    await expect(drawer.getByRole('button', { name: 'Solutions' })).toHaveCount(0);
  });
});
