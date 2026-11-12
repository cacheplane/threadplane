import { documentationModes } from './fixtures/workspace-controls';
import { selectFramework, expectFrameworkControl } from './fixtures/framework-controls';
import { test, expect } from '@playwright/test';

test('public React client tools aligns the canonical Chat guide, source, runtime and history', async ({ page }, testInfo) => {
  await page.goto('/docs/react/chat/guides/client-tools');
  await expect(page.getByLabel('Framework')).toHaveAttribute('data-value', 'react');
  await expect(page.getByRole('heading', { name: 'React client-tools preview', exact: true })).toBeVisible();
  await expect(page.locator('[data-example-file="cockpit/langgraph/client-tools/react/src/tools.ts"]')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('react-client-tools-docs-desktop.png') });
  await documentationModes(page).getByRole('button', { name: 'Code', exact: true }).click();
  await expect(page).toHaveURL(/\/docs\/react\//);
  await documentationModes(page).getByRole('button', { name: /^Run(?:,|$)/ }).click();
  await expect(page.locator('iframe')).toHaveAttribute('src', /(?:localhost:4603|langgraph\/client-tools\/react)/);
  await selectFramework(page, 'angular');
  await expect(page).not.toHaveURL(/\/docs\/react\//);
  await page.goBack();
  await expect(page.getByLabel('Framework')).toHaveAttribute('data-value', 'react');
  await page.reload();
  await expect(page.locator('iframe')).toHaveAttribute('src', /(?:localhost:4603|langgraph\/client-tools\/react)/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectFrameworkControl(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('react-client-tools-docs-mobile.png') });
});

test('switching away disposes pending browser decisions and returning starts empty', async ({ page, request }) => {
  test.skip(Boolean(process.env['BASE_URL']), 'Local browser decision ownership is verified before deployment');
  await request.post('http://127.0.0.1:4603/__reset');
  await page.goto('/docs/react/chat/guides/client-tools?mode=run');
  const frame = page.frameLocator('iframe');
  await frame.getByLabel('Message', { exact: true }).fill('Bookings');
  await frame.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(frame.getByRole('button', { name: 'Confirm booking' })).toHaveCount(2);
  const oldFrame = await page.locator('iframe').elementHandle();
  await selectFramework(page, 'angular');
  await expect.poll(() => oldFrame?.evaluate((element) => element.isConnected)).toBe(false);
  await selectFramework(page, 'react');
  await expect(frame.locator('.tp-chat-input__footer > [role="status"]')).toHaveText('Ready.');
  await expect(frame.getByRole('button', { name: 'Confirm booking' })).toHaveCount(0);
  const before = await (await request.get('http://127.0.0.1:4603/__requests')).json();
  expect(before.filter((entry: { path: string }) => entry.path.endsWith('/runs/stream'))).toHaveLength(1);
  await frame.getByLabel('Message', { exact: true }).fill('Weather');
  await frame.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(frame.locator('.tp-chat-input__footer > [role="status"]')).toHaveText('Response complete.');
  const proof = await (await request.get('http://127.0.0.1:4603/__requests')).json();
  expect(proof.filter((entry: { path: string }) => entry.path === '/api/threads')).toHaveLength(2);
  expect(proof.filter((entry: { path: string }) => entry.path.endsWith('/runs/stream'))).toHaveLength(3);
});
