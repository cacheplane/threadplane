import { test, expect } from '@playwright/test';

test('public React memory keep topic docs, sources, runtime, and history aligned', async ({
  page,
}, testInfo) => {
  await page.goto('/docs/langgraph/guides/memory?frontend=react');
  await expect(page.getByLabel('Example UI')).toHaveValue('react');
  await expect(
    page.getByRole('heading', { name: 'React memory preview', exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'React streaming preview', exact: true })
  ).toHaveCount(0);
  await expect(
    page.locator(
      '[data-example-file="cockpit/langgraph/memory/react/src/application.ts"]'
    )
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('react-memory-docs-desktop.png'),
  });
  await page
    .locator('[data-workspace-desktop-navigation]')
    .getByRole('button', { name: 'Code', exact: true })
    .click();
  await expect(page).toHaveURL(/frontend=react/);
  await page
    .locator('[data-workspace-desktop-navigation]')
    .getByRole('button', { name: /^Run(?:,|$)/ })
    .click();
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    /(?:localhost:4602|langgraph\/memory\/react)/
  );
  await page.getByLabel('Example UI').selectOption('angular');
  await expect(page).not.toHaveURL(/frontend=react/);
  await page.goBack();
  await expect(page.getByLabel('Example UI')).toHaveValue('react');
  await page.reload();
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    /(?:localhost:4602|langgraph\/memory\/react)/
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('Example UI')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('react-memory-docs-mobile.png'),
  });
});

test('switching away releases held React extraction and returning starts empty', async ({
  page,
  request,
}) => {
  test.skip(
    Boolean(process.env['BASE_URL']),
    'Local extraction lifetime is verified before deployment'
  );
  await request.post('http://127.0.0.1:4602/__reset');
  await request.post('http://127.0.0.1:4602/__hold-extraction');
  await page.goto('/docs/langgraph/guides/memory?frontend=react&mode=run');
  const frame = page.frameLocator('iframe');
  await frame.getByLabel('Message', { exact: true }).fill('Remember Mira');
  await frame.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(
    frame.getByRole('region', { name: 'Conversation' })
  ).toContainText('Memory reply');
  await expect(
    frame.getByRole('region', { name: 'Learned facts' })
  ).toContainText('No facts yet.');
  const oldFrame = await page.locator('iframe').elementHandle();
  await page.getByLabel('Example UI').selectOption('angular');
  expect(await oldFrame?.evaluate((element) => element.isConnected)).toBe(
    false
  );
  await expect
    .poll(
      async () =>
        (
          await (await request.get('http://127.0.0.1:4602/__lifetime')).json()
        ).active
    )
    .toBe(false);
  await page.getByLabel('Example UI').selectOption('react');
  await expect(frame.getByRole('status')).toHaveText('Ready.');
  await expect(
    frame.getByRole('region', { name: 'Learned facts' })
  ).toContainText('No facts yet.');
  await frame.getByLabel('Message', { exact: true }).fill('Recall');
  await frame.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(
    frame.getByRole('region', { name: 'Conversation' })
  ).toContainText('No facts remembered.');
  await expect(frame.getByRole('status')).toHaveText('Response complete.');
  const proof = await (
    await request.get('http://127.0.0.1:4602/__requests')
  ).json();
  expect(
    proof.filter((entry: { path: string }) => entry.path === '/api/threads')
  ).toHaveLength(2);
});

test('unsupported React topics retain an availability notice', async ({
  page,
}) => {
  await page.goto('/docs/langgraph/guides/durable-execution?frontend=react&mode=run');
  await expect(page.getByLabel('Example UI')).toHaveValue('react');
  await expect(
    page.getByText(/React preview is not available for this topic/)
  ).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
});
