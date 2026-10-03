import { test, expect } from '@playwright/test';
const base = '/render/spec-rendering/react/';

test('plays real installed partial JSON, pauses, rewinds and resets without runtime requests', async ({
  page,
}) => {
  const writes: string[] = [];
  const errors: string[] = [];
  page.on('request', (request) => {
    if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.url());
  });
  page.on('pageerror', (error) => errors.push(error.message));
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
  await expect(
    page.getByRole('region', { name: 'Streaming JSON' }).locator('pre')
  ).not.toBeEmpty();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
  expect(await position.inputValue()).toBe(paused);
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(
    page.getByRole('heading', { name: 'Welcome to React Spec Rendering' })
  ).toBeVisible();
  await position.fill('5');
  await expect(
    page.getByRole('heading', { name: 'Welcome to React Spec Rendering' })
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(position).toHaveValue('0');
  await expect(
    page.getByRole('region', { name: 'Streaming JSON' }).locator('pre')
  ).toBeEmpty();
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test('renders every authored sample through the installed native registry', async ({
  page,
}) => {
  await page.goto(base);
  for (const [label, heading] of [
    ['Heading + Text', 'Welcome to React Spec Rendering'],
    ['Card + Badge', 'Streaming Demo'],
    ['Nested Layout', 'Multi-Level Nesting'],
  ]) {
    await page.getByRole('combobox').selectOption({ label });
    await page.getByRole('button', { name: 'Finish' }).click();
    await expect(
      page
        .getByRole('region', { name: 'Render output' })
        .getByRole('heading', { name: heading })
    ).toBeVisible();
    await expect(page.getByRole('status')).toContainText('Complete');
  }
  const cards = page
    .getByRole('region', { name: 'Render output' })
    .locator('article');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText('Section One');
  await expect(cards.nth(1)).toContainText('Section Two');
});

test('switching mid-play revokes old callbacks and pagehide ends local ownership', async ({
  page,
}) => {
  await page.goto(base);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('combobox').selectOption({ label: 'Card + Badge' });
  await expect(page.getByRole('status')).toHaveText('Paused · 0 characters');
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(
    page.getByRole('heading', { name: 'Streaming Demo' })
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Welcome to React Spec Rendering' })
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect(page.locator('#root')).toBeEmpty();
});

test('fits a narrow viewport and exposes no API fixture', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base);
  await page.getByRole('combobox').selectOption({ label: 'Nested Layout' });
  await page.getByRole('button', { name: 'Finish' }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  for (const route of [
    '/api/native/threads',
    '/developer-api/threads',
    '/__fixture',
  ])
    expect((await request.get(route)).status()).toBe(404);
  expect((await request.post('/api/native/threads')).status()).toBe(405);
});
