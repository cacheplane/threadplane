import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from '@playwright/test';
// Backend: aimock replays cockpit/langgraph/durable-execution/angular/e2e/
// fixtures (shared with the Angular example) into a real `langgraph dev`
// running analyze → plan → generate, each step checkpointed. The React static
// server proxies /api to it, recording requests and injecting holds, failures,
// uncertain outcomes and the finalization faults below
// (scripts/react-cockpit/langgraph-proxy.mjs).
const FINAL = { event: '^(values|checkpoints)$', ifKey: 'completed_turn_id' };
const finalFaults: Record<string, object[]> = {
  'Missing marker': [{ ...FINAL, op: 'omit', keys: ['completed_turn_id'] }],
  'Stale marker': [{ ...FINAL, op: 'patch', set: { completed_turn_id: 'previous-human' } }],
  'Wrong marker': [{ ...FINAL, op: 'patch', set: { completed_turn_id: 'wrong-human' } }],
  'Missing answer marker': [{ ...FINAL, op: 'omit', keys: ['completed_answer_id'] }],
  'Stale answer marker': [{ ...FINAL, op: 'patch', set: { completed_answer_id: 'previous-answer' } }],
  'Human answer marker': [{ ...FINAL, op: 'patch', set: { completed_answer_id: '$humanId' } }],
  'Unknown tool': [{ ...FINAL, op: 'patch', path: 'messages.1', set: { tool_calls: [{ id: 'unknown-call', name: 'unknown', args: {} }] } }],
  // Only the marked terminal root arrives: no tokens, node updates or drafts.
  'Final only': [
    { event: '^messages', op: 'drop' },
    { event: '^updates$', op: 'drop' },
    { event: '^(values|checkpoints)$', op: 'drop', unlessKey: 'completed_turn_id' },
  ],
};
/** The connection ends after the first draft chunk and saved history stays
 * inconclusive. An unknown run also withholds its identity; a known run keeps
 * reporting itself running. */
async function prepareUncertain(request: APIRequestContext, known: boolean) {
  if (known) await request.post('/__run-status/running');
  else await request.post('/__stream/edit', { data: { ops: [], anonymous: true } });
  await request.post('/__hold/stream', { data: { end: true } });
  await request.post('/__history/pending');
}
const humanOf = async (request: APIRequestContext) =>
  ((await (await request.get('/__requests')).json()) as Wire[])
    .filter((entry) => entry.path.endsWith('/runs/stream'))
    .at(-1)!.body.input!.messages[0].id;
/** The saved outcome of the retained turn becomes conclusive (one read). */
async function publish(request: APIRequestContext, humanId: string, marker = humanId) {
  const answer = 'final-answer';
  await request.post('/__history/safe');
  await request.post('/__history-values', {
    data: {
      set: {
        messages: [
          { type: 'human', id: humanId, content: 'Uncertain' },
          { type: 'ai', id: answer, content: 'Final answer' },
        ],
        step: 'generate',
        completed_turn_id: marker,
        completed_answer_id: answer,
      },
      entry: { next: [], tasks: [] },
    },
  });
}
test.beforeEach(async ({ request }) => {
  await request.post('/__reset');
});
const transcript = (page: Page) =>
  page.getByRole('region', { name: 'Conversation', exact: true });
const checkpoints = (page: Page) =>
  page.getByRole('region', { name: 'Saved pipeline checkpoints', exact: true });
