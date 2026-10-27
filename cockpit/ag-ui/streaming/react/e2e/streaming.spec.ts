import { test, expect, type Page } from '@playwright/test';
test.beforeEach(async ({ request }) => {
  await request.post('/__reset');
});
const conversation = (page: Page) =>
  page.getByRole('region', { name: 'Conversation', exact: true });
async function send(page: Page, text: string) {
  await page.getByLabel('Message', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}
type Wire = {
  path: string;
  method: string;
  body: {
    threadId: string;
    runId: string;
    protocolVersion: string;
    messages: { id: string; role: string; content: string }[];
    tools: unknown[];
    context: unknown[];
    state: unknown;
    forwardedProps: unknown;
  };
};
test('installed AG-UI client sends full native history on one lazy UUID and New creates a fresh conversation', async ({
  page,
  request,
}) => {
  await page.goto('/ag-ui/streaming/react/');
  expect(await (await request.get('/__requests')).json()).toEqual([]);
  await send(page, 'Alpha');
  await expect(page.getByRole('status')).toHaveText('Response complete.');
  await expect(conversation(page).locator('li')).toHaveCount(2);
  await send(page, 'Beta');
  await expect(page.getByRole('status')).toHaveText('Response complete.');
  await expect(conversation(page).locator('li')).toHaveCount(4);
  const before: Wire[] = await (await request.get('/__requests')).json();
  expect(before).toHaveLength(2);
  for (const entry of before) {
    expect(entry.path).toBe('/ag-ui/streaming/agent');
    expect(entry.method).toBe('POST');
    expect(entry.body.protocolVersion).toBe('1.0');
    expect(entry.body.tools).toEqual([]);
    expect(entry.body.context).toEqual([]);
    expect(entry.body.state).toEqual({});
    expect(entry.body.forwardedProps).toEqual({});
  }
  expect(before[0].body.messages.map((x) => [x.role, x.content])).toEqual([
    ['user', 'Alpha'],
  ]);
  expect(before[1].body.messages.map((x) => [x.role, x.content])).toEqual([
    ['user', 'Alpha'],
    ['assistant', 'Reply to Alpha'],
    ['user', 'Beta'],
  ]);
  expect(before[0].body.threadId).toBe(before[1].body.threadId);
  expect(before[0].body.runId).not.toBe(before[1].body.runId);
  await page.getByLabel('Message', { exact: true }).fill('Unsent draft');
  await page.getByRole('button', { name: 'New conversation' }).click();
  await expect(conversation(page).locator('li')).toHaveCount(0);
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('');
  expect(await (await request.get('/__requests')).json()).toEqual(before);
  await send(page, 'Gamma');
  await expect(page.getByRole('status')).toHaveText('Response complete.');
  const after: Wire[] = await (await request.get('/__requests')).json();
  expect(after).toHaveLength(3);
  expect(after[2].body.threadId).not.toBe(before[0].body.threadId);
  expect(new Set(after.map((x) => x.body.runId)).size).toBe(3);
  expect(after[2].body.messages.map((x) => x.content)).toEqual(['Gamma']);
});
test('native incremental partial settles to one canonical final row', async ({
  page,
  request,
}) => {
  await page.goto('/ag-ui/streaming/react/');
  await send(page, 'Hold');
  await expect(conversation(page)).toContainText('Live partial');
  await expect(
    page.getByRole('button', { name: 'New conversation' })
  ).toBeDisabled();
  await request.post('/__release');
  await expect(page.getByRole('status')).toHaveText('Response complete.');
  await expect(conversation(page).locator('li')).toHaveCount(2);
  await expect(conversation(page)).toContainText('Reply to Hold');
  await expect(conversation(page)).not.toContainText('Live partial');
});

for (const text of [
  'HTTP error',
  'Run error',
  'Interrupt',
  'Cancelled',
  'Notice EOF',
  'Tool',
  'Pending tools',
  'Child',
  'Duplicate identity',
  'Wrong terminal',
  'Truncated prefix',
  'Old pair',
]) {
  test(`${text} requires New without replay or recovery commands`, async ({
    page,
    request,
  }) => {
    await page.goto('/ag-ui/streaming/react/');
    if (text === 'Truncated prefix' || text === 'Old pair') {
      await send(page, 'Alpha');
      await expect(page.getByRole('status')).toHaveText('Response complete.');
    }
    await send(page, text);
    await expect(page.getByRole('status')).toHaveText(
      'Start a new conversation to continue.'
    );
    await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
    await expect(page.locator('body')).not.toContainText('PRIVATE');
    const before: Wire[] = await (await request.get('/__requests')).json();
    expect(before).toHaveLength(
      ['Truncated prefix', 'Old pair'].includes(text) ? 2 : 1
    );
    await page.waitForTimeout(100);
    expect(await (await request.get('/__requests')).json()).toEqual(before);
    await page.getByRole('button', { name: 'New conversation' }).click();
    await send(page, 'Recovered');
    await expect(page.getByRole('status')).toHaveText('Response complete.');
    const after: Wire[] = await (await request.get('/__requests')).json();
    expect(after.at(-1)!.body.threadId).not.toBe(before.at(-1)!.body.threadId);
    expect(after.at(-1)!.body.messages).toHaveLength(1);
  });
}
for (const exit of ['Stop', 'pagehide']) {
  test(`${exit} closes the held native HTTP stream and fences late content`, async ({
    page,
    request,
  }) => {
    await page.goto('/ag-ui/streaming/react/');
    await send(page, 'Hold');
    await expect(conversation(page)).toContainText('Live partial');
    expect((await (await request.get('/__lifetime')).json()).active).toBe(true);
    if (exit === 'Stop') {
      await page.getByRole('button', { name: 'Stop', exact: true }).click();
      await expect(page.getByRole('status')).toHaveText(
        'Start a new conversation to continue.'
      );
    } else {
      await page.evaluate(() =>
        window.dispatchEvent(new PageTransitionEvent('pagehide'))
      );
      await expect(conversation(page)).toHaveCount(0);
    }
    await expect
      .poll(
        async () => (await (await request.get('/__lifetime')).json()).active
      )
      .toBe(false);
    await request.post('/__release');
    expect(await (await request.get('/__requests')).json()).toHaveLength(1);
    if (exit === 'Stop')
      await expect(conversation(page)).not.toContainText('Reply to Hold');
    else await expect(conversation(page)).toHaveCount(0);
  });
}
test('literal root text and controls fit a narrow viewport', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/ag-ui/streaming/react/');
  const text = '<img src=x onerror=alert(1)> **literal**';
  await send(page, text);
  await expect(page.getByRole('status')).toHaveText('Response complete.');
  await expect(conversation(page)).toContainText(text);
  expect(await conversation(page).locator('img').count()).toBe(0);
  expect(
    await page
      .locator('body')
      .evaluate((el) => el.scrollWidth <= window.innerWidth)
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('ag-ui-streaming-mobile.png'),
    fullPage: true,
  });
});

