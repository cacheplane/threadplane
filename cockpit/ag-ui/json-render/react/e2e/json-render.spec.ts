import { test, expect, type Page } from '@playwright/test';
const base = '/ag-ui/json-render/react/';
const rows = (page: Page) => page.locator('[data-dashboard-message]');
async function send(page: Page, text: string) {
  await page.getByLabel('Message', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}
test.beforeEach(async ({ request }) => {
  await request.post('/__reset');
});
test('actual compiled graph and installed SDK retain all six views, canonical batches, state updates and lazy New', async ({
  page,
  request,
}) => {
  await page.goto(base);
  expect(await (await request.get('/__requests')).json()).toEqual([]);
  let count = 0;
  const nativeIds: string[][] = [];
  for (const [mode, added] of [
    ['full', 9],
    ['filter', 5],
    ['structural', 5],
    ['zero', 3],
    ['prose', 9],
    ['rounds', 7],
    ['cap', 13],
    ['all-airlines', 5],
  ] as const) {
    await send(page, mode);
    await expect(page.getByRole('status')).toHaveText('Response complete.');
    count += added;
    await expect(rows(page)).toHaveCount(count);
    nativeIds.push(
      await rows(page).evaluateAll((elements) =>
        elements.map(
          (element) => element.getAttribute('data-dashboard-message')!
        )
      )
    );
    if (mode === 'full') {
      await expect(page.locator('[data-dashboard-view]')).toHaveCount(6);
      await expect(page.locator('.dashboard-metric')).toHaveText('84.2%');
      await expect(
        page.getByRole('table', { name: 'Disruptions', exact: true })
      ).toContainText('UA123');
    }
    if (mode === 'filter') {
      const table = page.getByRole('table', {
        name: 'Disruptions',
        exact: true,
      });
      await expect(table).toContainText('AA456');
      await expect(table).not.toContainText('UA123');
      await expect(page.locator('[data-dashboard-spec-owner]')).toHaveCount(1);
    }
    if (mode === 'structural') {
      await expect(page.locator('[data-dashboard-spec-owner]')).toHaveCount(2);
      await expect(
        page.getByRole('heading', { name: 'Updated flights' })
      ).toBeVisible();
    }
  }
  const requests = await (await request.get('/__requests')).json();
  expect(requests).toHaveLength(8);
  expect(
    new Set(
      requests.map(
        (entry: { body: { threadId: string } }) => entry.body.threadId
      )
    ).size
  ).toBe(1);
  expect(
    new Set(
      requests.map((entry: { body: { runId: string } }) => entry.body.runId)
    ).size
  ).toBe(8);
  for (let index = 0; index < requests.length; index++) {
    const entry = requests[index];
    expect(entry.path).toBe('/ag-ui/json-render/agent');
    expect(entry.body.protocolVersion).toBe('1.0');
    expect(entry.body.tools).toEqual([]);
    const prefix = entry.body.messages.slice(0, -1);
    expect(prefix.map((message: { id: string }) => message.id)).toEqual(
      index ? nativeIds[index - 1] : []
    );
    if (index) {
      expect(prefix).toHaveLength(requests[index - 1].final.length);
      for (const message of prefix)
        expect(message).toEqual(
          requests[index - 1].final.find(
            (row: { id: string }) => row.id === message.id
          )
        );
      expect(prefix.slice(0, requests[index - 1].body.messages.length)).toEqual(
        requests[index - 1].body.messages
      );
    }
    const calls = new Set<string>();
    for (const message of entry.final) {
      if (message.role === 'assistant')
        for (const call of message.toolCalls ?? []) calls.add(call.id);
      if (message.role === 'tool') {
        expect(calls.has(message.toolCallId)).toBe(true);
        expect(message.id).toBe(message.toolCallId);
      }
    }
  }
  await page.getByRole('button', { name: 'New conversation' }).click();
  await expect(rows(page)).toHaveCount(0);
  await expect(page.locator('[data-dashboard-spec-owner]')).toHaveCount(0);
  expect(await (await request.get('/__requests')).json()).toHaveLength(8);
  await send(page, 'full');
  await expect(page.getByRole('status')).toHaveText('Response complete.');
  const after = await (await request.get('/__requests')).json();
  expect(after).toHaveLength(9);
  expect(after[8].body.threadId).not.toBe(after[0].body.threadId);
  expect(after[8].body.messages).toHaveLength(1);
});
for (const stage of ['state', 'result', 'final'])
  test(`held ${stage} cannot publish a new layout or admit another Send`, async ({
    page,
    request,
  }) => {
    await page.goto(base);
    await request.post('/__hold/' + stage);
    await send(page, 'full');
    await expect
      .poll(
        async () => (await (await request.get('/__lifetime')).json()).active
      )
      .toBe(true);
    await expect(
      page.getByRole('button', { name: 'Send', exact: true })
    ).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'New conversation' })
    ).toBeDisabled();
    await expect(page.locator('[data-dashboard-spec-owner]')).toHaveCount(0);
    await request.post('/__release');
    await expect(page.getByRole('status')).toHaveText('Response complete.');
    await expect(page.locator('[data-dashboard-view]')).toHaveCount(6);
    expect(await (await request.get('/__requests')).json()).toHaveLength(1);
  });
