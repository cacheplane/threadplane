import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ request }) => {
  await request.post('/__reset');
});
const transcript = (page: Page) =>
  page.getByRole('region', { name: 'Conversation', exact: true });
async function send(page: Page, text: string) {
  await page.getByLabel('Message', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Response complete.');
}
async function two(page: Page) {
  await page.goto('/langgraph/persistence/react/');
  await send(page, 'Remember Avery likes tea');
  await page.getByRole('button', { name: 'New conversation' }).click();
  await expect(page.getByRole('status')).toHaveText('Ready.');
  await send(page, 'Remember Blair likes coffee');
}
type Wire = {
  path: string;
  method: string;
  body: { assistant_id?: string; command?: unknown; thread_id?: string };
  key: string | null;
};

test('loads saved A/B histories and recalls the selected confirmed UUID without a new run on selection', async ({
  page,
  request,
}) => {
  await two(page);
  await page
    .getByRole('button', { name: 'Conversation 1', exact: true })
    .click();
  await expect(page.getByRole('status')).toHaveText('Ready.');
  await expect(transcript(page)).toContainText('Avery likes tea');
  await expect(transcript(page)).not.toContainText('Blair');
  let wire: Wire[] = await (await request.get('/__requests')).json();
  expect(wire.filter((entry) => entry.path.endsWith('/threads'))).toHaveLength(
    2
  );
  expect(
    wire.filter((entry) => entry.path.endsWith('/runs/stream'))
  ).toHaveLength(2);
  const history = wire.filter((entry) => entry.path.endsWith('/history'));
  expect(history).toHaveLength(1);
  expect(history[0].method).toBe('POST');
  await send(page, 'Recall');
  await expect(transcript(page)).toContainText('You are Avery and prefer tea.');
  await page
    .getByRole('button', { name: 'Conversation 2', exact: true })
    .click();
  await expect(page.getByRole('status')).toHaveText('Ready.');
  await expect(transcript(page)).toContainText('Blair likes coffee');
  await expect(transcript(page)).not.toContainText('Avery');
  wire = await (await request.get('/__requests')).json();
  const runs = wire.filter((entry) => entry.path.endsWith('/runs/stream'));
  expect(runs).toHaveLength(3);
  expect(runs[2].path).toBe(runs[0].path);
  expect(
    runs.every(
      (entry) =>
        entry.body.assistant_id === 'persistence' && !entry.body.command
    )
  ).toBe(true);
  expect(wire.filter((entry) => entry.method === 'GET')).toHaveLength(3);
});

test('selection reads changed server history instead of cached rows; selecting the same thread is inert', async ({
  page,
  request,
}) => {
  await two(page);
  await request.post('/__replace-first');
  await page
    .getByRole('button', { name: 'Conversation 1', exact: true })
    .click();
  await expect(page.getByRole('status')).toHaveText('Ready.');
  await expect(transcript(page)).toContainText(
    'Server correction: Avery likes cocoa.'
  );
  await expect(transcript(page)).not.toContainText('likes tea');
  const before = await (await request.get('/__requests')).json();
  await page
    .getByRole('button', { name: 'Conversation 1', exact: true })
    .click();
  expect(await (await request.get('/__requests')).json()).toEqual(before);
});

test('new draft keeps confirmed entries, creates lazily, and reload has an empty page-local list', async ({
  page,
  request,
}) => {
  await two(page);
  await page.getByRole('button', { name: 'New conversation' }).click();
  await expect(page.getByRole('status')).toHaveText('Ready.');
  await expect(transcript(page).locator('article')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Conversation 1', exact: true })
  ).toBeVisible();
  await send(page, 'Recall');
  await expect(transcript(page)).toContainText('No facts remembered.');
  const wire: Wire[] = await (await request.get('/__requests')).json();
  const creates = wire.filter((entry) => entry.path.endsWith('/threads'));
  expect(creates).toHaveLength(3);
  expect(new Set(creates.map((entry) => entry.body.thread_id)).size).toBe(3);
  await page.reload();
  await expect(
    page.getByRole('region', { name: 'Saved conversations' })
  ).toContainText('No saved conversations yet.');
  expect(await (await request.get('/__requests')).json()).toEqual(wire);
});

test('held history blocks competing commands; Stop quarantines only the selected entry', async ({
  page,
  request,
}) => {
  await two(page);
  await request.post('/__hold-history');
  await page
    .getByRole('button', { name: 'Conversation 1', exact: true })
    .click();
  await expect(page.getByRole('status')).toHaveText(
    'Loading saved conversation…'
  );
  await expect(transcript(page).locator('article')).toHaveCount(0);
  await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'New conversation' })
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Conversation 2', exact: true })
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Stopped.');
  await request.post('/__release');
  await expect(
    page.getByRole('button', {
      name: 'Conversation 1 — unavailable',
      exact: true,
    })
  ).toBeDisabled();
  await expect(transcript(page).locator('article')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Conversation 2', exact: true })
    .click();
  await expect(page.getByRole('status')).toHaveText('Ready.');
  await expect(transcript(page)).toContainText('Blair');
  const wire: Wire[] = await (await request.get('/__requests')).json();
  expect(
    wire.filter((entry) => entry.path.endsWith('/runs/stream'))
  ).toHaveLength(2);
});

