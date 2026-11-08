import { expect, test } from '@playwright/test';
import { chooseFramework, frameworkControl, selectFramework } from './fixtures/framework-controls';

const angular = '/docs/angular/langgraph/guides/streaming';
const react = '/docs/react/langgraph/guides/streaming';
const preferenceKey = 'threadplane.docs.framework';

// These tests need only the website at BASE_URL, never a running example backend.
test('a JavaScript-disabled hard load renders the selected React article and canonical metadata', async ({ browser, baseURL }) => {
  // Next dev streams the article into a hidden Suspense segment that needs
  // its development script to reveal it; the public no-JS contract is the
  // prerendered production response, also exercised against deployed BASE_URLs.
  test.skip(
    !process.env['BASE_URL'] && process.env['WEBSITE_E2E_MODE'] !== 'production',
    'The no-JavaScript rendering contract requires production output.'
  );
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    const response = await page.goto(react);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'React streaming preview', exact: true })).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://threadplane.ai${react}`);
    await expect(page.locator('[data-docs-framework="angular"]')).toHaveCount(0);
    await expect(page.locator('article').first()).toContainText('experimental, private source-build packages');
  } finally {
    await context.close();
  }
});

test('route identity wins over opposite storage and obsolete frontend queries without starting agent work', async ({ page }) => {
  const executions: string[] = [];
  page.on('request', request => {
    if (!['GET', 'HEAD'].includes(request.method()) && /\/(?:threads|runs|agent|chat\/completions)(?:\/|$)/.test(new URL(request.url()).pathname)) executions.push(request.url());
  });
  await page.addInitScript(key => { if (window === window.top) localStorage.setItem(key, 'angular'); }, preferenceKey);
  await page.goto(`${react}?frontend=angular`);
  await expect(page.locator('[data-workspace-shell]')).toHaveAttribute('data-hydrated', 'true');
  await expect(await frameworkControl(page)).toHaveAttribute('data-value', 'react');
  await expect(page.getByRole('heading', { name: 'React streaming preview', exact: true })).toBeVisible();
  await expect(page.locator('[data-example-file="cockpit/langgraph/streaming/react/src/app.tsx"]')).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), preferenceKey)).toBe('react');
  expect(executions).toEqual([]);
});

test('framework navigation remains reachable in Code and preserves supported modes while dropping missing anchors', async ({ page }) => {
  await page.goto(`${react}?mode=code#build-from-source`);
  await expect(page.locator('[data-workspace-shell]')).toHaveAttribute('data-workspace-mode', 'Code');
  await selectFramework(page, 'angular');
  await expect(page).toHaveURL(`${angular}?mode=code`);
  await expect(page.locator('[data-workspace-shell]')).toHaveAttribute('data-workspace-mode', 'Code');
  await expect(await frameworkControl(page)).toHaveAttribute('data-value', 'angular');
  await selectFramework(page, 'react');
  await expect(page).toHaveURL(`${react}?mode=code`);
});

for (const width of [1440, 390]) {
  test(`framework selection stays disabled through a held server navigation at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${react}?mode=code`);
  const host = page.locator('[data-website-workspace-host]');
  await expect(host).toHaveAttribute('data-workspace-framework', 'react');
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let intercepted = false;
  await page.route(url => url.pathname === angular && url.searchParams.has('_rsc'), async route => {
    intercepted = true;
    await held;
    await route.continue();
  });
  try {
    const control = await frameworkControl(page);
    await chooseFramework(page, 'angular');
    await expect.poll(() => intercepted).toBe(true);
    if (width < 768) {
      await expect(control).not.toBeVisible();
      await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    }
    await expect(control).toBeDisabled();
    await expect(host).toHaveAttribute('data-workspace-framework', 'react');
    release();
    await expect(page).toHaveURL(`${angular}?mode=code`);
    await expect(host).toHaveAttribute('data-workspace-framework', 'angular');
    await selectFramework(page, 'react');
    await expect(page).toHaveURL(`${react}?mode=code`);
    await expect(host).toHaveAttribute('data-workspace-framework', 'react');
    await expect(page.locator('[data-workspace-shell]')).toHaveAttribute('data-workspace-mode', 'Code');
  } finally {
    release();
  }
});
}