test('retained layout reads valid streamed shared-state updates while native completion remains pending', async ({
  page,
  request,
}) => {
  await page.goto(base);
  await send(page, 'full');
  await expect(page.getByRole('status')).toHaveText('Response complete.');
  await request.post('/__hold/final');
  await send(page, 'filter');
  await expect
    .poll(async () => (await (await request.get('/__lifetime')).json()).active)
    .toBe(true);
  await expect(
    page.getByRole('table', { name: 'Disruptions', exact: true })
  ).not.toContainText('UA123');
  await expect(page.locator('[data-dashboard-spec-owner]')).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: 'Send', exact: true })
  ).toBeDisabled();
  await request.post('/__release');
  await expect(page.getByRole('status')).toHaveText('Response complete.');
});
for (const mode of [
  'http-error',
  'run-error',
  'wrong-run',
  'wrong-thread',
  'eof',
  'child',
  'legacy',
  'notice-eof',
  'bad-state',
  'truncated-prefix',
  'duplicate-result',
  'orphan-result',
  'missing-result',
  'wrong-result-id',
  'unknown-tool',
  'malformed-spec',
])
  test(`${mode} requires New without replay or exposing private failures`, async ({
    page,
    request,
  }) => {
    await page.goto(base);
    await send(page, 'full');
    await expect(page.getByRole('status')).toHaveText('Response complete.');
    await request.post('/__mode/' + mode);
    await send(page, 'full');
    await expect(page.getByRole('status')).toHaveText(
      'Start a new conversation to continue.'
    );
    await expect(
      page.getByRole('button', { name: 'Send', exact: true })
    ).toBeDisabled();
    expect(await (await request.get('/__requests')).json()).toHaveLength(2);
    await expect(page.locator('body')).not.toContainText('PRIVATE');
    await page.getByRole('button', { name: 'New conversation' }).click();
    await expect(page.getByRole('status')).toHaveText('Ready.');
    await expect(rows(page)).toHaveCount(0);
  });
for (const action of ['Stop', 'pagehide'])
  test(`${action} closes the held actual graph response and revokes late publication`, async ({
    page,
    request,
  }) => {
    await page.goto(base);
    await request.post('/__hold/result');
    await send(page, 'full');
    await expect
      .poll(
        async () => (await (await request.get('/__lifetime')).json()).active
      )
      .toBe(true);
    if (action === 'Stop')
      await page.getByRole('button', { name: 'Stop', exact: true }).click();
    else await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await expect
      .poll(
        async () => (await (await request.get('/__lifetime')).json()).active
      )
      .toBe(false);
    await request.post('/__release');
    expect(await (await request.get('/__requests')).json()).toHaveLength(1);
    await expect(page.locator('[data-dashboard-spec-owner]')).toHaveCount(0);
    if (action === 'Stop')
      await expect(page.getByRole('status')).toHaveText(
        'Start a new conversation to continue.'
      );
  });
