import { expect, test } from '@playwright/test';

// These checks exercise the actual cascade: workspace theme variables and
// Tailwind layers can silently replace the site's type and navigation styles.
test('the brand face survives inside the docs workspace', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/docs/chat/getting-started/quickstart');
  const prose = page.locator('.docs-prose').first();
  await expect(prose).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect(prose).toHaveCSS('font-family', /Hanken/);
  await expect(prose).toHaveCSS('font-size', '16px');
  await expect(prose).toHaveCSS('line-height', '27.2px');
  await expect(prose.locator('h1')).toHaveCSS('font-weight', '600');
  await expect(prose.locator('h1')).toHaveCSS('font-size', '40px');
  await expect(prose.locator('h1')).toHaveCSS('font-family', /Hanken/);
});

test('custom nav triggers have rounded hover and expanded surfaces', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  const trigger = page.locator('.nav-desktop').getByRole('button', { name: 'Docs', exact: true });
  await trigger.hover();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(trigger).toHaveCSS('border-radius', '999px');
  await expect(trigger).toHaveCSS('font-family', /Hanken/);
  await expect(trigger).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(page.locator('.nav-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.nav-panel')).toHaveCount(0);
});

test('dark brand sections keep ink labels on yellow primary actions', async ({ page }) => {
  await page.goto('/');
  const action = page.locator('[data-surface="dark"] [data-ui="button"][data-variant="primary"]').first();
  await expect(action).toBeVisible();
  await expect(action).toHaveCSS('background-color', 'rgb(255, 175, 0)');
  await expect(action).toHaveCSS('color', 'rgb(10, 10, 10)');
});

for (const width of [375, 1440]) {
  test(`docs and generated API have no decorative left accents at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    for (const path of ['/docs/chat/getting-started/quickstart', '/docs/api/langgraph/injectAgent']) {
      await page.goto(path);
      await expect(page.locator('.docs-prose, .api-reference-detail').first()).toBeVisible();
      const accents = await page.locator('.docs-workspace-article').evaluate((article) =>
        [...article.querySelectorAll('*')].filter((element) => {
          const style = getComputedStyle(element);
          return element.getBoundingClientRect().width > 0 &&
            parseFloat(style.borderLeftWidth) > 0 &&
            style.borderLeftWidth !== style.borderRightWidth;
        }).map((element) => element.className)
      );
      expect(accents, path).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    }
  });
}
