import { test, expect, type Page } from '@playwright/test';
const base = '/render/computed-functions/react/';
const output = (page: Page) =>
  page.getByRole('region', { name: 'Render output' });
const observed = new WeakMap<Page, { writes: string[]; errors: string[] }>();
test.beforeEach(async ({ page }) => {
  const writes: string[] = [],
    errors: string[] = [];
  page.on('request', (request) => {
    if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.url());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  observed.set(page, { writes, errors });
});
test.afterEach(async ({ page }) => {
  expect(observed.get(page)?.writes).toEqual([]);
  expect(observed.get(page)?.errors).toEqual([]);
});

test('plays local computation, pauses, rewinds and resets with owned source', async ({
  page,
}) => {
  await page.goto(base);
  await expect(page.getByRole('status')).toHaveText('Paused · 0 characters');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const position = page.getByRole('slider');
  await expect
    .poll(async () => Number(await position.inputValue()))
    .toBeGreaterThan(160);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const paused = await position.inputValue();
  expect(Number(paused)).toBeLessThan(
    Number(await position.getAttribute('max'))
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
  expect(await position.inputValue()).toBe(paused);
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(
    output(page).getByText('HELLO WORLD', { exact: true })
  ).toBeVisible();
  await expect(
    output(page).getByText('gnimaerts', { exact: true })
  ).toBeVisible();
  const source = await page
    .getByRole('region', { name: 'Streaming JSON' })
    .locator('pre')
    .textContent();
  expect(JSON.parse(source!).elements.upper.props.value).toEqual({
    $computed: 'uppercase',
    args: { value: 'hello world' },
  });
  await position.fill('5');
  await expect(
    output(page).getByText('HELLO WORLD', { exact: true })
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(position).toHaveValue('0');
  await expect(
    page.getByRole('region', { name: 'Streaming JSON' }).locator('pre')
  ).toBeEmpty();
});

test('renders every canonical calculation through installed native RenderSpec', async ({
  page,
}, testInfo) => {
  await page.goto(base);
  const dates = await page.evaluate(() =>
    ['2024-06-15T12:00:00Z', '2025-01-01T00:00:00Z'].map((value) =>
      new Date(value).toLocaleDateString()
    )
  );
  for (const [label, values] of [
    ['Text Transforms', ['HELLO WORLD', 'gnimaerts']],
    ['Data Display', ['42', dates[0]]],
    ['Mixed Functions', ['60', 'COMPUTED FUNCTIONS', dates[1]]],
  ] as const) {
    await page.getByRole('combobox').selectOption({ label });
    await page.getByRole('button', { name: 'Finish' }).click();
    for (const value of values)
      await expect(
        output(page).getByText(value, { exact: true })
      ).toBeVisible();
    await expect(page.getByRole('status')).toContainText('Complete');
  }
  await page.screenshot({
    path: testInfo.outputPath('computed-functions-desktop.png'),
  });
});

test('sample selection and pagehide revoke previous playback generations', async ({
  page,
}) => {
  await page.goto(base);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('combobox').selectOption({ label: 'Data Display' });
  await expect(page.getByRole('status')).toHaveText('Paused · 0 characters');
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(output(page).getByText('42', { exact: true })).toBeVisible();
  await expect(
    output(page).getByText('HELLO WORLD', { exact: true })
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect(page.locator('#root')).toBeEmpty();
});

test('fits mobile and exposes no backend API fixture', async ({
  page,
  request,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base);
  await page.getByRole('combobox').selectOption({ label: 'Mixed Functions' });
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(output(page).getByText('60', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('computed-functions-mobile.png'),
  });
  for (const route of [
    '/api/native/threads',
    '/developer-api/threads',
    '/__fixture',
  ])
    expect((await request.get(route)).status()).toBe(404);
  expect((await request.post('/api/native/threads')).status()).toBe(405);
});
