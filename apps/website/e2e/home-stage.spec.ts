import { test, expect } from '@playwright/test';

test('homepage uses the hero demo and five focused capabilities without a duplicate pinned stage', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('[data-hero-demo]')).toHaveCount(1);
  await expect(page.locator('#capabilities article')).toHaveCount(5);
  await expect(
    page.locator('#stage, [data-stage-act], #stage-heading')
  ).toHaveCount(0);
  await expect(page.locator('.hero-subhead')).toHaveCount(0);
});
