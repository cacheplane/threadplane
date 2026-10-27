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
type Wire = {
  path: string;
  method: string;
  body: {
    checkpoint?: { checkpoint_id: string };
    stream_mode?: string[];
    input?: { messages: { id: string; content: string }[] };
  };
  key: string | null;
};

test('fork adopts A rather than B and retained continuation ignores a competing latest tip', async ({
  page,
  request,
}) => {
  await page.goto('/langgraph/time-travel/react/');
  await send(page, 'A');
  await send(page, 'B');
  await page.getByRole('button', { name: 'Refresh saved checkpoints' }).click();
  await expect(
    page.getByRole('button', { name: 'Select checkpoint 3' })
  ).toBeVisible();
  const before: Wire[] = await (await request.get('/__requests')).json();
  await page.getByRole('button', { name: 'Select checkpoint 3' }).click();
  expect(await (await request.get('/__requests')).json()).toEqual(before);
  await expect(transcript(page)).toContainText('Answer to B');
  await page.getByLabel('Message', { exact: true }).fill('C');
  await page.getByRole('button', { name: 'Fork selected checkpoint' }).click();
  await expect(page.getByRole('status')).toHaveText('Response complete.');
  await expect(transcript(page).getByRole('article')).toHaveCount(4);
  await expect(transcript(page)).toContainText('Answer to A');
  await expect(transcript(page)).toContainText('Answer to C');
  await expect(transcript(page)).not.toContainText('Answer to B');
  await expect(transcript(page)).not.toContainText('Transient chunk');
  await request.post('/__advance-tip');
  await send(page, 'D');
  await expect(transcript(page).getByRole('article')).toHaveCount(6);
  await expect(transcript(page)).toContainText('Answer to C');
  await expect(transcript(page)).toContainText('Answer to D');
  await expect(transcript(page)).not.toContainText('Competing tip');
  const wire: Wire[] = await (await request.get('/__requests')).json();
  const runs = wire.filter((row) => row.path.endsWith('/runs/stream'));
  expect(runs).toHaveLength(4);
  expect(runs[2].body.checkpoint?.checkpoint_id).toBe('checkpoint-1');
  expect(runs[3].body.checkpoint?.checkpoint_id).toBe('checkpoint-3');
  expect(runs[2].body.stream_mode).toContain('checkpoints');
  expect(new Set(runs.map((row) => row.path)).size).toBe(1);
  expect(wire.filter((row) => row.path.endsWith('/threads'))).toHaveLength(1);
  expect(wire.filter((row) => row.path.endsWith('/history'))).toHaveLength(1);
  const reads = wire.filter((row) => row.path.endsWith('/state/checkpoint'));
  expect(reads.map((row) => row.body.checkpoint?.checkpoint_id)).toEqual([
    'checkpoint-1',
    'checkpoint-3',
    'checkpoint-4',
  ]);
  const states = await (await request.get('/__states')).json();
  expect(
    states
      .find(
        (state: { checkpoint: { checkpoint_id: string } }) =>
          state.checkpoint.checkpoint_id === 'checkpoint-2'
      )
      .values.messages.map((message: { content: string }) => message.content)
  ).toEqual(['A', 'Answer to A', 'B', 'Answer to B']);
});

