import { test, expect, type Page } from '@playwright/test';
import { fromPageOrReactPreview } from './fixtures/react-preview-requests';

const route = '/docs/render/guides/state-store';
const reactFrame =
  /(?:localhost:4615(?:[/?#]|$)|\/render\/state-management\/react\/?(?:[?#]|$))/;
const iframe = (page: Page) =>
  page.locator('iframe[title="State Management (React preview) live example"]');
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
  await expect(example.getByRole('textbox', { name: 'Name' })).toHaveValue(
    'Alice'
  );
  await expect(example.getByRole('spinbutton', { name: 'Age' })).toHaveValue(
    '30'
  );
  await expect(
    example.getByRole('spinbutton', { name: 'Age' })
  ).toHaveAttribute('aria-invalid', 'false');
  await expect(example.getByRole('combobox', { name: 'Theme' })).toHaveValue(
    'dark'
  );
  await expect(example.getByRole('alert')).toHaveCount(0);
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
  await example.getByRole('textbox', { name: 'Name' }).fill('Ada');
  await example.getByRole('spinbutton', { name: 'Age' }).fill('42');
  await example.getByRole('combobox', { name: 'Theme' }).selectOption('light');
  await example
    .getByRole('combobox', { name: 'Sample' })
    .selectOption({ label: 'Nested Paths' });
  await example.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(
    example.getByRole('heading', { name: 'Nested State Paths', exact: true })
  ).toBeVisible();
  await expect(
    example.getByRole('region', { name: 'Render output' })
  ).toContainText('Ada');
  await expect(
    example.getByRole('region', { name: 'Render output' })
  ).toContainText('light');
  await expect(
    example.getByRole('region', { name: 'Streaming JSON' }).locator('pre')
  ).not.toHaveText('');
}

test('React State Management keeps local Docs, Code and Run aligned', async ({
  page,
}, testInfo) => {
  await page.goto(`${route}?frontend=react`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Example UI')).toHaveValue('react');
  await expect(
    page.getByRole('heading', {
      name: 'React State Management preview',
      exact: true,
    })
  ).toBeVisible();
  await expect(
    page.locator(
      '[data-example-file="cockpit/render/state-management/react/src/state.ts"]'
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
    path: testInfo.outputPath('react-state-management-desktop.png'),
  });
});

test('React State Management restores fresh playback through frontend history', async ({
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
    /(?:localhost:4403(?:[/?#]|$)|\/render\/state-management\/?(?:[?#]|$))/
  );
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await expectFreshRun(page);
});

test('React State Management reloads fresh playback after rendering another sample', async ({
  page,
}) => {
  await page.goto(`${route}?frontend=react&mode=run`, {
    waitUntil: 'domcontentloaded',
  });
  await expectFreshRun(page);
  await renderChangedSample(page);
  await frame(page).getByRole('spinbutton', { name: 'Age' }).fill('151');
  await expect(
    frame(page).getByRole('spinbutton', { name: 'Age' })
  ).toHaveAttribute('aria-invalid', 'true');
  await expect(frame(page).getByRole('alert')).toHaveText(
    'Enter a whole age from 0 to 150.'
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expectFreshRun(page);
});

test('canonical State Management Run resolves edited bindings in all samples without execution', async ({
  page,
}) => {
  await page.goto(`${route}?frontend=react&mode=run`, {
    waitUntil: 'domcontentloaded',
  });
  await expectFreshRun(page);
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('status')).toHaveText('Paused · 0 characters');
  await frame.getByRole('textbox', { name: 'Name' }).fill('Ada');
  await frame.getByRole('spinbutton', { name: 'Age' }).fill('42');
  await frame.getByRole('combobox', { name: 'Theme' }).selectOption('light');
  const output = frame.getByRole('region', { name: 'Render output' });
  for (const [label, heading] of [
    ['User Profile', 'User Profile'],
    ['Nested Paths', 'Nested State Paths'],
    ['Form Display', 'State-Driven Form'],
  ]) {
    await frame
      .getByRole('combobox', { name: 'Sample' })
      .selectOption({ label });
    await frame.getByRole('button', { name: 'Finish' }).click();
    await expect(
      frame.getByRole('heading', { name: heading, exact: true })
    ).toBeVisible();
    await expect(output).toContainText('Ada');
    await expect(output).toContainText(
      label === 'User Profile' ? '42' : 'light'
    );
  }
  await frame.getByRole('button', { name: 'Reset' }).click();
  await expect(frame.getByRole('slider')).toHaveValue('0');
  await expect(frame.getByRole('textbox', { name: 'Name' })).toHaveValue('Ada');
});

test('local React State Management remains usable on a narrow screen', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${route}?frontend=react&mode=run`, {
    waitUntil: 'domcontentloaded',
  });
  await expectFreshRun(page);
  await expect(page.getByLabel('Example UI')).toBeVisible();
  const frame = page.frameLocator('iframe');
  await frame.getByRole('textbox', { name: 'Name' }).fill('Grace');
  await frame.getByRole('button', { name: 'Finish' }).click();
  await expect(
    frame.getByRole('region', { name: 'Render output' })
  ).toContainText('Grace');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('react-state-management-mobile.png'),
  });
});
