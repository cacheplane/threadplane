import { test, expect, type Page } from '@playwright/test';
type Wire = {
  path: string;
  method: string;
  body: {
    assistant_id?: string;
    command?: { resume?: unknown };
    input?: { messages: { content: string }[] };
  };
  key: string | null;
};
const base = '/chat/interrupts/react/';
const conversation = (page: Page) =>
  page.getByRole('region', { name: 'Conversation', exact: true });
async function submit(page: Page, text: string) {
  await page.getByLabel('Message', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}
async function pause(page: Page, text = 'Book padded flight.') {
  await submit(page, text);
  await expect(
    page.getByRole('button', { name: 'Confirm', exact: true })
  ).toBeEnabled();
}
async function saved(page: Page) {
  await expect(page.getByRole('status')).toHaveText('Response saved.');
}
async function blocked(page: Page) {
  await expect(page.getByRole('status')).toHaveText(
    'Start a new conversation to continue.'
  );
  await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Confirm', exact: true })
  ).toHaveCount(0);
}
test.beforeEach(async ({ request }) => {
  await request.post('/__reset');
});
test('installed SDK confirms then cancels real saved pauses on one conversation', async ({
  page,
  request,
}, testInfo) => {
  await page.goto(base);
  await expect(page.getByRole('status')).toHaveText('Ready.');
  expect(await (await request.get('/__requests')).json()).toEqual([]);
  await pause(page);
  await expect(page.getByText('Boeing 787', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
  await page.screenshot({
    path: testInfo.outputPath('approval-desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('approval-mobile.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await saved(page);
  await pause(page, 'Book AA404.');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await saved(page);
  await page.screenshot({
    path: testInfo.outputPath('terminal-desktop.png'),
    fullPage: true,
  });
  const wire: Wire[] = await (await request.get('/__requests')).json();
  const runs = wire.filter((item) => item.path.endsWith('/runs/stream'));
  expect(wire.filter((item) => item.path.endsWith('/threads'))).toHaveLength(1);
  expect(runs).toHaveLength(4);
  expect(new Set(runs.map((item) => item.path)).size).toBe(1);
  expect(runs.map((item) => item.body.command?.resume)).toEqual([
    undefined,
    'confirm',
    undefined,
    'cancel',
  ]);
  expect(runs.every((item) => item.body.assistant_id === 'c-interrupts')).toBe(
    true
  );
  expect(wire.filter((item) => item.path.endsWith('/history'))).toHaveLength(4);
  expect(wire.filter((item) => item.method === 'GET')).toHaveLength(4);
  await expect(conversation(page)).not.toContainText(
    'Authored aviation conversation'
  );
  const proofs = await (await request.get('/__graph-proof')).json();
  expect(proofs).toHaveLength(4);
  for (const proof of proofs)
    expect(proof).toMatchObject({
      actualCompiledGraph: true,
      networkConnectAttempts: 0,
      titleMessageCallbacks: 0,
    });
});
test('direct answers and causally completed read tools precede a saved approval', async ({
  page,
  request,
}) => {
  await page.goto(base);
  await submit(page, 'Explain aviation');
  await saved(page);
  await expect(conversation(page).locator('pre code')).toHaveText(
    'const approved = true;'
  );
  await pause(page, 'Read then book UA123.');
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await saved(page);
  const wire: Wire[] = await (await request.get('/__requests')).json();
  expect(wire.filter((item) => item.path.endsWith('/threads'))).toHaveLength(1);
  expect(
    wire.filter((item) => item.path.endsWith('/runs/stream'))
  ).toHaveLength(3);
});
test('an unknown demo flight resolves without inventing approval authority', async ({
  page,
}) => {
  await page.goto(base);
  await submit(page, 'Book unknown flight.');
  await saved(page);
  await expect(
    page.getByRole('button', { name: 'Confirm', exact: true })
  ).toHaveCount(0);
});
test('two real pending booking calls with one visible interrupt are blocked', async ({
  page,
  request,
}) => {
  await page.goto(base);
  await submit(page, 'Book multiple flights.');
  await blocked(page);
  const wire: Wire[] = await (await request.get('/__requests')).json();
  expect(wire.filter((item) => item.body.command)).toHaveLength(0);
});
for (const mode of [
  'changed',
  'missing',
  'pending',
  'failed',
  'mismatch',
  'unsupported',
]) {
  test(`rejects ${mode} saved pause evidence without replay`, async ({
    page,
    request,
  }) => {
    await request.post(`/__history/${mode}`);
    await page.goto(base);
    await submit(page, 'Book UA123.');
    await blocked(page);
    const wire: Wire[] = await (await request.get('/__requests')).json();
    expect(
      wire.filter((item) => item.path.endsWith('/runs/stream'))
    ).toHaveLength(1);
    expect(wire.filter((item) => item.body.command)).toHaveLength(0);
  });
}
test('held saved pause disables commands and cannot regain authority after Stop', async ({
  page,
  request,
}) => {
  await request.post('/__history/hold');
  await page.goto(base);
  await submit(page, 'Book UA123.');
  await expect(page.getByRole('status')).toHaveText(
    'Confirming saved conversation…'
  );
  await expect(
    page.getByRole('button', { name: 'Confirm', exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'New conversation' })
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await blocked(page);
  await request.post('/__release-history');
  await blocked(page);
});
test('held resume admits one decision and Stop fences late completion', async ({
  page,
  request,
}) => {
  await page.goto(base);
  await pause(page);
  await request.post('/__hold-resume');
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Confirm', exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Stop', exact: true })
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await blocked(page);
  await request.post('/__release');
  const wire: Wire[] = await (await request.get('/__requests')).json();
  expect(wire.filter((item) => item.body.command)).toHaveLength(1);
  expect(wire.filter((item) => item.path.endsWith('/history'))).toHaveLength(1);
});
test('failed resume is never retried and New only resets local state', async ({
  page,
  request,
}) => {
  await page.goto(base);
  await pause(page);
  await request.post('/__fail-resume');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await blocked(page);
  const wire: Wire[] = await (await request.get('/__requests')).json();
  expect(wire.filter((item) => item.body.command)).toHaveLength(1);
  await page.getByRole('button', { name: 'New conversation' }).click();
  await expect(page.getByRole('status')).toHaveText('Ready.');
  expect(await (await request.get('/__requests')).json()).toEqual(wire);
  await submit(page, 'Explain aviation');
  await saved(page);
  const next: Wire[] = await (await request.get('/__requests')).json();
  expect(next.filter((item) => item.path.endsWith('/threads'))).toHaveLength(2);
});
test('failed creation creates no session and cannot replay without explicit New', async ({
  page,
  request,
}) => {
  await request.post('/__fail-create');
  await page.goto(base);
  await submit(page, 'Book UA123.');
  await blocked(page);
  const wire: Wire[] = await (await request.get('/__requests')).json();
  expect(wire).toHaveLength(1);
  expect(wire[0].path).toBe('/api/threads');
});
test('metadata failure cannot corrupt the real graph wire or expose a title response', async ({
  page,
  request,
}) => {
  await request.post('/__metadata-failure');
  await page.goto(base);
  await pause(page);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await saved(page);
  await expect(conversation(page)).not.toContainText('Authored metadata');
});
test('authored developer connection routes only to its configured target', async ({
  page,
  request,
}) => {
  await page.goto('http://127.0.0.1:3000/');
  await page.setContent(`<!doctype html><html><body><p id="state">Waiting</p><script>
    addEventListener('message', event => {
      const frame = document.getElementById('pilot');
      if (event.origin !== 'http://127.0.0.1:4622' || event.source !== frame.contentWindow) return;
      if (event.data.type === 'tplane:runtime-child-ready') frame.contentWindow.postMessage({
        type: 'tplane:runtime-configure', version: 2, nonce: event.data.nonce, generation: 1,
        target: {kind: 'langsmith', apiUrl: 'http://127.0.0.1:4622/developer-api', apiKey: 'TEST_DEVELOPER_KEY'}
      }, event.origin);
      if (event.data.type === 'tplane:runtime-configured') frame.contentWindow.postMessage({
        type: 'tplane:runtime-check', version: 1, nonce: 'parent-health', capability: 'interrupts'
      }, event.origin);
      if (event.data.type === 'tplane:runtime-ready' && event.data.nonce === 'parent-health') document.getElementById('state').textContent = 'Ready';
    });</script><iframe id="pilot" title="Chat Interrupts React" src="http://127.0.0.1:4622/chat/interrupts/react/"></iframe></body></html>`);
  await expect(page.locator('#state')).toHaveText('Ready');
  const frame = page.frameLocator('#pilot');
  await frame.getByLabel('Message', { exact: true }).fill('Book UA123.');
  await frame.getByRole('button', { name: 'Send', exact: true }).click();
  await frame.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(frame.getByRole('status')).toHaveText('Response saved.');
  const wire: Wire[] = await (await request.get('/__requests')).json();
  expect(wire).toHaveLength(7);
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

for (const finish of ['release', 'stop']) {
  test(`held terminal history blocks continuation until ${finish}`, async ({
    page,
    request,
  }) => {
    await page.goto(base);
    await pause(page);
    await request.post('/__history/hold');
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText(
      'Confirming saved conversation…'
    );
    await expect(
      page.getByRole('button', { name: 'Send', exact: true })
    ).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'New conversation' })
    ).toBeDisabled();
    if (finish === 'stop') {
      await page.getByRole('button', { name: 'Stop', exact: true }).click();
      await blocked(page);
    }
    await request.post('/__release-history');
    if (finish === 'release') await saved(page);
    else await blocked(page);
    const wire: Wire[] = await (await request.get('/__requests')).json();
    expect(wire.filter((item) => item.path.endsWith('/history'))).toHaveLength(
      2
    );
    expect(wire.filter((item) => item.body.command)).toHaveLength(1);
  });
}
test('Stop during held initial streaming cannot expose a late approval', async ({
  page,
  request,
}) => {
  await request.post('/__hold-stream');
  await page.goto(base);
  await submit(page, 'Book UA123.');
  await expect
    .poll(
      async () => (await (await request.get('/__lifetime')).json()).activeStream
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await blocked(page);
  await request.post('/__release');
  await blocked(page);
  const wire: Wire[] = await (await request.get('/__requests')).json();
  expect(wire.filter((item) => item.path.endsWith('/history'))).toHaveLength(0);
  expect(
    wire.filter((item) => item.path.endsWith('/runs/stream'))
  ).toHaveLength(1);
});
