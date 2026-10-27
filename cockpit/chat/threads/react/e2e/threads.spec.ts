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
const picker = (page: Page) =>
  page.getByRole('navigation', { name: 'Conversations' }).getByRole('button');
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
  await titleReads(request, 3);
  await submit(page, 'A followup');
  await saved(page);
  await expect(conversation(page).locator('article')).toHaveCount(4);
  await expect(conversation(page)).toContainText('A first');
  await expect(conversation(page)).toContainText('A followup');
  await expect(conversation(page).locator('pre code')).toHaveCount(2);
  await titleReads(request, 4);
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
  await expect(picker(page).nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(
      async () =>
        ((await (await request.get('/__requests')).json()) as Wire[]).filter(
          (item) => item.method === 'GET' && /\/threads\/[^/]+$/.test(item.path)
        ).length
    )
    .toBe(5);
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
for (const mode of ['missing', 'wrong-thread', 'invalid', 'titlefailure']) {
  test(`optional ${mode} title retains fallback without withholding continuation`, async ({
    page,
    request,
  }) => {
    expect((await request.post('/__title/' + mode)).status()).toBe(200);
    await page.goto(base);
    await submit(page, 'First');
    await saved(page);
    await expect
      .poll(
        async () =>
          ((await (await request.get('/__requests')).json()) as Wire[]).filter(
            (item) =>
              item.method === 'GET' && /\/threads\/[^/]+$/.test(item.path)
          ).length
      )
      .toBe(1);
    await expect(picker(page).first()).toHaveText('Conversation 1');
    await submit(page, 'Second');
    await saved(page);
    await expect(conversation(page).locator('article')).toHaveCount(4);
    await expect(picker(page).first()).toHaveText('Conversation 1');
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
    await expect(picker(page).first()).toBeDisabled();
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
  await expect(picker(page).nth(0)).toBeDisabled();
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
test('held title does not block a new conversation and cannot relabel it after release', async ({
  page,
  request,
}) => {
  await request.post('/__hold-title');
  await page.goto(base);
  await submit(page, 'A first');
  await saved(page);
  await expect
    .poll(
      async () => (await (await request.get('/__lifetime')).json()).activeTitle
    )
    .toBe(true);
  await expect(picker(page).first()).toHaveText('Conversation 1');
  await newConversation(page);
  await expect
    .poll(
      async () => (await (await request.get('/__lifetime')).json()).activeTitle
    )
    .toBe(false);
  await request.post('/__release-title');
  await submit(page, 'B first');
  await saved(page);
  await expect(picker(page).nth(1)).toHaveText('Authored conversation title');
  await expect(picker(page).first()).toHaveText('Conversation 1');
});
test('a late title from selected A cannot relabel B after switching', async ({
  page,
  request,
}) => {
  await page.goto(base);
  await submit(page, 'A first');
  await saved(page);
  await expect(picker(page).first()).toHaveText('Authored conversation title');
  await newConversation(page);
  await submit(page, 'B first');
  await saved(page);
  await expect(picker(page).nth(1)).toHaveText('Authored conversation title');
  await request.post('/__title/literal');
  await request.post('/__hold-title');
  await picker(page).first().click();
  await loaded(page);
  await expect
    .poll(
      async () => (await (await request.get('/__lifetime')).json()).activeTitle
    )
    .toBe(true);
  await request.post('/__title/safe');
  await picker(page).nth(1).click();
  await loaded(page);
  await request.post('/__release-title');
  await expect(picker(page).nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(picker(page).nth(1)).toHaveText('Authored conversation title');
  await expect(picker(page).first()).toHaveText('Authored conversation title');
  await expect(conversation(page)).toContainText('B first');
  await expect(conversation(page)).not.toContainText('A first');
});
test('failed metadata refresh retains the last valid title', async ({
  page,
  request,
}) => {
  await page.goto(base);
  await submit(page, 'First');
  await saved(page);
  await expect(picker(page).first()).toHaveText('Authored conversation title');
  await request.post('/__title/titlefailure');
  await submit(page, 'Second');
  await saved(page);
  await expect
    .poll(
      async () =>
        ((await (await request.get('/__requests')).json()) as Wire[]).filter(
          (item) => item.method === 'GET' && /\/threads\/[^/]+$/.test(item.path)
        ).length
    )
    .toBe(2);
  await expect(picker(page).first()).toHaveText('Authored conversation title');
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
  await expect
    .poll(
      async () => [...((await picker(page).first().textContent()) ?? '')].length
    )
    .toBe(80);
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
  await expect(picker(page).nth(1)).toBeDisabled();
  await picker(page).first().click();
  await loaded(page);
  await expect(conversation(page)).toContainText('A first');
  await expect(conversation(page)).not.toContainText('B interrupted');
  const wire: Wire[] = await (await request.get('/__requests')).json();
  expect(
    wire.filter((item) => item.path.endsWith('/runs/stream'))
  ).toHaveLength(2);
});
for (const kind of ['history', 'title', 'stream']) {
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
test('developer endpoint credentials stay in headers for creation, stream, history and title', async ({
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
    });</script><iframe id="pilot" title="Chat Threads React" src="http://127.0.0.1:4625/chat/threads/react/"></iframe></body></html>`);
  await expect(page.locator('#state')).toHaveText('Ready');
  const frame = page.frameLocator('#pilot');
  await frame.getByLabel('Message', { exact: true }).fill('Developer first');
  await frame.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(frame.getByRole('status')).toHaveText('Response saved.');
  await expect(
    frame.getByRole('navigation', { name: 'Conversations' }).getByRole('button')
  ).toHaveText('Authored conversation title');
  const wire: Wire[] = await (await request.get('/__requests')).json();
  expect(wire).toHaveLength(5);
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
});
