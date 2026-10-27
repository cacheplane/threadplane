import { test, expect } from '@playwright/test';

test('public React AG-UI streaming keep topic docs, sources, runtime, and history aligned', async ({
  page,
}, testInfo) => {
  await page.goto('/docs/ag-ui/reference/event-mapping?frontend=react');
  await expect(page.getByLabel('Example UI')).toHaveValue('react');
  await expect(
    page.getByRole('heading', {
      name: 'React AG-UI streaming preview',
      exact: true,
    })
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'React streaming preview', exact: true })
  ).toHaveCount(0);
  await expect(
    page.locator(
      '[data-example-file="cockpit/ag-ui/streaming/react/src/application.ts"]'
    )
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('react-ag-ui-streaming-docs-desktop.png'),
  });
  await page
    .locator('[data-workspace-desktop-navigation]')
    .getByRole('button', { name: 'Code', exact: true })
    .click();
  await expect(page).toHaveURL(
    '/docs/ag-ui/reference/event-mapping?mode=code&frontend=react'
  );
  await page
    .locator('[data-workspace-desktop-navigation]')
    .getByRole('button', { name: /^Run(?:,|$)/ })
    .click();
  await expect(page).toHaveURL(
    '/docs/ag-ui/reference/event-mapping?mode=run&frontend=react'
  );
  await expect(page.locator('iframe')).toBeVisible();
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    /(?:localhost:4609|ag-ui\/streaming\/react)/
  );
  await page.getByLabel('Example UI').selectOption('angular');
  await expect(page).toHaveURL('/docs/ag-ui/reference/event-mapping?mode=run');
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(
    '/docs/ag-ui/reference/event-mapping?mode=run&frontend=react'
  );
  await expect(page.getByLabel('Example UI')).toHaveValue('react');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(
    '/docs/ag-ui/reference/event-mapping?mode=run&frontend=react'
  );
  await expect(page.locator('iframe')).toBeVisible();
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    /(?:localhost:4609|ag-ui\/streaming\/react)/
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('Example UI')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('react-ag-ui-streaming-docs-mobile.png'),
  });
});
test('switching away releases the held AG-UI Streaming stream and returning stays lazy', async ({
  page,
  request,
}) => {
  test.skip(
    Boolean(process.env['BASE_URL']),
    'Local execution lifetime is verified before deployment'
  );
  const origin = 'http://127.0.0.1:4609';
  await request.post(origin + '/__reset');
  await page.goto(
    '/docs/ag-ui/reference/event-mapping?frontend=react&mode=run'
  );
  const frame = page.frameLocator('iframe');
  await expect(
    frame.getByRole('region', { name: 'Runtime connection' })
  ).toContainText('Shared runtime');
  await frame.getByLabel('Message', { exact: true }).fill('Hold');
  await frame.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(
    frame.getByRole('region', { name: 'Conversation', exact: true })
  ).toContainText('Live partial');
  const oldFrame = await page.locator('iframe').elementHandle();
  await page.getByLabel('Example UI').selectOption('angular');
  expect(await oldFrame?.evaluate((element) => element.isConnected)).toBe(
    false
  );
  await expect
    .poll(
      async () =>
        (
          await (await request.get(origin + '/__lifetime')).json()
        ).active
    )
    .toBe(false);
  await request.post(origin + '/__release');
  await page.getByLabel('Example UI').selectOption('react');
  await expect(frame.getByRole('status')).toHaveText('Ready.');
  await expect(
    frame
      .getByRole('region', { name: 'Conversation', exact: true })
      .locator('li')
  ).toHaveCount(0);
  await expect(frame.getByLabel('Message', { exact: true })).toHaveValue('');
  const proof: { path: string }[] = await (
    await request.get(origin + '/__requests')
  ).json();
  expect(proof).toHaveLength(1);
  expect(proof[0].path).toBe('/ag-ui/streaming/agent');
});
