import { selectFramework, expectFrameworkControl } from './fixtures/framework-controls';
import { test, expect } from '@playwright/test';

test('public React persistence keep topic docs, sources, runtime, and history aligned', async ({
  page,
}, testInfo) => {
  await page.goto('/docs/react/langgraph/guides/persistence');
  await expect(page.getByLabel('Framework')).toHaveValue('react');
  await expect(
    page.getByRole('heading', {
      name: 'React persistence preview',
      exact: true,
    })
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'React streaming preview', exact: true })
  ).toHaveCount(0);
  await expect(
    page.locator(
      '[data-example-file="cockpit/langgraph/persistence/react/src/application.ts"]'
    )
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('react-persistence-docs-desktop.png'),
  });
  await page
    .locator('[data-workspace-desktop-navigation]')
    .getByRole('button', { name: 'Code', exact: true })
    .click();
  await expect(page).toHaveURL(/\/docs\/react\//);
  await page
    .locator('[data-workspace-desktop-navigation]')
    .getByRole('button', { name: /^Run(?:,|$)/ })
    .click();
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    /(?:localhost:4604|langgraph\/persistence\/react)/
  );
  await selectFramework(page, 'angular');
  await expect(page).not.toHaveURL(/\/docs\/react\//);
  await page.goBack();
  await expect(page.getByLabel('Framework')).toHaveValue('react');
  await page.reload();
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    /(?:localhost:4604|langgraph\/persistence\/react)/
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expectFrameworkControl(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('react-persistence-docs-mobile.png'),
  });
});

test('switching away releases held React history and returning starts with an empty picker', async ({
  page,
  request,
}) => {
  test.skip(
    Boolean(process.env['BASE_URL']),
    'Local history lifetime is verified before deployment'
  );
  await request.post('http://127.0.0.1:4604/__reset');
  await page.goto('/docs/react/langgraph/guides/persistence?mode=run');
  const frame = page.frameLocator('iframe');
  for (const text of [
    'Remember Avery likes tea',
    'Remember Blair likes coffee',
  ]) {
    await frame.getByLabel('Message', { exact: true }).fill(text);
    await frame.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(frame.getByRole('status')).toHaveText('Response complete.');
    if (text.includes('Avery')) {
      await frame.getByRole('button', { name: 'New conversation' }).click();
      await expect(frame.getByRole('status')).toHaveText('Ready.');
    }
  }
  await request.post('http://127.0.0.1:4604/__hold-history');
  await frame
    .getByRole('button', { name: 'Conversation 1', exact: true })
    .click();
  await expect(frame.getByRole('status')).toHaveText(
    'Loading saved conversation…'
  );
  const oldFrame = await page.locator('iframe').elementHandle();
  await selectFramework(page, 'angular');
  await expect.poll(() => oldFrame?.evaluate((element) => element.isConnected)).toBe(false);
  await expect
    .poll(
      async () =>
        (
          await (await request.get('http://127.0.0.1:4604/__lifetime')).json()
        ).active
    )
    .toBe(false);
  await request.post('http://127.0.0.1:4604/__release');
  await selectFramework(page, 'react');
  await expect(frame.getByRole('status')).toHaveText('Ready.');
  await expect(
    frame.getByRole('region', { name: 'Saved conversations' })
  ).toContainText('No saved conversations yet.');
  await expect(
    frame
      .getByRole('region', { name: 'Conversation', exact: true })
      .locator('article')
  ).toHaveCount(0);
  const proof = await (
    await request.get('http://127.0.0.1:4604/__requests')
  ).json();
  expect(
    proof.filter((entry: { path: string }) => entry.path.endsWith('/threads'))
  ).toHaveLength(2);
  expect(
    proof.filter((entry: { path: string }) => entry.path.endsWith('/history'))
  ).toHaveLength(1);
  expect(
    proof.filter((entry: { path: string }) =>
      entry.path.endsWith('/runs/stream')
    )
  ).toHaveLength(2);
});
