import { documentationModes } from './fixtures/workspace-controls';
import { selectFramework, expectFrameworkControl } from './fixtures/framework-controls';
import { test, expect } from '@playwright/test';

test('public React approvals keep topic docs, sources, runtime, and history aligned', async ({
  page,
}, testInfo) => {
  await page.goto('/docs/react/langgraph/guides/interrupts');
  await expect(page.getByLabel('Framework')).toHaveAttribute('data-value', 'react');
  await expect(
    page.getByRole('heading', { name: 'React interrupts preview', exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'React streaming preview', exact: true })
  ).toHaveCount(0);
  await expect(
    page.locator(
      '[data-example-file="cockpit/langgraph/interrupts/react/src/application.ts"]'
    )
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('react-interrupts-docs-desktop.png') });
  await documentationModes(page)
    .getByRole('button', { name: 'Code', exact: true })
    .click();
  await expect(page).toHaveURL(/\/docs\/react\//);
  await documentationModes(page)
    .getByRole('button', { name: /^Run(?:,|$)/ })
    .click();
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    /(?:localhost:4601|langgraph\/interrupts\/react)/
  );
  await selectFramework(page, 'angular');
  await expect(page).not.toHaveURL(/\/docs\/react\//);
  await page.goBack();
  await expect(page.getByLabel('Framework')).toHaveAttribute('data-value', 'react');
  await page.reload();
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    /(?:localhost:4601|langgraph\/interrupts\/react)/
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expectFrameworkControl(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('react-interrupts-run-mobile.png') });
});

test('switching away releases a held React decision and returning starts fresh', async ({
  page,
  request,
}) => {
  test.skip(
    Boolean(process.env['BASE_URL']),
    'Local held decision lifetime is verified before deployment'
  );
  await request.post('http://127.0.0.1:4601/__reset');
  await request.post('http://127.0.0.1:4601/__hold-resume');
  await page.goto('/docs/react/langgraph/guides/interrupts?mode=run');
  const frame = page.frameLocator('iframe');
  await frame.getByLabel('Message', { exact: true }).fill('Refund');
  await frame.getByRole('button', { name: 'Send', exact: true }).click();
  await frame.getByRole('button', { name: 'Issue refund' }).click();
  await expect(frame.getByRole('status')).toHaveText('Sending decision…');
  const oldFrame = await page.locator('iframe').elementHandle();
  await selectFramework(page, 'angular');
  await expect.poll(() => oldFrame?.evaluate((element) => element.isConnected)).toBe(false);
  await expect
    .poll(
      async () =>
        (
          await (await request.get('http://127.0.0.1:4601/__lifetime')).json()
        ).active
    )
    .toBe(false);
  await selectFramework(page, 'react');
  await expect(frame.getByRole('status')).toHaveText('Ready.');
  await expect(
    frame.getByRole('region', { name: 'Refund approval required' })
  ).toHaveCount(0);
  await frame.getByLabel('Message', { exact: true }).fill('Refund');
  await frame.getByRole('button', { name: 'Send', exact: true }).click();
  await frame.getByRole('button', { name: "Don't refund" }).click();
  await expect(frame.getByRole('status')).toHaveText('Response complete.');
  const proof = await (
    await request.get('http://127.0.0.1:4601/__requests')
  ).json();
  expect(
    proof.filter((entry: { path: string }) => entry.path === '/api/threads')
  ).toHaveLength(2);
});