async function prepareFork(page: Page) {
  await page.goto('/langgraph/time-travel/react/');
  await send(page, 'A');
  await send(page, 'B');
  await page.getByRole('button', { name: 'Refresh saved checkpoints' }).click();
  await page.getByRole('button', { name: 'Select checkpoint 3' }).click();
}
async function fork(page: Page, text = 'C') {
  await page.getByLabel('Message', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Fork selected checkpoint' }).click();
}

test('explicit secondary history refresh after a fork cannot redirect primary execution', async ({
  page,
  request,
}) => {
  await prepareFork(page);
  await fork(page);
  await expect(page.getByRole('status')).toHaveText('Response complete.');
  await request.post('/__advance-tip');
  await page.getByRole('button', { name: 'Refresh saved checkpoints' }).click();
  await expect(
    page.getByRole('button', { name: 'Refresh saved checkpoints' })
  ).toBeEnabled();
  await expect(transcript(page)).not.toContainText('Competing tip');
  await send(page, 'D');
  const wire: Wire[] = await (await request.get('/__requests')).json();
  const runs = wire.filter((row) => row.path.endsWith('/runs/stream'));
  expect(runs.at(-1)?.body.checkpoint?.checkpoint_id).toBe('checkpoint-3');
  expect(wire.filter((row) => row.path.endsWith('/history'))).toHaveLength(2);
  await expect(transcript(page)).not.toContainText('Answer to B');
  await expect(transcript(page).getByRole('article')).toHaveCount(6);
});

test('duplicate, child, pending and malformed history references never receive Select authority', async ({
  page,
  request,
}) => {
  await page.goto('/langgraph/time-travel/react/');
  await send(page, 'A');
  await request.post('/__bad-history');
  await page.getByRole('button', { name: 'Refresh saved checkpoints' }).click();
  await expect(
    page.getByRole('region', { name: 'Last loaded checkpoint page' })
  ).toContainText('Duplicate checkpoint identity.');
  await expect(
    page.getByRole('button', { name: /^Select checkpoint/ })
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Fork selected checkpoint' })
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Refresh saved checkpoints' })
  ).toBeEnabled();
  const wire: Wire[] = await (await request.get('/__requests')).json();
  expect(wire.filter((row) => row.path.endsWith('/runs/stream'))).toHaveLength(
    1
  );
  expect(
    wire.filter((row) => row.path.endsWith('/state/checkpoint'))
  ).toHaveLength(0);
});

test('metadata eligibility does not replace mandatory completed-source preflight', async ({
  page,
  request,
}) => {
  await prepareFork(page);
  await request.post('/__unsafe-source');
  await fork(page);
  await expect(page.getByRole('status')).toHaveText(
    'Start a new conversation to continue.'
  );
  const wire: Wire[] = await (await request.get('/__requests')).json();
  expect(wire.filter((row) => row.path.endsWith('/runs/stream'))).toHaveLength(
    2
  );
  expect(
    wire.filter((row) => row.path.endsWith('/state/checkpoint'))
  ).toHaveLength(1);
  await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
});

test('Stop during exact source preparation issues no fork POST and New creates only on Send', async ({
  page,
  request,
}) => {
  await prepareFork(page);
  await request.post('/__hold-state');
  await fork(page);
  await expect
    .poll(async () => (await (await request.get('/__lifetime')).json()).active)
    .toBe(true);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect
    .poll(async () => (await (await request.get('/__lifetime')).json()).active)
    .toBe(false);
  await request.post('/__release');
  let wire: Wire[] = await (await request.get('/__requests')).json();
  expect(wire.filter((row) => row.path.endsWith('/runs/stream'))).toHaveLength(
    2
  );
  await page.getByRole('button', { name: 'New conversation' }).click();
  await expect(page.getByRole('status')).toHaveText('Ready.');
  await expect(transcript(page).getByRole('article')).toHaveCount(0);
  wire = await (await request.get('/__requests')).json();
  expect(wire.filter((row) => row.path.endsWith('/threads'))).toHaveLength(1);
  await send(page, 'New');
  wire = await (await request.get('/__requests')).json();
  const runs = wire.filter((row) => row.path.endsWith('/runs/stream'));
  expect(runs).toHaveLength(3);
  expect(runs[2].path).not.toBe(runs[0].path);
  expect(wire.filter((row) => row.path.endsWith('/threads'))).toHaveLength(2);
});

test('page exit revokes a held fork stream without replaying it', async ({
  page,
  request,
}) => {
  await prepareFork(page);
  await request.post('/__hold-stream');
  await fork(page);
  await expect(transcript(page)).toContainText('Transient chunk');
  await page.goto('about:blank');
  await expect
    .poll(async () => (await (await request.get('/__lifetime')).json()).active)
    .toBe(false);
  await request.post('/__release');
  const wire: Wire[] = await (await request.get('/__requests')).json();
  expect(wire.filter((row) => row.path.endsWith('/runs/stream'))).toHaveLength(
    3
  );
});

test('failed readonly history is protected and safe primary can continue', async ({
  page,
  request,
}) => {
  await page.goto('/langgraph/time-travel/react/');
  await send(page, 'A');
  await request.post('/__fail-history');
  await page.getByRole('button', { name: 'Refresh saved checkpoints' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'The checkpoint page was not refreshed.'
  );
  await expect(page.getByRole('status')).toHaveText('Response complete.');
  await send(page, 'B');
  const wire: Wire[] = await (await request.get('/__requests')).json();
  expect(wire.filter((row) => row.path.endsWith('/runs/stream'))).toHaveLength(
    2
  );
  expect(wire.filter((row) => row.path.endsWith('/history'))).toHaveLength(1);
});

test('Stop of a held history read releases the secondary session and blocks late publication', async ({
  page,
  request,
}) => {
  await page.goto('/langgraph/time-travel/react/');
  await send(page, 'A');
  await request.post('/__hold-history');
  await page.getByRole('button', { name: 'Refresh saved checkpoints' }).click();
  await expect
    .poll(async () => (await (await request.get('/__lifetime')).json()).active)
    .toBe(true);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect
    .poll(async () => (await (await request.get('/__lifetime')).json()).active)
    .toBe(false);
  await request.post('/__release');
  await expect(
    page.getByRole('button', { name: /^Select checkpoint/ })
  ).toHaveCount(0);
  await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
  const wire: Wire[] = await (await request.get('/__requests')).json();
  expect(wire.filter((row) => row.path.endsWith('/runs/stream'))).toHaveLength(
    1
  );
  expect(wire.filter((row) => row.path.endsWith('/history'))).toHaveLength(1);
});

for (const text of [
  'Truncated history',
  'Missing marker',
  'Stale marker',
  'Equal marker',
  'Unknown tool',
]) {
  test(`unconfirmed ${text} result blocks commands without replay`, async ({
    page,
    request,
  }) => {
    await prepareFork(page);
    await fork(page, text);
    await expect(page.getByRole('status')).toHaveText(
      'Start a new conversation to continue.'
    );
    await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
    const wire: Wire[] = await (await request.get('/__requests')).json();
    expect(
      wire.filter((row) => row.path.endsWith('/runs/stream'))
    ).toHaveLength(3);
    expect(wire.filter((row) => row.path.endsWith('/threads'))).toHaveLength(1);
  });
}

test('ambiguous creation is protected without a second request', async ({
  page,
  request,
}) => {
  await request.post('/__fail-create');
  await page.goto('/langgraph/time-travel/react/');
  await page.getByLabel('Message', { exact: true }).fill('A');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText(
    'Start a new conversation to continue.'
  );
  const wire: Wire[] = await (await request.get('/__requests')).json();
  expect(wire.filter((row) => row.path.endsWith('/threads'))).toHaveLength(1);
  expect(wire.filter((row) => row.path.endsWith('/runs/stream'))).toHaveLength(
    0
  );
  await expect(page.getByRole('alert')).not.toContainText('PRIVATE');
});

test('literal content and checkpoint controls fit a 390px viewport', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/langgraph/time-travel/react/');
  await send(page, 'Literal');
  await page.getByRole('button', { name: 'Refresh saved checkpoints' }).click();
  await expect(
    page.getByRole('button', { name: 'Select checkpoint 1' })
  ).toBeVisible();
  await expect(transcript(page)).toContainText(
    '<script>literal answer</script>'
  );
  await expect(page.locator('main script')).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('time-travel-mobile.png'),
    fullPage: true,
  });
});

