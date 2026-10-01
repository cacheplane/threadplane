import { test, expect } from '@playwright/test';

test('public React selection keeps docs, code, runtime and history consistent', async ({
  page,
}, testInfo) => {
  await page.goto('/docs/langgraph/guides/streaming?frontend=react');
  await expect(page.getByLabel('Example UI')).toHaveValue('react');
  await expect(
    page.getByRole('heading', { name: 'React streaming preview', exact: true })
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('react-preview-desktop.png') });
  await expect(
    page.locator(
      '[data-example-file="cockpit/langgraph/streaming/react/src/app.tsx"]'
    )
  ).toBeVisible();
  await page
    .locator('[data-workspace-desktop-navigation]')
    .getByRole('button', { name: 'Code', exact: true })
    .click();
  await expect(page).toHaveURL(/frontend=react/);
  await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
    'data-workspace-mode',
    'Code'
  );
  await page
    .locator('[data-workspace-desktop-navigation]')
    .getByRole('button', { name: /^Run(?:,|$)/ })
    .click();
  const frame = page.locator('iframe');
  await expect(frame).toHaveAttribute(
    'src',
    /(?:localhost:4600|langgraph\/streaming\/react)/
  );
  await expect(page.locator('[data-workspace-docs-only-context]')).toHaveCount(0);
  await page.getByLabel('Example UI').selectOption('angular');
  await expect(page).not.toHaveURL(/frontend=react/);
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    /(?:localhost:4300|langgraph\/streaming(?:\?|$))/
  );
  await page.goBack();
  await expect(page.getByLabel('Example UI')).toHaveValue('react');
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    /(?:localhost:4600|langgraph\/streaming\/react)/
  );
  await page.reload();
  await expect(page.getByLabel('Example UI')).toHaveValue('react');
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    /(?:localhost:4600|langgraph\/streaming\/react)/
  );
  await page.locator('[data-workspace-desktop-navigation]').getByRole('button', { name: 'Docs', exact: true }).click();
  await page.locator('[data-docs-control-plane-context]').getByRole('link', { name: 'Persistence', exact: true }).click();
  await expect(page).toHaveURL(/persistence\?frontend=react/);
  await expect(page.getByText(/React preview is not available for this topic/)).toBeVisible();
});

test('unsupported React topics show availability without an Angular frame', async ({
  page,
}, testInfo) => {
  await page.goto('/docs/langgraph/guides/persistence?frontend=react&mode=run');
  await expect(
    page.getByText(/React preview is not available for this topic/)
  ).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('Example UI')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page.getByLabel('Example UI').selectOption('angular');
  await expect(
    page.getByText(/React preview is not available for this topic/)
  ).toHaveCount(0);
  await page.goto('/docs/langgraph/guides/streaming?frontend=react');
  await expect(page.getByRole('heading', { name: 'React streaming preview', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('react-preview-mobile.png') });
});

test('the installed React frame streams and releases work when the public selector changes', async ({
  page,
  request,
}) => {
  test.skip(
    Boolean(process.env['BASE_URL']),
    'Local fixture stream lifetime is verified before deployment'
  );
  await request.post('http://127.0.0.1:4600/__reset');
  await page.goto('/docs/langgraph/guides/streaming?frontend=react&mode=run');
  const frame = page.frameLocator('iframe');
  await frame.getByLabel('Message', { exact: true }).fill('First');
  await frame.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(
    frame.getByRole('region', { name: 'Conversation' })
  ).toContainText('Live partial');
  const oldFrame = await page.locator('iframe').elementHandle();
  await page.getByLabel('Example UI').selectOption('angular');
  await expect(page).not.toHaveURL(/frontend=react/);
  expect(await oldFrame?.evaluate((element) => element.isConnected)).toBe(
    false
  );
  await expect
    .poll(
      async () =>
        (
          await (await request.get('http://127.0.0.1:4600/__lifetime')).json()
        ).active
    )
    .toBe(false);
  await page.getByLabel('Example UI').selectOption('react');
  await frame.getByLabel('Message', { exact: true }).fill('Literal');
  await frame.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(
    frame.getByRole('region', { name: 'Conversation' })
  ).toContainText('<script>private markup</script>');
  await expect(
    frame.locator('script').filter({ hasText: 'private markup' })
  ).toHaveCount(0);
});
