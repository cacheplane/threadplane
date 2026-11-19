// The preview server (`serve.mjs <example> --backend`) runs the real graph under
// `langgraph dev` on aimock fixtures shared with the Angular example; controls
// come from scripts/react-cockpit/langgraph-proxy.mjs.
import { documentationModes } from './fixtures/workspace-controls';
import { selectFramework, expectFrameworkControl } from './fixtures/framework-controls';
import { test, expect } from '@playwright/test';

test('public React time-travel keep topic docs, sources, runtime, and history aligned', async ({
  page,
}, testInfo) => {
  await page.goto('/docs/react/langgraph/guides/time-travel');
  await expect(page.getByLabel('Framework')).toHaveAttribute('data-value', 'react');
  await expect(
    page.getByRole('heading', {
      name: 'React time travel preview',
      exact: true,
    })
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'React streaming preview', exact: true })
  ).toHaveCount(0);
  await expect(
    page.locator(
      '[data-example-file="cockpit/langgraph/time-travel/react/src/application.ts"]'
    )
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('react-time-travel-docs-desktop.png'),
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
    /(?:localhost:4607|langgraph\/time-travel\/react)/
  );
  await selectFramework(page, 'angular');
  await expect(page).not.toHaveURL(/\/docs\/react\//);
  await page.goBack();
  await expect(page.getByLabel('Framework')).toHaveAttribute('data-value', 'react');
  await page.reload();
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    /(?:localhost:4607|langgraph\/time-travel\/react)/
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expectFrameworkControl(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('react-time-travel-docs-mobile.png'),
  });
});
test('switching away releases a held fork and returning starts with an empty checkpoint page', async ({
  page,
  request,
}) => {
  test.skip(
    Boolean(process.env['BASE_URL']),
    'Local fork lifetime is verified before deployment'
  );
  const origin = 'http://127.0.0.1:4607';
  await request.post(origin + '/__reset');
  await request.post(origin + '/__ready', { timeout: 180000 });
  await page.goto('/docs/react/langgraph/guides/time-travel?mode=run');
  const frame = page.frameLocator('iframe');
  for (const text of ['A', 'B']) {
    await frame.getByLabel('Message', { exact: true }).fill(text);
    await frame.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(frame.getByRole('status')).toHaveText('Response complete.');
  }
  // Real history saves input, start and done checkpoints per turn: select
  // turn A's completed checkpoint from the page the app just loaded.
  const loaded = page.waitForResponse((r) => r.url().endsWith('/history'));
  await frame
    .getByRole('button', { name: 'Refresh saved checkpoints' })
    .click();
  const history: { next: string[]; values: { messages: unknown[] } }[] =
    await (await loaded).json();
  const a = history.findIndex(
    (entry) => entry.next.length === 0 && entry.values.messages.length === 2
  );
  await frame
    .getByRole('button', { name: `Select checkpoint ${a + 1}` })
    .click();
  await request.post(origin + '/__hold/stream');
  await frame.getByLabel('Message', { exact: true }).fill('Held fork');
  await frame.getByRole('button', { name: 'Fork selected checkpoint' }).click();
  await expect
    .poll(
      async () =>
        (await (await request.get(origin + '/__lifetime')).json()).activeStream
    )
    .toBe(true);
  const oldFrame = await page.locator('iframe').elementHandle();
  await selectFramework(page, 'angular');
  await expect.poll(() => oldFrame?.evaluate((element) => element.isConnected)).toBe(false);
  await expect
    .poll(
      async () =>
        (
          await (await request.get(origin + '/__lifetime')).json()
        ).activeStream
    )
    .toBe(false);
  await request.post(origin + '/__release');
  await selectFramework(page, 'react');
  await expect(frame.getByRole('status')).toHaveText('Ready.');
  await expect(
    frame.getByRole('region', { name: 'Last loaded checkpoint page' })
  ).toContainText('No checkpoint page loaded.');
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
  expect(
    proof.filter((entry) => entry.path.endsWith('/runs/stream'))
  ).toHaveLength(3);
});
