import { test, expect } from '@playwright/test';

test('React Component Registry keeps local Docs, Code, Run and Angular selection aligned', async ({
  page,
}, testInfo) => {
  await page.goto('/docs/render/guides/registry?frontend=react');
  await expect(page.getByLabel('Example UI')).toHaveValue('react');
  await expect(
    page.getByRole('heading', {
      name: 'React Component Registry preview',
      exact: true,
    })
  ).toBeVisible();
  await expect(
    page.locator(
      '[data-example-file="cockpit/render/registry/react/src/views.tsx"]'
    )
  ).toBeVisible();
  await expect(page.locator('[data-example-file*="/python/"]')).toHaveCount(0);
  const navigation = page.locator('[data-workspace-desktop-navigation]');
  await navigation.getByRole('button', { name: 'Code', exact: true }).click();
  await expect(page).toHaveURL(/frontend=react/);
  await navigation.getByRole('button', { name: /^Run(?:,|$)/ }).click();
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    /(?:localhost:4617|render\/registry\/react)/
  );
  await expect(page.frameLocator('iframe').getByRole('status')).toHaveText(
    'Paused · 0 characters'
  );
  await page.screenshot({
    path: testInfo.outputPath('react-registry-desktop.png'),
  });
  await page.getByLabel('Example UI').selectOption('angular');
  await expect(page).not.toHaveURL(/frontend=react/);
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    /(?:localhost:4404|render\/registry(?:\/|$))/
  );
  await page.goBack();
  await expect(page.getByLabel('Example UI')).toHaveValue('react');
  await page.reload();
  await expect(
    page.frameLocator('iframe').getByRole('combobox', { name: 'Badge display' })
  ).toHaveValue('registered');
});

test('canonical Registry Run uses all native registry modes without execution or source changes', async ({
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
  await page.goto('/docs/render/guides/registry?frontend=react&mode=run');
  const frame = page.frameLocator('iframe'),
    choice = frame.getByRole('combobox', { name: 'Badge display' });
  const output = frame.getByRole('region', { name: 'Render output' });
  const source = frame
    .getByRole('region', { name: 'Streaming JSON' })
    .locator('pre');
  await expect(frame.getByRole('status')).toHaveText('Paused · 0 characters');
  for (const [label, count] of [
    ['Basic Types', 1],
    ['Card Layout', 1],
    ['Mixed Components', 2],
  ] as const) {
    await frame
      .getByRole('combobox', { name: 'Sample' })
      .selectOption({ label });
    await choice.selectOption('registered');
    await frame.getByRole('button', { name: 'Finish', exact: true }).click();
    await expect(output.locator('[data-registry-badge]')).toHaveCount(count);
    const original = await source.textContent();
    await choice.selectOption('omitted');
    await expect(output.locator('[data-registry-badge]')).toHaveCount(0);
    await expect(output.locator('[data-registry-fallback]')).toHaveCount(0);
    await choice.selectOption('fallback');
    await expect(output.locator('[data-registry-fallback]')).toHaveCount(count);
    await expect(source).toHaveText(original ?? '');
  }
  await frame.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(choice).toHaveValue('fallback');
  await frame.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(output.locator('[data-registry-fallback]')).toHaveCount(2);
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test('local React Registry remains usable on a narrow screen', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/docs/render/guides/registry?frontend=react&mode=run');
  await expect(page.getByLabel('Example UI')).toBeVisible();
  const frame = page.frameLocator('iframe');
  await frame
    .getByRole('combobox', { name: 'Badge display' })
    .selectOption('fallback');
  await frame.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(frame.locator('[data-registry-fallback]')).toHaveText(
    'Fallback: Registered'
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('react-registry-mobile.png'),
  });
});
