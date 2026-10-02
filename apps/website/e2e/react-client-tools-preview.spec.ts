import { test, expect } from '@playwright/test';

test('public React client tools aligns the canonical Chat guide, source, runtime and history', async ({ page }, testInfo) => {
  await page.goto('/docs/chat/guides/client-tools?frontend=react');
  await expect(page.getByLabel('Example UI')).toHaveValue('react');
  await expect(page.getByRole('heading', { name: 'React client-tools preview', exact: true })).toBeVisible();
  await expect(page.locator('[data-example-file="cockpit/langgraph/client-tools/react/src/tools.ts"]')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('react-client-tools-docs-desktop.png') });
  await page.locator('[data-workspace-desktop-navigation]').getByRole('button', { name: 'Code', exact: true }).click();
  await expect(page).toHaveURL(/frontend=react/);
  await page.locator('[data-workspace-desktop-navigation]').getByRole('button', { name: /^Run(?:,|$)/ }).click();
  await expect(page.locator('iframe')).toHaveAttribute('src', /(?:localhost:4603|langgraph\/client-tools\/react)/);
  await page.getByLabel('Example UI').selectOption('angular');
  await expect(page).not.toHaveURL(/frontend=react/);
  await page.goBack();
  await expect(page.getByLabel('Example UI')).toHaveValue('react');
  await page.reload();
  await expect(page.locator('iframe')).toHaveAttribute('src', /(?:localhost:4603|langgraph\/client-tools\/react)/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('Example UI')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('react-client-tools-docs-mobile.png') });
});

test('frontend switching keeps the selected mode and URL aligned while route responses are delayed', async ({ page }) => {
  await page.goto('/docs/chat/guides/client-tools?frontend=react#ownership');
  await expect(page.getByLabel('Example UI')).toHaveValue('react');
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let heldCount = 0, pendingResponses = 0;
  await page.route('**/docs/chat/guides/client-tools?*', async route => {
    if (!new URL(route.request().url()).searchParams.has('_rsc')) {
      await route.continue(); return;
    }
    heldCount++; pendingResponses++;
    try {
      await held;
      await route.continue();
      await (await route.request().response())?.finished();
    } catch { /* The superseded navigation may be cancelled by the router. */ }
    finally { pendingResponses--; }
  });
  try {
    await page.locator('[data-workspace-desktop-navigation]').getByRole('button', { name: /^Run(?:,|$)/ }).click();
    await expect(page.locator('iframe')).toHaveAttribute('src', /(?:localhost:4603|langgraph\/client-tools\/react)/);
    await expect.poll(() => heldCount).toBeGreaterThan(0);
    await page.getByLabel('Example UI').selectOption('angular');
    await expect(page).not.toHaveURL(/frontend=react/);
    await expect(page).toHaveURL(/mode=run/);
    await expect(page.getByLabel('Example UI')).toHaveValue('angular');
    release();
    await expect.poll(() => pendingResponses).toBe(0);
    await expect(page).not.toHaveURL(/frontend=react/);
    await expect(page).toHaveURL(/mode=run.*#ownership$/);
    await expect(page.getByLabel('Example UI')).toHaveValue('angular');
    await page.goBack();
    await expect(page.getByLabel('Example UI')).toHaveValue('react');
  } finally { release(); await page.unrouteAll({ behavior: 'wait' }); }
});

test('switching away disposes pending browser decisions and returning starts empty', async ({ page, request }) => {
  test.skip(Boolean(process.env['BASE_URL']), 'Local browser decision ownership is verified before deployment');
  await request.post('http://127.0.0.1:4603/__reset');
  await page.goto('/docs/chat/guides/client-tools?frontend=react&mode=run');
  const frame = page.frameLocator('iframe');
  await frame.getByLabel('Message', { exact: true }).fill('Bookings');
  await frame.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(frame.getByRole('button', { name: 'Confirm booking' })).toHaveCount(2);
  const oldFrame = await page.locator('iframe').elementHandle();
  await page.getByLabel('Example UI').selectOption('angular');
  expect(await oldFrame?.evaluate((element) => element.isConnected)).toBe(false);
  await page.getByLabel('Example UI').selectOption('react');
  await expect(frame.getByRole('status')).toHaveText('Ready.');
  await expect(frame.getByRole('region', { name: 'Booking decisions' })).toContainText('No booking decisions yet.');
  const before = await (await request.get('http://127.0.0.1:4603/__requests')).json();
  expect(before.filter((entry: { path: string }) => entry.path.endsWith('/runs/stream'))).toHaveLength(1);
  await frame.getByLabel('Message', { exact: true }).fill('Weather');
  await frame.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(frame.getByRole('status')).toHaveText('Response complete.');
  const proof = await (await request.get('http://127.0.0.1:4603/__requests')).json();
  expect(proof.filter((entry: { path: string }) => entry.path === '/api/threads')).toHaveLength(2);
  expect(proof.filter((entry: { path: string }) => entry.path.endsWith('/runs/stream'))).toHaveLength(3);
});
