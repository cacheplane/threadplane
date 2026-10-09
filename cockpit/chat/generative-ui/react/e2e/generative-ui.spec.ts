import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const base = '/chat/generative-ui/react/';
const box = (page: Page) =>
  page.getByRole('textbox', { name: 'Message', exact: true });
const boards = (page: Page) => page.locator('[data-dashboard-spec-owner]');
const requests = async (request: APIRequestContext) =>
  (await request.get('/__requests')).json();
const configure = async (
  request: APIRequestContext,
  data: Record<string, unknown>
) => expect((await request.post('/__configure', { data })).status()).toBe(200);
async function send(page: Page, text: string) {
  await box(page).fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Response saved.' })
  ).toBeVisible();
}
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page, request }) => {
  expect((await request.post('/__reset')).status()).toBe(200);
  const list: string[] = [];
  errors.set(page, list);
  page.on('pageerror', (e) => list.push(e.message));
  page.on('request', (r) => {
    if (!r.url().startsWith('http://127.0.0.1:4627/')) list.push(r.url());
  });
});
test.afterEach(async ({ page, request }) => {
  expect(errors.get(page)).toEqual([]);
  const proofs = await (await request.get('/__graph-proof')).json();
  for (const proof of proofs)
    expect(proof).toMatchObject({
      actualCompiledGraph: true,
      networkConnectAttempts: 0,
      titleMessageCallbacks: 0,
      sourceSha256: createHash('sha256')
        .update(readFileSync(resolve(__dirname, '../../python/src/graph.py')))
        .digest('hex'),
      lockSha256: createHash('sha256')
        .update(readFileSync(resolve(__dirname, '../../python/uv.lock')))
        .digest('hex'),
    });
  await page.goto('about:blank');
  await expect
    .poll(async () => (await (await request.get('/__lifetime')).json()).held)
    .toBe(0);
});
test('mount is inert; four confirmed turns retain ownership and share refreshed data', async ({
  page,
  request,
}, testInfo) => {
  await page.goto(base);
  await expect(
    page.getByRole('heading', { name: 'Chat generative UI' })
  ).toBeVisible();
  expect(await requests(request)).toEqual([]);
  await page.getByRole('button', { name: 'Show dashboard' }).click();
  expect(await requests(request)).toEqual([]);
  await box(page).press('Enter');
  await expect(
    page.getByRole('status').filter({ hasText: 'Response saved.' })
  ).toBeVisible();
  await expect(box(page)).toHaveValue('');
  await expect(boards(page)).toHaveCount(1);
  const owner = await boards(page).getAttribute('data-dashboard-spec-owner');
  for (const type of [
    'dashboard_grid',
    'container',
    'stat_card',
    'line_chart',
    'bar_chart',
    'data_grid',
  ])
    await expect(
      boards(page).locator(`[data-dashboard-view="${type}"]`).first()
    ).toBeVisible();
  expect(await requests(request)).toHaveLength(5);
  const table = boards(page).getByRole('table', {
    name: 'Recent Disruptions',
    exact: true,
  });
  const originalRows = await table.locator('tbody tr').count();
  expect(originalRows).toBeGreaterThan(1);
  await page.screenshot({
    path: testInfo.outputPath('desktop.png'),
    fullPage: true,
  });
  await send(page, 'Filter to only the cancelled flights.');
  await expect(boards(page)).toHaveCount(1);
  expect(await boards(page).getAttribute('data-dashboard-spec-owner')).toBe(
    owner
  );
  await expect(table.locator('tbody tr')).toHaveCount(3);
  expect(
    await table.locator('tbody tr td:nth-child(2)').allTextContents()
  ).toEqual(['cancelled', 'cancelled', 'cancelled']);
  await expect(table).toContainText('cancelled');
  expect(await requests(request)).toHaveLength(9);
  await send(page, 'Remove the disruptions table from the structure.');
  await expect(boards(page)).toHaveCount(2);
  await expect(
    boards(page)
      .first()
      .getByRole('table', { name: 'Recent Disruptions', exact: true })
      .locator('tbody tr')
  ).toHaveCount(3);
  await expect(
    boards(page).nth(1).locator('[data-dashboard-view="data_grid"]')
  ).toHaveCount(0);
  expect(await requests(request)).toHaveLength(13);
  await send(page, 'Why is on-time performance changing?');
  await expect(boards(page)).toHaveCount(2);
  await expect(
    page.getByText('On-time performance needs operational context to explain.')
  ).toBeVisible();
  const captured = await requests(request);
  expect(captured).toHaveLength(17);
  expect(
    captured.filter((r: { path: string }) => r.path.endsWith('/runs/stream'))
  ).toHaveLength(4);
  expect(
    captured.filter((r: { path: string }) => r.path === '/api/threads')
  ).toHaveLength(1);
  writeFileSync(
    testInfo.outputPath('graph-proof.json'),
    JSON.stringify(
      {
        requests: captured,
        proofs: await (await request.get('/__graph-proof')).json(),
      },
      null,
      2
    )
  );
  await page.setViewportSize({ width: 375, height: 812 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
    )
    .toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('mobile.png'),
    fullPage: true,
  });
});
test('nonempty parent preserves prose with inspectable raw result and notice', async ({
  page,
  request,
}) => {
  await page.goto(base);
  await send(page, 'prose render');
  await expect(boards(page)).toHaveCount(0);
  await expect(page.getByText('Here is the layout.')).toBeVisible();
  await expect(
    page.getByText(
      'This layout was not applied because the assistant already supplied prose. The tool result is available for inspection.'
    )
  ).toBeVisible();
  await page.getByText('Server tool result', { exact: true }).first().click();
  await expect(
    page
      .locator('details[open] > pre')
      .filter({ hasText: 'dashboard_grid' })
      .first()
  ).toBeVisible();
  expect(await requests(request)).toHaveLength(5);
});
test('pending update keeps the old board; double submit, Stop and New cannot publish stale state', async ({
  page,
  request,
}) => {
  await page.goto(base);
  await send(page, 'Show dashboard');
  const old = await boards(page).innerText();
  await configure(request, { holdStream: true });
  await box(page).fill('Filter to only the cancelled flights.');
  await box(page).press('Enter');
  await box(page).press('Enter');
  await expect(box(page)).toHaveValue('');
  await expect
    .poll(async () => (await (await request.get('/__lifetime')).json()).held)
    .toBe(1);
  expect(await boards(page).innerText()).toBe(old);
  expect(
    (await requests(request)).filter((r: { path: string }) =>
      r.path.endsWith('/runs/stream')
    )
  ).toHaveLength(2);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(
    page.getByText('Start a new conversation to continue.', { exact: true })
  ).toBeVisible();
  expect(await boards(page).innerText()).toBe(old);
  await request.post('/__release');
  await page.getByRole('button', { name: 'New conversation' }).click();
  await expect(boards(page)).toHaveCount(0);
  await configure(request, { holdStream: false, holdState: true });
  await box(page).fill('New dashboard');
  await box(page).press('Enter');
  await expect
    .poll(async () => (await (await request.get('/__lifetime')).json()).held)
    .toBe(1);
  await page.getByRole('button', { name: 'New conversation' }).click();
  await request.post('/__release');
  await expect(boards(page)).toHaveCount(0);
  await expect(box(page)).toBeEnabled();
  await configure(request, { holdState: false });
  await send(page, 'Fresh dashboard');
  await expect(boards(page)).toHaveCount(1);
  expect(
    (await requests(request)).filter(
      (r: { path: string }) => r.path === '/api/threads'
    )
  ).toHaveLength(3);
});
for (const fault of [
  'malformed-layout',
  'missing-terminal',
  'pending-tasks',
  'task-error',
])
  test(`rejects ${fault} and retains the confirmed layout`, async ({
    page,
    request,
  }) => {
    await page.goto(base);
    await send(page, 'Show dashboard');
    const old = await boards(page).innerText();
    await configure(request, { stateFault: fault });
    await box(page).fill('Show another dashboard');
    await box(page).press('Enter');
    await expect(page.getByRole('alert')).toContainText(
      'could not be confirmed'
    );
    await expect(boards(page)).toHaveCount(1);
    expect(await boards(page).innerText()).toBe(old);
    await expect(box(page)).toBeDisabled();
    expect(
      (await requests(request)).filter((r: { path: string }) =>
        r.path.endsWith('/runs/stream')
      )
    ).toHaveLength(2);
  });
for (const options of [{ runStatus: 'error' }, { failAgent: true }])
  test(`run failure ${JSON.stringify(
    options
  )} leaves no provisional layout`, async ({ page, request }) => {
    await page.goto(base);
    await configure(request, options);
    await box(page).fill('Show dashboard');
    await box(page).press('Enter');
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(boards(page)).toHaveCount(0);
    await expect(box(page)).toBeDisabled();
  });
test('unsupported streamed layout is quarantined before mounting a surface', async ({
  page,
  request,
}) => {
  await page.goto(base);
  await page.route('**/api/threads/**', async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    await route.fulfill({
      response,
      body: body.replaceAll('dashboard_grid', 'unsupported_view'),
    });
  });
  await box(page).fill('Show dashboard');
  await box(page).press('Enter');
  await expect(page.getByRole('alert')).toContainText('could not be confirmed');
  await expect(boards(page)).toHaveCount(0);
  await expect(page.locator('[data-dashboard-view]')).toHaveCount(0);
  expect(
    (await requests(request)).filter((r: { path: string }) =>
      r.path.endsWith('/runs/stream')
    )
  ).toHaveLength(1);
});