test('missing counterparts stay unavailable with a separate introduction destination on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/docs/angular/langgraph/concepts/angular-signals');
  const control = await frameworkControl(page);
  await control.click();
  await expect(page.getByRole('menuitemradio', { name: /React/ })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-framework-selector]:visible').getByText('This topic is not available for React.')).toBeVisible();
  const introduction = page.locator('[data-framework-selector]:visible').getByRole('link', { name: 'React introduction', exact: true });
  await expect(introduction).toHaveAttribute('href', '/docs/react/getting-started/introduction');
  await introduction.click();
  await expect(page).toHaveURL('/docs/react/getting-started/introduction');
  await expect(page.getByRole('heading', { name: 'React documentation', exact: true })).toBeVisible();
});

for (const width of [1440, 390]) {
  test(`React onboarding reaches a real quickstart counterpart at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/docs/react/getting-started/introduction');
    // Desktop navigation mounts during hydration and moves the article. Start
    // the pointer gesture after the shell's published readiness boundary.
    await expect(page.locator('[data-workspace-shell]')).toHaveAttribute('data-hydrated', 'true');
    await page.locator('article').getByRole('link', { name: 'chat quickstart', exact: true }).click();
    await expect(page).toHaveURL('/docs/react/chat/getting-started/quickstart');
    await expect(page.getByRole('heading', { name: 'Compose your first React chat', exact: true })).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://threadplane.ai/docs/react/chat/getting-started/quickstart');
    await selectFramework(page, 'angular');
    await expect(page).toHaveURL('/docs/angular/chat/getting-started/quickstart');
    await selectFramework(page, 'react');
    await expect(page).toHaveURL('/docs/react/chat/getting-started/quickstart');
    await expect(page.getByRole('heading', { name: 'Compose your first React chat', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('shared documents keep their canonical identity when guide preference changes', async ({ page }) => {
  const shared = '/docs/shared/middleware/getting-started/introduction';
  await page.goto(shared);
  await chooseFramework(page, 'react');
  await expect(page).toHaveURL(shared);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://threadplane.ai${shared}`);
  await expect(page.locator('[data-docs-framework="shared"]')).toBeVisible();
  await expect(page.getByRole('link', { name: 'React overview', exact: true })).toHaveAttribute('href', '/docs/react/getting-started/introduction');
});

test('storage denial retains explicit framework selection in the current tab', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException('Blocked', 'SecurityError'); };
    Storage.prototype.setItem = () => { throw new DOMException('Blocked', 'SecurityError'); };
  });
  await page.goto('/docs/shared/middleware/getting-started/introduction');
  await chooseFramework(page, 'react');
  await expect(await frameworkControl(page)).toHaveAttribute('data-value', 'react');
  await expect(page.getByRole('link', { name: 'React overview', exact: true })).toHaveAttribute('href', '/docs/react/getting-started/introduction');
});

test('cross-tab preference changes do not navigate or relabel an open article', async ({ page, context }) => {
  await page.goto(angular);
  await expect(await frameworkControl(page)).toHaveAttribute('data-value', 'angular');
  const other = await context.newPage();
  await other.goto(react);
  await expect(await frameworkControl(other)).toHaveAttribute('data-value', 'react');
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key), preferenceKey)).toBe('react');
  await expect(page).toHaveURL(angular);
  await expect(await frameworkControl(page)).toHaveAttribute('data-value', 'angular');
  await other.close();
});

test('retired narratives and missing framework variants return 404 without redirects', async ({ request }) => {
  for (const pathname of [
    '/docs/langgraph/guides/streaming',
    '/docs/langgraph/guides/streaming?frontend=react',
    '/docs/react/langgraph/concepts/angular-signals',
    '/docs/vue/langgraph/guides/streaming',
    '/api/markdown/langgraph/guides/streaming',
  ]) {
    const response = await request.get(pathname, { maxRedirects: 0 });
    expect(response.status(), pathname).toBe(404);
    expect(response.headers()['location'], pathname).toBeUndefined();
  }
});
