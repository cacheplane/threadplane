import { test, expect, type Page } from '@playwright/test';
const route = '/docs/chat/guides/thread-routing';
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
      /\/threads(?:\/|$)/.test(new URL(request.url()).pathname)
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
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    /(?:localhost:4625|chat\/threads\/react)/
  );
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('status')).toHaveText('Ready.');
  await expect(
    frame
      .getByRole('region', { name: 'Conversation', exact: true })
      .locator('article')
  ).toHaveCount(0);
  await expect(frame.getByLabel('Message', { exact: true })).toHaveValue(draft);
}
test('native Chat Threads keeps canonical Docs, Code and Run aligned', async ({
  page,
}, testInfo) => {
  await page.goto(route + '?frontend=react', { waitUntil: 'domcontentloaded' });
  await hydrated(page, 'docs');
  await expect(page.getByLabel('Example UI')).toHaveValue('react');
  await expect(
    page.getByRole('heading', {
      name: 'React chat threads preview',
      exact: true,
    })
  ).toBeVisible();
  await expect(
    page.locator(
      '[data-example-file="cockpit/chat/threads/react/src/application.ts"]'
    )
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('react-chat-threads-docs-desktop.png'),
  });
  await page
    .locator('[data-workspace-desktop-navigation]')
    .getByRole('button', { name: 'Code', exact: true })
    .click();
  await hydrated(page, 'code');
  await expect(page).toHaveURL(/(?:\?|&)mode=code(?:&|$)/);
  await page
    .locator('[data-workspace-desktop-navigation]')
    .getByRole('button', { name: /^Run(?:,|$)/ })
    .click();
  await emptyRun(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('Example UI')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('react-chat-threads-run-mobile.png'),
  });
});
test('the canonical thread-routing guide keeps Angular as its default frontend', async ({
  page,
}) => {
  await page.goto(route, { waitUntil: 'domcontentloaded' });
  await hydrated(page, 'docs');
  await expect(page.getByLabel('Example UI')).toHaveValue('angular');
  await expect(
    page.getByRole('heading', {
      name: 'React chat threads preview',
      exact: true,
    })
  ).toHaveCount(0);
  await page.getByLabel('Example UI').selectOption('react');
  await expect(
    page.getByRole('heading', {
      name: 'React chat threads preview',
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
