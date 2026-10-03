import { test, expect } from '@playwright/test';

test('React Repeat Loops keeps local Docs, Code, Run and Angular selection aligned', async ({
  page,
}, testInfo) => {
  await page.goto('/docs/render/guides/repeat-loops?frontend=react');
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
  const navigation = page.locator('[data-workspace-desktop-navigation]');
  await navigation.getByRole('button', { name: 'Code', exact: true }).click();
  await expect(page).toHaveURL(/frontend=react/);
  await navigation.getByRole('button', { name: /^Run(?:,|$)/ }).click();
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    /(?:localhost:4616|render\/repeat-loops\/react)/
  );
  await expect(page.frameLocator('iframe').getByRole('status')).toHaveText(
    'Paused · 0 characters'
  );
  await page.screenshot({
    path: testInfo.outputPath('react-repeat-loops-desktop.png'),
  });
  await page.getByLabel('Example UI').selectOption('angular');
  await expect(page).not.toHaveURL(/frontend=react/);
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    /(?:localhost:4405|render\/repeat-loops(?:\/|$))/
  );
  await page.goBack();
  await expect(page.getByLabel('Example UI')).toHaveValue('react');
  await page.reload();
  await expect(
    page
      .frameLocator('iframe')
      .getByRole('button', { name: 'Remove Alpha', exact: true })
  ).toBeVisible();
});

test('canonical Repeat Loops Run keeps native row identity, edits and samples without execution', async ({
  page,
}) => {
  const writes: string[] = [],
    errors: string[] = [];
  page.on('request', (request) => {
    if (
      !['GET', 'HEAD'].includes(request.method()) &&
      /\/agent(?:\/|$)|\/api\/native\/|\/threads(?:\/|$)/.test(
        new URL(request.url()).pathname
      )
    )
      writes.push(request.url());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/docs/render/guides/repeat-loops?frontend=react&mode=run');
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
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test('local React Repeat Loops remains usable on a narrow screen', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/docs/render/guides/repeat-loops?frontend=react&mode=run');
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
