import { test, expect, type Page } from '@playwright/test';
import { fromPageOrReactPreview } from './fixtures/react-preview-requests';
const route = '/docs/deep-agents/capabilities/filesystem';
const reactFrame = /(?:localhost:4629|deep-agents\/filesystem\/react)/;
const observations = new WeakMap<
  Page,
  { requests: string[]; errors: string[] }
>();
test.beforeEach(async ({ page }) => {
  const observed = { requests: [] as string[], errors: [] as string[] };
  observations.set(page, observed);
  page.on('request', (request) => {
    if (
      ['fetch', 'xhr'].includes(request.resourceType()) &&
      /\/threads(?:\/|$)/.test(new URL(request.url()).pathname) &&
      fromPageOrReactPreview(request, reactFrame)
    )
      observed.requests.push(request.method());
  });
  page.on('pageerror', (error) => observed.errors.push(error.message));
});
test.afterEach(async ({ page }) => {
  expect(observations.get(page)?.requests).toEqual([]);
  expect(observations.get(page)?.errors).toEqual([]);
});
async function hydrated(page: Page, mode: 'docs' | 'code' | 'run') {
  await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
    'data-hydrated',
    'true'
  );
  await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
    'data-workspace-mode',
    { docs: 'Docs', code: 'Code', run: 'Run' }[mode]
  );
}
async function emptyRun(page: Page, draft = '') {
  await hydrated(page, 'run');
  await expect(page.getByLabel('Example UI')).toHaveValue('react');
  await expect(page).toHaveURL(/(?:\?|&)mode=run(?:&|$)/);
  await expect(page.locator('iframe')).toBeVisible();
  await expect(page.locator('iframe')).toHaveAttribute('src', reactFrame);
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('status')).toHaveText('Ready.');
  await expect(
    frame
      .getByRole('region', { name: 'Conversation', exact: true })
      .locator('article')
  ).toHaveCount(0);
  await expect(frame.getByLabel('Message', { exact: true })).toHaveValue(draft);
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}
test('native Deep Agents Filesystem keeps canonical Docs, Code and Run aligned', async ({
  page,
}, testInfo) => {
  await page.goto(route + '?frontend=react', { waitUntil: 'domcontentloaded' });
  await hydrated(page, 'docs');
  await expect(page.getByLabel('Example UI')).toHaveValue('react');
  await expect(
    page.getByRole('heading', {
      name: 'React Deep Agents Filesystem preview',
      exact: true,
    })
  ).toBeVisible();
  await expect(
    page.locator(
      '[data-example-file="cockpit/deep-agents/filesystem/react/src/application.ts"]'
    )
  ).toBeVisible();
  await noOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath('react-deep-agents-filesystem-docs-desktop.png'),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath('react-deep-agents-filesystem-docs-mobile.png'),
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page
    .locator('[data-workspace-desktop-navigation]')
    .getByRole('button', { name: 'Code', exact: true })
    .click();
  await hydrated(page, 'code');
  for (const name of [
    'app.tsx',
    'application.ts',
    'connection.ts',
    'workspace-state.ts',
    'approval-state.ts',
    'authority.ts',
    'workspace-panel.tsx',
    'approval-panel.tsx',
    'main.tsx',
    'styles.css',
  ])
    await expect(
      page
        .getByRole('complementary', { name: 'File tree' })
        .getByRole('button', { name, exact: true })
    ).toBeVisible();
  await expect(page.getByRole('tabpanel')).toContainText(
    'createConnectedApplication'
  );
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('react-deep-agents-filesystem-code-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('react-deep-agents-filesystem-code-mobile.png') });
  await page.setViewportSize({ width: 1280, height: 720 });
  const graph = page
    .getByRole('complementary', { name: 'File tree' })
    .getByRole('button', { name: 'graph.py', exact: true });
  await graph.click();
  await expect(page.getByRole('tabpanel')).toContainText('FilesystemPermission');
  await expect(page).toHaveURL(/(?:\?|&)mode=code(?:&|$)/);
  await page
    .locator('[data-workspace-desktop-navigation]')
    .getByRole('button', { name: /^Run(?:,|$)/ })
    .click();
  await emptyRun(page);
  await noOverflow(page);
  expect(await page.frameLocator('iframe').locator('html').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('react-deep-agents-filesystem-run-desktop.png'),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('Example UI')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  expect(
    await page
      .frameLocator('iframe')
      .locator('html')
      .evaluate((element) => element.scrollWidth <= element.clientWidth)
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('react-deep-agents-filesystem-run-mobile.png'),
  });
});
test('the canonical Filesystem guide keeps Angular as its default frontend', async ({
  page,
}) => {
  await page.goto(route, { waitUntil: 'domcontentloaded' });
  await hydrated(page, 'docs');
  await expect(page.getByLabel('Example UI')).toHaveValue('angular');
  await expect(
    page.getByRole('heading', {
      name: 'React Deep Agents Filesystem preview',
      exact: true,
    })
  ).toHaveCount(0);
  await page.getByLabel('Example UI').selectOption('react');
  await expect(
    page.getByRole('heading', {
      name: 'React Deep Agents Filesystem preview',
      exact: true,
    })
  ).toBeVisible();
  await expect(page).toHaveURL(/frontend=react/);
});
test('a direct React run link mounts an empty conversation without creating a thread', async ({
  page,
}) => {
  await page.goto(route + '?frontend=react&mode=run', {
    waitUntil: 'domcontentloaded',
  });
  await emptyRun(page);
});
test('history preserves the mounted React owner and unsent draft without runtime requests', async ({
  page,
}) => {
  await page.goto(route + '?frontend=react&mode=run', {
    waitUntil: 'domcontentloaded',
  });
  await emptyRun(page);
  const mountedFrame = await page.locator('iframe').elementHandle();
  await page
    .frameLocator('iframe')
    .getByLabel('Message', { exact: true })
    .fill('Unsent history draft');
  await expect(
    page.frameLocator('iframe').getByLabel('Message', { exact: true })
  ).toHaveValue('Unsent history draft');
  const before = [...(observations.get(page)?.requests ?? [])];
  await page
    .locator('[data-workspace-desktop-navigation]')
    .getByRole('button', { name: 'Code', exact: true })
    .click();
  await hydrated(page, 'code');
  await expect(page).toHaveURL(/(?:\?|&)mode=code(?:&|$)/);
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await emptyRun(page, 'Unsent history draft');
  expect(
    await page
      .locator('iframe')
      .evaluate((frame, original) => frame === original, mountedFrame)
  ).toBe(true);
  expect(observations.get(page)?.requests).toEqual(before);
});
test('reload clears an unsent React draft without runtime requests', async ({
  page,
}) => {
  await page.goto(route + '?frontend=react&mode=run', {
    waitUntil: 'domcontentloaded',
  });
  await emptyRun(page);
  const before = [...(observations.get(page)?.requests ?? [])];
  await page
    .frameLocator('iframe')
    .getByLabel('Message', { exact: true })
    .fill('Unsent reload draft');
  await expect(
    page.frameLocator('iframe').getByLabel('Message', { exact: true })
  ).toHaveValue('Unsent reload draft');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await emptyRun(page);
  expect(observations.get(page)?.requests).toEqual(before);
});

test('the aviation suggestion fills an exact inert draft', async ({ page }) => {
  await page.goto(route + '?frontend=react&mode=run', {
    waitUntil: 'domcontentloaded',
  });
  await emptyRun(page);
  const frame = page.frameLocator('iframe');
  await frame
    .getByRole('button', { name: 'Runway note for KASE', exact: true })
    .click();
  await expect(frame.getByLabel('Message', { exact: true })).toHaveValue(
    'Work up a runway suitability note for KASE. Save your raw lookups to /notes/kase-data.md, then write the finished note to /reports/kase-runway.md.'
  );
  await frame
    .getByRole('button', { name: 'New conversation', exact: true })
    .click();
  await emptyRun(page);
});
