import { test, expect } from '@playwright/test';

test('canonical Element Rendering Run uses native children and visibility without execution or source changes', async ({
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
  await page.goto(
    '/docs/render/api/render-spec-component?frontend=react&mode=run'
  );
  const frame = page.frameLocator('iframe');
  const output = frame.getByRole('region', { name: 'Render output' });
  const source = frame
    .getByRole('region', { name: 'Streaming JSON' })
    .locator('pre');
  await expect(frame.getByRole('status')).toHaveText('Paused · 0 characters');
  for (const [index, count] of [
    [0, 2],
    [1, 1],
    [2, 2],
  ] as const) {
    await frame
      .getByRole('combobox', { name: 'Sample' })
      .selectOption(String(index));
    await frame.getByRole('button', { name: 'Finish', exact: true }).click();
    await expect(output.locator('p')).toHaveCount(count);
  }
  const original = await source.textContent(),
    position = await frame.getByRole('slider').inputValue();
  await frame.getByRole('checkbox', { name: 'Show detail' }).uncheck();
  await expect(output.locator('[data-element-key="conditional"]')).toHaveCount(
    0
  );
  await expect(source).toHaveText(original ?? '');
  await expect(frame.getByRole('slider')).toHaveValue(position);
  await frame.getByRole('button', { name: 'Reset', exact: true }).click();
  await frame.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(
    frame.getByRole('checkbox', { name: 'Show detail' })
  ).not.toBeChecked();
  await expect(output.locator('[data-element-key="conditional"]')).toHaveCount(
    0
  );
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test('local React Element Rendering remains usable on a narrow screen', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(
    '/docs/render/api/render-spec-component?frontend=react&mode=run'
  );
  await expect(page.getByLabel('Example UI')).toBeVisible();
  const frame = page.frameLocator('iframe');
  await frame.getByRole('combobox', { name: 'Sample' }).selectOption('2');
  await frame.getByRole('checkbox', { name: 'Show detail' }).uncheck();
  await frame.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(frame.locator('[data-element-key="always"]')).toHaveCount(1);
  await expect(frame.locator('[data-element-key="conditional"]')).toHaveCount(
    0
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('react-element-rendering-mobile.png'),
  });
});

test('React Element Rendering keeps local Docs, Code, Run and Angular selection aligned', async ({
  page,
}, testInfo) => {
  await page.goto('/docs/render/api/render-spec-component?frontend=react');
  await expect(page.getByLabel('Example UI')).toHaveValue('react');
  await expect(
    page.getByRole('heading', {
      name: 'React Element Rendering preview',
      exact: true,
    })
  ).toBeVisible();
  await expect(
    page.locator(
      '[data-example-file="cockpit/render/element-rendering/react/src/views.tsx"]'
    )
  ).toBeVisible();
  await expect(page.locator('[data-example-file*="/python/"]')).toHaveCount(0);
  const navigation = page.locator('[data-workspace-desktop-navigation]');
  await navigation.getByRole('button', { name: 'Code', exact: true }).click();
  await expect(page).toHaveURL(/frontend=react/);
  await navigation.getByRole('button', { name: /^Run(?:,|$)/ }).click();
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    /(?:localhost:4618|render\/element-rendering\/react)/
  );
  await expect(page.frameLocator('iframe').getByRole('status')).toHaveText(
    'Paused · 0 characters'
  );
  await page.screenshot({
    path: testInfo.outputPath('react-element-rendering-desktop.png'),
  });
  await page.getByLabel('Example UI').selectOption('angular');
  await expect(page).not.toHaveURL(/frontend=react/);
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    /(?:localhost:4402|render\/element-rendering(?:\/|$))/
  );
  await page.goBack();
  await expect(page.getByLabel('Example UI')).toHaveValue('react');
  await page.reload();
  await expect(
    page.frameLocator('iframe').getByRole('checkbox', { name: 'Show detail' })
  ).toBeChecked();
});
