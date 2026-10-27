import { test, expect, type Page } from '@playwright/test';
type Wire = {
  path: string;
  method: string;
  body: { assistant_id?: string; thread_id?: string; command?: unknown };
  key: string | null;
};
test.beforeEach(async ({ request }) => {
  await request.post('/__reset');
});
async function submit(page: Page, text: string) {
  await page.getByLabel('Message', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}
async function send(page: Page, text: string) {
  await submit(page, text);
  await expect(page.getByRole('status')).toHaveText('Response saved.');
}
const conversation = (page: Page) =>
  page.getByRole('region', { name: 'Conversation', exact: true });

test('installed runtime renders compiled graph code fences, isolates titles and confirms each continued turn', async ({
  page,
  request,
}) => {
  await page.goto('/chat/messages/react/');
  await expect(page.getByRole('status')).toHaveText('Ready.');
  expect(await (await request.get('/__requests')).json()).toEqual([]);
  await send(page, 'Explain the aviation example');
  await expect(conversation(page).locator('pre code')).toHaveText(
    'const answer = 42;'
  );
  await expect(conversation(page)).not.toContainText('Authored metadata title');
  await send(page, 'Continue with the same conversation');
  await expect(conversation(page).locator('article')).toHaveCount(4);
  const wire: Wire[] = await (await request.get('/__requests')).json();
  const creates = wire.filter((r) => r.path.endsWith('/threads')),
    runs = wire.filter((r) => r.path.endsWith('/runs/stream'));
  expect(creates).toHaveLength(1);
  expect(runs).toHaveLength(2);
  expect(runs[0].path).toBe(runs[1].path);
  expect(
    runs.every((r) => r.body.assistant_id === 'c-messages' && !r.body.command)
  ).toBe(true);
  expect(wire.filter((r) => r.path.endsWith('/history'))).toHaveLength(2);
  expect(wire.filter((r) => r.method === 'GET')).toHaveLength(2);
  const proofs = await (await request.get('/__graph-proof')).json();
  expect(proofs).toHaveLength(2);
  for (const proof of proofs)
    expect(proof).toMatchObject({
      actualCompiledGraph: true,
      networkConnectAttempts: 0,
      titleMessageCallbacks: 0,
    });
  await page.getByRole('button', { name: 'New conversation' }).click();
  await expect(page.getByRole('status')).toHaveText('Ready.');
  await expect(conversation(page).locator('article')).toHaveCount(0);
  expect(await (await request.get('/__requests')).json()).toEqual(wire);
});
test('held canonical read disables competing commands and cannot restore authority after Stop', async ({
  page,
  request,
}) => {
  await request.post('/__history/hold');
  await page.goto('/chat/messages/react/');
  await submit(page, 'Confirm once');
  await expect(page.getByRole('status')).toHaveText(
    'Confirming saved response…'
  );
  await expect(
    page.getByRole('button', { name: 'New conversation' })
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText(
    'Stopped. Start a new conversation to continue.'
  );
  await request.post('/__release-history');
  await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
  const wire: Wire[] = await (await request.get('/__requests')).json();
  expect(wire.filter((r) => r.path.endsWith('/runs/stream'))).toHaveLength(1);
});
test('held response Stop fences the run and explicit reset remains local', async ({
  page,
  request,
}) => {
  await page.goto('/chat/messages/react/');
  await submit(page, 'Hold');
  await expect(page.getByRole('status')).toHaveText('Receiving response…');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText(
    'Stopped. Start a new conversation to continue.'
  );
  await request.post('/__release');
  await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
  const before = await (await request.get('/__requests')).json();
  await page.getByRole('button', { name: 'New conversation' }).click();
  await expect(page.getByRole('status')).toHaveText('Ready.');
  expect(await (await request.get('/__requests')).json()).toEqual(before);
});
test('renders actual graph output inside an unfinished code fence before release', async ({
  page,
  request,
}) => {
  await page.goto('/chat/messages/react/');
  await submit(page, 'Hold fence');
  await expect(page.getByRole('status')).toHaveText('Receiving response…');
  await expect(conversation(page).locator('pre code')).toContainText(
    'const answer'
  );
  await expect(conversation(page).locator('pre code')).not.toContainText('42;');
  const before: Wire[] = await (await request.get('/__requests')).json();
  expect(
    before.filter((entry) => entry.path.endsWith('/history'))
  ).toHaveLength(0);
  await request.post('/__release');
  await expect(page.getByRole('status')).toHaveText('Response saved.');
  await expect(conversation(page).locator('pre code')).toHaveText(
    'const answer = 42;'
  );
  const after: Wire[] = await (await request.get('/__requests')).json();
  expect(
    after.filter((entry) => entry.path.endsWith('/runs/stream'))
  ).toHaveLength(1);
});
test('pagehide closes an active installed transport and a new page never replays it', async ({
  page,
  request,
}) => {
  await page.goto('/chat/messages/react/');
  await submit(page, 'Hold');
  await expect(page.getByRole('status')).toHaveText('Receiving response…');
  expect(await (await request.get('/__lifetime')).json()).toMatchObject({
    activeStream: true,
  });
  await page.goto('about:blank');
  await expect
    .poll(async () => await (await request.get('/__lifetime')).json())
    .toMatchObject({ activeStream: false });
  await request.post('/__release');
  const before = await (await request.get('/__requests')).json();
  await page.goto('/chat/messages/react/');
  await expect(page.getByRole('status')).toHaveText('Ready.');
  await expect(conversation(page).locator('article')).toHaveCount(0);
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('');
  expect(await (await request.get('/__requests')).json()).toEqual(before);
  const runs: Wire[] = before.filter((entry: Wire) =>
    entry.path.endsWith('/runs/stream')
  );
  expect(runs).toHaveLength(1);
});
for (const mode of ['changed', 'missing', 'pending', 'failed'])
  test(`canonical ${mode} history blocks submission without another run`, async ({
    page,
    request,
  }) => {
    await request.post('/__history/' + mode);
    await page.goto('/chat/messages/react/');
    await submit(page, 'Confirm the saved answer');
    await expect(page.getByRole('status')).toHaveText(
      'Start a new conversation to continue.'
    );
    await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
    await expect(page.getByRole('alert')).not.toContainText('PRIVATE');
    const wire: Wire[] = await (await request.get('/__requests')).json();
    expect(wire.filter((r) => r.path.endsWith('/runs/stream'))).toHaveLength(1);
    expect(wire.filter((r) => r.path.endsWith('/history'))).toHaveLength(1);
  });
test('unconfirmed creation is not retried and does not dispatch a model run', async ({
  page,
  request,
}) => {
  await request.post('/__fail-create');
  await page.goto('/chat/messages/react/');
  await submit(page, 'Question');
  await expect(page.getByRole('status')).toHaveText(
    'Start a new conversation to continue.'
  );
  await expect(page.getByRole('alert')).not.toContainText('PRIVATE');
  const wire: Wire[] = await (await request.get('/__requests')).json();
  expect(wire.filter((r) => r.path.endsWith('/threads'))).toHaveLength(1);
  expect(wire.filter((r) => r.path.endsWith('/runs/stream'))).toHaveLength(0);
});
test('authored developer connection routes only to its configured target', async ({
  page,
  request,
}) => {
  await page.goto('http://127.0.0.1:3000/');
  await page.setContent(`<!doctype html><html><body><p id="state">Waiting</p><script>
    addEventListener('message', event => {
      const frame = document.getElementById('pilot');
      if (event.origin !== 'http://127.0.0.1:4620' || event.source !== frame.contentWindow) return;
      if (event.data.type === 'tplane:runtime-child-ready') frame.contentWindow.postMessage({
        type: 'tplane:runtime-configure', version: 2, nonce: event.data.nonce, generation: 1,
        target: {kind: 'langsmith', apiUrl: 'http://127.0.0.1:4620/developer-api', apiKey: 'TEST_DEVELOPER_KEY'}
      }, event.origin);
      if (event.data.type === 'tplane:runtime-configured') frame.contentWindow.postMessage({
        type: 'tplane:runtime-check', version: 1, nonce: 'parent-health', capability: 'messages'
      }, event.origin);
      if (event.data.type === 'tplane:runtime-ready' && event.data.nonce === 'parent-health') document.getElementById('state').textContent = 'Ready';
    });</script><iframe id="pilot" title="Chat Messages React" src="http://127.0.0.1:4620/chat/messages/react/"></iframe></body></html>`);
  await expect(page.locator('#state')).toHaveText('Ready');
  const frame = page.frameLocator('#pilot');
  await frame.getByLabel('Message', { exact: true }).fill('Developer question');
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
