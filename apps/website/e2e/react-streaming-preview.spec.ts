import { frameworkControl, selectFramework } from './fixtures/framework-controls';
import { test, expect } from '@playwright/test';

test('public React selection keeps docs, code, runtime and history consistent', async ({
  page,
}, testInfo) => {
  await page.goto('/docs/react/langgraph/guides/streaming');
  await expect(page.getByLabel('Framework')).toHaveValue('react');
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
  await expect(page).toHaveURL(/\/docs\/react\//);
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
  await selectFramework(page, 'angular');
  await expect(page).not.toHaveURL(/\/docs\/react\//);
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    /(?:localhost:4300|langgraph\/streaming(?:\?|$))/
  );
  await page.goBack();
  await expect(page.getByLabel('Framework')).toHaveValue('react');
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    /(?:localhost:4600|langgraph\/streaming\/react)/
  );
  await page.reload();
  await expect(page.getByLabel('Framework')).toHaveValue('react');
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    /(?:localhost:4600|langgraph\/streaming\/react)/
  );
  await page.locator('[data-workspace-desktop-navigation]').getByRole('button', { name: 'Docs', exact: true }).click();
  await page.locator('[data-docs-control-plane-context]').getByRole('link', { name: 'Persistence', exact: true }).click();
  await expect(page).toHaveURL(/\/docs\/react\/langgraph\/guides\/persistence/);
  await expect(page.getByRole('heading', { name: 'React persistence preview', exact: true })).toBeVisible();
});

test('missing counterparts are explicit in mobile framework navigation', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/docs/angular/langgraph/guides/testing');
  const control = await frameworkControl(page);
  await expect(control).toHaveAttribute('data-value', 'angular');
  await control.click();
  await expect(
    page.getByRole('menu', { name: 'Frameworks', exact: true })
      .getByRole('menuitemradio', { name: 'React Unavailable for this topic', exact: true })
  ).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-framework-selector]:visible').getByText('This topic is not available for React.')).toBeVisible();
  await expect(page.locator('[data-framework-selector]:visible').getByRole('link', { name: 'React introduction' })).toHaveAttribute('href', '/docs/react/getting-started/introduction');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('react-unavailable-mobile.png') });
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
  await page.goto('/docs/react/langgraph/guides/streaming?mode=run');
  const frame = page.frameLocator('iframe');
  await frame.getByLabel('Message', { exact: true }).fill('First');
  await frame.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(
    frame.getByRole('region', { name: 'Conversation' })
  ).toContainText('Live partial');
  const oldFrame = await page.locator('iframe').elementHandle();
  await selectFramework(page, 'angular');
  await expect(page).not.toHaveURL(/\/docs\/react\//);
  await expect.poll(() => oldFrame?.evaluate((element) => element.isConnected)).toBe(false);
  await expect
    .poll(
      async () =>
        (
          await (await request.get('http://127.0.0.1:4600/__lifetime')).json()
        ).active
    )
    .toBe(false);
  await selectFramework(page, 'react');
  await frame.getByLabel('Message', { exact: true }).fill('Literal');
  await frame.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(
    frame.getByRole('region', { name: 'Conversation' })
  ).toContainText('<script>private markup</script>');
  await expect(
    frame.locator('script').filter({ hasText: 'private markup' })
  ).toHaveCount(0);
});