test('all six views fit a narrow viewport with contained chart and table data', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base);
  await send(page, 'full');
  await expect(page.getByRole('status')).toHaveText('Response complete.');
  const width = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(width.document).toBeLessThanOrEqual(width.viewport);
  for (const chart of await page.locator('.dashboard-chart svg').all())
    expect((await chart.boundingBox())!.width).toBeLessThanOrEqual(358);
  await page
    .getByRole('button', { name: 'Send', exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByRole('button', { name: 'Send', exact: true })
  ).toBeVisible();
  expect(errors).toEqual([]);
  await page.screenshot({
    path: test.info().outputPath('dashboard-mobile.png'),
    fullPage: true,
  });
});
test('native human text stays literal beside the dashboard', async ({
  page,
}) => {
  await page.goto(base);
  await send(
    page,
    '<script>private markup</script> <img src=x onerror=alert(1)>'
  );
  await expect(page.getByRole('status')).toHaveText('Response complete.');
  await expect(rows(page).first()).toContainText(
    '<script>private markup</script>'
  );
  await expect(page.locator('main img, main script')).toHaveCount(0);
});
test('the authored developer endpoint routes all native requests and stays out of visible text', async ({
  page,
  request,
}) => {
  await page.goto('http://127.0.0.1:3000/');
  await page.setContent(`<!doctype html><html><body><p id="state">Waiting</p><script>
    addEventListener('message',event=>{
      const frame=document.getElementById('pilot');
      if(event.origin!=='http://127.0.0.1:4612'||event.source!==frame.contentWindow)return;
      if(event.data.type==='tplane:runtime-child-ready')frame.contentWindow.postMessage({
        type:'tplane:runtime-configure',version:2,nonce:event.data.nonce,generation:1,
        target:{kind:'ag-ui',endpoint:'http://127.0.0.1:4612/developer-agent'}
      },event.origin);
      if(event.data.type==='tplane:runtime-configured')frame.contentWindow.postMessage({
        type:'tplane:runtime-check',version:1,nonce:'parent-health',capability:'json-render'
      },event.origin);
      if(event.data.type==='tplane:runtime-ready'&&event.data.nonce==='parent-health')document.getElementById('state').textContent='Ready';
    });</script><iframe id="pilot" title="React preview" src="http://127.0.0.1:4612/ag-ui/json-render/react/"></iframe></body></html>`);
  await expect(page.locator('#state')).toHaveText('Ready');
  const frame = page.frameLocator('#pilot');
  await expect(
    frame.getByRole('region', { name: 'Runtime connection' })
  ).toContainText('Developer runtime');
  let priorIds: string[] = [];
  for (const mode of ['full', 'filter']) {
    await frame.getByLabel('Message', { exact: true }).fill(mode);
    await frame.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(frame.getByRole('status')).toHaveText('Response complete.');
    if (mode === 'full')
      priorIds = await frame
        .locator('[data-dashboard-message]')
        .evaluateAll((elements) =>
          elements.map(
            (element) => element.getAttribute('data-dashboard-message')!
          )
        );
  }
  const wire = await (await request.get('/__requests')).json();
  expect(wire).toHaveLength(2);
  expect(
    wire.every(
      (entry: { path: string; method: string }) =>
        entry.path === '/developer-agent' && entry.method === 'POST'
    )
  ).toBe(true);
  expect(wire[0].body.threadId).toBe(wire[1].body.threadId);
  expect(
    wire[1].body.messages
      .slice(0, -1)
      .map((message: { id: string }) => message.id)
  ).toEqual(priorIds);
  for (const message of wire[1].body.messages.slice(0, -1))
    expect(message).toEqual(
      wire[0].final.find((row: { id: string }) => row.id === message.id)
    );
  await expect(frame.locator('body')).not.toContainText('/developer-agent');
});
