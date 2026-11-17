import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
type Wire = {
  path: string;
  method: string;
  key: string | null;
  body: {
    thread_id?: string;
    assistant_id?: string;
    command?: unknown;
    input?: { messages: { content: string }[] };
  };
};
const base = '/chat/threads/react/';
const box = (page: Page) => page.getByLabel('Message', { exact: true });
// Conversation rows of the connected sidebar (not New chat or row menus).
const picker = (page: Page) =>
  page
    .getByRole('navigation', { name: 'Conversations' })
    .getByRole('list', { name: 'Recent' })
    .locator('.tp-thread-list__button');
const conversation = (page: Page) =>
  page.getByRole('region', { name: 'Conversation', exact: true });
async function submit(page: Page, text: string) {
  await box(page).fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}
async function saved(page: Page) {
  await expect(page.getByRole('status')).toHaveText('Response saved.');
}
async function loaded(page: Page) {
  await expect(page.getByRole('status')).toHaveText('Conversation loaded.');
}
async function titleReads(request: APIRequestContext, count: number) {
  await expect
    .poll(
      async () =>
        ((await (await request.get('/__requests')).json()) as Wire[]).filter(
          (item) => item.method === 'GET' && /\/threads\/[^/]+$/.test(item.path)
        ).length
    )
    .toBe(count);
}
const notice = (page: Page) => page.locator('.conversation-notice');
const UNAVAILABLE =
  'This conversation could not be confirmed and cannot be continued here.';
const EARLIER_VISIT =
  'This conversation was saved on an earlier visit and cannot be continued here.';