test('the authored developer AG-UI target routes every request and remains private in the UI', async ({
  page,
  request,
}) => {
  await page.goto('http://127.0.0.1:3000/');
  await page.setContent(`<!doctype html><html><body><p id="state">Waiting</p><script>
    addEventListener('message', (event) => {
      const frame = document.getElementById('pilot');
      if (event.origin !== 'http://127.0.0.1:4609' || event.source !== frame.contentWindow) return;
      if (event.data.type === 'tplane:runtime-child-ready') frame.contentWindow.postMessage({
        type: 'tplane:runtime-configure', version: 2, nonce: event.data.nonce, generation: 1,
        target: { kind: 'ag-ui', endpoint: 'http://127.0.0.1:4609/developer-agent' }
      }, event.origin);
      if (event.data.type === 'tplane:runtime-configured') frame.contentWindow.postMessage({
        type: 'tplane:runtime-check', version: 1, nonce: 'parent-health', capability: 'streaming'
      }, event.origin);
      if (event.data.type === 'tplane:runtime-ready' && event.data.nonce === 'parent-health') document.getElementById('state').textContent = 'Ready';
    });</script><iframe id="pilot" title="React preview" src="http://127.0.0.1:4609/ag-ui/streaming/react/"></iframe></body></html>`);
  await expect(page.locator('#state')).toHaveText('Ready');
  const frame = page.frameLocator('#pilot');
  await expect(
    frame.getByRole('region', { name: 'Runtime connection' })
  ).toContainText('Developer runtime');
  for (const text of ['Alpha', 'Beta']) {
    await frame.getByLabel('Message', { exact: true }).fill(text);
    await frame.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(frame.getByRole('status')).toHaveText('Response complete.');
  }
  const wire: Wire[] = await (await request.get('/__requests')).json();
  expect(wire).toHaveLength(2);
  expect(
    wire.every((x) => x.path === '/developer-agent' && x.method === 'POST')
  ).toBe(true);
  expect(wire[0].body.threadId).toBe(wire[1].body.threadId);
  await expect(frame.locator('body')).not.toContainText('/developer-agent');
});
