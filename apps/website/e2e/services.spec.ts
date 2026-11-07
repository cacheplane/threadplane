import { expect, test } from '@playwright/test';

test('Pilot-to-Prod leads directly to a scoped inquiry', async ({ page }) => {
  await page.goto('/pilot-to-prod');
  await expect(page.locator('.pilot-phase')).toHaveCount(3);
  await expect(page.locator('.services-page [data-ui="eyebrow"]')).toHaveCount(
    0
  );
  await page.getByRole('link', { name: 'Request a discovery call' }).click();
  await expect(page).toHaveURL(
    /\/contact\?intent=enterprise&entry=pilot_to_prod$/
  );
  await expect(
    page.getByRole('heading', { name: 'Let’s scope the work.' })
  ).toBeVisible();
  await expect(page.getByLabel('Timeline')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Request a conversation' })
  ).toBeVisible();
});

for (const width of [320, 375, 768, 1440]) {
  test(`services and inquiry pages fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const route of [
      '/pilot-to-prod',
      '/contact',
      '/contact?intent=enterprise&entry=pilot_to_prod',
    ]) {
      await page.goto(route);
      await expect(page.locator('h1')).toHaveCount(1);
      expect(
        (await page.locator('h1').boundingBox())?.y
      ).toBeGreaterThanOrEqual(112);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
        route
      ).toBe(width);
      if (route.startsWith('/contact')) {
        const email = await page
          .getByRole('textbox', { name: 'Work email' })
          .boundingBox();
        expect(email?.width).toBeGreaterThanOrEqual(200);
        if (width < 768) {
          const supportingCopy = await page
            .locator('.contact-editorial-copy')
            .boundingBox();
          if (!email || !supportingCopy) {
            throw new Error(
              `Contact form or supporting copy is missing on ${route}`
            );
          }
          expect(email.y).toBeLessThan(supportingCopy.y);
        }
      }
    }
  });
}
