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
const boundary = (page: Page) =>
  page.getByRole('region', { name: 'Research boundary', exact: true });
const children = (page: Page) =>
  page.getByRole('region', { name: 'Child observations', exact: true });
async function send(page: Page, text: string, navigate = true) {
  if (navigate) await page.goto('/langgraph/subgraphs/react/');
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
    stream_subgraphs?: boolean;
    input?: { messages: { id: string; content: string }[] };
  };
};
async function wire(request: APIRequestContext): Promise<Wire[]> {
  return (await request.get('/__requests')).json();
}
const runs = (entries: Wire[]) =>
  entries.filter((entry) => entry.path.endsWith('/runs/stream'));
test('conditional research and direct turns preserve parent history on one confirmed UUID', async ({
  page,
  request,
}) => {
  await send(page, 'Research first');
  await expect(page.getByRole('status')).toHaveText('Response complete.');
  await expect(boundary(page)).toContainText(
    'Nested — research boundary confirmed.'
  );
  await expect(boundary(page)).toContainText('Fictional checkpoint topic');
  await expect(boundary(page)).toContainText('CHILD-ONLY brief');
  await expect(children(page)).toContainText('research:');
  await expect(transcript(page)).not.toContainText('CHILD-ONLY brief');
  await expect(transcript(page)).not.toContainText('needs_research');
  await expect(transcript(page).getByRole('article')).toHaveCount(2);
  await send(page, 'Hello', false);
  await expect(page.getByRole('status')).toHaveText('Response complete.');
  await expect(boundary(page)).toContainText(
    'Direct — no child observed for this turn.'
  );
  await expect(boundary(page)).not.toContainText('CHILD-ONLY brief');
  await expect(children(page)).toContainText(
    'No child stream observed for this turn.'
  );
  await expect(transcript(page).getByRole('article')).toHaveCount(4);
  await send(page, 'Research again', false);
  await expect(page.getByRole('status')).toHaveText('Response complete.');
  await expect(boundary(page)).toContainText(
    'Nested — research boundary confirmed.'
  );
  await expect(transcript(page).getByRole('article')).toHaveCount(6);
  const entries = await wire(request),
    streams = runs(entries);
  expect(streams).toHaveLength(3);
  expect(new Set(streams.map((entry) => entry.path)).size).toBe(1);
  expect(
    entries.filter((entry) => entry.path.endsWith('/threads'))
  ).toHaveLength(1);
  expect(
    streams.every(
      (entry) =>
        entry.body.assistant_id === 'subgraphs' &&
        entry.body.stream_subgraphs === true &&
        !entry.body.command
    )
  ).toBe(true);
  expect(
    new Set(streams.map((entry) => entry.body.input!.messages.at(-1)!.id)).size
  ).toBe(3);
});
test('a new admission clears the old route before its router runs', async ({
  page,
  request,
}) => {
  await send(page, 'Research first');
  await expect(page.getByRole('status')).toHaveText('Response complete.');
  await request.post('/__hold-start');
  await send(page, 'Hello', false);
  await expect
    .poll(async () => (await (await request.get('/__lifetime')).json()).active)
    .toBe(true);
  await expect(boundary(page)).toContainText('Awaiting the current route.');
  await expect(boundary(page)).not.toContainText('CHILD-ONLY brief');
  await expect(children(page)).toContainText(
    'No child stream observed for this turn.'
  );
  await request.post('/__release');
  await expect(page.getByRole('status')).toHaveText('Response complete.');
  await expect(boundary(page)).toContainText(
    'Direct — no child observed for this turn.'
  );
});
test('an observed child does not imply a completed route while held', async ({
  page,
  request,
}, testInfo) => {
  await request.post('/__hold-child');
  await send(page, 'Research first');
  await expect(children(page)).toContainText('Observed child stream');
  await expect(boundary(page)).toContainText('Awaiting the current route.');
  await expect(
    page.getByRole('button', { name: 'New conversation' })
  ).toBeDisabled();
  await expect(children(page).getByRole('button')).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath('subgraphs-held-desktop.png'),
  });
  await request.post('/__release');
  await expect(page.getByRole('status')).toHaveText('Response complete.');
  await page.screenshot({
    path: testInfo.outputPath('subgraphs-final-desktop.png'),
  });
});
for (const text of [
  'Missing marker',
  'Stale marker',
  'Missing answer marker',
  'Equal marker',
  'Missing child',
  'Conflicting child',
  'Child pause',
  'Child error',
  'Child tool',
  'Root tool',
])
  test(`${text} cannot confer final route authority`, async ({
    page,
    request,
  }) => {
    await send(page, text);
    await expect(page.getByRole('status')).toHaveText(
      'Start a new conversation to continue.'
    );
    await expect(boundary(page)).toContainText('Current route unconfirmed.');
    await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
    await expect(page.locator('body')).not.toContainText('PRIVATE');
    await expect(
      page.getByRole('button', { name: /Resume|Check status|Retry/ })
    ).toHaveCount(0);
    expect(runs(await wire(request))).toHaveLength(1);
  });
