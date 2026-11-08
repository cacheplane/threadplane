import { test, expect } from '@playwright/test';

test('ownership explains licensing, hosting and support with working destinations', async ({
  page,
}) => {
  await page.goto('/');
  const panel = page.locator('#open-source');
  await expect(panel).toContainText(
    'Every package is MIT licensed, including production use.'
  );
  await expect(panel).toContainText(
    'No Threadplane-hosted service or account required.'
  );
  await expect(
    panel.getByRole('link', { name: 'Explore on GitHub' })
  ).toHaveAttribute('href', 'https://github.com/cacheplane/threadplane');
  await expect(
    panel.getByRole('link', { name: 'work with our team' })
  ).toHaveAttribute('href', '/pricing');
  await expect(
    page.locator('.home-page [data-surface="dark"], .open-source-strip-runway')
  ).toHaveCount(0);
});
