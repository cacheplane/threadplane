import { test, expect, type Page } from '@playwright/test';
import { fromPageOrReactPreview } from './fixtures/react-preview-requests';

const route = '/docs/render/api/provide-render';
const reactFrame =
  /(?:localhost:4619(?:[/?#]|$)|\/render\/computed-functions\/react\/?(?:[?#]|$))/;
const iframe = (page: Page) =>
  page.locator(
    'iframe[title="Computed Functions (React preview) live example"]'
  );
const frame = (page: Page) => iframe(page).contentFrame();

test.beforeEach(async ({ page }) => {
  const executions: string[] = [];
  const errors: string[] = [];
  page.on('request', (request) => {
    if (
      !['GET', 'HEAD'].includes(request.method()) &&
      /\/agent(?:\/|$)|\/api\/native(?:\/|$)|\/api\/threads(?:\/|$)|\/threads(?:\/|$)/.test(
        new URL(request.url()).pathname
      ) &&
      fromPageOrReactPreview(request, reactFrame)
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
  await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
    'data-hydrated',
    'true'
  );
  await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
    'data-workspace-mode',
    'Run'
  );
  await expect(iframe(page)).toBeVisible();
  await expect(page.getByLabel('Example UI')).toHaveValue('react');
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === route &&
      url.searchParams.get('frontend') === 'react' &&
      url.searchParams.get('mode') === 'run'
  );
  await expect(iframe(page)).toHaveAttribute(
    'src',
    reactFrame
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
    .selectOption({ label: 'Data Display' });
  await example.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(
    example.getByRole('heading', { name: 'Formatted Data', exact: true })
  ).toBeVisible();
  await expect(
    example.getByRole('region', { name: 'Streaming JSON' }).locator('pre')
  ).not.toHaveText('');
}

test('React Computed Functions keeps local Docs, Code and Run aligned', async ({
  page,
}, testInfo) => {
  await page.goto(`${route}?frontend=react`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Example UI')).toHaveValue('react');
  await expect(
    page.getByRole('heading', {
      name: 'React Computed Functions preview',
      exact: true,
    })
  ).toBeVisible();
  await expect(
    page.locator(
      '[data-example-file="cockpit/render/computed-functions/react/src/playback.ts"]'
    )
  ).toBeVisible();
  await expect(page.locator('[data-example-file*="/python/"]')).toHaveCount(0);
  await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
    'data-hydrated',
    'true'
  );
  const navigation = page.locator('[data-workspace-desktop-navigation]');
  await navigation.getByRole('button', { name: 'Code', exact: true }).click();
  await expect(page).toHaveURL(/frontend=react/);
  await expect(page).toHaveURL(/mode=code/);
  await navigation.getByRole('button', { name: /^Run(?:,|$)/ }).click();
  await expectFreshRun(page);
  await page.screenshot({
    path: testInfo.outputPath('react-computed-functions-desktop.png'),
  });
});

test('React Computed Functions restores fresh playback through frontend history', async ({
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
    /(?:localhost:4406(?:[/?#]|$)|\/render\/computed-functions\/?(?:[?#]|$))/
  );
  await expect(
    page
      .locator('iframe')
      .contentFrame()
      .getByRole('button', { name: 'Play or pause', exact: true })
  ).toBeVisible();
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await expectFreshRun(page);
});

test('React Computed Functions reloads fresh playback after rendering another sample', async ({
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

test('canonical Computed Functions Run renders local samples without runtime execution', async ({
  page,
}) => {
  await page.goto(`${route}?frontend=react&mode=run`, {
    waitUntil: 'domcontentloaded',
  });
  await expectFreshRun(page);
  const example = frame(page);
  const dates = await example
    .locator('body')
    .evaluate(() =>
      ['2024-06-15T12:00:00Z', '2025-01-01T00:00:00Z'].map((value) =>
        new Date(value).toLocaleDateString()
      )
    );
  for (const [label, heading, values] of [
    ['Text Transforms', 'Text Transforms', ['HELLO WORLD', 'gnimaerts']],
    ['Data Display', 'Formatted Data', ['42', dates[0]]],
    [
      'Mixed Functions',
      'Mixed Functions',
      ['60', 'COMPUTED FUNCTIONS', dates[1]],
    ],
  ] as const) {
    await example
      .getByRole('combobox', { name: 'Sample' })
      .selectOption({ label });
    await example.getByRole('button', { name: 'Finish', exact: true }).click();
    await expect(
      example.getByRole('heading', { name: heading, exact: true })
    ).toBeVisible();
    for (const value of values)
      await expect(
        example
          .getByRole('region', { name: 'Render output' })
          .getByText(value, { exact: true })
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

test('local React Computed Functions remains usable on a narrow screen', async ({
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
      name: 'Text Transforms',
      exact: true,
    })
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('react-computed-functions-mobile.png'),
  });
});
