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
  await page.locator('.docs-entry-install summary').first().click();
  const copy = page.locator('.docs-entry-install').first().getByRole('button');
  expect(await copy.evaluate((button) => button.closest('a') === null)).toBe(
    true
  );
  await copy.click();
  await expect(page).toHaveURL(/\/docs$/);
  await expect(copy).toHaveAttribute('aria-label', 'Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'npm i @threadplane/chat @threadplane/langgraph @langchain/core @langchain/langgraph-sdk marked'
  );
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