async function send(page: Page, text: string, navigate = true) {
  // Shapes a real pipeline never finalizes with: the proxy edits the stream
  // the browser receives (injected data, like the authored fixture's variants).
  if (text in finalFaults)
    await page.request.post('/__stream/edit', { data: { ops: finalFaults[text] } });
  if (text === 'Uncertain' || text === 'Known uncertain')
    await prepareUncertain(page.request, text === 'Known uncertain');
  if (navigate) await page.goto('/langgraph/durable-execution/react/');
  await page.getByLabel('Message', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}
type Wire = {
  path: string;
  method: string;
  key: string | null;
  body: {
    assistant_id?: string;
    command?: unknown;
    input?: { messages: { id: string; content: string }[] };
  };
};
async function wire(request: APIRequestContext): Promise<Wire[]> {
  return (await request.get('/__requests')).json();
}
const runs = (entries: Wire[]) =>
  entries.filter((entry) => entry.path.endsWith('/runs/stream'));
async function uncertain(page: Page) {
  await send(page, 'Uncertain');
  await expect(
    page.getByRole('button', { name: 'Check status', exact: true })
  ).toBeVisible();
  await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
}
test('saves completed nodes while held, then replaces intermediate drafts with the final root', async ({
  page,
  request,
}, testInfo) => {
  // Hold once the analyze step's state is saved.
  await request.post('/__hold/stream', {
    data: { afterPattern: 'event: values\\s+data: .*"step": ?"analyze"' },
  });
  await send(page, 'A fictional project');
  await expect(checkpoints(page)).toContainText('Analyze — complete');
  await expect(checkpoints(page)).toContainText('Plan — pending');
  await expect(checkpoints(page)).toContainText('Generate — pending');
  await expect(transcript(page)).toContainText('Analysis draft');
  await page.screenshot({
    path: testInfo.outputPath('durable-execution-held-desktop.png'),
  });
  await expect(
    page.getByRole('button', { name: 'New conversation' })
  ).toBeDisabled();
  await request.post('/__release');
  await expect(page.locator('footer').getByRole('status')).toHaveText('Response complete.');
  await expect(checkpoints(page)).toContainText('Generate — complete');
  await expect(transcript(page)).not.toContainText('Analysis draft');
  await expect(transcript(page)).not.toContainText('Plan draft');
  await expect(transcript(page).getByRole('article')).toHaveCount(2);
  await page.screenshot({
    path: testInfo.outputPath('durable-execution-final-desktop.png'),
  });
  const entries = await wire(request);
  expect(runs(entries)).toHaveLength(1);
  expect(entries.filter((entry) => entry.method === 'GET')).toHaveLength(1);
  expect(runs(entries)[0].body.assistant_id).toBe('durable-execution');
  expect(runs(entries)[0].body.command).toBeUndefined();
});
test('second requests reuse one UUID and ignore the previous generate checkpoint', async ({
  page,
  request,
}) => {
  await send(page, 'First');
  await expect(page.locator('footer').getByRole('status')).toHaveText('Response complete.');
  await request.post('/__hold/stream', { data: { immediate: true } });
  await send(page, 'Second', false);
  await expect
    .poll(async () => (await (await request.get('/__lifetime')).json()).activeStream)
    .toBe(true);
  await expect(checkpoints(page)).toContainText('Analyze — pending');
  await expect(checkpoints(page)).toContainText('Generate — pending');
  await request.post('/__release');
  await expect(page.locator('footer').getByRole('status')).toHaveText('Response complete.');
  const entries = await wire(request),
    streams = runs(entries);
  expect(streams).toHaveLength(2);
  expect(streams[0].path).toBe(streams[1].path);
  expect(streams[0].body.input!.messages[0].id).not.toBe(
    streams[1].body.input!.messages[0].id
  );
  const reads = entries.filter((entry) => entry.method === 'GET');
  expect(new Set(reads.map((entry) => entry.path)).size).toBe(2);
  await page.getByRole('button', { name: 'New conversation' }).click();
  await expect(page.locator('footer').getByRole('status')).toHaveText('Ready.');
  await expect(transcript(page).getByRole('article')).toHaveCount(0);
  await expect(checkpoints(page)).toContainText('Generate — pending');
  await send(page, 'Third', false);
  await expect(page.locator('footer').getByRole('status')).toHaveText('Response complete.');
  expect(
    (await wire(request)).filter((entry) => entry.path.endsWith('/threads'))
  ).toHaveLength(2);
});
test('a current marked terminal root can arrive without intermediate observations', async ({
  page,
}) => {
  await send(page, 'Final only');
  await expect(page.locator('footer').getByRole('status')).toHaveText('Response complete.');
  await expect(checkpoints(page)).toContainText('Analyze — complete');
  await expect(checkpoints(page)).toContainText('Generate — complete');
});
for (const text of [
  'Missing marker',
  'Stale marker',
  'Wrong marker',
  'Missing answer marker',
  'Stale answer marker',
  'Human answer marker',
])
  test(`${text} cannot turn terminal stream success into final authority`, async ({
    page,
    request,
  }) => {
    await send(page, text);
    await expect(page.locator('footer').getByRole('status')).toHaveText(
      'Start a new conversation to continue.'
    );
    await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Check status' })
    ).toHaveCount(0);
    expect(runs(await wire(request))).toHaveLength(1);
  });
