import { expect, test } from '@playwright/test';

test('mobile React entry keeps scoped search reachable', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto('/docs/react/getting-started/quickstart');
  await expect(page.locator('[data-workspace-shell]')).toHaveAttribute('data-hydrated', 'true');
  await page
    .getByRole('button', { name: 'Search the docs', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Search documentation' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox').fill('streaming');
  await expect(dialog.getByRole('option').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});

test('React quickstart leads to usable source-build guides', async ({
  page,
}) => {
  await page.goto('/docs/react/getting-started/quickstart');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('React');
  await expect(page.locator('main')).toContainText('source-build');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://threadplane.ai/docs/react/getting-started/quickstart'
  );
  await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0);
  const guide = page.getByRole('link', {
    name: 'Connect LangGraph',
    exact: true,
  });
  await expect(guide).toHaveAttribute(
    'href',
    '/docs/react/langgraph/guides/streaming'
  );
  await guide.click();
  await expect(page).toHaveURL(/\/docs\/react\/langgraph\/guides\/streaming$/);
  await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
    'data-hydrated',
    'true'
  );
});

test('copying an Angular install command keeps the docs hub open', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/docs');
  // Hydration replaces the server fallback with the interactive workspace.
  // Open the disclosure on that stable tree, then verify copying preserves it.
  await expect(page.locator('[data-workspace-shell]')).toHaveAttribute('data-hydrated', 'true');
  const install = page.locator('.docs-entry-install').first();
  await install.locator('summary').click();
  await expect(install).toHaveAttribute('open', '');
  const copy = install.getByRole('button');
  await expect(copy).toBeVisible();
  expect(await copy.evaluate((button) => button.closest('a') === null)).toBe(
    true
  );
  await copy.click();
  await expect(page).toHaveURL(/\/docs$/);
  await expect(copy).toHaveAttribute('aria-label', 'Copied');
  await expect(install).toHaveAttribute('open', '');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'npm i @threadplane/chat @threadplane/langgraph @langchain/core @langchain/langgraph-sdk marked'
  );
});

test('an install disclosure opened before hydration stays open and can copy', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  let releaseScripts: () => void = () => undefined;
  const scriptsReady = new Promise<void>((resolve) => { releaseScripts = resolve; });
  await page.route('**/_next/**', async (route) => {
    if (route.request().resourceType() === 'script') await scriptsReady;
    await route.continue();
  });
  try {
    await page.goto('/docs', { waitUntil: 'commit' });
    const fallback = page.locator('.website-workspace-fallback');
    await expect(fallback).toBeVisible();
    await expect(page.locator('[data-workspace-shell]')).toHaveCount(0);
    const initialInstall = fallback.locator('.docs-entry-install').first();
    await initialInstall.locator('summary').click();
    await expect(initialInstall).toHaveAttribute('open', '');
    releaseScripts();
    await expect(page.locator('[data-workspace-shell]')).toHaveAttribute('data-hydrated', 'true');
    await expect(fallback).toHaveCount(0);
    const install = page.getByRole('region', { name: 'Docs workspace panel', exact: true }).locator('.docs-entry-install').first();
    await expect(install).toHaveAttribute('open', '');
    const copy = install.getByRole('button');
    await copy.click();
    await expect(copy).toHaveAttribute('aria-label', 'Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      'npm i @threadplane/chat @threadplane/langgraph @langchain/core @langchain/langgraph-sdk marked'
    );
    await expect(install).toHaveAttribute('open', '');
  } finally {
    releaseScripts();
  }
});

for (const width of [320, 375, 768, 1440]) {
  test(`docs entry pages remain readable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const route of [
      '/docs',
      '/docs/choosing-an-adapter',
      '/docs/react/getting-started/quickstart',
      '/docs/angular/chat/getting-started/quickstart',
    ]) {
      await page.goto(route);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
        route
      ).toBe(width);
    }
  });
}