test('developer credentials remain SDK headers for creation, stream and status', async ({
  page,
  request,
}) => {
  await page.goto('http://127.0.0.1:3000/');
  await page.setContent(`<!doctype html><html><body><p id="state">Waiting</p><script>
    addEventListener('message', (event) => {
      const frame = document.getElementById('pilot');
      if (event.origin !== 'http://127.0.0.1:4607' || event.source !== frame.contentWindow) return;
      if (event.data.type === 'tplane:runtime-child-ready') frame.contentWindow.postMessage({
        type: 'tplane:runtime-configure', version: 2, nonce: event.data.nonce, generation: 1,
        target: { kind: 'langsmith', apiUrl: 'http://127.0.0.1:4607/developer-api', apiKey: 'TEST_DEVELOPER_KEY' }
      }, event.origin);
      if (event.data.type === 'tplane:runtime-configured') frame.contentWindow.postMessage({
        type: 'tplane:runtime-check', version: 1, nonce: 'parent-health', capability: 'time-travel'
      }, event.origin);
      if (event.data.type === 'tplane:runtime-ready' && event.data.nonce === 'parent-health') document.getElementById('state').textContent = 'Ready';
    });</script><iframe id="pilot" title="React pilot" src="http://127.0.0.1:4607/langgraph/time-travel/react/"></iframe></body></html>`);
  await expect(page.locator('#state')).toHaveText('Ready');
  const frame = page.frameLocator('#pilot');
  await frame.getByLabel('Message', { exact: true }).fill('A');
  await frame.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(frame.getByRole('status')).toHaveText('Response complete.');
  await frame
    .getByRole('button', { name: 'Refresh saved checkpoints' })
    .click();
  await frame.getByRole('button', { name: 'Select checkpoint 1' }).click();
  await frame.getByLabel('Message', { exact: true }).fill('C');
  await frame.getByRole('button', { name: 'Fork selected checkpoint' }).click();
  await expect(frame.getByRole('status')).toHaveText('Response complete.');
  const entries: Wire[] = await (await request.get('/__requests')).json();
  expect(
    entries.every(
      (entry) =>
        entry.path.startsWith('/developer-api/') &&
        entry.key === 'TEST_DEVELOPER_KEY'
    )
  ).toBe(true);
  expect(entries.filter((entry) => entry.method === 'GET')).toHaveLength(2);
  expect(
    entries.filter((entry) => entry.path.endsWith('/history'))
  ).toHaveLength(1);
  expect(
    entries.filter((entry) => entry.path.endsWith('/state/checkpoint'))
  ).toHaveLength(2);
  expect(JSON.stringify(entries.map((entry) => entry.body))).not.toContain(
    'TEST_DEVELOPER_KEY'
  );
  await expect(frame.locator('body')).not.toContainText('TEST_DEVELOPER_KEY');
});

test('full checkpoint maps survive exact source reads, fork POST and retained continuation', async ({
  page,
  request,
}) => {
  await request.post('/__mapped-checkpoints');
  await prepareFork(page);
  await fork(page);
  await expect(page.getByRole('status')).toHaveText('Response complete.');
  await send(page, 'D');
  const entries: Wire[] = await (await request.get('/__requests')).json();
  const runs = entries.filter((row) => row.path.endsWith('/runs/stream'));
  expect(runs[2].body.checkpoint).toMatchObject({
    checkpoint_ns: '',
    checkpoint_id: 'checkpoint-1',
    checkpoint_map: { '': 'checkpoint-1', child: 'literal-map-value' },
  });
  expect(runs[3].body.checkpoint).toMatchObject({
    checkpoint_ns: '',
    checkpoint_id: 'checkpoint-3',
    checkpoint_map: { '': 'checkpoint-3', child: 'literal-map-value' },
  });
  const reads = entries.filter((row) => row.path.endsWith('/state/checkpoint'));
  expect(reads[0].body.checkpoint).toEqual(runs[2].body.checkpoint);
  expect(reads[1].body.checkpoint).toEqual(runs[3].body.checkpoint);
});