test('Stop releases a held pipeline run and fences its later final result', async ({
  page,
  request,
}) => {
  // Hold once the analyze step's state is saved.
  await request.post('/__hold/stream', {
    data: { afterPattern: 'event: values\\s+data: .*"step": ?"analyze"' },
  });
  await send(page, 'A fictional project');
  await expect(checkpoints(page)).toContainText('Analyze — complete');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect
    .poll(async () => (await (await request.get('/__lifetime')).json()).activeStream)
    .toBe(false);
  await request.post('/__release');
  await expect(page.locator('footer').getByRole('status')).toContainText('Stopped');
  await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
  await expect(checkpoints(page)).not.toContainText('Generate — complete');
  expect(runs(await wire(request))).toHaveLength(1);
  await page.getByRole('button', { name: 'New conversation' }).click();
  await send(page, 'New request', false);
  await expect(page.locator('footer').getByRole('status')).toHaveText('Response complete.');
  const entries = await wire(request);
  expect(
    entries.filter((entry) => entry.path.endsWith('/threads'))
  ).toHaveLength(2);
  expect(runs(entries)[0].path).not.toBe(runs(entries)[1].path);
});
test('developer credentials stay in SDK headers on creation, streaming and reconciliation', async ({
  page,
  request,
}) => {
  await page.goto('http://127.0.0.1:3000/');
  await page.setContent(`<!doctype html><html><body><p id="state">Waiting</p><script>
    addEventListener('message', (event) => {
      const frame = document.getElementById('pilot');
      if (event.origin !== 'http://127.0.0.1:4605' || event.source !== frame.contentWindow) return;
      if (event.data.type === 'tplane:runtime-child-ready') frame.contentWindow.postMessage({
        type: 'tplane:runtime-configure', version: 2, nonce: event.data.nonce, generation: 1,
        target: { kind: 'langsmith', apiUrl: 'http://127.0.0.1:4605/developer-api', apiKey: 'TEST_DEVELOPER_KEY' }
      }, event.origin);
      if (event.data.type === 'tplane:runtime-configured') frame.contentWindow.postMessage({
        type: 'tplane:runtime-check', version: 1, nonce: 'parent-health', capability: 'durable-execution'
      }, event.origin);
      if (event.data.type === 'tplane:runtime-ready' && event.data.nonce === 'parent-health') document.getElementById('state').textContent = 'Ready';
    });</script><iframe id="pilot" title="React pilot" style="width:100%;height:700px" src="http://127.0.0.1:4605/langgraph/durable-execution/react/"></iframe></body></html>`);
  await expect(page.locator('#state')).toHaveText('Ready');
  const frame = page.frameLocator('#pilot');
  await prepareUncertain(request, false);
  await frame.getByLabel('Message', { exact: true }).fill('Uncertain');
  await frame.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(
    frame.getByRole('button', { name: 'Check status', exact: true })
  ).toBeVisible();
  await publish(request, await humanOf(request));
  await frame
    .getByRole('button', { name: 'Check status', exact: true })
    .click();
  await expect(frame.locator('footer').getByRole('status')).toHaveText('Response complete.');
  const entries = await wire(request);
  expect(
    entries.filter((entry) => entry.path.endsWith('/history'))
  ).toHaveLength(2);
  expect(
    entries.every(
      (entry) =>
        entry.path.startsWith('/developer-api/') &&
        entry.key === 'TEST_DEVELOPER_KEY'
    )
  ).toBe(true);
  expect(JSON.stringify(entries.map((entry) => entry.body))).not.toContain(
    'TEST_DEVELOPER_KEY'
  );
  await expect(frame.locator('body')).not.toContainText('TEST_DEVELOPER_KEY');
});
test('explicit reconciliation reads the exact retained turn without creating or dispatching another run', async ({
  page,
  request,
}) => {
  await uncertain(page);
  expect(
    (await wire(request)).filter((entry) => entry.path.endsWith('/history'))
  ).toHaveLength(1);
  await publish(request, await humanOf(request));
  await page.getByRole('button', { name: 'Check status' }).click();
  await expect(page.locator('footer').getByRole('status')).toHaveText('Response complete.');
  await expect(transcript(page).getByRole('article')).toHaveCount(2);
  await expect(checkpoints(page)).toContainText('Generate — complete');
  const entries = await wire(request);
  expect(runs(entries)).toHaveLength(1);
  expect(
    entries.filter((entry) => entry.path.endsWith('/threads'))
  ).toHaveLength(1);
  expect(
    entries
      .filter((entry) => entry.path.endsWith('/history'))
      .map((entry) => entry.method)
  ).toEqual(['POST', 'POST']);
});
test('fulfilled pending history stays uncertain and never retries the submission automatically', async ({
  page,
  request,
}) => {
  await uncertain(page);
  await page.getByRole('button', { name: 'Check status' }).click();
  await expect(
    page.getByRole('button', { name: 'Check status' })
  ).toBeVisible();
  await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
  expect(runs(await wire(request))).toHaveLength(1);
  expect(
    (await wire(request)).filter((entry) => entry.path.endsWith('/history'))
  ).toHaveLength(2);
});
test('a conclusive history with a wrong marker cannot enable text', async ({
  page,
  request,
}) => {
  await uncertain(page);
  await publish(request, await humanOf(request), 'wrong-human');
  await page.getByRole('button', { name: 'Check status' }).click();
  await expect(page.locator('footer').getByRole('status')).toHaveText(
    'Start a new conversation to continue.'
  );
  await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
  expect(runs(await wire(request))).toHaveLength(1);
});
test('unrelated saved history cannot reconcile the retained request', async ({
  page,
  request,
}) => {
  await uncertain(page);
  // Saved history about some other turn: the retained request is absent.
  await request.post('/__history/safe');
  await request.post('/__history-values', {
    data: {
      set: {
        messages: [
          { type: 'human', id: 'unrelated-human', content: 'Unrelated' },
          { type: 'ai', id: 'unrelated-answer', content: 'Unrelated answer' },
        ],
        step: 'generate',
        completed_turn_id: 'unrelated-human',
        completed_answer_id: 'unrelated-answer',
      },
      entry: { next: [], tasks: [] },
    },
  });
  await page.getByRole('button', { name: 'Check status' }).click();
  await expect(
    page.getByRole('button', { name: 'Check status' })
  ).toBeVisible();
  await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
  expect(runs(await wire(request))).toHaveLength(1);
});
test('a failed history read protects diagnostics without replay', async ({
  page,
  request,
}) => {
  await uncertain(page);
  await request.post('/__history/failed');
  await page.getByRole('button', { name: 'Check status' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'The saved outcome could not be confirmed.'
  );
  await expect(page.locator('body')).not.toContainText('PRIVATE');
  expect(runs(await wire(request))).toHaveLength(1);
});
for (const action of ['Stop', 'pagehide'])
  test(`${action} fences an active status read and its later final history`, async ({
    page,
    request,
  }) => {
    await uncertain(page);
    await publish(request, await humanOf(request));
    await request.post('/__hold/history');
    await page.getByRole('button', { name: 'Check status' }).click();
    await expect(page.locator('footer').getByRole('status')).toHaveText(
      'Checking saved outcome…'
    );
    await expect(
      page.getByRole('button', { name: 'New conversation' })
    ).toBeDisabled();
    await expect
      .poll(
        async () => (await (await request.get('/__lifetime')).json()).activeHistory
      )
      .toBe(true);
    if (action === 'Stop')
      await page.getByRole('button', { name: 'Stop', exact: true }).click();
    else await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await expect
      .poll(
        async () => (await (await request.get('/__lifetime')).json()).activeHistory
      )
      .toBe(false);
    await request.post('/__release');
    if (action === 'Stop') {
      await expect(page.locator('footer').getByRole('status')).toContainText('Stopped');
      await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
      await expect(
        page.getByRole('button', { name: 'Check status' })
      ).toHaveCount(0);
    } else await expect(page.locator('main')).toHaveCount(0);
    expect(runs(await wire(request))).toHaveLength(1);
  });
test('a known physical run with an unknown outcome offers only a read-only status check', async ({
  page,
  request,
}) => {
  await send(page, 'Known uncertain');
  await expect(page.locator('footer').getByRole('status')).toHaveText(
    'The outcome is uncertain. Check its saved status.'
  );
  // While the exact run is still in flight, close and check read its status
  // only: saved history is not conclusive yet and is never consulted.
  let entries = await wire(request);
  expect(entries.filter((entry) => entry.method === 'GET')).toHaveLength(1);
  expect(
    entries.filter((entry) => entry.path.endsWith('/history'))
  ).toHaveLength(0);
  await page.getByRole('button', { name: 'Check status' }).click();
  await expect(page.locator('footer').getByRole('status')).toHaveText(
    'The outcome is uncertain. Check its saved status.'
  );
  entries = await wire(request);
  expect(entries.filter((entry) => entry.method === 'GET')).toHaveLength(2);
  expect(
    entries.filter((entry) => entry.path.endsWith('/history'))
  ).toHaveLength(0);
  // Once the exact run has ended, the same check reads the saved outcome and
  // concludes the turn without creating or replaying anything.
  await request.post('/__run-status/success');
  await publish(request, await humanOf(request));
  await page.getByRole('button', { name: 'Check status' }).click();
  await expect(page.locator('footer').getByRole('status')).toHaveText('Response complete.');
  await expect(transcript(page).getByRole('article')).toHaveCount(2);
  await expect(checkpoints(page)).toContainText('Generate — complete');
  entries = await wire(request);
  expect(runs(entries)).toHaveLength(1);
  expect(entries.filter((entry) => entry.method === 'GET')).toHaveLength(3);
  expect(
    entries.filter((entry) => entry.path.endsWith('/history'))
  ).toHaveLength(1);
});
test('uncertain creation cannot construct a run or replay', async ({
  page,
  request,
}) => {
  await request.post('/__fail-create');
  await send(page, 'First');
  await expect(page.locator('footer').getByRole('status')).toHaveText(
    'Start a new conversation to continue.'
  );
  await expect(page.getByRole('alert')).toHaveText(
    'The LangGraph request failed.'
  );
  const entries = await wire(request);
  expect(runs(entries)).toHaveLength(0);
  expect(
    entries.filter((entry) => entry.path.endsWith('/threads'))
  ).toHaveLength(1);
});
test('unsupported tool references cannot grant completion authority', async ({
  page,
}) => {
  await send(page, 'Unknown tool');
  await expect(page.locator('footer').getByRole('status')).toHaveText(
    'Start a new conversation to continue.'
  );
  await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Check status' })).toHaveCount(
    0
  );
});
test('literal checkpoint and transcript panels fit a narrow screen', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await send(page, '<script>fictional project</script>');
  await expect(page.locator('footer').getByRole('status')).toHaveText('Response complete.');
  await expect(transcript(page)).toContainText(
    '<script>fictional project</script>'
  );
  expect(
    await page
      .locator('script')
      .filter({ hasText: 'fictional project' })
      .count()
  ).toBe(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('durable-execution-mobile.png'),
  });
});
