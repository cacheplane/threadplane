import { selectFramework, expectFrameworkControl } from './fixtures/framework-controls';
import { test, expect } from '@playwright/test';

test('public React deployment runtime keep topic docs, sources, runtime, and history aligned', async ({
  page,
}, testInfo) => {
  await page.goto('/docs/react/langgraph/guides/deployment');
  await expect(page.getByLabel('Framework')).toHaveValue('react');
  await expect(
    page.getByRole('heading', {
      name: 'React deployment runtime preview',
      exact: true,
    })
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'React streaming preview', exact: true })
  ).toHaveCount(0);
  await expect(
    page.locator(
      '[data-example-file="cockpit/langgraph/deployment-runtime/react/src/application.ts"]'
    )
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('react-deployment-runtime-docs-desktop.png'),
  });
  await page
    .locator('[data-workspace-desktop-navigation]')
    .getByRole('button', { name: 'Code', exact: true })
    .click();
  await expect(page).toHaveURL(
    '/docs/react/langgraph/guides/deployment?mode=code'
  );
  await page
    .locator('[data-workspace-desktop-navigation]')
    .getByRole('button', { name: /^Run(?:,|$)/ })
    .click();
  await expect(page).toHaveURL(
    '/docs/react/langgraph/guides/deployment?mode=run'
  );
  await expect(page.locator('iframe')).toBeVisible();
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    /(?:localhost:4608|langgraph\/deployment-runtime\/react)/
  );
  await selectFramework(page, 'angular');
  await expect(page).toHaveURL('/docs/angular/langgraph/guides/deployment?mode=run');
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(
    '/docs/react/langgraph/guides/deployment?mode=run'
  );
  await expect(page.getByLabel('Framework')).toHaveValue('react');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(
    '/docs/react/langgraph/guides/deployment?mode=run'
  );
  await expect(page.locator('iframe')).toBeVisible();
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    /(?:localhost:4608|langgraph\/deployment-runtime\/react)/
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expectFrameworkControl(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('react-deployment-runtime-docs-mobile.png'),
  });
});
test('switching away releases the held Deployment Runtime stream and returning stays lazy', async ({
  page,
  request,
}) => {
  test.skip(
    Boolean(process.env['BASE_URL']),
    'Local execution lifetime is verified before deployment'
  );
  const origin = 'http://127.0.0.1:4608';
  await request.post(origin + '/__reset');
  await page.goto('/docs/react/langgraph/guides/deployment?mode=run');
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
  await selectFramework(page, 'angular');
  await expect.poll(() => oldFrame?.evaluate((element) => element.isConnected)).toBe(false);
  await expect
    .poll(
      async () =>
        (
          await (await request.get(origin + '/__lifetime')).json()
        ).active
    )
    .toBe(false);
  await request.post(origin + '/__release');
  await selectFramework(page, 'react');
  await expect(frame.getByRole('status')).toHaveText('Ready.');
  await expect(
    frame
      .getByRole('region', { name: 'Conversation', exact: true })
      .getByRole('article')
  ).toHaveCount(0);
  await expect(frame.getByLabel('Message', { exact: true })).toHaveValue('');
  const proof: { path: string }[] = await (
    await request.get(origin + '/__requests')
  ).json();
  expect(proof.filter((entry) => entry.path.endsWith('/threads'))).toHaveLength(
    1
  );
  expect(
    proof.filter((entry) => entry.path.endsWith('/runs/stream'))
  ).toHaveLength(1);
});
