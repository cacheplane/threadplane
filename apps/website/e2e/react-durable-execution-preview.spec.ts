import { test, expect } from '@playwright/test';

test('public React durable-execution keep topic docs, sources, runtime, and history aligned', async ({
  page,
}, testInfo) => {
  await page.goto('/docs/langgraph/guides/durable-execution?frontend=react');
  await expect(page.getByLabel('Example UI')).toHaveValue('react');
  await expect(
    page.getByRole('heading', {
      name: 'React durable execution preview',
      exact: true,
    })
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'React streaming preview', exact: true })
  ).toHaveCount(0);
  await expect(
    page.locator(
      '[data-example-file="cockpit/langgraph/durable-execution/react/src/application.ts"]'
    )
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('react-durable-execution-docs-desktop.png'),
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
    /(?:localhost:4605|langgraph\/durable-execution\/react)/
  );
  await page.getByLabel('Example UI').selectOption('angular');
  await expect(page).not.toHaveURL(/frontend=react/);
  await page.goBack();
  await expect(page.getByLabel('Example UI')).toHaveValue('react');
  await page.reload();
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    /(?:localhost:4605|langgraph\/durable-execution\/react)/
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('Example UI')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('react-durable-execution-docs-mobile.png'),
  });
});
test('switching away releases a held status read and returning starts empty', async ({
  page,
  request,
}) => {
  test.skip(
    Boolean(process.env['BASE_URL']),
    'Local status-read lifetime is verified before deployment'
  );
  const origin = 'http://127.0.0.1:4605';
  await request.post(origin + '/__reset');
  await page.goto(
    '/docs/langgraph/guides/durable-execution?frontend=react&mode=run'
  );
  const frame = page.frameLocator('iframe');
  await frame.getByLabel('Message', { exact: true }).fill('Uncertain');
  await frame.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(
    frame.getByRole('button', { name: 'Check status', exact: true })
  ).toBeVisible();
  await request.post(origin + '/__publish-final');
  await request.post(origin + '/__hold-history');
  await frame
    .getByRole('button', { name: 'Check status', exact: true })
    .click();
  await expect(frame.getByRole('status')).toHaveText('Checking saved outcome…');
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
    frame.getByRole('region', {
      name: 'Saved pipeline checkpoints',
      exact: true,
    })
  ).toContainText('Generate — pending');
  await expect(
    frame
      .getByRole('region', { name: 'Conversation', exact: true })
      .getByRole('article')
  ).toHaveCount(0);
  const proof: { path: string }[] = await (
    await request.get(origin + '/__requests')
  ).json();
  expect(proof.filter((entry) => entry.path.endsWith('/threads'))).toHaveLength(
    1
  );
  expect(proof.filter((entry) => entry.path.endsWith('/history'))).toHaveLength(
    2
  );
  expect(
    proof.filter((entry) => entry.path.endsWith('/runs/stream'))
  ).toHaveLength(1);
});
