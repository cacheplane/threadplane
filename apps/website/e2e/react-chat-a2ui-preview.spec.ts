import { test, expect, type Page } from '@playwright/test';
import { fromPageOrReactPreview } from './fixtures/react-preview-requests';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const route = '/docs/chat/a2ui/overview';
const reactFrame = /(?:127\.0\.0\.1:4646|localhost:4646|chat\/a2ui\/react)/;
const observations = new WeakMap<Page, { requests: string[]; errors: string[] }>();

test.beforeEach(async ({ page }) => {
  const observed = { requests: [] as string[], errors: [] as string[] };
  observations.set(page, observed);
  page.on('request', request => {
    if (['fetch', 'xhr'].includes(request.resourceType()) && /\/threads(?:\/|$)/.test(new URL(request.url()).pathname) && fromPageOrReactPreview(request, reactFrame)) observed.requests.push(request.method());
  });
  page.on('pageerror', error => observed.errors.push(error.message));
});
test.afterEach(async ({ page }, testInfo) => {
  const observed = observations.get(page);
  const receipt = testInfo.outputPath('passive-runtime-requests.json');
  await writeFile(receipt, JSON.stringify(observed, null, 2) + '\n');
  await testInfo.attach('passive-runtime-requests', { path: receipt, contentType: 'application/json' });
  expect(observed?.requests).toEqual([]);
  expect(observed?.errors).toEqual([]);
});

async function hydrated(page: Page, mode: 'Docs' | 'Code' | 'Run') {
  await expect(page.locator('[data-workspace-shell]')).toHaveAttribute('data-hydrated', 'true');
  await expect(page.locator('[data-workspace-shell]')).toHaveAttribute('data-workspace-mode', mode);
}
async function emptyRun(page: Page, draft = '') {
  await hydrated(page, 'Run');
  await expect(page.getByLabel('Example UI')).toHaveValue('react');
  await expect(page).toHaveURL(/frontend=react/);
  await expect(page).toHaveURL(/(?:\?|&)mode=run(?:&|$)/);
  await expect(page.locator('iframe')).toBeVisible();
  await expect(page.locator('iframe')).toHaveAttribute('src', reactFrame);
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('heading', { name: 'Plan a flight', exact: true })).toBeVisible();
  await expect(frame.getByRole('status')).toHaveText('Ready.');
  await expect(frame.getByRole('region', { name: 'Conversation', exact: true }).locator('article')).toHaveCount(0);
  await expect(frame.getByLabel('Message', { exact: true })).toHaveValue(draft);
}
async function mode(page: Page, name: 'Docs' | 'Code' | 'Run') {
  await page.locator('[data-workspace-desktop-navigation]').getByRole('button', { name: name === 'Run' ? /^Run(?:,|$)/ : name, exact: name !== 'Run' }).click();
  await hydrated(page, name);
}

test('native Chat A2UI keeps canonical Docs, Code and Run aligned', async ({ page }, testInfo) => {
  await page.goto(route + '?frontend=react', { waitUntil: 'domcontentloaded' });
  await hydrated(page, 'Docs');
  await expect(page.getByLabel('Example UI')).toHaveValue('react');
  await expect(page.getByRole('heading', { name: 'React chat A2UI preview', exact: true })).toBeVisible();
  await expect(page.locator('[data-example-file="libs/cockpit-a2ui-react/src/protocol.ts"]')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('react-chat-a2ui-docs-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('react-chat-a2ui-docs-mobile.png') });
  await page.setViewportSize({ width: 1280, height: 720 });
  await mode(page, 'Code');
  const files = page.getByRole('complementary', { name: 'File tree' });
  for (const name of ['app.tsx', 'application.ts', 'connection.ts', 'data.ts', 'terminal.ts', 'protocol.ts', 'form.ts', 'actions.ts', 'views.tsx', 'main.tsx', 'styles.css', 'graph.py']) await expect(files.getByRole('button', { name, exact: true })).toBeVisible();
  await expect(page.getByRole('tabpanel')).toContainText('A2uiDemo');
  await files.getByRole('button', { name: 'graph.py', exact: true }).click();
  await expect(page.getByRole('tabpanel')).toContainText('a2ui');
  await expect(files).not.toContainText('fixture');
  await expect(files).not.toContainText('probe');
  await mode(page, 'Run');
  await emptyRun(page);
  const iframeUrl = await page.locator('iframe').getAttribute('src');
  const htmlResponse = await page.request.get(iframeUrl!);
  expect(htmlResponse.ok()).toBe(true);
  const html = await htmlResponse.text();
  const assets = [{ path: 'index.html', sha256: createHash('sha256').update(html).digest('hex') }];
  for (const match of html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)) {
    const url = new URL(match[1], iframeUrl!);
    const response = await page.request.get(url.href);
    expect(response.ok()).toBe(true);
    assets.push({ path: url.pathname.replace('/chat/a2ui/react/', ''), sha256: createHash('sha256').update(await response.body()).digest('hex') });
  }
  expect(assets.some(asset => asset.path.endsWith('.js'))).toBe(true);
  expect(assets.some(asset => asset.path.endsWith('.css'))).toBe(true);
  const assetReceipt = testInfo.outputPath('served-native-assets.json');
  await writeFile(assetReceipt, JSON.stringify(assets, null, 2) + '\n');
  await testInfo.attach('served-native-assets', { path: assetReceipt, contentType: 'application/json' });
  await page.screenshot({ path: testInfo.outputPath('react-chat-a2ui-run-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('Example UI')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.frameLocator('iframe').locator('html').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('react-chat-a2ui-run-mobile.png') });
});

test('native Chat A2UI retains Angular as the canonical default', async ({ page }) => {
  await page.goto(route, { waitUntil: 'domcontentloaded' });
  await hydrated(page, 'Docs');
  await expect(page.getByLabel('Example UI')).toHaveValue('angular');
  await expect(page.getByRole('heading', { name: 'React chat A2UI preview', exact: true })).toHaveCount(0);
  await page.getByLabel('Example UI').selectOption('react');
  await expect(page.getByRole('heading', { name: 'React chat A2UI preview', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/frontend=react/);
});

test('native Chat A2UI preserves its mounted frame and unsent draft through modes and history', async ({ page }) => {
  await page.goto(route + '?frontend=react&mode=run', { waitUntil: 'domcontentloaded' });
  await emptyRun(page);
  const mountedFrame = await page.locator('iframe').elementHandle();
  await page.frameLocator('iframe').getByLabel('Message', { exact: true }).fill('Unsent A2UI history draft');
  await mode(page, 'Docs');
  await expect(page).toHaveURL(/frontend=react/);
  await mode(page, 'Code');
  await expect(page).toHaveURL(/mode=code/);
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await hydrated(page, 'Docs');
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await emptyRun(page, 'Unsent A2UI history draft');
  expect(await page.locator('iframe').evaluate((frame, original) => frame === original, mountedFrame)).toBe(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await emptyRun(page);
});
