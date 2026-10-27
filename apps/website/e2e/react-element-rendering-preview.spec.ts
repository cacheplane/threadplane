import { test, expect, type Page } from '@playwright/test';
import { fromPageOrReactPreview } from './fixtures/react-preview-requests';

const route = '/docs/render/api/render-spec-component';
const reactFrame =
  /(?:localhost:4618(?:[/?#]|$)|\/render\/element-rendering\/react\/?(?:[?#]|$))/;
const iframe = (page: Page) =>
  page.locator(
    'iframe[title="Element Rendering (React preview) live example"]'
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
  await expect(
    example.getByRole('checkbox', { name: 'Show detail' })
  ).toBeChecked();
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
  await example.getByRole('combobox', { name: 'Sample' }).selectOption('2');
  await example.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(
    example.locator('[data-element-key="conditional"]')
  ).toBeVisible();
  await example.getByRole('checkbox', { name: 'Show detail' }).uncheck();
  await expect(example.locator('[data-element-key="conditional"]')).toHaveCount(
    0
  );
  await expect(example.locator('[data-element-key="always"]')).toBeVisible();
  await expect(
    example.getByRole('region', { name: 'Streaming JSON' }).locator('pre')
  ).not.toHaveText('');
}

test('React Element Rendering keeps local Docs, Code and Run aligned', async ({
  page,
}, testInfo) => {
  await page.goto(`${route}?frontend=react`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Example UI')).toHaveValue('react');
  await expect(
    page.getByRole('heading', {
      name: 'React Element Rendering preview',
      exact: true,
    })
  ).toBeVisible();
  await expect(
    page.locator(
      '[data-example-file="cockpit/render/element-rendering/react/src/views.tsx"]'
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
    path: testInfo.outputPath('react-element-rendering-desktop.png'),
  });
});

test('React Element Rendering restores fresh playback through frontend history', async ({
  page,
}) => {
  await page.goto(`${route}?frontend=react&mode=run`, {
    waitUntil: 'domcontentloaded',
  });
  await expectFreshRun(page);
  await renderChangedSample(page);
  await page.getByLabel('Example UI').selectOption('angular');
  await expect(page.getByLabel('Example UI')).toHaveValue('angular');
  await expect(page).toHaveURL(`${route}?mode=run`);
  await expect(page.locator('iframe')).toBeVisible();
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    /(?:localhost:4402(?:[/?#]|$)|\/render\/element-rendering\/?(?:[?#]|$))/
  );
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await expectFreshRun(page);
});

test('React Element Rendering reloads fresh playback after rendering another sample', async ({
  page,
}) => {
  await page.goto(`${route}?frontend=react&mode=run`, {
    waitUntil: 'domcontentloaded',
  });
  await expectFreshRun(page);
  await renderChangedSample(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expectFreshRun(page);
  const example = frame(page);
  await example.getByRole('combobox', { name: 'Sample' }).selectOption('2');
  await example.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(
    example.locator('[data-element-key="conditional"]')
  ).toBeVisible();
  await expect(example.locator('[data-element-key="always"]')).toBeVisible();
});

test('canonical Element Rendering Run uses native children and visibility without execution or source changes', async ({
  page,
}) => {
  await page.goto(`${route}?frontend=react&mode=run`, {
    waitUntil: 'domcontentloaded',
  });
  await expectFreshRun(page);
  const frame = page.frameLocator('iframe');
  const output = frame.getByRole('region', { name: 'Render output' });
  const source = frame
    .getByRole('region', { name: 'Streaming JSON' })
    .locator('pre');
  await expect(frame.getByRole('status')).toHaveText('Paused · 0 characters');
  for (const [index, count] of [
    [0, 2],
    [1, 1],
    [2, 2],
  ] as const) {
    await frame
      .getByRole('combobox', { name: 'Sample' })
      .selectOption(String(index));
    await frame.getByRole('button', { name: 'Finish', exact: true }).click();
    await expect(output.locator('p')).toHaveCount(count);
  }
  const original = await source.textContent(),
    position = await frame.getByRole('slider').inputValue();
  await frame.getByRole('checkbox', { name: 'Show detail' }).uncheck();
  await expect(output.locator('[data-element-key="conditional"]')).toHaveCount(
    0
  );
  await expect(source).toHaveText(original ?? '');
  await expect(frame.getByRole('slider')).toHaveValue(position);
  await frame.getByRole('button', { name: 'Reset', exact: true }).click();
  await frame.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(
    frame.getByRole('checkbox', { name: 'Show detail' })
  ).not.toBeChecked();
  await expect(output.locator('[data-element-key="conditional"]')).toHaveCount(
    0
  );
});

test('local React Element Rendering remains usable on a narrow screen', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${route}?frontend=react&mode=run`, {
    waitUntil: 'domcontentloaded',
  });
  await expectFreshRun(page);
  await expect(page.getByLabel('Example UI')).toBeVisible();
  const frame = page.frameLocator('iframe');
  await frame.getByRole('combobox', { name: 'Sample' }).selectOption('2');
  await frame.getByRole('checkbox', { name: 'Show detail' }).uncheck();
  await frame.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(frame.locator('[data-element-key="always"]')).toHaveCount(1);
  await expect(frame.locator('[data-element-key="conditional"]')).toHaveCount(
    0
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('react-element-rendering-mobile.png'),
  });
});
