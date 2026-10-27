import {
  expect,
  test,
  type Page,
  type APIRequestContext,
} from '@playwright/test';
test('the authored developer endpoint routes all native requests and stays out of visible text', async ({
  page,
  request,
}) => {
  await page.goto('http://127.0.0.1:3000/');
  await page.setContent(`<!doctype html><html><body><p id="state">Waiting</p><script>
    addEventListener('message',event=>{
      const frame=document.getElementById('pilot');
      if(event.origin!=='http://127.0.0.1:4613'||event.source!==frame.contentWindow)return;
      if(event.data.type==='tplane:runtime-child-ready')frame.contentWindow.postMessage({
        type:'tplane:runtime-configure',version:2,nonce:event.data.nonce,generation:1,
        target:{kind:'ag-ui',endpoint:'http://127.0.0.1:4613/developer-agent'}
      },event.origin);
      if(event.data.type==='tplane:runtime-configured')frame.contentWindow.postMessage({
        type:'tplane:runtime-check',version:1,nonce:'parent-health',capability:'subagents'
      },event.origin);
      if(event.data.type==='tplane:runtime-ready'&&event.data.nonce==='parent-health')document.getElementById('state').textContent='Ready';
    });</script><iframe id="pilot" title="React preview" src="http://127.0.0.1:4613/ag-ui/subagents/react/"></iframe></body></html>`);
  await expect(page.locator('#state')).toHaveText('Ready');
  const frame = page.frameLocator('#pilot');
  await expect(
    frame.getByRole('region', { name: 'Runtime connection' })
  ).toContainText('Developer runtime');
  let priorIds: string[] = [];
  for (const mode of ['sequential', 'direct']) {
    await frame.getByLabel('Message', { exact: true }).fill(mode);
    await frame.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(frame.getByRole('status')).toHaveText('Response complete.');
    if (mode === 'sequential')
      priorIds = await frame
        .locator('[data-parent-message]')
        .evaluateAll((elements) =>
          elements.map(
            (element) => element.getAttribute('data-parent-message')!
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
test.beforeEach(async ({ request }) => {
  await request.post('/__reset');
});
async function ready(page: Page) {
  await page.goto('/ag-ui/subagents/react/');
  await expect(page.getByRole('status')).toHaveText('Ready.');
}
async function send(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}
async function requests(request: APIRequestContext) {
  return (await request.get('/__requests')).json();
}
async function nativeRows(page: Page) {
  return page
    .locator('[data-parent-message]')
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-parent-message'))
    );
}
async function completed(page: Page) {
  await expect(page.getByRole('status')).toHaveText('Response complete.');
}
test('real sequential specialists retain captured text, causal parent results and full native follow-up history', async ({
  page,
  request,
}) => {
  await ready(page);
  await send(page, 'sequential');
  await completed(page);
  await expect(page.locator('[data-child-id]')).toHaveCount(3);
  for (const role of ['Research', 'Booking', 'Itinerary']) {
    const card = page.getByRole('region', { name: role + ' specialist' });
    await expect(card).toContainText('A fictional specialist observation.');
    await expect(card).toContainText('Complete');
  }
  const first = (await requests(request))[0],
    before = await nativeRows(page);
  expect(first.body.protocolVersion).toBe('1.0');
  expect(first.body.tools).toEqual([]);
  expect(before.length).toBe(8);
  expect(new Set(before).size).toBe(8);
  expect([...before].sort()).toEqual(
    first.final.map((row: { id: string }) => row.id).sort()
  );
  await send(page, 'direct');
  await completed(page);
  const all = await requests(request),
    second = all[1];
  expect(all).toHaveLength(2);
  expect(second.body.threadId).toBe(first.body.threadId);
  expect(second.body.runId).not.toBe(first.body.runId);
  expect(
    second.body.messages.slice(0, -1).map((row: { id: string }) => row.id)
  ).toEqual(before);
  for (const message of second.body.messages.slice(0, -1))
    expect(message).toEqual(
      first.final.find((row: { id: string }) => row.id === message.id)
    );
  expect(
    second.body.messages.some(
      (row: { subagentRunId?: string }) => row.subagentRunId
    )
  ).toBe(false);
  await expect(page.locator('[data-child-id]')).toHaveCount(3);
  await expect(page.locator('[data-parent-message]')).toHaveCount(10);
  await page.getByRole('button', { name: 'New conversation' }).click();
  await expect(page.getByRole('status')).toHaveText('Ready.');
  await expect(page.locator('[data-child-id]')).toHaveCount(0);
  await expect(page.locator('[data-parent-message]')).toHaveCount(0);
  expect(await requests(request)).toHaveLength(2);
  await send(page, 'direct');
  await completed(page);
  const fresh = (await requests(request))[2];
  expect(fresh.body.threadId).not.toBe(first.body.threadId);
  expect(fresh.body.messages).toHaveLength(1);
});
for (const [mode, count] of [
  ['batch', 3],
  ['rounds', 6],
  ['direct', 0],
] as const)
  test(`real ${mode} keeps ${count} attributed child cards`, async ({
    page,
    request,
  }) => {
    await ready(page);
    await send(page, mode);
    await completed(page);
    await expect(page.locator('[data-child-id]')).toHaveCount(count);
    expect(await requests(request)).toHaveLength(1);
  });
test('real nonstreaming child providers retain final result fallback', async ({
  page,
  request,
}) => {
  await request.post('/__mode/without-child-tokens');
  await ready(page);
  await send(page, 'sequential');
  await completed(page);
  await expect(page.locator('[data-child-id]')).toHaveCount(3);
  await expect(
    page.getByRole('region', { name: 'Research specialist' })
  ).toContainText('A fictional specialist observation.');
});
for (const stage of ['child-text', 'child-finished', 'final'])
  test(`held ${stage} cannot admit a follow-up before root settlement`, async ({
    page,
    request,
  }) => {
    await request.post('/__hold/' + stage);
    await ready(page);
    await send(page, 'sequential');
    await expect(page.locator('[data-child-id]').first()).toBeVisible();
    await expect
      .poll(
        async () => (await (await request.get('/__lifetime')).json()).active
      )
      .toBe(true);
    await expect(page.getByRole('status')).toHaveText(
      'Planning with specialists…'
    );
    await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(await requests(request)).toHaveLength(1);
    await request.post('/__release');
    await completed(page);
    await expect(page.locator('[data-child-phase="complete"]')).toHaveCount(3);
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
  'duplicate-result',
  'orphan-result',
  'missing-result',
  'wrong-result-id',
  'unknown-tool',
  'unfinished-child',
  'wrong-parent',
  'unknown-role',
  'wrong-child-id',
  'orphan-text',
])
  test(`${mode} requires New with no replay`, async ({ page, request }) => {
    await request.post('/__mode/' + mode);
    await ready(page);
    await send(page, 'sequential');
    await expect(page.getByRole('status')).toHaveText(
      'Start a new conversation to continue.'
    );
    await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled();
    await expect(page.locator('body')).not.toContainText('PRIVATE');
    expect(await requests(request)).toHaveLength(1);
  });
test('actual child provider failure stays generic and never fabricates root success', async ({
  page,
  request,
}) => {
  await ready(page);
  await send(page, 'failure');
  await expect(page.getByRole('status')).toHaveText(
    'Start a new conversation to continue.'
  );
  await expect(page.locator('[data-child-phase="error"]')).toHaveCount(1);
  await expect(
    page.getByRole('region', { name: 'Booking specialist' })
  ).toContainText('The specialist could not finish.');
  await expect(page.locator('body')).not.toContainText(
    'private-provider-marker-14'
  );
  expect(await requests(request)).toHaveLength(1);
});
for (const action of ['Stop', 'pagehide'])
  test(`${action} releases the held native stream and fences child text`, async ({
    page,
    request,
  }) => {
    await request.post('/__hold/child-text');
    await ready(page);
    await send(page, 'sequential');
    await expect(page.locator('[data-child-id]')).toHaveCount(1);
    if (action === 'Stop')
      await page.getByRole('button', { name: 'Stop' }).click();
    else await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await expect
      .poll(
        async () => (await (await request.get('/__lifetime')).json()).active
      )
      .toBe(false);
    await request.post('/__release');
    expect(await requests(request)).toHaveLength(1);
    if (action === 'Stop') {
      await expect(page.getByRole('status')).toHaveText(
        'Start a new conversation to continue.'
      );
      await expect(page.locator('[data-child-phase="complete"]')).toHaveCount(
        0
      );
      await expect(
        page.getByRole('region', { name: 'Research specialist' })
      ).toContainText('Stopped');
      await expect(
        page.getByRole('region', { name: 'Research specialist' })
      ).not.toContainText('Working');
    } else await expect(page.locator('main')).toHaveCount(0);
  });
test('a truncated final snapshot cannot replace a previously confirmed canonical prefix', async ({ page, request }) => {
  await ready(page); await send(page, 'sequential'); await completed(page);
  await request.post('/__mode/truncated-prefix'); await send(page, 'sequential');
  await expect(page.getByRole('status')).toHaveText('Start a new conversation to continue.');
  await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled();
  expect(await requests(request)).toHaveLength(2);
});
test('cards and disclosure fit a narrow viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await send(page, 'sequential');
  await completed(page);
  const width = await page.evaluate(() => ({
    viewport: innerWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(width.content).toBeLessThanOrEqual(width.viewport);
  await expect(
    page.getByRole('region', { name: 'Research specialist' })
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('native-subagents-mobile.png') });
});
