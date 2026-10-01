import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ request }) => {
  await request.post('/__reset');
});
async function send(page: Page, text: string, navigate = true) {
  if (navigate) await page.goto('/langgraph/memory/react/');
  await page.getByLabel('Message', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}
const facts = (page: Page) =>
  page.getByRole('region', { name: 'Learned facts' });
const transcript = (page: Page) =>
  page.getByRole('region', { name: 'Conversation' });

test('shows a streamed reply before held extraction publishes facts', async ({
  page,
  request,
}) => {
  await request.post('/__hold-extraction');
  await send(page, 'Remember Mira');
  await expect(transcript(page)).toContainText('Memory reply');
  await expect(transcript(page)).toContainText('Memory reply complete.');
  await expect(facts(page)).toContainText('No facts yet.');
  await expect(
    page.getByRole('button', { name: 'New conversation' })
  ).toBeDisabled();
  await expect
    .poll(async () => (await (await request.get('/__lifetime')).json()).active)
    .toBe(true);
  await request.post('/__release');
  await expect(facts(page)).toContainText('Mira');
  await expect(page.getByRole('status')).toHaveText('Response complete.');
});

test('recalls and corrects facts in one confirmed thread with distinct physical runs', async ({
  page,
  request,
}) => {
  await send(page, 'Remember Mira');
  await expect(facts(page)).toContainText('Mira');
  await send(page, 'Recall', false);
  await expect(transcript(page)).toContainText('You are Mira and prefer tea.');
  await send(page, 'Correct', false);
  await expect(facts(page)).toContainText('coffee');
  await expect(facts(page)).not.toContainText('tea');
  const proof = await (await request.get('/__requests')).json();
  const streams = proof.filter((entry: { path: string }) =>
    entry.path.endsWith('/runs/stream')
  );
  expect(streams).toHaveLength(3);
  expect(
    new Set(streams.map((entry: { path: string }) => entry.path)).size
  ).toBe(1);
  expect(
    proof.filter((entry: { path: string }) => entry.path === '/api/threads')
  ).toHaveLength(1);
  const reads = proof.filter(
    (entry: { method: string }) => entry.method === 'GET'
  );
  expect(reads).toHaveLength(3);
  expect(new Set(reads.map((entry: { path: string }) => entry.path)).size).toBe(
    3
  );
  expect(
    streams.every(
      (entry: { body: { assistant_id: string; command?: unknown } }) =>
        entry.body.assistant_id === 'memory' && !entry.body.command
    )
  ).toBe(true);
});

test('authoritative replacement removes facts and reset creates an empty new thread', async ({
  page,
  request,
}) => {
  await send(page, 'Remember Mira');
  await expect(facts(page)).toContainText('Mira');
  await send(page, 'Replace', false);
  await expect(facts(page)).toContainText('coffee');
  await expect(facts(page)).not.toContainText('Mira');
  await page.getByRole('button', { name: 'New conversation' }).click();
  await expect(facts(page)).toContainText('No facts yet.');
  await expect(transcript(page)).not.toContainText('Memory reply');
  await send(page, 'Recall', false);
  await expect(transcript(page)).toContainText('No facts remembered.');
  const created = (await (await request.get('/__requests')).json()).filter(
    (entry: { path: string }) => entry.path === '/api/threads'
  );
  expect(created).toHaveLength(2);
  expect(created[0].body.thread_id).not.toBe(created[1].body.thread_id);
});

test('renders reserved and markup keys as literal text', async ({ page }) => {
  await send(page, 'Literal');
  await expect(facts(page)).toContainText('__proto__');
  await expect(facts(page)).toContainText('a.b');
  await expect(facts(page)).toContainText('<script>tea</script>');
  await expect(
    page.locator('script').filter({ hasText: '<script>tea</script>' })
  ).toHaveCount(0);
});

for (const text of ['Malformed', 'Absent']) {
  test(`${text} memory clears previously learned facts`, async ({ page }) => {
    await send(page, 'Remember Mira');
    await expect(facts(page)).toContainText('Mira');
    await send(page, text, false);
    await expect(facts(page)).toContainText('No facts yet.');
    await expect(page.getByRole('status')).toHaveText('Response complete.');
    await send(page, 'Recall', false);
    await expect(transcript(page)).toContainText('No facts remembered.');
    await expect(page.getByRole('status')).toHaveText('Response complete.');
  });
}

test('unexpected pause blocks text and never guesses a resume command', async ({
  page,
  request,
}) => {
  await send(page, 'Pause');
  await expect(page.getByRole('status')).toHaveText(
    'Start a new conversation to continue.'
  );
  await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
  const streams = (await (await request.get('/__requests')).json()).filter(
    (entry: { path: string }) => entry.path.endsWith('/runs/stream')
  );
  expect(streams).toHaveLength(1);
  expect(streams[0].body.command).toBeUndefined();
});

test('duplicate send admits one run and Stop releases held extraction', async ({
  page,
  request,
}) => {
  await request.post('/__hold-extraction');
  await page.goto('/langgraph/memory/react/');
  await page.getByLabel('Message', { exact: true }).fill('Remember Mira');
  await page
    .getByRole('button', { name: 'Send', exact: true })
    .evaluate((element: HTMLButtonElement) => {
      element.click();
      element.click();
    });
  await expect(transcript(page)).toContainText('Memory reply');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Stopped');
  await expect
    .poll(async () => (await (await request.get('/__lifetime')).json()).active)
    .toBe(false);
  await request.post('/__release');
  await expect(facts(page)).toContainText('No facts yet.');
  await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
  expect(
    (await (await request.get('/__requests')).json()).filter(
      (entry: { path: string }) => entry.path.endsWith('/runs/stream')
    )
  ).toHaveLength(1);
});

for (const kind of ['creation', 'run']) {
  test(`uncertain ${kind} fails without replay or leaked details`, async ({
    page,
    request,
  }) => {
    if (kind === 'creation') await request.post('/__fail-create');
    await send(page, kind === 'run' ? 'Error' : 'Remember Mira');
    await expect(page.getByRole('alert')).toHaveText(
      'The LangGraph request failed.'
    );
    await expect(page.locator('body')).not.toContainText('PRIVATE');
    await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
    const proof = await (await request.get('/__requests')).json();
    expect(
      proof.filter((entry: { path: string }) => entry.path === '/api/threads')
    ).toHaveLength(1);
    expect(
      proof.filter((entry: { path: string }) =>
        entry.path.endsWith('/runs/stream')
      )
    ).toHaveLength(kind === 'run' ? 1 : 0);
  });
}

test('pagehide disposes held extraction and fences late facts', async ({
  page,
  request,
}) => {
  await request.post('/__hold-extraction');
  await send(page, 'Remember Mira');
  await expect(transcript(page)).toContainText('Memory reply');
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pagehide'))
  );
  await expect(transcript(page)).toHaveCount(0);
  await expect
    .poll(async () => (await (await request.get('/__lifetime')).json()).active)
    .toBe(false);
  await request.post('/__release');
  await expect(facts(page)).toHaveCount(0);
});

