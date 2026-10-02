import { test, expect } from '@playwright/test';

// These cases own one local producer's request log and held response.
test.describe.configure({ mode: 'default' });

test('canonical Subagents Run retains attributed specialist text and full native parent history', async ({
  page,
  request,
}) => {
  test.skip(
    Boolean(process.env['BASE_URL']),
    'The compiled offline producer is verified before deployment'
  );
  const origin = 'http://127.0.0.1:4613';
  await request.post(origin + '/__reset');
  await page.goto('/docs/ag-ui/guides/subagents?frontend=react&mode=run');
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('status')).toHaveText('Ready.');
  for (const mode of ['sequential', 'direct']) {
    await frame.getByLabel('Message', { exact: true }).fill(mode);
    const response = page.waitForResponse(
      (candidate) =>
        new URL(candidate.url()).pathname === '/ag-ui/subagents/agent' &&
        candidate.request().method() === 'POST' &&
        candidate.request().postDataJSON().messages.at(-1)?.content === mode
    );
    await frame.getByRole('button', { name: 'Send', exact: true }).click();
    const received = await response;
    expect(received.status()).toBe(200);
    expect(received.headers()['content-type']).toContain('text/event-stream');
    await expect(frame.getByRole('status')).toHaveText('Response complete.');
  }
  await expect(frame.locator('[data-child-id]')).toHaveCount(3);
  for (const role of ['Research', 'Booking', 'Itinerary'])
    await expect(
      frame.getByRole('region', { name: role + ' specialist' })
    ).toContainText('A fictional specialist observation.');
  const wire = await (await request.get(origin + '/__requests')).json();
  expect(wire).toHaveLength(2);
  expect(wire[1].body.threadId).toBe(wire[0].body.threadId);
  expect(wire[1].body.messages).toHaveLength(9);
  expect(
    wire.every(
      (entry: { path: string }) => entry.path === '/ag-ui/subagents/agent'
    )
  ).toBe(true);
});

test('public React AG-UI subagents keep topic docs, sources, runtime, and history aligned', async ({
  page,
  request,
}, testInfo) => {
  const origin = 'http://127.0.0.1:4613';
  const requestsBefore = process.env['BASE_URL']
    ? undefined
    : await (await request.get(origin + '/__requests')).json();
  await page.goto('/docs/ag-ui/guides/subagents?frontend=react');
  await expect(page.getByLabel('Example UI')).toHaveValue('react');
  await expect(
    page.getByRole('heading', {
      name: 'React AG-UI Subagents preview',
      exact: true,
    })
  ).toBeVisible();
  await expect(
    page.getByRole('heading', {
      name: 'React AG-UI interrupts preview',
      exact: true,
    })
  ).toHaveCount(0);
  await expect(
    page.locator(
      '[data-example-file="cockpit/ag-ui/subagents/react/src/application.ts"]'
    )
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('react-ag-ui-subagents-docs-desktop.png'),
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
    /(?:localhost:4613|ag-ui\/subagents\/react)/
  );
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('status')).toHaveText('Ready.');
  await page.getByLabel('Example UI').selectOption('angular');
  await expect(page).not.toHaveURL(/frontend=react/);
  await page.goBack();
  await expect(page.getByLabel('Example UI')).toHaveValue('react');
  await expect(frame.getByRole('status')).toHaveText('Ready.');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Example UI')).toHaveValue('react');
  await expect(page.locator('iframe')).toHaveAttribute(
    'src',
    /(?:localhost:4613|ag-ui\/subagents\/react)/
  );
  await expect(frame.getByRole('status')).toHaveText('Ready.');
  await expect(frame.locator('[data-parent-message]')).toHaveCount(0);
  await expect(frame.locator('[data-child-id]')).toHaveCount(0);
  await expect(frame.getByLabel('Message', { exact: true })).toHaveValue('');
  if (requestsBefore !== undefined) {
    const requestsAfter = await (
      await request.get(origin + '/__requests')
    ).json();
    expect(requestsAfter).toHaveLength(requestsBefore.length);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('Example UI')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('react-ag-ui-subagents-docs-mobile.png'),
  });
});

test('switching away disposes a held child stream and returning stays lazy', async ({
  page,
  request,
}) => {
  test.skip(
    Boolean(process.env['BASE_URL']),
    'Local execution lifetime is verified before deployment'
  );
  const origin = 'http://127.0.0.1:4613';
  await request.post(origin + '/__reset');
  await page.goto('/docs/ag-ui/guides/subagents?frontend=react&mode=run');
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('status')).toHaveText('Ready.');
  await request.post(origin + '/__hold/child-text');
  await frame.getByLabel('Message', { exact: true }).fill('sequential');
  const response = page.waitForResponse(
    (candidate) =>
      new URL(candidate.url()).pathname === '/ag-ui/subagents/agent' &&
      candidate.request().method() === 'POST' &&
      candidate.request().postDataJSON().messages.at(-1)?.content ===
        'sequential'
  );
  await frame.getByRole('button', { name: 'Send', exact: true }).click();
  const received = await response;
  expect(received.status()).toBe(200);
  expect(received.headers()['content-type']).toContain('text/event-stream');
  await expect
    .poll(
      async () =>
        (
          await (await request.get(origin + '/__lifetime')).json()
        ).active
    )
    .toBe(true);
  await expect(frame.getByRole('status')).toHaveText(
    'Planning with specialists…'
  );
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
  await expect(frame.locator('[data-parent-message]')).toHaveCount(0);
  await expect(frame.getByLabel('Message', { exact: true })).toHaveValue('');
  const proof = await (await request.get(origin + '/__requests')).json();
  expect(proof).toHaveLength(1);
  expect(proof[0].path).toBe('/ag-ui/subagents/agent');
});
