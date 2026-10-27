import { expect, test, type Page } from '@playwright/test';

const observations = new WeakMap<Page, { writes: string[]; errors: string[] }>();

test.beforeEach(async ({ page }) => {
  const observed = { writes: [] as string[], errors: [] as string[] };
  observations.set(page, observed);
  page.on('request', (request) => {
    if (
      !['GET', 'HEAD'].includes(request.method()) &&
      /\/agent(?:\/|$)|\/api\/native(?:\/|$)|\/api\/threads(?:\/|$)|\/threads(?:\/|$)/.test(
        new URL(request.url()).pathname
      )
    ) observed.writes.push(request.url());
  });
  page.on('pageerror', (error) => observed.errors.push(error.message));
});

test.afterEach(async ({ page }) => {
  expect(observations.get(page)?.writes).toEqual([]);
  expect(observations.get(page)?.errors).toEqual([]);
});

for (const viewport of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`static React runtime explains browser execution on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto('/docs/render/guides/state-store?frontend=react&mode=run', {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.locator('[data-workspace-shell]')).toHaveAttribute('data-hydrated', 'true');
    const example = page.locator('iframe[title="State Management (React preview) live example"]').contentFrame();
    await expect(example.getByRole('status')).toHaveText('Paused · 0 characters');
    await example.getByRole('textbox', { name: 'Name' }).fill('Ada');
    await example.getByRole('button', { name: 'Finish', exact: true }).click();
    await expect(example.getByRole('region', { name: 'Render output' })).toContainText('Ada');

    if (viewport.name === 'mobile') {
      await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Documentation control plane', exact: true })).toBeVisible();
    }
    const section = page.locator('[data-runtime-section]:visible');
    const toggle = section.getByRole('button', { name: 'Runtime', exact: true });
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    await expect(section.locator('[data-runtime-status]')).toHaveAttribute('data-runtime-phase', 'ready');
    await expect(section.getByText('Runs in your browser', { exact: true })).toBeVisible();
    await expect(section.getByText('Browser · Render', { exact: true })).toBeVisible();
    await expect(section.getByText('Runtime target unavailable', { exact: true })).toHaveCount(0);
    await expect(section.getByText('Python · Render', { exact: true })).toHaveCount(0);
    await section.locator('[data-runtime-metadata]').scrollIntoViewIfNeeded();
    await expect(section.getByText('Runs in your browser', { exact: true })).toBeInViewport();
    await expect(section.getByText('Browser · Render', { exact: true })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`static-browser-runtime-${viewport.name}.png`) });
    if (viewport.name === 'mobile') {
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: 'Documentation control plane', exact: true })).toBeHidden();
      await expect(example.getByRole('region', { name: 'Render output' })).toContainText('Ada');
    }
  });
}

test('live LangGraph metadata preserves its backend language and shared target', async ({ page }) => {
  await page.goto('/docs/langgraph/guides/streaming?mode=code', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-workspace-shell]')).toHaveAttribute('data-hydrated', 'true');
  await expect(page.locator('[data-workspace-shell]')).toHaveAttribute('data-workspace-mode', 'Code');
  const section = page.locator('[data-runtime-section]:visible');
  const toggle = section.getByRole('button', { name: 'Runtime', exact: true });
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await expect(section.getByText('Python · LangGraph', { exact: true })).toBeVisible();
  await expect(section.getByText('Shared development', { exact: true })).toBeVisible();
  await expect(section.getByText('Runs in your browser', { exact: true })).toHaveCount(0);
});
