import { expect, test } from '@playwright/test';
import { attachBrowserHygiene, openDemo } from './test-helpers';

test('openDemo clears storage before one app startup and preserves later reloads', async ({ page }) => {
  let appStarts = 0;
  await page.route('**/helper-seed', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><title>Seed storage</title>',
  }));
  await page.route('**/helper-app?mode=embed', (route) => {
    appStarts += 1;
    return route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><script>
        document.documentElement.dataset.local = localStorage.getItem('saved') ?? 'empty';
        document.documentElement.dataset.session = sessionStorage.getItem('saved') ?? 'empty';
      </script>`,
    });
  });
  await page.goto('/helper-seed');
  await page.evaluate(() => {
    localStorage.setItem('saved', 'stale');
    sessionStorage.setItem('saved', 'stale');
  });
  const hygiene = attachBrowserHygiene(page);

  await openDemo(page, '/helper-app?mode=embed');

  expect(appStarts).toBe(1);
  await expect(page.locator('html')).toHaveAttribute('data-local', 'empty');
  await expect(page.locator('html')).toHaveAttribute('data-session', 'empty');
  await expect(page).toHaveURL(/\/helper-app\?mode=embed$/);

  await page.evaluate(() => {
    localStorage.setItem('saved', 'current');
    sessionStorage.setItem('saved', 'current');
  });
  await page.reload();
  expect(appStarts).toBe(2);
  await expect(page.locator('html')).toHaveAttribute('data-local', 'current');
  await expect(page.locator('html')).toHaveAttribute('data-session', 'current');

  await openDemo(page, '/helper-app?mode=embed');
  expect(appStarts).toBe(3);
  await expect(page.locator('html')).toHaveAttribute('data-local', 'empty');
  await expect(page.locator('html')).toHaveAttribute('data-session', 'empty');
  expect(hygiene.consoleErrors).toEqual([]);
  expect(hygiene.failedRequests).toEqual([]);
});
