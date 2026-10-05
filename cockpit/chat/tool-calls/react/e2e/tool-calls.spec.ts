import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('a held real tool call exposes complete arguments before its result', async ({
  page,
  request,
}) => {
  expect((await request.post('/__hold-tool')).status()).toBe(200);
  await page.goto(base);
  await submit(page, 'Status UA123');
  const pending = page.getByRole('region', {
    name: 'Observed tool call',
    exact: true,
  });
  await expect(pending).toHaveCount(1);
  await expect(pending).toContainText('"flight_number": "UA123"');
  await expect(pending.getByText('Result', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Send', exact: true })
  ).toBeDisabled();
  await request.post('/__release');
  await saved(page);
  await expect(cards(page)).toHaveCount(1);
});
test('worker failure is generic and never retried', async ({
  page,
  request,
}) => {
  expect((await request.post('/__worker-failure')).status()).toBe(200);
  await page.goto(base);
  await submit(page, 'Status UA123');
  await blocked(page);
  const wire: Wire[] = await (await request.get('/__requests')).json();
  expect(
    wire.filter((item) => item.path.endsWith('/runs/stream'))
  ).toHaveLength(1);
  expect(wire.filter((item) => item.path.endsWith('/history'))).toHaveLength(0);
  await expect(page.locator('body')).not.toContainText('Graph worker');
});
test('long literal tool arguments and data remain text on mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base);
  await submit(page, 'Literal long airport');
  await saved(page);
  await expect(cards(page)).toContainText('<button>observed</button>');
  await expect(
    page.getByRole('button', { name: 'observed', exact: true })
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
});
test('page disposal aborts held history and cannot replay a turn', async ({
  page,
  request,
}) => {
  await request.post('/__history/hold');
  await page.goto(base);
  await submit(page, 'Status UA123');
  await expect(page.getByRole('status')).toHaveText(
    'Confirming saved conversation…'
  );
  await page.goto('about:blank');
  await expect
    .poll(
      async () =>
        (
          await (await request.get('/__lifetime')).json()
        ).activeHistory
    )
    .toBe(false);
  await request.post('/__release-history');
  const wire: Wire[] = await (await request.get('/__requests')).json();
  expect(
    wire.filter((item) => item.path.endsWith('/runs/stream'))
  ).toHaveLength(1);
  expect(wire.filter((item) => item.path.endsWith('/history'))).toHaveLength(1);
});
test('metadata failure preserves the real tool stream and hides private diagnostics', async ({
  page,
  request,
}) => {
  await request.post('/__metadata-failure');
  await page.goto(base);
  await submit(page, 'Status UA123');
  await saved(page);
  await expect(cards(page)).toHaveCount(1);
  await expect(page.locator('body')).not.toContainText('Authored metadata');
});
test('authored developer connection routes only to its configured target', async ({
  page,
  request,
}) => {
  await page.goto('http://127.0.0.1:3000/');
  await page.setContent(`<!doctype html><html><body><p id="state">Waiting</p><script>
    addEventListener('message', event => {
      const frame = document.getElementById('pilot');
      if (event.origin !== 'http://127.0.0.1:4623' || event.source !== frame.contentWindow) return;
      if (event.data.type === 'tplane:runtime-child-ready') frame.contentWindow.postMessage({
        type: 'tplane:runtime-configure', version: 2, nonce: event.data.nonce, generation: 1,
        target: {kind: 'langsmith', apiUrl: 'http://127.0.0.1:4623/developer-api', apiKey: 'TEST_DEVELOPER_KEY'}
      }, event.origin);
      if (event.data.type === 'tplane:runtime-configured') frame.contentWindow.postMessage({
        type: 'tplane:runtime-check', version: 1, nonce: 'parent-health', capability: 'tool-calls'
      }, event.origin);
      if (event.data.type === 'tplane:runtime-ready' && event.data.nonce === 'parent-health') document.getElementById('state').textContent = 'Ready';
    });</script><iframe id="pilot" title="Chat Tool Calls React" src="http://127.0.0.1:4623/chat/tool-calls/react/"></iframe></body></html>`);
  await expect(page.locator('#state')).toHaveText('Ready');
  const frame = page.frameLocator('#pilot');
  await frame.getByLabel('Message', { exact: true }).fill('Status UA123');
  await frame.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(frame.getByRole('status')).toHaveText('Response saved.');
  const wire: Wire[] = await (await request.get('/__requests')).json();
  expect(wire).toHaveLength(4);
  expect(
    wire.every(
      (entry) =>
        entry.path.startsWith('/developer-api/') &&
        entry.key === 'TEST_DEVELOPER_KEY'
    )
  ).toBe(true);
  expect(JSON.stringify(wire.map((entry) => entry.body))).not.toContain(
    'TEST_DEVELOPER_KEY'
  );
  await expect(frame.locator('body')).not.toContainText('TEST_DEVELOPER_KEY');
});
type Wire = {
  path: string;
  method: string;
  key: string | null;
  body: {
    assistant_id?: string;
    command?: unknown;
    input?: { messages: { content: string }[] };
  };
};
const base = '/chat/tool-calls/react/';
const cards = (page: Page) =>
  page.getByRole('region', { name: 'Observed tool result', exact: true });
const conversation = (page: Page) =>
  page.getByRole('region', { name: 'Conversation', exact: true });
async function submit(page: Page, text: string) {
  await page.getByLabel('Message', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}
async function saved(page: Page) {
  await expect(page.getByRole('status')).toHaveText('Response saved.');
}
async function blocked(page: Page) {
  await expect(page.getByRole('status')).toHaveText(
    'Start a new conversation to continue.'
  );
  await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
}
test.beforeEach(async ({ request }) => {
  await request.post('/__reset');
});
test.afterEach(async ({ request }) => {
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
});
test('installed SDK confirms single and parallel tools on one saved conversation', async ({
  page,
  request,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base);
  await expect(page.getByRole('status')).toHaveText('Ready.');
  expect(await (await request.get('/__requests')).json()).toEqual([]);
  await submit(page, 'Status UA123');
  await saved(page);
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).first()).toContainText('lookup_flight');
  await expect(cards(page).first()).toContainText('UA123');
  await submit(page, 'Compare airports');
  await saved(page);
  await expect(cards(page)).toHaveCount(3);
  await expect(cards(page).nth(1)).toContainText('LAX');
  await expect(cards(page).nth(2)).toContainText('JFK');
  await page.screenshot({
    path: testInfo.outputPath('tools-desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('tools-mobile.png'),
    fullPage: true,
  });
  const wire: Wire[] = await (await request.get('/__requests')).json();
  const runs = wire.filter((item) => item.path.endsWith('/runs/stream'));
  expect(wire.filter((item) => item.path.endsWith('/threads'))).toHaveLength(1);
  expect(runs).toHaveLength(2);
  expect(new Set(runs.map((item) => item.path)).size).toBe(1);
  expect(
    runs.every(
      (item) => item.body.assistant_id === 'c-tool-calls' && !item.body.command
    )
  ).toBe(true);
  expect(wire.filter((item) => item.path.endsWith('/history'))).toHaveLength(2);
  expect(wire.filter((item) => item.method === 'GET')).toHaveLength(2);
  await expect(conversation(page)).not.toContainText(
    'Authored aviation conversation'
  );
  expect(errors).toEqual([]);
});
for (const [text, count] of [
  ['Sequential lookup', 2],
  ['Routes tomorrow', 1],
  ['Unknown flight', 1],
  ['No tools', 0],
] as const) {
  test(`real graph ${text} preserves observed results`, async ({ page }) => {
    await page.goto(base);
    await submit(page, text);
    await saved(page);
    await expect(cards(page)).toHaveCount(count);
    if (text === 'Unknown flight')
      await expect(cards(page)).toContainText('not found');
    if (text === 'Routes tomorrow')
      await expect(cards(page)).toContainText('date_offset_days');
  });
}
test('invalid finalized tool arguments withhold cards and further admission', async ({
  page,
  request,
}) => {
  await page.goto(base);
  await submit(page, 'Malformed flight');
  await blocked(page);
  await expect(cards(page)).toHaveCount(0);
  const wire: Wire[] = await (await request.get('/__requests')).json();
  expect(
    wire.filter((item) => item.path.endsWith('/runs/stream'))
  ).toHaveLength(1);
  expect(wire.filter((item) => item.path.endsWith('/history'))).toHaveLength(0);
});
for (const mode of [
  'changed',
  'missing',
  'pending',
  'failed',
  'args',
  'result',
  'name',
  'ids',
  'interrupt',
  'subgraph',
]) {
  test(`rejects ${mode} saved evidence without replay`, async ({
    page,
    request,
  }) => {
    await request.post(`/__history/${mode}`);
    await page.goto(base);
    await submit(page, 'Status UA123');
    await blocked(page);
    const wire: Wire[] = await (await request.get('/__requests')).json();
    expect(
      wire.filter((item) => item.path.endsWith('/runs/stream'))
    ).toHaveLength(1);
    expect(wire.filter((item) => item.body.command)).toHaveLength(0);
  });
}
for (const hold of ['stream', 'history']) {
  test(`Stop fences held ${hold} and late release`, async ({
    page,
    request,
  }) => {
    await request.post(
      hold === 'stream' ? '/__hold-stream' : '/__history/hold'
    );
    await page.goto(base);
    await submit(page, 'Status UA123');
    if (hold === 'history')
      await expect(page.getByRole('status')).toHaveText(
        'Confirming saved conversation…'
      );
    await expect(
      page.getByRole('button', { name: 'Stop', exact: true })
    ).toBeEnabled();
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await blocked(page);
    await request.post(hold === 'stream' ? '/__release' : '/__release-history');
    await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
    const wire: Wire[] = await (await request.get('/__requests')).json();
    expect(
      wire.filter((item) => item.path.endsWith('/runs/stream'))
    ).toHaveLength(1);
  });
}
test('draft seeds and local reset perform no automatic request', async ({
  page,
  request,
}) => {
  await page.goto(base);
  await page.getByRole('button', { name: 'Flight UA123', exact: true }).click();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
    "What's the status of UA123?"
  );
  expect(await (await request.get('/__requests')).json()).toEqual([]);
  await page.getByRole('button', { name: 'New conversation' }).click();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('');
  expect(await (await request.get('/__requests')).json()).toEqual([]);
});
test('failed creation never retries and New restores only local readiness', async ({
  page,
  request,
}) => {
  await request.post('/__fail-create');
  await page.goto(base);
  await submit(page, 'Status UA123');
  await blocked(page);
  await page.getByRole('button', { name: 'New conversation' }).click();
  await expect(page.getByRole('status')).toHaveText('Ready.');
  const wire: Wire[] = await (await request.get('/__requests')).json();
  expect(wire.filter((item) => item.path.endsWith('/threads'))).toHaveLength(1);
  expect(
    wire.filter((item) => item.path.endsWith('/runs/stream'))
  ).toHaveLength(0);
});
