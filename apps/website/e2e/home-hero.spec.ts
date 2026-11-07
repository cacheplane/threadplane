import { test, expect } from '@playwright/test';

test.describe('homepage hero', () => {
  test('install dialog opens, is keyboard operable, and copies the visible command', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/');
    const install = page.getByRole('button', { name: 'Install Threadplane' });
    const restingColor = await install.evaluate(el => getComputedStyle(el).backgroundColor);
    await install.hover();
    await expect.poll(() => install.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(restingColor);
    await install.click();
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
    // No scrollIntoViewIfNeeded: the demo must meet its 25%-visibility
    // IntersectionObserver threshold on load, including the hero's CTA spacing.
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
    // Allow two primary lines and the smaller highlighted aside, while
    // catching unintended wrapping that pushes the hero below the fold.
    const heading = page.locator('.hero-heading');
    await expect(heading).toBeVisible();
    const headingHeight = (await heading.boundingBox())!.height;
    expect(headingHeight).toBeLessThanOrEqual(130);

    // Keep enough of the demo above the fold despite the extra top padding
    // and the stacked mobile CTA and framework links.
    const demo = page.locator('[data-hero-demo]');
    await expect(demo).toBeVisible();
    const demoTop = (await demo.boundingBox())!.y;
    expect(demoTop).toBeLessThanOrEqual(480);
  });
});
