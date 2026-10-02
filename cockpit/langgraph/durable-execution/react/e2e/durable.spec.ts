import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from '@playwright/test';
test.beforeEach(async ({ request }) => {
  await request.post('/__reset');
});
const transcript = (page: Page) =>
  page.getByRole('region', { name: 'Conversation', exact: true });
const checkpoints = (page: Page) =>
  page.getByRole('region', { name: 'Saved pipeline checkpoints', exact: true });
async function send(page: Page, text: string, navigate = true) {
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
  await request.post('/__hold-plan');
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
  await expect(page.getByRole('status')).toHaveText('Response complete.');
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
  await expect(page.getByRole('status')).toHaveText('Response complete.');
  await request.post('/__hold-start');
  await send(page, 'Second', false);
  await expect
    .poll(async () => (await (await request.get('/__lifetime')).json()).active)
    .toBe(true);
  await expect(checkpoints(page)).toContainText('Analyze — pending');
  await expect(checkpoints(page)).toContainText('Generate — pending');
  await request.post('/__release');
  await expect(page.getByRole('status')).toHaveText('Response complete.');
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
  await expect(page.getByRole('status')).toHaveText('Ready.');
  await expect(transcript(page).getByRole('article')).toHaveCount(0);
  await expect(checkpoints(page)).toContainText('Generate — pending');
  await send(page, 'Third', false);
  await expect(page.getByRole('status')).toHaveText('Response complete.');
  expect(
    (await wire(request)).filter((entry) => entry.path.endsWith('/threads'))
  ).toHaveLength(2);
});
test('a current marked terminal root can arrive without intermediate observations', async ({
  page,
}) => {
  await send(page, 'Final only');
  await expect(page.getByRole('status')).toHaveText('Response complete.');
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
    await expect(page.getByRole('status')).toHaveText(
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
  await request.post('/__hold-plan');
  await send(page, 'A fictional project');
  await expect(checkpoints(page)).toContainText('Analyze — complete');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect
    .poll(async () => (await (await request.get('/__lifetime')).json()).active)
    .toBe(false);
  await request.post('/__release');
  await expect(page.getByRole('status')).toContainText('Stopped');
  await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
  await expect(checkpoints(page)).not.toContainText('Generate — complete');
  expect(runs(await wire(request))).toHaveLength(1);
  await page.getByRole('button', { name: 'New conversation' }).click();
  await send(page, 'New request', false);
  await expect(page.getByRole('status')).toHaveText('Response complete.');
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
    });</script><iframe id="pilot" title="React pilot" src="http://127.0.0.1:4605/langgraph/durable-execution/react/"></iframe></body></html>`);
  await expect(page.locator('#state')).toHaveText('Ready');
  const frame = page.frameLocator('#pilot');
  await frame.getByLabel('Message', { exact: true }).fill('Uncertain');
  await frame.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(
    frame.getByRole('button', { name: 'Check status', exact: true })
  ).toBeVisible();
  await request.post('/__publish-final');
  await frame
    .getByRole('button', { name: 'Check status', exact: true })
    .click();
  await expect(frame.getByRole('status')).toHaveText('Response complete.');
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
  await request.post('/__publish-final');
  await page.getByRole('button', { name: 'Check status' }).click();
  await expect(page.getByRole('status')).toHaveText('Response complete.');
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
  await request.post('/__publish-wrong-marker');
  await page.getByRole('button', { name: 'Check status' }).click();
  await expect(page.getByRole('status')).toHaveText(
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
  await request.post('/__publish-unrelated');
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
  await request.post('/__fail-history');
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
    await request.post('/__publish-final');
    await request.post('/__hold-history');
    await page.getByRole('button', { name: 'Check status' }).click();
    await expect(page.getByRole('status')).toHaveText(
      'Checking saved outcome…'
    );
    await expect(
      page.getByRole('button', { name: 'New conversation' })
    ).toBeDisabled();
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
    if (action === 'Stop') {
      await expect(page.getByRole('status')).toContainText('Stopped');
      await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
      await expect(
        page.getByRole('button', { name: 'Check status' })
      ).toHaveCount(0);
    } else await expect(page.locator('main')).toHaveCount(0);
    expect(runs(await wire(request))).toHaveLength(1);
  });
test('a known physical run with an unknown outcome does not offer check recovery', async ({
  page,
  request,
}) => {
  await send(page, 'Known uncertain');
  await expect(page.getByRole('status')).toHaveText(
    'Start a new conversation to continue.'
  );
  await expect(page.getByRole('button', { name: 'Check status' })).toHaveCount(
    0
  );
  const entries = await wire(request);
  expect(entries.filter((entry) => entry.method === 'GET')).toHaveLength(1);
  expect(
    entries.filter((entry) => entry.path.endsWith('/history'))
  ).toHaveLength(0);
});
test('uncertain creation cannot construct a run or replay', async ({
  page,
  request,
}) => {
  await request.post('/__fail-create');
  await send(page, 'First');
  await expect(page.getByRole('status')).toHaveText(
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
  await expect(page.getByRole('status')).toHaveText(
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
  await expect(page.getByRole('status')).toHaveText('Response complete.');
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
