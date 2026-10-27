import { test, expect, type Page } from '@playwright/test';
import { fromPageOrReactPreview } from './fixtures/react-preview-requests';

const route = '/docs/render/guides/repeat-loops';
const reactFrame =
  /(?:localhost:4616(?:[/?#]|$)|\/render\/repeat-loops\/react\/?(?:[?#]|$))/;
const iframe = (page: Page) =>
  page.locator('iframe[title="Repeat Loops (React preview) live example"]');
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
  for (const name of ['Alpha', 'Beta', 'Gamma']) {
    await expect(
      example.getByRole('button', { name: `Remove ${name}`, exact: true })
    ).toBeVisible();
  }
  await expect(
    example.getByRole('button', { name: 'Remove Item 1', exact: true })
  ).toHaveCount(0);
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
    .getByRole('button', { name: 'Remove Alpha', exact: true })
    .click();
  await example.getByRole('button', { name: 'Add Item', exact: true }).click();
  await example
    .getByRole('button', { name: 'Reverse items', exact: true })
    .click();
  await expect(
    example.getByRole('button', { name: 'Remove Alpha', exact: true })
  ).toHaveCount(0);
  await expect(
    example.getByRole('button', { name: 'Remove Item 1', exact: true })
  ).toBeVisible();
  await example
    .getByRole('combobox', { name: 'Sample' })
    .selectOption({ label: 'Sections' });
  await example.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(
    example.getByRole('heading', { name: 'Multiple Sections', exact: true })
  ).toBeVisible();
  await expect(
    example.getByRole('region', { name: 'Streaming JSON' }).locator('pre')
  ).not.toHaveText('');
}

test('React Repeat Loops keeps local Docs, Code and Run aligned', async ({
  page,
}, testInfo) => {
  await page.goto(`${route}?frontend=react`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Example UI')).toHaveValue('react');
  await expect(
    page.getByRole('heading', {
      name: 'React Repeat Loops preview',
      exact: true,
    })
  ).toBeVisible();
  await expect(
    page.locator(
      '[data-example-file="cockpit/render/repeat-loops/react/src/items.ts"]'
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
    path: testInfo.outputPath('react-repeat-loops-desktop.png'),
  });
});

test('React Repeat Loops restores fresh playback through frontend history', async ({
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
    /(?:localhost:4405(?:[/?#]|$)|\/render\/repeat-loops\/?(?:[?#]|$))/
  );
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await expectFreshRun(page);
});

test('React Repeat Loops reloads fresh playback after rendering another sample', async ({
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
  await example.getByRole('button', { name: 'Finish', exact: true }).click();
  const rows = example.locator('[data-repeat-row]');
  await expect(rows).toHaveText(['1. Alpha', '2. Beta', '3. Gamma']);
  expect(
    await rows.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-repeat-row'))
    )
  ).toEqual(['alpha', 'beta', 'gamma']);
  await example.getByRole('button', { name: 'Add Item', exact: true }).click();
  await expect(rows).toHaveText([
    '1. Alpha',
    '2. Beta',
    '3. Gamma',
    '4. Item 1',
  ]);
  await expect(rows.nth(3)).toHaveAttribute('data-repeat-row', 'item-1');
});

test('canonical Repeat Loops Run keeps native row identity, edits and samples without execution', async ({
  page,
}) => {
  await page.goto(`${route}?frontend=react&mode=run`, {
    waitUntil: 'domcontentloaded',
  });
  await expectFreshRun(page);
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('status')).toHaveText('Paused · 0 characters');
  await frame.getByRole('button', { name: 'Finish', exact: true }).click();
  const rows = frame.locator('[data-repeat-row]');
  await expect(rows).toHaveText(['1. Alpha', '2. Beta', '3. Gamma']);
  const alpha = await rows.first().elementHandle();
  const source = frame
    .getByRole('region', { name: 'Streaming JSON' })
    .locator('pre');
  const original = await source.textContent();
  await frame.getByRole('button', { name: 'Reverse items' }).click();
  await expect(rows).toHaveText(['1. Gamma', '2. Beta', '3. Alpha']);
  expect(await rows.nth(2).evaluate((node, old) => node === old, alpha)).toBe(
    true
  );
  await frame.getByRole('button', { name: 'Remove Beta', exact: true }).click();
  await frame.getByRole('button', { name: 'Add Item', exact: true }).click();
  await expect(rows).toHaveText(['1. Gamma', '2. Alpha', '3. Item 1']);
  await expect(source).toHaveText(original ?? '');
  for (const [label, heading] of [
    ['Task List', 'Task List'],
    ['Sections', 'Multiple Sections'],
  ]) {
    await frame
      .getByRole('combobox', { name: 'Sample' })
      .selectOption({ label });
    await frame.getByRole('button', { name: 'Finish', exact: true }).click();
    await expect(
      frame.getByRole('heading', { name: heading, exact: true })
    ).toBeVisible();
    await expect(rows).toHaveCount(0);
  }
  await frame.getByRole('combobox', { name: 'Sample' }).selectOption('0');
  await frame.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(rows).toHaveText(['1. Gamma', '2. Alpha', '3. Item 1']);
  await frame.getByRole('button', { name: 'Reset', exact: true }).click();
  await frame.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(rows).toHaveText(['1. Gamma', '2. Alpha', '3. Item 1']);
});

test('local React Repeat Loops remains usable on a narrow screen', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${route}?frontend=react&mode=run`, {
    waitUntil: 'domcontentloaded',
  });
  await expectFreshRun(page);
  await expect(page.getByLabel('Example UI')).toBeVisible();
  const frame = page.frameLocator('iframe');
  await frame.getByRole('button', { name: 'Add Item', exact: true }).click();
  await frame.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(frame.locator('[data-repeat-row]')).toHaveText([
    '1. Alpha',
    '2. Beta',
    '3. Gamma',
    '4. Item 1',
  ]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('react-repeat-loops-mobile.png'),
  });
});