for (const action of ['Stop', 'pagehide'])
  test(`${action} releases a held child and fences later completion`, async ({
    page,
    request,
  }) => {
    await request.post('/__hold-child');
    await send(page, 'Research first');
    await expect(children(page)).toContainText('Observed child stream');
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
      await expect(boundary(page)).not.toContainText(
        'Nested — research boundary confirmed.'
      );
      await page.getByRole('button', { name: 'New conversation' }).click();
      await expect(transcript(page).getByRole('article')).toHaveCount(0);
      expect(runs(await wire(request))).toHaveLength(1);
      await send(page, 'Hello', false);
      await expect(page.getByRole('status')).toHaveText('Response complete.');
      const entries = await wire(request);
      expect(
        entries.filter((entry) => entry.path.endsWith('/threads'))
      ).toHaveLength(2);
      expect(runs(entries)[0].path).not.toBe(runs(entries)[1].path);
    } else {
      await expect(page.locator('main')).toHaveCount(0);
      expect(runs(await wire(request))).toHaveLength(1);
    }
  });
test('New is lazy and clears the parent and child panels', async ({
  page,
  request,
}) => {
  await send(page, 'Research first');
  await expect(page.getByRole('status')).toHaveText('Response complete.');
  await page.getByRole('button', { name: 'New conversation' }).click();
  await expect(page.getByRole('status')).toHaveText('Ready.');
  await expect(transcript(page).getByRole('article')).toHaveCount(0);
  await expect(boundary(page)).toContainText('Awaiting the current route.');
  await expect(children(page)).toContainText(
    'No child stream observed for this turn.'
  );
  expect(
    (await wire(request)).filter((entry) => entry.path.endsWith('/threads'))
  ).toHaveLength(1);
  await send(page, 'Research again', false);
  await expect(page.getByRole('status')).toHaveText('Response complete.');
  const entries = await wire(request);
  expect(
    entries.filter((entry) => entry.path.endsWith('/threads'))
  ).toHaveLength(2);
  expect(runs(entries)[0].path).not.toBe(runs(entries)[1].path);
});
test('failed creation does not dispatch or replay a run', async ({
  page,
  request,
}) => {
  await request.post('/__fail-create');
  await send(page, 'Research first');
  await expect(page.getByRole('status')).toHaveText(
    'Start a new conversation to continue.'
  );
  await expect(page.getByRole('alert')).toHaveText(
    'The LangGraph request failed.'
  );
  await expect(page.locator('body')).not.toContainText('PRIVATE');
  const entries = await wire(request);
  expect(runs(entries)).toHaveLength(0);
  expect(
    entries.filter((entry) => entry.path.endsWith('/threads'))
  ).toHaveLength(1);
});
test('literal boundary text and full namespace fit a narrow screen', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await send(page, 'Literal');
  await expect(page.getByRole('status')).toHaveText('Response complete.');
  await expect(boundary(page)).toContainText('<script>private topic</script>');
  await expect(boundary(page)).toContainText('<img src=x onerror=alert(1)>');
  expect(await boundary(page).locator('script, img').count()).toBe(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  await expect(children(page).locator('code')).toHaveText(
    /^research:00000000-0000-0000-0000-000000000001$/
  );
  await page.screenshot({ path: testInfo.outputPath('subgraphs-mobile.png') });
});
test('developer credentials remain SDK headers for creation, stream and status', async ({
  page,
  request,
}) => {
  await page.goto('http://127.0.0.1:3000/');
  await page.setContent(`<!doctype html><html><body><p id="state">Waiting</p><script>
    addEventListener('message', (event) => {
      const frame = document.getElementById('pilot');
      if (event.origin !== 'http://127.0.0.1:4606' || event.source !== frame.contentWindow) return;
      if (event.data.type === 'tplane:runtime-child-ready') frame.contentWindow.postMessage({
        type: 'tplane:runtime-configure', version: 2, nonce: event.data.nonce, generation: 1,
        target: { kind: 'langsmith', apiUrl: 'http://127.0.0.1:4606/developer-api', apiKey: 'TEST_DEVELOPER_KEY' }
      }, event.origin);
      if (event.data.type === 'tplane:runtime-configured') frame.contentWindow.postMessage({
        type: 'tplane:runtime-check', version: 1, nonce: 'parent-health', capability: 'subgraphs'
      }, event.origin);
      if (event.data.type === 'tplane:runtime-ready' && event.data.nonce === 'parent-health') document.getElementById('state').textContent = 'Ready';
    });</script><iframe id="pilot" title="React pilot" src="http://127.0.0.1:4606/langgraph/subgraphs/react/"></iframe></body></html>`);
  await expect(page.locator('#state')).toHaveText('Ready');
  const frame = page.frameLocator('#pilot');
  await frame.getByLabel('Message', { exact: true }).fill('Research first');
  await frame.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(frame.getByRole('status')).toHaveText('Response complete.');
  const entries = await wire(request);
  expect(
    entries.every(
      (entry) =>
        entry.path.startsWith('/developer-api/') &&
        entry.key === 'TEST_DEVELOPER_KEY'
    )
  ).toBe(true);
  expect(entries.filter((entry) => entry.method === 'GET')).toHaveLength(1);
  expect(JSON.stringify(entries.map((entry) => entry.body))).not.toContain(
    'TEST_DEVELOPER_KEY'
  );
  await expect(frame.locator('body')).not.toContainText('TEST_DEVELOPER_KEY');
});