test('long literal facts fit at a mobile width', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await send(page, 'Literal');
  await expect(facts(page)).toContainText('<script>tea</script>');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('memory-mobile.png'),
    fullPage: true,
  });
});

test('uses developer bridge headers while keeping credentials out of the body', async ({
  page,
  request,
}) => {
  await page.goto('http://127.0.0.1:3000/');
  await page.setContent(`<!doctype html><html><body><p id="state">Waiting</p><script>
    addEventListener('message', (event) => {
      const frame = document.getElementById('pilot');
      if (event.origin !== 'http://127.0.0.1:4602' || event.source !== frame.contentWindow) return;
      if (event.data.type === 'tplane:runtime-child-ready') frame.contentWindow.postMessage({
        type: 'tplane:runtime-configure', version: 2, nonce: event.data.nonce, generation: 1,
        target: { kind: 'langsmith', apiUrl: 'http://127.0.0.1:4602/developer-api', apiKey: 'TEST_DEVELOPER_KEY' }
      }, event.origin);
      if (event.data.type === 'tplane:runtime-configured') frame.contentWindow.postMessage({
        type: 'tplane:runtime-check', version: 1, nonce: 'parent-health', capability: 'memory'
      }, event.origin);
      if (event.data.type === 'tplane:runtime-ready' && event.data.nonce === 'parent-health') document.getElementById('state').textContent = 'Ready';
    });</script><iframe id="pilot" title="React pilot" src="http://127.0.0.1:4602/langgraph/memory/react/"></iframe></body></html>`);
  await expect(page.locator('#state')).toHaveText('Ready');
  const frame = page.frameLocator('#pilot');
  await frame.getByLabel('Message', { exact: true }).fill('Remember Mira');
  await frame.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(frame.getByRole('status')).toHaveText('Response complete.');
  const proof = await (await request.get('/__requests')).json();
  expect(
    proof.every(
      (entry: { path: string; key: string }) =>
        entry.path.startsWith('/developer-api/') &&
        entry.key === 'TEST_DEVELOPER_KEY'
    )
  ).toBe(true);
  await expect(frame.locator('body')).not.toContainText('TEST_DEVELOPER_KEY');
});
