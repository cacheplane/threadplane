import { expect, test } from '@playwright/test';
import { REGISTRY_SAMPLES } from '../src/specs';

test('installed native registry registers, omits and falls back in all three samples without rewriting source', async ({
  page,
}, testInfo) => {
  const writes: string[] = [],
    errors: string[] = [];
  page.on('request', (request) => {
    if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.url());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  const choice = page.getByRole('combobox', { name: 'Badge display' });
  const output = page.getByRole('region', { name: 'Render output' });
  const source = page
    .getByRole('region', { name: 'Streaming JSON' })
    .locator('pre');
  await expect(choice).toHaveValue('registered');
  for (const [sample, count] of [
    ['Basic Types', 1],
    ['Card Layout', 1],
    ['Mixed Components', 2],
  ] as const) {
    await page
      .getByRole('combobox', { name: 'Sample' })
      .selectOption({ label: sample });
    await choice.selectOption('registered');
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
    await expect(output.locator('[data-registry-badge]')).toHaveCount(count);
    const json = await source.textContent(),
      position = await page.getByRole('slider').inputValue();
    await choice.selectOption('omitted');
    await expect(output.locator('[data-registry-badge]')).toHaveCount(0);
    await expect(output.locator('[data-registry-fallback]')).toHaveCount(0);
    await choice.selectOption('fallback');
    await expect(output.locator('[data-registry-fallback]')).toHaveCount(count);
    await expect(source).toHaveText(json ?? '');
    await expect(page.getByRole('slider')).toHaveValue(position);
    await choice.selectOption('registered');
    await expect(output.locator('[data-registry-badge]')).toHaveCount(count);
  }
  await expect(output.locator('article')).toHaveCount(2);
  await expect(
    output.getByText('Text inside the first card section.', { exact: true })
  ).toHaveCount(1);
  await expect(
    output.getByText('Text inside the second card section.', { exact: true })
  ).toHaveCount(1);
  await page.screenshot({
    path: testInfo.outputPath('registry-desktop.png'),
    fullPage: true,
  });
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test('native fallback receives element key, resolved label and loading while a spec is partial', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('combobox', { name: 'Badge display' })
    .selectOption('fallback');
  await page
    .getByRole('slider')
    .fill(String(REGISTRY_SAMPLES[0].json.length - 2));
  const fallback = page.locator('[data-registry-fallback]');
  await expect(fallback).toHaveText('Fallback: Registered');
  await expect(fallback).toHaveAttribute('data-fallback-key', 'badge');
  await expect(fallback).toHaveAttribute('aria-busy', 'true');
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(fallback).toHaveAttribute('aria-busy', 'false');
});

test('host registry choice survives paused and active playback, rewind, Reset and sample changes', async ({
  page,
}) => {
  await page.goto('/');
  const choice = page.getByRole('combobox', { name: 'Badge display' });
  const position = page.getByRole('slider');
  await choice.selectOption('fallback');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect
    .poll(async () => Number(await position.inputValue()))
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const paused = await position.inputValue();
  await choice.selectOption('omitted');
  await expect(position).toHaveValue(paused);
  await choice.selectOption('fallback');
  await position.fill('0');
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.locator('[data-registry-fallback]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.getByRole('combobox', { name: 'Sample' }).selectOption('2');
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(choice).toHaveValue('fallback');
  await expect(page.locator('[data-registry-fallback]')).toHaveCount(2);
  await page.reload();
  await expect(choice).toHaveValue('registered');
});

test('narrow layout and page exit remain safe with an authored fallback', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page
    .getByRole('combobox', { name: 'Badge display' })
    .selectOption('fallback');
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.locator('[data-registry-fallback]')).toHaveText(
    'Fallback: Registered'
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('registry-mobile.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pagehide'))
  );
  await expect(page.locator('#root')).toBeEmpty();
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )
  );
  await expect(page.locator('#root')).toBeEmpty();
});