/** A row the page cannot continue: the click explains why and sends nothing. */
async function refused(
  page: Page,
  request: APIRequestContext,
  row: ReturnType<typeof picker>,
  message: string
) {
  const before = ((await (await request.get('/__requests')).json()) as Wire[])
    .length;
  await row.click();
  await expect(notice(page)).toHaveText(message);
  expect(
    ((await (await request.get('/__requests')).json()) as Wire[]).length
  ).toBe(before);
}
async function blocked(page: Page) {
  await expect(page.getByRole('status')).toHaveText(
    'Choose another conversation or start a new one.'
  );
  await expect(box(page)).toBeDisabled();
}
async function newConversation(page: Page) {
  await page
    .getByRole('button', { name: 'New conversation', exact: true })
    .click();
  await expect(page.getByRole('status')).toHaveText('Ready.');
}
test.beforeEach(async ({ request }) => {
  expect((await request.post('/__reset')).status()).toBe(200);
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
test('installed SDK switches A/B/A and extends only the selected saved conversation', async ({
  page,
  request,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base);
  await expect(page.getByRole('status')).toHaveText('Ready.');
  expect(await (await request.get('/__requests')).json()).toEqual([]);
  await submit(page, 'A first');
  await saved(page);
  await expect(picker(page).first()).toHaveText('Authored conversation title');
  await box(page).fill('A retained draft');
  await newConversation(page);
  await expect(box(page)).toHaveValue('');
  await submit(page, 'B first');
  await saved(page);
  await expect(picker(page).nth(1)).toHaveText('Authored conversation title');
  await box(page).fill('B retained draft');
  await picker(page).nth(0).click();
  await loaded(page);
  await expect(box(page)).toHaveValue('A retained draft');
  await expect(conversation(page).locator('article')).toHaveCount(2);
  await expect(conversation(page)).toContainText('A first');
  await expect(conversation(page)).not.toContainText('B first');
  await submit(page, 'A followup');
  await saved(page);
  await expect(conversation(page).locator('article')).toHaveCount(4);
  await expect(conversation(page)).toContainText('A first');
  await expect(conversation(page)).toContainText('A followup');
  await expect(conversation(page).locator('pre code')).toHaveCount(2);
  await page.screenshot({
    path: testInfo.outputPath('threads-desktop.png'),
    fullPage: true,
  });
  await picker(page).nth(1).click();
  await loaded(page);
  await expect(box(page)).toHaveValue('B retained draft');
  await expect(conversation(page).locator('article')).toHaveCount(2);
  await expect(conversation(page)).toContainText('B first');
  await expect(conversation(page)).not.toContainText('A first');
  await expect(conversation(page)).not.toContainText(
    'Authored conversation title'
  );
  await expect(picker(page).nth(1)).toHaveAttribute('aria-current', 'true');
  // Titles come from the sidebar's directory, so the page never reads one.
  await titleReads(request, 0);
  const wire: Wire[] = await (await request.get('/__requests')).json();
  const creates = wire.filter((item) => item.path.endsWith('/threads'));
  const runs = wire.filter((item) => item.path.endsWith('/runs/stream'));
  const histories = wire.filter((item) => item.path.endsWith('/history'));
  const known = creates.map((item) => item.body.thread_id);
  expect(creates).toHaveLength(2);
  expect(runs).toHaveLength(3);
  expect(histories).toHaveLength(5);
  expect(runs.map((item) => item.path.split('/')[3])).toEqual([
    known[0],
    known[1],
    known[0],
  ]);
  expect(histories.map((item) => item.path.split('/')[3])).toEqual([
    known[0],
    known[1],
    known[0],
    known[0],
    known[1],
  ]);
  expect(
    runs.every(
      (item) => item.body.assistant_id === 'c-threads' && !item.body.command
    )
  ).toBe(true);
  expect(
    wire.filter(
      (item) => item.method === 'GET' && /\/runs\/[^/]+$/.test(item.path)
    )
  ).toHaveLength(3);
  expect(
    wire.every(
      (item) =>
        item.path.endsWith('/threads') ||
        known.includes(item.path.split('/')[3])
    )
  ).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('threads-mobile.png'),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test('mount, prompt fill and New perform no runtime request', async ({
  page,
  request,
}) => {
  await page.goto(base);
  await page
    .getByRole('button', { name: 'Try a question', exact: true })
    .click();
  await expect(box(page)).toHaveValue(
    'Explain how saved conversations work in two sentences.'
  );
  await newConversation(page);
  await expect(box(page)).toHaveValue('');
  await expect(picker(page)).toHaveCount(0);
  expect(await (await request.get('/__requests')).json()).toEqual([]);
  // The sidebar only reads the server's lists on mount.
  const directory: Wire[] = await (
    await request.get('/__directory-requests')
  ).json();
  expect(directory.length).toBeGreaterThan(0);
  expect(
    directory.every(
      (item) =>
        item.method === 'POST' &&
        ['/api/threads/search', '/api/store/items/search'].includes(item.path)
    )
  ).toBe(true);
});
test('draft typed while saved history is held survives confirmation', async ({
  page,
  request,
}) => {
  await request.post('/__history/hold');
  await page.goto(base);
  await submit(page, 'Hold confirmation');
  await expect(page.getByRole('status')).toHaveText(
    'Confirming saved conversation…'
  );
  await box(page).fill('Next draft');
  await request.post('/__release-history');
  await saved(page);
  await expect(box(page)).toHaveValue('Next draft');
});
// The sidebar shows the server's title; a missing or malformed one falls back.
for (const mode of ['missing', 'invalid']) {
  test(`server ${mode} title falls back in the sidebar without withholding continuation`, async ({
    page,
    request,
  }) => {
    expect((await request.post('/__title/' + mode)).status()).toBe(200);
    await page.goto(base);
    await submit(page, 'First');
    await saved(page);
    await expect(picker(page).first()).toHaveText('Untitled conversation');
    await submit(page, 'Second');
    await saved(page);
    await expect(conversation(page).locator('article')).toHaveCount(4);
    await expect(picker(page).first()).toHaveText('Untitled conversation');
    await titleReads(request, 0);
  });
}
for (const mode of ['changed', 'missing', 'pending', 'foreign', 'failure']) {
  test(`rejects ${mode} saved history without retry or replay`, async ({
    page,
    request,
  }) => {
    await request.post('/__history/' + mode);
    await page.goto(base);
    await submit(page, 'First');
    await blocked(page);
    const wire: Wire[] = await (await request.get('/__requests')).json();
    expect(
      wire.filter((item) => item.path.endsWith('/runs/stream'))
    ).toHaveLength(1);
    expect(wire.filter((item) => item.body.command)).toHaveLength(0);
    // The quarantined conversation cannot be reopened from the sidebar.
    await refused(page, request, picker(page).first(), UNAVAILABLE);
    await blocked(page);
  });
}
test('cancelled selection quarantines A while independently saved B remains usable', async ({
  page,
  request,
}) => {
  await page.goto(base);
  await submit(page, 'A first');
  await saved(page);
  await newConversation(page);
  await submit(page, 'B first');
  await saved(page);
  await box(page).fill('B retained draft');
  await request.post('/__history/hold');
  await picker(page).nth(0).click();
  await expect(page.getByRole('status')).toHaveText(
    'Loading saved conversation…'
  );
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await blocked(page);
  await request.post('/__release-history');
  await request.post('/__history/safe');
  await refused(page, request, picker(page).nth(0), UNAVAILABLE);
  await blocked(page);
  await picker(page).nth(1).click();
  await loaded(page);
  await expect(box(page)).toHaveValue('B retained draft');
  await submit(page, 'B followup');
  await saved(page);
  await expect(conversation(page)).not.toContainText('A first');
  const wire: Wire[] = await (await request.get('/__requests')).json();
  expect(
    wire.filter((item) => item.path.endsWith('/runs/stream'))
  ).toHaveLength(3);
});
test('failed creation is never retried and New restores local readiness', async ({
  page,
  request,
}) => {
  await request.post('/__fail-create');
  await page.goto(base);
  await submit(page, 'First');
  await blocked(page);
  await newConversation(page);
  const wire: Wire[] = await (await request.get('/__requests')).json();
  expect(wire.filter((item) => item.path.endsWith('/threads'))).toHaveLength(1);
  expect(
    wire.filter((item) => item.path.endsWith('/runs/stream'))
  ).toHaveLength(0);
  await expect(page.locator('body')).not.toContainText('PRIVATE');
});
test('actual graph failure is generic and never confirms or replays', async ({
  page,
  request,
}) => {
  await page.goto(base);
  await submit(page, 'fail-stream');
  await blocked(page);
  await expect(page.locator('body')).not.toContainText('PRIVATE');
  await expect(page.locator('body')).not.toContainText('Authored stream failure');
  const wire: Wire[] = await (await request.get('/__requests')).json();
  expect(
    wire.filter((item) => item.path.endsWith('/runs/stream'))
  ).toHaveLength(1);
  expect(wire.filter((item) => item.path.endsWith('/history'))).toHaveLength(0);
});
test('literal title markup remains button text', async ({ page, request }) => {
  await request.post('/__title/literal');
  await page.goto(base);
  await submit(page, 'First');
  await saved(page);
  await expect(picker(page).first()).toContainText('<script>');
  await expect(picker(page).first().locator('script')).toHaveCount(0);
  await expect(conversation(page)).not.toContainText('<script>');
});
test('long optional title is bounded and wraps on mobile', async ({
  page,
  request,
}, testInfo) => {
  await request.post('/__title/long');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base);
  await submit(page, 'First');
  await saved(page);
  // The sidebar shows the full server title without widening the page.
  await expect(picker(page).first()).toHaveText(/^Long authored title/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('threads-long-title-mobile.png'),
    fullPage: true,
  });
});
test('Stop fences held streaming and preserves other records', async ({
  page,
  request,
}) => {
  await page.goto(base);
  await submit(page, 'A first');
  await saved(page);
  await newConversation(page);
  await request.post('/__hold-stream');
  await submit(page, 'B interrupted');
  await expect
    .poll(
      async () => (await (await request.get('/__lifetime')).json()).activeStream
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await blocked(page);
  await request.post('/__release');
  await refused(page, request, picker(page).nth(1), UNAVAILABLE);
  await blocked(page);
  await picker(page).first().click();
  await loaded(page);
  await expect(conversation(page)).toContainText('A first');
  await expect(conversation(page)).not.toContainText('B interrupted');
  const wire: Wire[] = await (await request.get('/__requests')).json();
  expect(
    wire.filter((item) => item.path.endsWith('/runs/stream'))
  ).toHaveLength(2);
});
for (const kind of ['history', 'stream']) {
  test(`page disposal aborts held ${kind} without replay`, async ({
    page,
    request,
  }) => {
    await request.post('/__hold-' + kind);
    await page.goto(base);
    await submit(page, 'First');
    const field = 'active' + kind[0].toUpperCase() + kind.slice(1);
    await expect
      .poll(
        async () => (await (await request.get('/__lifetime')).json())[field]
      )
      .toBe(true);
    await page.goto('about:blank');
    await expect
      .poll(
        async () => (await (await request.get('/__lifetime')).json())[field]
      )
      .toBe(false);
    await request.post(kind === 'stream' ? '/__release' : '/__release-' + kind);
    const wire: Wire[] = await (await request.get('/__requests')).json();
    expect(wire.filter((item) => item.path.endsWith('/threads'))).toHaveLength(
      1
    );
    expect(
      wire.filter((item) => item.path.endsWith('/runs/stream'))
    ).toHaveLength(1);
  });
}
test('worker failure stays generic and is not retried', async ({
  page,
  request,
}) => {
  await request.post('/__worker-failure');
  await page.goto(base);
  await submit(page, 'First');
  await blocked(page);
  await expect(page.locator('body')).not.toContainText('Graph worker');
  const wire: Wire[] = await (await request.get('/__requests')).json();
  expect(
    wire.filter((item) => item.path.endsWith('/runs/stream'))
  ).toHaveLength(1);
  expect(wire.filter((item) => item.path.endsWith('/history'))).toHaveLength(0);
});
test('developer endpoint credentials stay in headers for creation, stream, history and the sidebar', async ({
  page,
  request,
}) => {
  await page.goto('http://127.0.0.1:3000/');
  await page.setContent(`<!doctype html><html><body><p id="state">Waiting</p><script>
    addEventListener('message', event => {
      const frame = document.getElementById('pilot');
      if (event.origin !== 'http://127.0.0.1:4625' || event.source !== frame.contentWindow) return;
      if (event.data.type === 'tplane:runtime-child-ready') frame.contentWindow.postMessage({
        type: 'tplane:runtime-configure', version: 2, nonce: event.data.nonce, generation: 1,
        target: {kind: 'langsmith', apiUrl: 'http://127.0.0.1:4625/developer-api', apiKey: 'TEST_DEVELOPER_KEY'}
      }, event.origin);
      if (event.data.type === 'tplane:runtime-configured') frame.contentWindow.postMessage({
        type: 'tplane:runtime-check', version: 1, nonce: 'parent-health', capability: 'threads'
      }, event.origin);
      if (event.data.type === 'tplane:runtime-ready' && event.data.nonce === 'parent-health') document.getElementById('state').textContent = 'Ready';
    });</script><iframe id="pilot" title="Chat Threads React" style="width:100%;height:700px" src="http://127.0.0.1:4625/chat/threads/react/"></iframe></body></html>`);
  await expect(page.locator('#state')).toHaveText('Ready');
  const frame = page.frameLocator('#pilot');
  await frame.getByLabel('Message', { exact: true }).fill('Developer first');
  await frame.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(frame.getByRole('status')).toHaveText('Response saved.');
  await expect(
    frame
      .getByRole('navigation', { name: 'Conversations' })
      .getByRole('list', { name: 'Recent' })
      .locator('.tp-thread-list__button')
  ).toHaveText('Authored conversation title');
  const wire: Wire[] = await (await request.get('/__requests')).json();
  expect(wire).toHaveLength(4);
  expect(
    wire.every(
      (item) =>
        item.path.startsWith('/developer-api/') &&
        item.key === 'TEST_DEVELOPER_KEY'
    )
  ).toBe(true);
  expect(JSON.stringify(wire.map((item) => item.body))).not.toContain(
    'TEST_DEVELOPER_KEY'
  );
  await expect(frame.locator('body')).not.toContainText('TEST_DEVELOPER_KEY');
  const directory: Wire[] = await (
    await request.get('/__directory-requests')
  ).json();
  expect(directory.length).toBeGreaterThan(0);
  expect(
    directory.every(
      (item) =>
        item.path.startsWith('/developer-api/') &&
        item.key === 'TEST_DEVELOPER_KEY'
    )
  ).toBe(true);
});
const sidebarRows = picker;
// Row titles without the visually hidden "Pinned conversation" note.
const rowTitles = (page: Page) => () =>
  sidebarRows(page).evaluateAll((rows) =>
    rows.map((row) => row.getAttribute('title'))
  );
const projectButton = (page: Page, name: string) =>
  page
    .getByRole('navigation', { name: 'Conversations' })
    .getByRole('list', { name: 'Projects' })
    .getByRole('button', { name, exact: true });
async function rowCommand(page: Page, title: string, command: string) {
  await page
    .getByRole('button', { name: `More actions for ${title}`, exact: true })
    .click();
  await page.getByRole('menuitem', { name: command, exact: true }).click();
}
async function createdThreads(request: APIRequestContext) {
  const wire: Wire[] = await (await request.get('/__requests')).json();
  return wire
    .filter((item) => item.method === 'POST' && item.path.endsWith('/threads'))
    .map((item) => item.body.thread_id as string);
}
type ServerThread = { thread_id: string; metadata: Record<string, unknown> };
async function serverThreads(request: APIRequestContext) {
  const response = await request.post('/api/threads/search', {
    data: { limit: 50, offset: 0 },
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as ServerThread[];
}

test('sidebar rename persists on the server and survives reload', async ({
  page,
  request,
}) => {
  await page.goto(base);
  await submit(page, 'A first');
  await saved(page);
  await expect(sidebarRows(page)).toHaveText(['Authored conversation title']);
  await rowCommand(page, 'Authored conversation title', 'Rename');
  const title = page.getByLabel('Conversation title', { exact: true });
  await title.fill('Renamed A');
  await title.press('Enter');
  await expect(sidebarRows(page)).toHaveText(['Renamed A']);
  await page.reload();
  await expect(sidebarRows(page)).toHaveText(['Renamed A']);
  // Listed after reload, but only conversations confirmed on this page open.
  await refused(page, request, sidebarRows(page).first(), EARLIER_VISIT);
  await expect(page.getByRole('status')).toHaveText('Ready.');
  const [thread] = await serverThreads(request);
  expect(thread.metadata['title']).toBe('Renamed A');
});

test('sidebar pins two conversations, reorders them by drag and keeps the order after reload', async ({
  page,
  request,
}) => {
  await page.goto(base);
  await submit(page, 'A first');
  await saved(page);
  await newConversation(page);
  await submit(page, 'B first');
  await saved(page);
  const [a, b] = await createdThreads(request);
  for (const [id, title] of [
    [a, 'Alpha'],
    [b, 'Beta'],
  ])
    expect(
      (
        await request.patch(`/api/threads/${id}`, {
          data: { metadata: { title } },
        })
      ).status()
    ).toBe(200);
  await page.reload();
  await expect(sidebarRows(page)).toHaveText(['Alpha', 'Beta']);
  await rowCommand(page, 'Alpha', 'Pin');
  await rowCommand(page, 'Beta', 'Pin');
  await expect.poll(rowTitles(page)).toEqual(['Alpha', 'Beta']);
  const rows = page
    .getByRole('navigation', { name: 'Conversations' })
    .getByRole('list', { name: 'Recent' })
    .locator('li');
  await rows.nth(1).dragTo(rows.nth(0), { targetPosition: { x: 20, y: 2 } });
  await expect.poll(rowTitles(page)).toEqual(['Beta', 'Alpha']);
  await page.reload();
  await expect.poll(rowTitles(page)).toEqual(['Beta', 'Alpha']);
  const pinned = await serverThreads(request);
  expect(
    pinned.every((thread) => thread.metadata['pinned'] === true)
  ).toBe(true);
});

test('sidebar creates a project, moves a conversation into it and keeps both after reload', async ({
  page,
  request,
}) => {
  await page.goto(base);
  await submit(page, 'A first');
  await saved(page);
  await page
    .getByRole('button', { name: '+ New project', exact: true })
    .click();
  const name = page.getByLabel('New project name', { exact: true });
  await name.fill('Research');
  await name.press('Enter');
  await expect(projectButton(page, 'Research')).toBeVisible();
  await rowCommand(page, 'Authored conversation title', 'Move to project');
  await page.getByRole('menuitem', { name: 'Research', exact: true }).click();
  await expect
    .poll(async () => (await serverThreads(request))[0]?.metadata['projectId'])
    .toEqual(expect.any(String));
  await page.reload();
  await expect(projectButton(page, 'Research')).toBeVisible();
  await expect(sidebarRows(page)).toHaveText(['Authored conversation title']);
  const store = (await (
    await request.post('/api/store/items/search', {
      data: { namespace_prefix: ['threadplane', 'projects'], limit: 100 },
    })
  ).json()) as { items: { key: string; value: { name: string } }[] };
  const [thread] = await serverThreads(request);
  expect(store.items).toEqual([
    expect.objectContaining({
      key: thread.metadata['projectId'],
      value: { name: 'Research' },
    }),
  ]);
});

test('sidebar delete of the active conversation returns to a new chat', async ({
  page,
  request,
}) => {
  await page.goto(base);
  await submit(page, 'A first');
  await saved(page);
  await expect(sidebarRows(page).first()).toHaveAttribute(
    'aria-current',
    'true'
  );
  await rowCommand(page, 'Authored conversation title', 'Delete');
  await page
    .getByRole('alertdialog', { name: 'Delete conversation?' })
    .getByRole('button', { name: 'Delete', exact: true })
    .click();
  await expect(sidebarRows(page)).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveText('Ready.');
  await expect(conversation(page).locator('article')).toHaveCount(0);
  await expect(box(page)).toBeEnabled();
  await expect(box(page)).toHaveValue('');
  expect(await serverThreads(request)).toEqual([]);
});
