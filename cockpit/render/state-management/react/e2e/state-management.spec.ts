import { expect, test } from '@playwright/test';
import { STATE_SAMPLES } from '../src/specs';

test('native bindings update independently of playback in all three samples', async ({
  page,
}) => {
  const execution: string[] = [],
    errors: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET' && request.method() !== 'HEAD')
      execution.push(request.url());
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
  await expect(output).toContainText('Play a sample');
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue(
    'Alice'
  );
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(output).toContainText('Alice');
  await expect(output).toContainText('30');
  const unchanged = await source.textContent();
  await page
    .getByRole('textbox', { name: 'Name' })
    .fill('<script>Ada</script>');
  await page.getByRole('spinbutton', { name: 'Age' }).fill('42');
  await page.getByRole('combobox', { name: 'Theme' }).selectOption('light');
  await expect(output).toContainText('<script>Ada</script>');
  await expect(output).toContainText('42');
  await expect(source).toHaveText(unchanged ?? '');
  await expect(output.locator('script')).toHaveCount(0);
  for (const label of ['Nested Paths', 'Form Display']) {
    await page
      .getByRole('combobox', { name: 'Sample' })
      .selectOption({ label });
    await page.getByRole('button', { name: 'Finish' }).click();
    await expect(output).toContainText('<script>Ada</script>');
    await expect(output).toContainText('light');
  }
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(source).toHaveText('');
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue(
    '<script>Ada</script>'
  );
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(output).toContainText('<script>Ada</script>');
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue(
    'Alice'
  );
  await expect(page.getByRole('spinbutton', { name: 'Age' })).toHaveValue('30');
  await expect(page.getByRole('combobox', { name: 'Theme' })).toHaveValue(
    'dark'
  );
  expect(execution).toEqual([]);
  expect(errors).toEqual([]);
});

test('paused and active partial bindings retain edits across rewind and sample changes', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Sample' }).selectOption('1');
  const position = page.getByRole('slider', { name: 'Playback position' });
  const prefix = STATE_SAMPLES[1].json.indexOf('    "userAge":');
  await position.fill(String(prefix));
  const output = page.getByRole('region', { name: 'Render output' });
  await expect(output).toContainText('Alice');
  await page.getByRole('textbox', { name: 'Name' }).fill('Grace');
  await expect(output).toContainText('Grace');
  await expect(position).toHaveValue(String(prefix));
  await page.getByRole('button', { name: 'Play' }).click();
  await expect
    .poll(async () => Number(await position.inputValue()))
    .toBeGreaterThan(prefix);
  await page.getByRole('button', { name: 'Pause' }).click();
  const paused = await position.inputValue();
  await page.getByRole('textbox', { name: 'Name' }).fill('Katherine');
  await expect(output).toContainText('Katherine');
  await expect(position).toHaveValue(paused);
  await position.fill('0');
  await expect(output).toContainText('Play a sample');
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(output).toContainText('Katherine');
  await page.getByRole('button', { name: 'Play' }).click();
  await page.getByRole('combobox', { name: 'Sample' }).selectOption('2');
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(output).toContainText('State-Driven Form');
  await expect(output).toContainText('Katherine');
  await expect(output).not.toContainText('Nested State Paths');
});

test('invalid age retains the native value and recovers without resetting playback', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Sample' }).selectOption('1');
  await page.getByRole('button', { name: 'Finish' }).click();
  const age = page.getByRole('spinbutton', { name: 'Age' });
  const output = page.getByRole('region', { name: 'Render output' });
  await age.fill('42');
  for (const value of ['', '-1', '151', '1.5']) {
    await age.fill(value);
    await expect(output.getByText('42', { exact: true })).toBeVisible();
    await expect(age).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('alert')).toHaveText(
      'Enter a whole age from 0 to 150.'
    );
  }
  await age.fill('0');
  await expect(output.getByText('0', { exact: true })).toBeVisible();
  await expect(age).toHaveAttribute('aria-invalid', 'false');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Complete');
});

test('narrow layout is usable and pagehide cancels active playback', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Sample' }).selectOption('2');
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(
    page.getByRole('region', { name: 'Render output' })
  ).toContainText('State-Driven Form');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('state-management-mobile.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Play' }).click();
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
