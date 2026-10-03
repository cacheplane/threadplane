import { expect, test } from '@playwright/test';
import { ELEMENT_RENDERING_SAMPLES } from '../src/specs';

test('installed native children preserve ordering and nesting across all three samples', async ({
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
  const output = page.getByRole('region', { name: 'Render output' });
  const source = page
    .getByRole('region', { name: 'Streaming JSON' })
    .locator('pre');
  await expect(
    page.getByRole('checkbox', { name: 'Show detail' })
  ).toBeChecked();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(output.locator('p')).toHaveText([
    'First child text element rendered beneath the parent heading.',
    'Second child text element demonstrating sibling rendering.',
  ]);
  await page.getByRole('combobox', { name: 'Sample' }).selectOption('1');
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(output.locator('article')).toHaveCount(2);
  await expect(
    output.locator('article').first().locator('article')
  ).toHaveCount(1);
  await expect(
    output.getByText('Deeply nested text inside two levels of card wrappers.', {
      exact: true,
    })
  ).toHaveCount(1);
  await page.getByRole('combobox', { name: 'Sample' }).selectOption('2');
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(output.locator('[data-element-key="conditional"]')).toHaveCount(
    1
  );
  const original = await source.textContent(),
    position = await page.getByRole('slider').inputValue();
  await page.getByRole('checkbox', { name: 'Show detail' }).uncheck();
  await expect(output.locator('[data-element-key="conditional"]')).toHaveCount(
    0
  );
  await expect(output.locator('[data-element-key="always"]')).toHaveCount(1);
  await expect(source).toHaveText(original ?? '');
  await expect(page.getByRole('slider')).toHaveValue(position);
  await page.getByRole('checkbox', { name: 'Show detail' }).check();
  await expect(output.locator('[data-element-key="conditional"]')).toHaveCount(
    1
  );
  await page.screenshot({
    path: testInfo.outputPath('element-rendering-desktop.png'),
    fullPage: true,
  });
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test('native partial visibility never displays the conditional node before its binding is admitted', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Sample' }).selectOption('2');
  const json = ELEMENT_RENDERING_SAMPLES[2].json;
  const beforeBinding = json.indexOf('"visible"');
  const conditional = page.locator('[data-element-key="conditional"]');
  await page.getByRole('slider').fill(String(beforeBinding));
  await expect(conditional).toHaveCount(0);
  await page
    .getByRole('slider')
    .fill(String(json.indexOf('/showDetail"', beforeBinding) + 5));
  await expect(conditional).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Show detail' }).uncheck();
  await page.getByRole('slider').fill(String(json.length - 2));
  await expect(conditional).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Show detail' }).check();
  await expect(conditional).toHaveCount(1);
  await expect(conditional).toHaveAttribute('aria-busy', 'true');
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(conditional).toHaveAttribute('aria-busy', 'false');
});

test('caller visibility survives paused and active playback, rewind, Reset and sample changes', async ({
  page,
}) => {
  await page.goto('/');
  const detail = page.getByRole('checkbox', { name: 'Show detail' });
  const position = page.getByRole('slider');
  await page.getByRole('combobox', { name: 'Sample' }).selectOption('2');
  await detail.uncheck();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect
    .poll(async () => Number(await position.inputValue()))
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const paused = await position.inputValue();
  await detail.check();
  await expect(position).toHaveValue(paused);
  await detail.uncheck();
  await position.fill('0');
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.locator('[data-element-key="conditional"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.getByRole('combobox', { name: 'Sample' }).selectOption('0');
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await page.getByRole('combobox', { name: 'Sample' }).selectOption('2');
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(detail).not.toBeChecked();
  await expect(page.locator('[data-element-key="conditional"]')).toHaveCount(0);
  await page.reload();
  await expect(detail).toBeChecked();
});

test('narrow layout and page exit remain safe with native visibility', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Sample' }).selectOption('2');
  await page.getByRole('checkbox', { name: 'Show detail' }).uncheck();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.locator('[data-element-key="always"]')).toHaveCount(1);
  await expect(page.locator('[data-element-key="conditional"]')).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('element-rendering-mobile.png'),
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
