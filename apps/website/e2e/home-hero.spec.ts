import { test, expect } from '@playwright/test';

test.describe('homepage hero', () => {
  test('install dialog opens, is keyboard operable, and copies the visible command', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/');
    await page.getByRole('button', { name: 'Install Threadplane' }).click();
    const dialog = page.getByRole('dialog', { name: 'Install Threadplane' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('radio', { name: 'Try without a backend' })).toHaveAttribute('aria-checked', 'true');
    await dialog.getByRole('radio', { name: 'Try without a backend' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(dialog.getByRole('radio', { name: 'LangGraph' })).toHaveAttribute('aria-checked', 'true');
    const visible = await dialog.getByTestId('install-command').textContent();
    await dialog.getByRole('button', { name: 'Copy install command' }).click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(visible);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Install Threadplane' })).toBeFocused();
  });

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
    // to y=469 of this 844px fold, leaving ~44% of it visible on load — the 25%
    // IntersectionObserver threshold is met without any scroll, and asserting
    // the mount from a standing start is what proves it.
    //
    // This test still does NOT defend the fold; the budget below does. The 25%
    // threshold is a proxy that only bites once the demo is pushed a long way
    // down, and it moves whenever the stage's aspect ratio changes, so it is
    // not a stable thing to reason about a fold with. Keep the two separate:
    // this asserts that a phone autoplays, the budget asserts where the demo
    // sits.
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
    // Three lines at 36px/1.08 measure 116.63px. line-height is pinned as a
    // RATIO of font-size, so this height is quantized to 38.88px steps — 3
    // lines is 116.64, 4 lines is 155.52, and nothing lands in between. A
    // webfont falling back changes where the text WRAPS, not the line box
    // height, so any budget inside that gap behaves identically and there is no
    // metric-variance flake surface. 130 sits in the gap.
    const heading = page.locator('.hero-heading');
    await expect(heading).toBeVisible();
    const headingHeight = (await heading.boundingBox())!.height;
    expect(headingHeight).toBeLessThanOrEqual(130);

    // Measure [data-hero-demo], the same element the 501.42px figure came from.
    // .hero-demo-stage sits ~48px lower inside the BrowserFrame chrome, so
    // budgeting the stage at this number would be a far tighter guard.
    //
    // 530, not 560: one extra H1 line adds 38.88px and lands at 540.3, which a
    // 560 budget would wave through — leaving the heading budget as the only
    // thing catching a taller hero. 530 trips on a single extra line by itself,
    // and 28px of slack still absorbs sub-line drift in the eyebrow, subhead or
    // CTA row. Measured: 501.42.
    const demo = page.locator('[data-hero-demo]');
    await expect(demo).toBeVisible();
    const demoTop = (await demo.boundingBox())!.y;
    expect(demoTop).toBeLessThanOrEqual(530);
  });
});
