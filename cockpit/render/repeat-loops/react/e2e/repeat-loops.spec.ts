import { expect, test } from '@playwright/test';

test('installed native rows retain actual element identity and independent source across list edits', async ({
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
  const rows = output.locator('[data-repeat-row]');
  const source = page
    .getByRole('region', { name: 'Streaming JSON' })
    .locator('pre');
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(output.locator('article')).toHaveCount(1);
  await expect(rows).toHaveText(['1. Alpha', '2. Beta', '3. Gamma']);
  const alpha = await rows.nth(0).elementHandle();
  const original = await source.textContent();
  await page.getByRole('button', { name: 'Reverse items' }).click();
  await expect(rows).toHaveText(['1. Gamma', '2. Beta', '3. Alpha']);
  expect(await rows.nth(2).evaluate((node, old) => node === old, alpha)).toBe(
    true
  );
  await page.getByRole('button', { name: 'Remove Beta', exact: true }).click();
  await page.getByRole('button', { name: 'Add Item', exact: true }).click();
  await expect(rows).toHaveText(['1. Gamma', '2. Alpha', '3. Item 1']);
  await expect(source).toHaveText(original ?? '');
  for (const label of ['Task List', 'Sections']) {
    await page
      .getByRole('combobox', { name: 'Sample' })
      .selectOption({ label });
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
    await expect(rows).toHaveCount(0);
    await expect(output).toContainText(
      label === 'Task List' ? 'Review pull request' : 'Frontend Tasks'
    );
  }
  await page.getByRole('combobox', { name: 'Sample' }).selectOption('0');
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(rows).toHaveText(['1. Gamma', '2. Alpha', '3. Item 1']);
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(rows).toHaveText(['1. Gamma', '2. Alpha', '3. Item 1']);
  await page.screenshot({
    path: testInfo.outputPath('repeat-loops-desktop.png'),
    fullPage: true,
  });
  await page.reload();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(rows).toHaveText(['1. Alpha', '2. Beta', '3. Gamma']);
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test('capacity, removal and empty recovery preserve unique identities', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  for (let index = 0; index < 29; index++)
    await page.getByRole('button', { name: 'Add Item', exact: true }).click();
  const rows = page.locator('[data-repeat-row]');
  await expect(rows).toHaveCount(32);
  await expect(
    page.getByRole('button', { name: 'Add Item', exact: true })
  ).toBeDisabled();
  expect(
    new Set(
      await rows.evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-repeat-row'))
      )
    ).size
  ).toBe(32);
  const remove = page.getByRole('button', { name: /^Remove / });
  while (await remove.count()) await remove.first().click();
  await expect(rows).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Reverse items' })
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Add Item', exact: true }).click();
  await expect(rows).toHaveText(['1. Item 30']);
  await expect(rows).toHaveAttribute('data-repeat-row', 'item-30');
});

test('active and paused playback retain list edits and rewind safely', async ({
  page,
}) => {
  await page.goto('/');
  const position = page.getByRole('slider', { name: 'Playback position' });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect
    .poll(async () => Number(await position.inputValue()))
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Add Item', exact: true }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const paused = await position.inputValue();
  await page.getByRole('button', { name: 'Reverse items' }).click();
  await expect(position).toHaveValue(paused);
  await position.fill('0');
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.locator('[data-repeat-row]')).toHaveText([
    '1. Item 1',
    '2. Gamma',
    '3. Beta',
    '4. Alpha',
  ]);
});

test('narrow layout and pagehide remain usable during playback', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.locator('[data-repeat-row]')).toHaveCount(3);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('repeat-loops-mobile.png'),
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