for (const mode of ['fail', 'pause'])
  test(`${mode} history cannot silently authorize another run`, async ({
    page,
    request,
  }) => {
    await two(page);
    await request.post('/__' + mode + '-history');
    await page
      .getByRole('button', { name: 'Conversation 1', exact: true })
      .click();
    await expect(page.getByRole('status')).toContainText('new conversation');
    await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
    await expect(
      page.getByRole('button', {
        name: 'Conversation 1 — unavailable',
        exact: true,
      })
    ).toBeDisabled();
    if (mode === 'fail')
      await expect(page.getByRole('alert')).toHaveText(
        'The LangGraph request failed.'
      );
    await expect(page.locator('body')).not.toContainText('PRIVATE');
    const wire: Wire[] = await (await request.get('/__requests')).json();
    expect(
      wire.filter((entry) => entry.path.endsWith('/runs/stream'))
    ).toHaveLength(2);
  });

test('pagehide releases a held history read', async ({ page, request }) => {
  await two(page);
  await request.post('/__hold-history');
  await page
    .getByRole('button', { name: 'Conversation 1', exact: true })
    .click();
  await expect(page.getByRole('status')).toHaveText(
    'Loading saved conversation…'
  );
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect
    .poll(async () => (await (await request.get('/__lifetime')).json()).active)
    .toBe(false);
  await request.post('/__release');
  await expect(page.locator('#root')).toBeEmpty();
});

test('an authoritative empty history clears previous rows', async ({
  page,
  request,
}) => {
  await two(page);
  await request.post('/__empty-first');
  await page
    .getByRole('button', { name: 'Conversation 1', exact: true })
    .click();
  await expect(page.getByRole('status')).toHaveText('Ready.');
  await expect(transcript(page).locator('article')).toHaveCount(0);
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
});

for (const kind of ['creation', 'run'])
  test(`${kind} failure is protected and never replayed`, async ({
    page,
    request,
  }) => {
    if (kind === 'creation') await request.post('/__fail-create');
    await page.goto('/langgraph/persistence/react/');
    await page
      .getByLabel('Message', { exact: true })
      .fill(kind === 'run' ? 'Error' : 'Remember Avery');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText(
      'The LangGraph request failed.'
    );
    await expect(page.locator('body')).not.toContainText('PRIVATE');
    await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
    const wire: Wire[] = await (await request.get('/__requests')).json();
    expect(
      wire.filter((entry) => entry.path.endsWith('/threads'))
    ).toHaveLength(1);
    expect(
      wire.filter((entry) => entry.path.endsWith('/runs/stream'))
    ).toHaveLength(kind === 'run' ? 1 : 0);
  });

test('literal messages and the conversation picker fit a mobile viewport', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/langgraph/persistence/react/');
  await send(page, '<script>fictional</script> ' + 'long'.repeat(40));
  await expect(transcript(page)).toContainText('<script>fictional</script>');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('persistence-mobile.png'),
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
      if (event.origin !== 'http://127.0.0.1:4604' || event.source !== frame.contentWindow) return;
      if (event.data.type === 'tplane:runtime-child-ready') frame.contentWindow.postMessage({
        type: 'tplane:runtime-configure', version: 2, nonce: event.data.nonce, generation: 1,
        target: { kind: 'langsmith', apiUrl: 'http://127.0.0.1:4604/developer-api', apiKey: 'TEST_DEVELOPER_KEY' }
      }, event.origin);
      if (event.data.type === 'tplane:runtime-configured') frame.contentWindow.postMessage({
        type: 'tplane:runtime-check', version: 1, nonce: 'parent-health', capability: 'persistence'
      }, event.origin);
      if (event.data.type === 'tplane:runtime-ready' && event.data.nonce === 'parent-health') document.getElementById('state').textContent = 'Ready';
    });</script><iframe id="pilot" title="React pilot" src="http://127.0.0.1:4604/langgraph/persistence/react/"></iframe></body></html>`);
  await expect(page.locator('#state')).toHaveText('Ready');
  const frame = page.frameLocator('#pilot');
  await frame
    .getByLabel('Message', { exact: true })
    .fill('Remember Avery likes tea');
  await frame.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(frame.getByRole('status')).toHaveText('Response complete.');
  await frame.getByRole('button', { name: 'New conversation' }).click();
  await expect(frame.getByRole('status')).toHaveText('Ready.');
  await frame
    .getByLabel('Message', { exact: true })
    .fill('Remember Blair likes coffee');
  await frame.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(frame.getByRole('status')).toHaveText('Response complete.');
  await frame
    .getByRole('button', { name: 'Conversation 1', exact: true })
    .click();
  await expect(frame.getByRole('status')).toHaveText('Ready.');
  const proof = await (await request.get('/__requests')).json();
  expect(
    proof.filter((entry: { path: string }) => entry.path.endsWith('/history'))
  ).toHaveLength(1);
  expect(
    proof.every(
      (entry: { path: string; key: string }) =>
        entry.path.startsWith('/developer-api/') &&
        entry.key === 'TEST_DEVELOPER_KEY'
    )
  ).toBe(true);
  await expect(frame.locator('body')).not.toContainText('TEST_DEVELOPER_KEY');
});
