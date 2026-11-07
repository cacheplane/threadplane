import { test, expect } from '@playwright/test';

const SLUGS = ['compliance', 'analytics', 'customer-support'];

test.describe('Solutions detail pages', () => {
  for (const slug of SLUGS) {
    test(`/solutions/${slug} renders the new sections`, async ({ page }) => {
      await page.goto(`/solutions/${slug}`);
      // Hero
      await expect(page.locator('#solution-hero-heading')).toBeVisible();
      // Pain points section heading
      await expect(page.locator('#problem-heading')).toBeVisible();
      // Architecture section heading
      await expect(page.locator('#arch-heading')).toBeVisible();
      // Capabilities section heading
      await expect(page.locator('#capabilities-heading')).toBeVisible();
      // FinalCTA picks up the per-solution headline
      await expect(page.locator('#final-cta-heading')).toBeVisible();
    });
  }

  test('/solutions/compliance shows the @threadplane/langgraph package pill', async ({ page }) => {
    await page.goto('/solutions/compliance');
    await expect(page.getByText('@threadplane/langgraph').first()).toBeVisible();
  });

  test('/solutions/unknown-slug returns 404', async ({ page }) => {
    const response = await page.goto('/solutions/unknown-slug');
    expect(response?.status()).toBe(404);
  });
});

test('overview links to each use case and the shared services offer', async ({ page }) => {
  await page.goto('/solutions');
  await expect(page.locator('.solutions-story')).toHaveCount(3);
  for (const slug of SLUGS) {
    await expect(page.locator(`.solutions-story a[href="/solutions/${slug}"]`)).toBeVisible();
  }
  await expect(page.getByRole('link', { name: 'Explore our services' })).toHaveAttribute('href', '/pricing#services');
});

for (const width of [320, 375, 768, 1440]) {
  test(`Solutions pages fit the viewport and code stays usable at ${width}px`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['/solutions', ...SLUGS.map(slug => `/solutions/${slug}`)]) {
      await page.goto(route);
      await expect(page.locator('h1')).toHaveCount(1);
      // The navigation is fixed; leave breathing room below its 64px height.
      expect((await page.locator('h1').boundingBox())?.y, route).toBeGreaterThanOrEqual(112);
      if (width < 768) {
        expect((await page.getByRole('textbox', { name: 'Work email' }).boundingBox())?.width, route).toBeGreaterThanOrEqual(200);
      }
      await expect(page.locator('.solutions-page [data-ui="eyebrow"]')).toBeHidden();
      if (route !== '/solutions') {
        const disclosure = page.locator('.solutions-code-disclosure');
        await disclosure.locator('summary').focus();
        await page.keyboard.press('Enter');
        await expect(disclosure).toHaveAttribute('open', '');
        await expect(disclosure.locator('pre').first()).toBeVisible();
        await expect(page.locator('#solution-demo-heading')).toHaveCount(route.endsWith('analytics') ? 0 : 1);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth), route).toBe(width);
    }
  });
}
