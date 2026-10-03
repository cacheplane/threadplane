import { test, expect, type Page } from '@playwright/test';

const route = '/docs/render/guides/specs';
const iframe = (page: Page) =>
  page.locator('iframe[title="Render Spec (React preview) live example"]');
const frame = (page: Page) => iframe(page).contentFrame();

test.beforeEach(async ({ page }) => {
  const executions: string[] = [];
  const errors: string[] = [];
  page.on('request', (request) => {
    if (
      !['GET', 'HEAD'].includes(request.method()) &&
      /\/agent(?:\/|$)|\/api\/native(?:\/|$)|\/api\/threads(?:\/|$)|\/threads(?:\/|$)/.test(
        new URL(request.url()).pathname
      )
    )
      executions.push(request.url());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  observers.set(page, { executions, errors });
});

const observers = new WeakMap<
  Page,
  { executions: string[]; errors: string[] }
>();
test.afterEach(async ({ page }) => {
  const observed = observers.get(page);
  expect(observed?.executions).toEqual([]);
  expect(observed?.errors).toEqual([]);
});

async function expectFreshRun(page: Page) {
  await expect(page.getByLabel('Example UI')).toHaveValue('react');
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === route &&
      url.searchParams.get('frontend') === 'react' &&
      url.searchParams.get('mode') === 'run'
  );
  await expect(iframe(page)).toHaveAttribute(
    'src',
    /(?:localhost:4614(?:[/?#]|$)|\/render\/spec-rendering\/react\/?(?:[?#]|$))/
  );
  const example = frame(page);
  await expect(example.getByRole('status')).toHaveText('Paused · 0 characters');
  await expect(example.getByRole('combobox', { name: 'Sample' })).toHaveValue(
    '0'
  );
  await expect(
    example.getByRole('slider', { name: 'Playback position' })
  ).toHaveValue('0');
  await expect(
    example.getByRole('region', { name: 'Streaming JSON' }).locator('pre')
  ).toHaveText('');
  await expect(
    example.getByRole('region', { name: 'Render output' })
  ).toContainText('Play a sample to see its view.');
}

async function renderChangedSample(page: Page) {
  const example = frame(page);
  await example
    .getByRole('combobox', { name: 'Sample' })
    .selectOption({ label: 'Card + Badge' });
  await example.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(
    example.getByRole('heading', { name: 'Streaming Demo', exact: true })
  ).toBeVisible();
  await expect(
    example.getByRole('region', { name: 'Streaming JSON' }).locator('pre')
  ).not.toHaveText('');
}

test('React Render Spec keeps local Docs, Code and Run aligned', async ({
  page,
}, testInfo) => {
  await page.goto(`${route}?frontend=react`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Example UI')).toHaveValue('react');
  await expect(
    page.getByRole('heading', {
      name: 'React Render Spec preview',
      exact: true,
    })
  ).toBeVisible();
  await expect(
    page.locator(
      '[data-example-file="cockpit/render/spec-rendering/react/src/playback.ts"]'
    )
  ).toBeVisible();
  await expect(page.locator('[data-example-file*="/python/"]')).toHaveCount(0);
  const navigation = page.locator('[data-workspace-desktop-navigation]');
  await navigation.getByRole('button', { name: 'Code', exact: true }).click();
  await expect(page).toHaveURL(/frontend=react/);
  await expect(page).toHaveURL(/mode=code/);
  await navigation.getByRole('button', { name: /^Run(?:,|$)/ }).click();
  await expectFreshRun(page);
  await page.screenshot({
    path: testInfo.outputPath('react-render-spec-desktop.png'),
  });
});

test('React Render Spec restores fresh playback through frontend history', async ({
  page,
}) => {
  await page.goto(`${route}?frontend=react&mode=run`, {
    waitUntil: 'domcontentloaded',
  });
  await expectFreshRun(page);
  await renderChangedSample(page);
  await page.getByLabel('Example UI').selectOption('angular');
  await expect(page.getByLabel('Example UI')).toHaveValue('angular');
  await expect(page).not.toHaveURL(/frontend=react/);
  await expect(page).toHaveURL(/mode=run/);
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    /(?:localhost:4401(?:[/?#]|$)|\/render\/spec-rendering\/?(?:[?#]|$))/
  );
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await expectFreshRun(page);
});

test('React Render Spec reloads fresh playback after rendering another sample', async ({
  page,
}) => {
  await page.goto(`${route}?frontend=react&mode=run`, {
    waitUntil: 'domcontentloaded',
  });
  await expectFreshRun(page);
  await renderChangedSample(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expectFreshRun(page);
});

test('canonical Render Spec Run renders local samples without runtime execution', async ({
  page,
}) => {
  await page.goto(`${route}?frontend=react&mode=run`, {
    waitUntil: 'domcontentloaded',
  });
  await expectFreshRun(page);
  const example = frame(page);
  for (const [label, heading] of [
    ['Heading + Text', 'Welcome to React Spec Rendering'],
    ['Card + Badge', 'Streaming Demo'],
    ['Nested Layout', 'Multi-Level Nesting'],
  ]) {
    await example
      .getByRole('combobox', { name: 'Sample' })
      .selectOption({ label });
    await example.getByRole('button', { name: 'Finish', exact: true }).click();
    await expect(
      example.getByRole('heading', { name: heading, exact: true })
    ).toBeVisible();
  }
  await example.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(
    example.getByRole('slider', { name: 'Playback position' })
  ).toHaveValue('0');
  await expect(
    example.getByRole('region', { name: 'Streaming JSON' }).locator('pre')
  ).toHaveText('');
});

test('local React Render Spec remains usable on a narrow screen', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${route}?frontend=react&mode=run`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.getByLabel('Example UI')).toBeVisible();
  await expectFreshRun(page);
  const example = frame(page);
  await example.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(
    example.getByRole('heading', {
      name: 'Welcome to React Spec Rendering',
      exact: true,
    })
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('react-render-spec-mobile.png'),
  });
});
