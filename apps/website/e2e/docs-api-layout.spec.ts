import { expect, test } from '@playwright/test';

const quickstart = '/docs/chat/getting-started/quickstart';

for (const width of [320, 390, 768, 1024, 1440, 1920]) {
  test(`API and docs share a reading edge at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(quickstart);
    await expect(page.locator('[data-workspace-shell]')).toHaveAttribute('data-hydrated', 'true');
    const docsLeft = await page.locator('.docs-prose').evaluate(el => el.getBoundingClientRect().left);
    for (const route of ['/docs/api', '/docs/api/langgraph/injectAgent']) {
      await page.goto(route);
      await expect(page.locator('[data-workspace-shell]')).toHaveAttribute('data-hydrated', 'true');
      const apiLeft = await page.locator('.api-reference-page').evaluate(el =>
        el.getBoundingClientRect().left + parseFloat(getComputedStyle(el).paddingLeft)
      );
      expect(Math.abs(apiLeft - docsLeft), route).toBeLessThanOrEqual(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    }
  });
}

for (const width of [390, 1440]) {
  test(`Quick Start hydrates with valid card links at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error' && /hydrat|cannot.*descendant|cannot contain a nested/i.test(message.text())) {
        errors.push(message.text());
      }
    });
    await page.goto(quickstart);
    await expect(page.locator('[data-workspace-shell]')).toHaveAttribute('data-hydrated', 'true');
    const card = page.getByRole('region', { name: 'Docs workspace panel', exact: true })
      .locator('[data-mdx="card"]').filter({ hasText: 'Going to production' });
    await card.scrollIntoViewIfNeeded();
    await expect(card.getByRole('link', { name: 'Going to production', exact: false })).toHaveAttribute('href', '/docs/chat/getting-started/installation');
    await expect(card.getByRole('link', { name: 'Installation', exact: true })).toHaveAttribute('href', '/docs/chat/getting-started/installation');
    await expect(card.getByRole('link', { name: 'Agent deployment', exact: true })).toHaveAttribute('href', '/docs/langgraph/guides/deployment');
    expect(errors).toEqual([]);
    await card.getByRole('link', { name: 'Agent deployment', exact: true }).click();
    await expect(page).toHaveURL(/\/docs\/langgraph\/guides\/deployment$/);
    await page.goto(quickstart);
    await expect(page.locator('[data-workspace-shell]')).toHaveAttribute('data-hydrated', 'true');
    await card.scrollIntoViewIfNeeded();
    const box = await card.boundingBox();
    if (!box) throw new Error('Missing production card bounds');
    // Clicking card padding must still follow the primary destination.
    await card.click({ position: { x: box.width - 12, y: box.height - 12 } });
    await expect(page).toHaveURL(/\/docs\/chat\/getting-started\/installation$/);
  });
}
