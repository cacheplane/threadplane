import { test, expect } from '@playwright/test';

test('React State Management keeps local Docs, Code, Run and Angular selection aligned', async ({
  page,
}, testInfo) => {
  await page.goto('/docs/render/guides/state-store?frontend=react');
  await expect(page.getByLabel('Example UI')).toHaveValue('react');
  await expect(
    page.getByRole('heading', {
      name: 'React State Management preview',
      exact: true,
    })
  ).toBeVisible();
  await expect(
    page.locator(
      '[data-example-file="cockpit/render/state-management/react/src/state.ts"]'
    )
  ).toBeVisible();
  await expect(page.locator('[data-example-file*="/python/"]')).toHaveCount(0);
  const navigation = page.locator('[data-workspace-desktop-navigation]');
  await navigation.getByRole('button', { name: 'Code', exact: true }).click();
  await expect(page).toHaveURL(/frontend=react/);
  await navigation.getByRole('button', { name: /^Run(?:,|$)/ }).click();
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    /(?:localhost:4615|render\/state-management\/react)/
  );
  await expect(page.frameLocator('iframe').getByRole('status')).toHaveText(
    'Paused · 0 characters'
  );
  await page.screenshot({
    path: testInfo.outputPath('react-state-management-desktop.png'),
  });
  await page.getByLabel('Example UI').selectOption('angular');
  await expect(page).not.toHaveURL(/frontend=react/);
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    /(?:localhost:4403|render\/state-management(?:\/|$))/
  );
  await page.goBack();
  await expect(page.getByLabel('Example UI')).toHaveValue('react');
  await page.reload();
  await expect(
    page.frameLocator('iframe').getByRole('textbox', { name: 'Name' })
  ).toHaveValue('Alice');
});

test('canonical State Management Run resolves edited bindings in all samples without execution', async ({
  page,
}) => {
  const executions: string[] = [],
    errors: string[] = [];
  page.on('request', (request) => {
    if (
      !['GET', 'HEAD'].includes(request.method()) &&
      /\/agent(?:\/|$)|\/api\/native\/|\/threads(?:\/|$)/.test(
        new URL(request.url()).pathname
      )
    )
      executions.push(request.url());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/docs/render/guides/state-store?frontend=react&mode=run');
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('status')).toHaveText('Paused · 0 characters');
  await frame.getByRole('textbox', { name: 'Name' }).fill('Ada');
  await frame.getByRole('spinbutton', { name: 'Age' }).fill('42');
  await frame.getByRole('combobox', { name: 'Theme' }).selectOption('light');
  const output = frame.getByRole('region', { name: 'Render output' });
  for (const [label, heading] of [
    ['User Profile', 'User Profile'],
    ['Nested Paths', 'Nested State Paths'],
    ['Form Display', 'State-Driven Form'],
  ]) {
    await frame
      .getByRole('combobox', { name: 'Sample' })
      .selectOption({ label });
    await frame.getByRole('button', { name: 'Finish' }).click();
    await expect(
      frame.getByRole('heading', { name: heading, exact: true })
    ).toBeVisible();
    await expect(output).toContainText('Ada');
    await expect(output).toContainText(
      label === 'User Profile' ? '42' : 'light'
    );
  }
  await frame.getByRole('button', { name: 'Reset' }).click();
  await expect(frame.getByRole('slider')).toHaveValue('0');
  await expect(frame.getByRole('textbox', { name: 'Name' })).toHaveValue('Ada');
  expect(executions).toEqual([]);
  expect(errors).toEqual([]);
});

test('local React State Management remains usable on a narrow screen', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/docs/render/guides/state-store?frontend=react&mode=run');
  await expect(page.getByLabel('Example UI')).toBeVisible();
  const frame = page.frameLocator('iframe');
  await frame.getByRole('textbox', { name: 'Name' }).fill('Grace');
  await frame.getByRole('button', { name: 'Finish' }).click();
  await expect(
    frame.getByRole('region', { name: 'Render output' })
  ).toContainText('Grace');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('react-state-management-mobile.png'),
  });
});
