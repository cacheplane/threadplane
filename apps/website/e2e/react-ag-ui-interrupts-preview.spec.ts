import { documentationModes } from './fixtures/workspace-controls';
import { selectFramework, expectFrameworkControl } from './fixtures/framework-controls';
import { test, expect } from '@playwright/test';

// Pause and resume cases own one local fixture's request log and held response.
test.describe.configure({mode:'default'});

test('public React AG-UI interrupts keep topic docs, sources, runtime, and history aligned', async ({
  page,
}, testInfo) => {
  await page.goto('/docs/react/ag-ui/guides/interrupts');
  await expect(page.getByLabel('Framework')).toHaveAttribute('data-value', 'react');
  await expect(
    page.getByRole('heading', {
      name: 'React AG-UI interrupts preview',
      exact: true,
    })
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'React interrupts preview', exact: true })
  ).toHaveCount(0);
  await expect(
    page.locator(
      '[data-example-file="cockpit/ag-ui/interrupts/react/src/application.ts"]'
    )
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('react-ag-ui-interrupts-docs-desktop.png'),
  });
  await documentationModes(page)
    .getByRole('button', { name: 'Code', exact: true })
    .click();
  await expect(page).toHaveURL(/\/docs\/react\//);
  await documentationModes(page)
    .getByRole('button', { name: /^Run(?:,|$)/ })
    .click();
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    /(?:localhost:4610|ag-ui\/interrupts\/react)/
  );
  await selectFramework(page, 'angular');
  await expect(page).not.toHaveURL(/\/docs\/react\//);
  await page.goBack();
  await expect(page.getByLabel('Framework')).toHaveAttribute('data-value', 'react');
  await page.reload();
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    /(?:localhost:4610|ag-ui\/interrupts\/react)/
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expectFrameworkControl(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('react-ag-ui-interrupts-docs-mobile.png'),
  });
});

for (const phase of ['paused', 'resume']) {
  test(`switching away disposes the native ${phase} owner and returning stays lazy`, async ({ page, request }) => {
    test.skip(Boolean(process.env['BASE_URL']), 'Local execution lifetime is verified before deployment');
    const origin = 'http://127.0.0.1:4610';
    await request.post(origin + '/__reset');
    await page.goto('/docs/react/ag-ui/guides/interrupts?mode=run');
    const frame = page.frameLocator('iframe');
    await expect(frame.getByRole('region', { name: 'Runtime connection' })).toContainText('Shared runtime');
    await frame.getByLabel('Message', { exact: true }).fill(phase === 'resume' ? 'Resume hold' : 'Fictional refund');
    await frame.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(frame.getByRole('status')).toHaveText('Awaiting your decision.');
    if (phase === 'resume') {
      await frame.getByRole('button', { name: 'Issue refund', exact: true }).click();
      await expect(frame.getByRole('region', { name: 'Conversation', exact: true })).toContainText('Live partial');
      expect((await (await request.get(origin + '/__lifetime')).json()).active).toBe(true);
    }
    const oldFrame = await page.locator('iframe').elementHandle();
    await selectFramework(page, 'angular');
    await expect.poll(() => oldFrame?.evaluate(element => element.isConnected)).toBe(false);
    await expect.poll(async () => (await (await request.get(origin + '/__lifetime')).json()).active).toBe(false);
    await request.post(origin + '/__release');
    await selectFramework(page, 'react');
    await expect(frame.getByRole('status')).toHaveText('Ready.');
    await expect(frame.getByRole('heading', { name: 'Refund approval' })).toHaveCount(0);
    await expect(frame.getByRole('region', { name: 'Conversation', exact: true }).locator('li')).toHaveCount(0);
    await expect(frame.getByLabel('Message', { exact: true })).toHaveValue('');
    const proof: { path: string }[] = await (await request.get(origin + '/__requests')).json();
    expect(proof).toHaveLength(phase === 'resume' ? 2 : 1);
    expect(proof.every(entry => entry.path === '/ag-ui/interrupts/agent/native')).toBe(true);
  });
}
