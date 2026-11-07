import { expect, test } from '@playwright/test';

for (const width of [320, 375, 768, 1440]) {
  test(`editorial pages remain readable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const route of [
      '/about',
      '/blog',
      '/blog/threadplane-0-3-0',
      '/blog/ag-ui-vs-webmcp',
    ]) {
      await page.goto(route);
      await expect(page.locator('h1')).toHaveCount(1);
      expect(
        (await page.locator('h1').boundingBox())?.y
      ).toBeGreaterThanOrEqual(112);
      if (route.startsWith('/blog/')) {
        await expect(page.locator('.docs-prose h2').first()).toBeVisible();
        await expect(page.locator('.blog-post-meta')).toContainText('min read');
        if (width < 1024) {
          await page.locator('.blog-mobile-toc summary').click();
          await expect(
            page.getByRole('navigation', { name: 'Article contents' })
          ).toBeVisible();
        } else {
          await expect(page.locator('.docs-toc')).toBeVisible();
        }
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
        route
      ).toBe(width);
    }
  });
}

for (const width of [375, 1440]) {
  test(`article contents navigate beneath the header at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/blog/ag-ui-vs-webmcp');
    await expect(page.locator('.docs-prose h2').first()).toBeVisible();
    const target = page.locator('.docs-prose h2').nth(1);
    const id = await target.getAttribute('id');
    expect(id).toBeTruthy();
    const toc =
      width < 1024
        ? page.locator('.blog-mobile-toc')
        : page.locator('.docs-toc');
    if (width < 1024) await toc.locator('summary').click();
    await toc.locator(`a[href="#${id}"]`).click();
    await expect(page).toHaveURL(new RegExp(`#${id}$`));
    await expect
      .poll(async () => (await target.boundingBox())?.y ?? 0)
      .toBeGreaterThanOrEqual(64);
    await expect
      .poll(async () => (await target.boundingBox())?.y ?? 900)
      .toBeLessThan(140);
    await expect(page.locator('.mdx-pre-copy').first()).toBeVisible();
    await page.getByRole('link', { name: 'All articles', exact: true }).click();
    await expect(page).toHaveURL(/\/blog$/);
  });
}
