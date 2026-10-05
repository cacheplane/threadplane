import { test, expect, type Page } from '@playwright/test';
type Wire = {
  path: string;
  method: string;
  body: {
    assistant_id?: string;
    thread_id?: string;
    command?: unknown;
    input?: { messages: { type: string; content: string }[] };
  };
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
  await page.goto('/chat/input/react/');
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
    runs.every((r) => r.body.assistant_id === 'c-input' && !r.body.command)
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
  await page.goto('/chat/input/react/');
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
  await page.goto('/chat/input/react/');
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
  await page.goto('/chat/input/react/');
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
  await page.goto('/chat/input/react/');
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
  await page.goto('/chat/input/react/');
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
    await page.goto('/chat/input/react/');
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
  await page.goto('/chat/input/react/');
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
      if (event.origin !== 'http://127.0.0.1:4621' || event.source !== frame.contentWindow) return;
      if (event.data.type === 'tplane:runtime-child-ready') frame.contentWindow.postMessage({
        type: 'tplane:runtime-configure', version: 2, nonce: event.data.nonce, generation: 1,
        target: {kind: 'langsmith', apiUrl: 'http://127.0.0.1:4621/developer-api', apiKey: 'TEST_DEVELOPER_KEY'}
      }, event.origin);
      if (event.data.type === 'tplane:runtime-configured') frame.contentWindow.postMessage({
        type: 'tplane:runtime-check', version: 1, nonce: 'parent-health', capability: 'messages'
      }, event.origin);
      if (event.data.type === 'tplane:runtime-ready' && event.data.nonce === 'parent-health') document.getElementById('state').textContent = 'Ready';
    });</script><iframe id="pilot" title="Chat Input React" src="http://127.0.0.1:4621/chat/input/react/"></iframe></body></html>`);
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

test('default Enter submits the exact raw draft once', async ({
  page,
  request,
}) => {
  await page.goto('/chat/input/react/');
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  const raw = '  Authored input with spaces  ';
  await input.fill(raw);
  await input.press('Enter');
  await expect(page.getByRole('status')).toHaveText('Response saved.');
  await expect(input).toHaveValue('');
  const wire: Wire[] = await (await request.get('/__requests')).json();
  const runs = wire.filter((r) => r.path.endsWith('/runs/stream'));
  expect(runs).toHaveLength(1);
  expect(runs[0].body.input?.messages).toMatchObject([
    { type: 'human', content: raw },
  ]);
});

test('Shift+Enter and alternate Enter mode preserve raw multiline text through Ctrl and Command submission', async ({
  page,
  request,
}) => {
  await page.goto('/chat/input/react/');
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  await input.fill('  first');
  await input.press('Shift+Enter');
  await input.pressSequentially('second  ');
  await expect(input).toHaveValue('  first\nsecond  ');
  expect(await (await request.get('/__requests')).json()).toEqual([]);
  await input.press('Enter');
  await expect(page.getByRole('status')).toHaveText('Response saved.');
  await page.getByRole('checkbox', { name: 'Enter sends a message' }).uncheck();
  await input.fill('third');
  await input.press('Enter');
  await input.pressSequentially('fourth');
  await expect(input).toHaveValue('third\nfourth');
  let wire: Wire[] = await (await request.get('/__requests')).json();
  expect(wire.filter((r) => r.path.endsWith('/runs/stream'))).toHaveLength(1);
  await input.press('Control+Enter');
  await expect(page.getByRole('status')).toHaveText('Response saved.');
  await input.fill('  Command draft  ');
  await input.press('Meta+Enter');
  await expect(page.getByRole('status')).toHaveText('Response saved.');
  wire = await (await request.get('/__requests')).json();
  expect(
    wire
      .filter((r) => r.path.endsWith('/runs/stream'))
      .map((r) => r.body.input?.messages[0].content)
  ).toEqual(['  first\nsecond  ', 'third\nfourth', '  Command draft  ']);
  expect(wire.filter((r) => r.path.endsWith('/threads'))).toHaveLength(1);
  await expect(conversation(page).locator('article')).toHaveCount(6);
});

test('whitespace and each native IME guard produce no requests or draft clearing', async ({
  page,
  request,
}) => {
  await page.goto('/chat/input/react/');
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  await input.fill(' \n  ');
  await input.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Send', exact: true })
  ).toBeDisabled();
  await input.fill('こんにちは');
  await input.dispatchEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    isComposing: true,
  });
  await input.dispatchEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    ctrlKey: true,
    isComposing: true,
  });
  await expect(input).toHaveValue('こんにちは');
  expect(await (await request.get('/__requests')).json()).toEqual([]);
  await input.dispatchEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    keyCode: 229,
  });
  await input.dispatchEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    metaKey: true,
    keyCode: 229,
  });
  await expect(input).toHaveValue('こんにちは');
  expect(await (await request.get('/__requests')).json()).toEqual([]);
});

for (const phase of ['stream', 'history'] as const) {
  test(`a newer controlled draft survives held ${phase} completion with no duplicate submission`, async ({
    page,
    request,
  }) => {
    if (phase === 'history') await request.post('/__history/hold');
    await page.goto('/chat/input/react/');
    await submit(page, phase === 'stream' ? 'Hold' : 'Confirm this turn');
    await expect(page.getByRole('status')).toHaveText(
      phase === 'stream' ? 'Receiving response…' : 'Confirming saved response…'
    );
    const input = page.getByRole('textbox', { name: 'Message', exact: true });
    await expect(input).toBeEnabled();
    await input.fill('  My next draft\nkeep the spaces  ');
    await input.press('Enter');
    await input.press('Control+Enter');
    await expect(
      page.getByRole('button', { name: 'Send', exact: true })
    ).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'New conversation' })
    ).toBeDisabled();
    await page
      .getByRole('textbox', { name: 'Custom placeholder' })
      .fill('Next question…');
    await page
      .getByRole('checkbox', { name: 'Enter sends a message' })
      .uncheck();
    await request.post(
      phase === 'stream' ? '/__release' : '/__release-history'
    );
    await expect(page.getByRole('status')).toHaveText('Response saved.');
    await expect(input).toHaveValue('  My next draft\nkeep the spaces  ');
    await expect(input).toHaveAttribute('placeholder', 'Next question…');
    await expect(
      page.getByRole('checkbox', { name: 'Enter sends a message' })
    ).not.toBeChecked();
    const wire: Wire[] = await (await request.get('/__requests')).json();
    expect(wire.filter((r) => r.path.endsWith('/threads'))).toHaveLength(1);
    expect(wire.filter((r) => r.path.endsWith('/runs/stream'))).toHaveLength(1);
    expect(wire.filter((r) => r.path.endsWith('/history'))).toHaveLength(1);
  });
}

test('local disabling blocks Send but preserves Stop during an active response', async ({
  page,
  request,
}) => {
  await page.goto('/chat/input/react/');
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  const disabled = page.getByRole('checkbox', {
    name: 'Disable message input',
  });
  await input.fill('Hold');
  await disabled.check();
  await expect(input).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Send', exact: true })
  ).toBeDisabled();
  expect(await (await request.get('/__requests')).json()).toEqual([]);
  await disabled.uncheck();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Receiving response…');
  await input.fill('Keep this draft after Stop');
  await disabled.check();
  await expect(input).toBeDisabled();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText(
    'Stopped. Start a new conversation to continue.'
  );
  await request.post('/__release');
  await disabled.uncheck();
  await expect(input).toBeDisabled();
  await expect(input).toHaveValue('Keep this draft after Stop');
  const before: Wire[] = await (await request.get('/__requests')).json();
  expect(before.filter((r) => r.path.endsWith('/runs/stream'))).toHaveLength(1);
  await page.getByRole('button', { name: 'New conversation' }).click();
  await expect(page.getByRole('status')).toHaveText('Ready.');
  await expect(input).toBeEnabled();
  await expect(input).toHaveValue('');
  expect(await (await request.get('/__requests')).json()).toEqual(before);
});

test('reset clears the unsent controlled draft while preserving settings and doing no remote work', async ({
  page,
  request,
}) => {
  await page.goto('/chat/input/react/');
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  await page
    .getByRole('textbox', { name: 'Custom placeholder' })
    .fill('Custom question…');
  await page.getByRole('checkbox', { name: 'Enter sends a message' }).uncheck();
  await input.fill('Unsent draft');
  await page.getByRole('button', { name: 'New conversation' }).click();
  await expect(page.getByRole('status')).toHaveText('Ready.');
  await expect(input).toHaveValue('');
  await expect(input).toHaveAttribute('placeholder', 'Custom question…');
  await expect(
    page.getByRole('checkbox', { name: 'Enter sends a message' })
  ).not.toBeChecked();
  expect(await (await request.get('/__requests')).json()).toEqual([]);
});
