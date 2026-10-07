import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const base = '/chat/timeline/react/';
const box = (page: Page) => page.getByLabel('Message', { exact: true });
const current = (page: Page) =>
  page.getByRole('region', { name: 'Current conversation', exact: true });
const preview = (page: Page) =>
  page.getByRole('region', { name: 'Historical preview', exact: true });
const picker = (page: Page) =>
  page
    .getByRole('navigation', { name: 'Saved checkpoints' })
    .getByRole('button', { name: /^Checkpoint / });
const saved = (page: Page) =>
  expect(current(page).getByRole('status')).toHaveText('Response saved.');
async function send(page: Page, text: string) {
  await box(page).fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await saved(page);
}
async function refresh(page: Page) {
  const result = page.waitForResponse((r) => r.url().endsWith('/history'));
  await page
    .getByRole('button', { name: 'Refresh checkpoints', exact: true })
    .click();
  const history = await (await result).json();
  await expect(
    page.getByRole('button', { name: 'Refresh checkpoints', exact: true })
  ).toBeEnabled();
  return history;
}
const requests = async (request: APIRequestContext) =>
  (await request.get('/__requests')).json();
const proofs = async (request: APIRequestContext) =>
  (await request.get('/__graph-proof')).json();
const browserErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ request, page }) => {
  expect((await request.post('/__reset')).status()).toBe(200);
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (!/^(http:\/\/127\.0\.0\.1:(4626|3000)\/|about:)/.test(request.url()))
      errors.push('Unexpected URL: ' + request.url());
  });
});
test.afterEach(async ({ request, page }) => {
  expect(browserErrors.get(page)).toEqual([]);
  for (const item of await requests(request)) {
    expect(item.path).toMatch(
      /^\/(api|developer-api)\/threads(?:\/[0-9a-f-]+(?:\/history|\/state\/checkpoint|\/runs\/stream|\/runs\/[0-9a-f-]+)?)?$/
    );
    expect(item.method).toBe(
      item.path.match(/\/runs\/[0-9a-f-]+$/) ? 'GET' : 'POST'
    );
  }
  for (const proof of await proofs(request))
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
test('installed SDK previews A, sends C at tip, forks D from A, and extends fork with E', async ({
  page,
  request,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const streamed: Promise<string>[] = [];
  page.on('response', (response) => {
    if (response.url().endsWith('/runs/stream')) streamed.push(response.text());
  });
  await page.goto(base);
  await expect(box(page)).toBeEnabled();
  expect(await requests(request)).toEqual([]);
  await send(page, 'A first');
  await send(page, 'B later');
  await box(page).fill('Retained draft');
  const history = await refresh(page);
  const index = history.findIndex(
    (s: { next: unknown[]; values: { messages: unknown[] } }) =>
      s.next.length === 0 && s.values.messages.length === 2
  );
  expect(index).toBeGreaterThanOrEqual(0);
  const source = history[index].checkpoint;
  const before = (await proofs(request)).filter(
    (p: { op: string }) => p.op === 'submit'
  ).length;
  await picker(page).nth(index).click();
  await expect(preview(page).locator('article')).toHaveCount(2);
  await expect(current(page).locator('article')).toHaveCount(4);
  await expect(box(page)).toHaveValue('Retained draft');
  expect(
    (await proofs(request)).filter((p: { op: string }) => p.op === 'submit')
  ).toHaveLength(before);
  await send(page, 'C tip');
  await expect(current(page).locator('article')).toHaveCount(6);
  await expect(preview(page).locator('article')).toHaveCount(2);
  await expect(preview(page)).not.toContainText('B later');
  await expect(preview(page)).not.toContainText('C tip');
  await box(page).fill('D fork');
  await page
    .getByRole('button', { name: 'Fork from here', exact: true })
    .click();
  await saved(page);
  await expect(current(page).locator('article')).toHaveCount(4);
  await expect(current(page)).toContainText('A first');
  await expect(current(page)).toContainText('D fork');
  await expect(current(page)).not.toContainText('B later');
  await expect(current(page)).not.toContainText('C tip');
  await expect(preview(page).locator('article')).toHaveCount(0);
  await send(page, 'E followup');
  await expect(current(page).locator('article')).toHaveCount(6);
  const final = await refresh(page);
  const messages = final[0].values.messages;
  expect(messages.slice(0, 2)).toEqual(history[index].values.messages);
  expect(
    messages
      .filter((m: { type: string }) => m.type === 'human')
      .map((m: { content: string }) => m.content)
  ).toEqual(['A first', 'D fork', 'E followup']);
  expect(final[0].values.completed_message_ids).toEqual(
    messages.map((m: { id: string }) => m.id)
  );
  const wire = await requests(request);
  const runs = wire.filter((r: { path: string }) =>
    r.path.endsWith('/runs/stream')
  );
  expect(runs).toHaveLength(5);
  const streamBodies = await Promise.all(streamed);
  expect(streamBodies).toHaveLength(5);
  for (let index = 0; index < 5; index++) {
    expect(runs[index].body.stream_mode).toEqual([
      'values',
      'messages-tuple',
      'updates',
      'custom',
      ...(index >= 3 ? ['checkpoints'] : []),
    ]);
    if (index < 3)
      expect(streamBodies[index]).not.toContain('event: checkpoints\n');
    else expect(streamBodies[index]).toContain('event: checkpoints\n');
  }
  writeFileSync(
    testInfo.outputPath('stream-mode-proof.json'),
    JSON.stringify(
      streamBodies.map((body, index) => ({
        input: runs[index].body.input,
        modes: runs[index].body.stream_mode,
        events: body
          .split('\n')
          .filter((line) => line.startsWith('event: '))
          .map((line) => line.slice(7)),
      })),
      null,
      2
    )
  );

  expect(runs[3].body.checkpoint).toEqual({ ...source, checkpoint_map: {} });
  expect(runs[4].body.checkpoint).toBeDefined();
  expect(
    wire.filter((r: { path: string }) => r.path.endsWith('/threads'))
  ).toHaveLength(1);
  expect(
    new Set(runs.map((r: { path: string }) => r.path.split('/')[3])).size
  ).toBe(1);
  const reads = wire.filter((r: { path: string }) =>
    r.path.endsWith('/state/checkpoint')
  );
  expect(wire).toHaveLength(17);
  expect(reads).toHaveLength(4);
  expect(
    wire.filter((r: { path: string }) => r.path.endsWith('/history'))
  ).toHaveLength(2);
  expect(
    wire.filter((r: { method: string }) => r.method === 'GET')
  ).toHaveLength(5);
  expect(reads[0].body).toEqual({ checkpoint: source });
  expect(reads[1].body).toEqual({
    checkpoint: { ...source, checkpoint_map: {} },
  });
  expect(errors).toEqual([]);
  writeFileSync(
    testInfo.outputPath('request-ledger.json'),
    JSON.stringify(wire, null, 2)
  );
  writeFileSync(
    testInfo.outputPath('graph-proof.json'),
    JSON.stringify(await proofs(request), null, 2)
  );
  await testInfo.attach('request-ledger', {
    body: JSON.stringify(wire, null, 2),
    contentType: 'application/json',
  });
  await testInfo.attach('graph-proof', {
    body: JSON.stringify(await proofs(request), null, 2),
    contentType: 'application/json',
  });
  await page.screenshot({
    path: testInfo.outputPath('timeline-desktop.png'),
    fullPage: true,
  });
});

async function selectFirst(page: Page) {
  const history = await refresh(page);
  const index = history.findIndex(
    (s: { next: unknown[]; values: { messages: unknown[] } }) =>
      s.next.length === 0 && s.values.messages.length === 2
  );
  await picker(page).nth(index).click();
  return history[index];
}
async function held(request: APIRequestContext, key: string) {
  await expect
    .poll(async () => (await (await request.get('/__lifetime')).json())[key])
    .toBe(true);
}

test('held preview is read-only, cancellation fences its late response, and refresh clears selection', async ({
  page,
  request,
}) => {
  await page.goto(base);
  await send(page, 'A');
  await send(page, 'B');
  await box(page).fill('Kept draft');
  await request.post('/__hold-state');
  await selectFirst(page);
  await held(request, 'activeState');
  await expect(preview(page).getByRole('status')).toHaveText(
    'Loading preview…'
  );
  await expect(current(page).locator('article')).toHaveCount(4);
  await expect(box(page)).toHaveValue('Kept draft');
  await expect(
    page.getByRole('button', { name: 'Fork from here', exact: true })
  ).toBeDisabled();
  await page
    .getByRole('button', { name: 'Cancel preview', exact: true })
    .click();
  await request.post('/__release-state');
  await expect(preview(page).locator('article')).toHaveCount(0);
  await selectFirst(page);
  await expect(preview(page).locator('article')).toHaveCount(2);
  await request.post('/__hold-history');
  await page
    .getByRole('button', { name: 'Refresh checkpoints', exact: true })
    .click();
  await held(request, 'activeHistory');
  await expect(preview(page).locator('article')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Fork from here', exact: true })
  ).toBeDisabled();
  await request.post('/__release-history');
  await expect(
    page.getByRole('button', { name: 'Refresh checkpoints', exact: true })
  ).toBeEnabled();
  await expect(box(page)).toHaveValue('Kept draft');
  expect(
    (await requests(request)).filter((r: { path: string }) =>
      r.path.endsWith('/runs/stream')
    )
  ).toHaveLength(2);
});

for (const mode of ['failure', 'foreign', 'malformed'])
  test(`preview ${mode} cannot authorize a fork or replace current messages`, async ({
    page,
    request,
  }) => {
    await page.goto(base);
    await send(page, 'A');
    await box(page).fill('Retained');
    await request.post('/__state/' + mode);
    await selectFirst(page);
    await expect(preview(page).getByRole('alert')).toHaveText(
      'Checkpoint preview is unavailable.'
    );
    await expect(preview(page).locator('article')).toHaveCount(0);
    await expect(current(page).locator('article')).toHaveCount(2);
    await expect(box(page)).toHaveValue('Retained');
    await expect(
      page.getByRole('button', { name: 'Fork from here', exact: true })
    ).toBeDisabled();
    expect(
      (await requests(request)).filter((r: { path: string }) =>
        r.path.endsWith('/runs/stream')
      )
    ).toHaveLength(1);
  });

test('history failure and late history after New cannot restore old selection or messages', async ({
  page,
  request,
}) => {
  await page.goto(base);
  await send(page, 'Old');
  await request.post('/__history/failure');
  await page
    .getByRole('button', { name: 'Refresh checkpoints', exact: true })
    .click();
  await expect(
    page
      .getByRole('navigation', { name: 'Saved checkpoints' })
      .getByRole('alert')
  ).toHaveText('Checkpoint history is unavailable.');
  await expect(current(page).locator('article')).toHaveCount(2);
  await request.post('/__history/safe');
  await request.post('/__hold-history');
  await page
    .getByRole('button', { name: 'Refresh checkpoints', exact: true })
    .click();
  await held(request, 'activeHistory');
  await page
    .getByRole('button', { name: 'New conversation', exact: true })
    .click();
  await request.post('/__release-history');
  await expect(current(page).locator('article')).toHaveCount(0);
  await expect(picker(page)).toHaveCount(0);
  await expect(box(page)).toHaveValue('');
  await send(page, 'Fresh');
  await expect(current(page)).not.toContainText('Old');
});

for (const failure of ['stop', 'failure'])
  test(`${failure} leaves unknown outcome requiring New without replay`, async ({
    page,
    request,
  }) => {
    await page.goto(base);
    if (failure === 'stop') await request.post('/__hold-stream');
    await box(page).fill(failure === 'stop' ? 'Held' : 'fail-stream');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    if (failure === 'stop') {
      await held(request, 'activeStream');
      await page.getByRole('button', { name: 'Stop', exact: true }).click();
      await request.post('/__release');
    }
    await expect(current(page).getByRole('status')).toHaveText(
      'Start a new conversation to continue.'
    );
    await expect(box(page)).toBeDisabled();
    expect(
      (await requests(request)).filter((r: { path: string }) =>
        r.path.endsWith('/runs/stream')
      )
    ).toHaveLength(1);
    await page
      .getByRole('button', { name: 'New conversation', exact: true })
      .click();
    await send(page, 'Recovered');
    expect(
      (await requests(request)).filter((r: { path: string }) =>
        r.path.endsWith('/runs/stream')
      )
    ).toHaveLength(2);
    await expect(current(page)).not.toContainText(
      failure === 'stop' ? 'Held' : 'fail-stream'
    );
  });

test('disposing a page with held preview releases it and leaves the replacement empty', async ({
  page,
  request,
}) => {
  await page.goto(base);
  await send(page, 'Old');
  await request.post('/__hold-state');
  await selectFirst(page);
  await held(request, 'activeState');
  await page.goto('about:blank');
  await expect
    .poll(
      async () => (await (await request.get('/__lifetime')).json()).activeState
    )
    .toBe(false);
  await request.post('/__release-state');
  await page.goto(base);
  await expect(box(page)).toBeEnabled();
  await expect(current(page).locator('article')).toHaveCount(0);
  await expect(preview(page).locator('article')).toHaveCount(0);
});

for (const control of ['metadata-failure', 'title-model-failure'])
  test(`optional ${control} preserves graph answer without title message callbacks`, async ({
    page,
    request,
  }) => {
    await request.post('/__' + control);
    await page.goto(base);
    await send(page, 'Title optional');
    await expect(current(page).locator('article')).toHaveCount(2);
    await expect(current(page)).toContainText('Answer: Title optional');
  });

test('literal and long content stays contained on desktop and mobile', async ({
  page,
}, testInfo) => {
  await page.goto(base);
  const text = '<script>alert("literal")</script> ' + 'long-word-'.repeat(90);
  await send(page, text);
  await selectFirst(page);
  await expect(preview(page).locator('article')).toHaveCount(2);
  await expect(current(page).locator('script')).toHaveCount(0);
  await expect(preview(page).locator('script')).toHaveCount(0);
  await expect(current(page).locator('article').first()).toContainText(
    '<script>alert("literal")</script>'
  );
  await page.screenshot({
    path: testInfo.outputPath('timeline-literal-desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('timeline-mobile.png'),
    fullPage: true,
  });
});

test('developer bridge sends credentials only in headers across checkpoint operations', async ({
  page,
  request,
}) => {
  await page.goto('http://127.0.0.1:3000/');
  await page.setContent(`<!doctype html><html><body><p id="state">Waiting</p><script>
    addEventListener('message',event=>{
      const frame=document.getElementById('pilot');
      if(event.origin!=='http://127.0.0.1:4626'||event.source!==frame.contentWindow)return;
      if(event.data.type==='tplane:runtime-child-ready')frame.contentWindow.postMessage({type:'tplane:runtime-configure',version:2,nonce:event.data.nonce,generation:1,target:{kind:'langsmith',apiUrl:'http://127.0.0.1:4626/developer-api',apiKey:window.timelineKey||'TEST_TIMELINE_KEY'}},event.origin);
      if(event.data.type==='tplane:runtime-configured')frame.contentWindow.postMessage({type:'tplane:runtime-check',version:1,nonce:'health',capability:'timeline'},event.origin);
      if(event.data.type==='tplane:runtime-ready'&&event.data.nonce==='health')document.getElementById('state').textContent='Ready';
    });</script><iframe id="pilot" title="Timeline" src="http://127.0.0.1:4626/chat/timeline/react/"></iframe></body></html>`);
  await expect(page.locator('#state')).toHaveText('Ready');
  const frame = page.frameLocator('#pilot');
  await frame.getByLabel('Message', { exact: true }).fill('Developer A');
  await frame.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(frame.getByRole('status')).toHaveText('Response saved.');
  await frame
    .getByRole('button', { name: 'Refresh checkpoints', exact: true })
    .click();
  await frame.getByRole('button', { name: /^Checkpoint 1/ }).click();
  await expect(
    frame.getByRole('region', { name: 'Historical preview' }).locator('article')
  ).toHaveCount(2);
  await frame.getByLabel('Message', { exact: true }).fill('Developer D');
  await frame
    .getByRole('button', { name: 'Fork from here', exact: true })
    .click();
  await expect(frame.getByRole('status')).toHaveText('Response saved.');
  const wire = await requests(request);
  expect(
    wire.every(
      (r: { path: string; key: string }) =>
        r.path.startsWith('/developer-api/') && r.key === 'TEST_TIMELINE_KEY'
    )
  ).toBe(true);
  expect(
    JSON.stringify(wire.map((r: { body: unknown }) => r.body))
  ).not.toContain('TEST_TIMELINE_KEY');
  await expect(frame.locator('body')).not.toContainText('TEST_TIMELINE_KEY');
  await request.post('/__hold-state');
  await frame
    .getByRole('button', { name: 'Refresh checkpoints', exact: true })
    .click();
  await frame.getByRole('button', { name: /^Checkpoint 1/ }).click();
  await held(request, 'activeState');
  const previous = (await requests(request)).length;
  await page.evaluate(() => {
    Object.assign(window, { timelineKey: 'REPLACEMENT_TIMELINE_KEY' });
    const iframe = document.querySelector<HTMLIFrameElement>('#pilot');
    if (!iframe) throw new Error('Missing authored frame');
    iframe.src = 'http://127.0.0.1:4626/chat/timeline/react/?replacement=2';
  });
  await expect
    .poll(
      async () => (await (await request.get('/__lifetime')).json()).activeState
    )
    .toBe(false);
  await request.post('/__release-state');
  await expect(frame.getByLabel('Message', { exact: true })).toBeEnabled();
  await expect(frame.locator('article')).toHaveCount(0);
  await frame.getByLabel('Message', { exact: true }).fill('Replacement fresh');
  await frame.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(frame.getByRole('status')).toHaveText('Response saved.');
  await expect(frame.locator('body')).not.toContainText('Developer A');
  await expect(frame.locator('body')).not.toContainText(
    'REPLACEMENT_TIMELINE_KEY'
  );
  const replacement = (await requests(request)).slice(previous);
  expect(replacement).toHaveLength(3);
  expect(
    replacement.every(
      (r: { key: string }) => r.key === 'REPLACEMENT_TIMELINE_KEY'
    )
  ).toBe(true);
});

test('mapped HTTP representation carries the complete source unchanged through preview and fork', async ({
  page,
  request,
}, testInfo) => {
  await request.post('/__mapped-checkpoints');
  await page.goto(base);
  await send(page, 'Mapped A');
  await send(page, 'Mapped B');
  const a = await selectFirst(page);
  expect(a.checkpoint.checkpoint_map).toEqual({
    '': a.checkpoint.checkpoint_id,
  });
  await expect(preview(page).locator('article')).toHaveCount(2);
  await box(page).fill('Mapped D');
  await page
    .getByRole('button', { name: 'Fork from here', exact: true })
    .click();
  await saved(page);
  await expect(current(page)).not.toContainText('Mapped B');
  const wire = await requests(request),
    reads = wire.filter((r: { path: string }) =>
      r.path.endsWith('/state/checkpoint')
    );
  expect(reads[0].body).toEqual({ checkpoint: a.checkpoint });
  expect(reads[1].body).toEqual({ checkpoint: a.checkpoint });
  expect(
    wire.filter((r: { path: string }) => r.path.endsWith('/runs/stream')).at(-1)
      .body.checkpoint
  ).toEqual(a.checkpoint);
  writeFileSync(
    testInfo.outputPath('mapped-request-ledger.json'),
    JSON.stringify(wire, null, 2)
  );
  writeFileSync(
    testInfo.outputPath('mapped-graph-proof.json'),
    JSON.stringify(await proofs(request), null, 2)
  );
  await testInfo.attach('mapped-representation-request-ledger', {
    body: JSON.stringify(wire, null, 2),
    contentType: 'application/json',
  });
});

test('changed known checkpoint after preview cannot be adopted as a successful fork', async ({
  page,
  request,
}) => {
  await page.goto(base);
  await send(page, 'Known A');
  await send(page, 'Known B');
  await selectFirst(page);
  await expect(preview(page).locator('article')).toHaveCount(2);
  await request.post('/__state/changed');
  await box(page).fill('Unconfirmed D');
  await page
    .getByRole('button', { name: 'Fork from here', exact: true })
    .click();
  await expect(current(page).getByRole('status')).toHaveText(
    'Start a new conversation to continue.'
  );
  await expect(box(page)).toBeDisabled();
  const runs = (await requests(request)).filter((r: { path: string }) =>
    r.path.endsWith('/runs/stream')
  );
  expect(runs).toHaveLength(3);
  expect(
    runs.filter(
      (r: { body: { input: { messages: { content: string }[] } } }) =>
        r.body.input.messages[0].content === 'Unconfirmed D'
    ).length
  ).toBe(1);
});
