import { test, expect, type Page } from '@playwright/test';
test.beforeEach(async ({ request }) => {
  await request.post('/__reset');
});
const rows = (page: Page) => page.locator('[data-weather-message]');
async function send(page: Page, text: string) {
  await page.getByLabel('Message', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}
test('actual installed SDK retains causal zero, one, batch and multiple server-tool rounds on one lazy UUID', async ({
  page,
  request,
}) => {
  await page.goto('/ag-ui/tool-views/react/');
  expect(await (await request.get('/__requests')).json()).toEqual([]);
  let count = 0;
  for (const [text, added, cards] of [
    ['Zero', 2, 0],
    ['One', 3, 1],
    ['Batch', 3, 3],
    ['Rounds', 4, 5],
  ] as const) {
    await send(page, text);
    await expect(page.getByRole('status')).toHaveText('Response complete.');
    count += added;
    await expect(rows(page)).toHaveCount(count);
    await expect(page.locator('[data-weather-tool]')).toHaveCount(cards);
    await expect(rows(page).last()).toContainText(`Reply to ${text}`);
    if (text === 'One') {
      await expect(rows(page).nth(3).locator('.weather-card')).toContainText(
        'San Francisco'
      );
      await expect(rows(page).nth(3).locator('.weather-card')).toContainText(
        '68 °F'
      );
      await expect(rows(page).nth(3).locator('.weather-card')).toContainText(
        'Sunny'
      );
      await expect(rows(page).nth(3).locator('.weather-card')).toContainText(
        '55%'
      );
      await expect(rows(page).nth(3).locator('.weather-card')).toContainText(
        '8 mph'
      );
    }
  }
  const before = await (await request.get('/__requests')).json();
  expect(before).toHaveLength(4);
  expect(
    new Set(before.map((x: { body: { threadId: string } }) => x.body.threadId))
      .size
  ).toBe(1);
  expect(
    new Set(before.map((x: { body: { runId: string } }) => x.body.runId)).size
  ).toBe(4);
  expect(
    before.map((x: { body: { messages: unknown[] } }) => x.body.messages.length)
  ).toEqual([1, 3, 7, 12]);
  for (const entry of before) {
    expect(entry.path).toBe('/ag-ui/tool-views/agent');
    expect(entry.body.protocolVersion).toBe('1.0');
    expect(entry.body.tools).toEqual([]);
  }
  const causal = before[3].body.messages;
  for (const result of causal.filter(
    (x: { role: string }) => x.role === 'tool'
  )) {
    expect(result.id).toBe(result.toolCallId);
    expect(
      causal.some((x: { toolCalls?: { id: string }[] }) =>
        x.toolCalls?.some((call) => call.id === result.toolCallId)
      )
    ).toBe(true);
  }
  await page.getByRole('button', { name: 'New conversation' }).click();
  await expect(rows(page)).toHaveCount(0);
  expect(await (await request.get('/__requests')).json()).toEqual(before);
  await send(page, 'One');
  await expect(page.getByRole('status')).toHaveText('Response complete.');
  const after = await (await request.get('/__requests')).json();
  expect(after).toHaveLength(5);
  expect(after[4].body.messages).toHaveLength(1);
  expect(after[4].body.threadId).not.toBe(before[0].body.threadId);
});
for (const mode of ['Hold args', 'Hold call', 'Hold result', 'Hold final']) {
  test(`${mode} remains current work until root completion`, async ({
    page,
    request,
  }) => {
    await page.goto('/ag-ui/tool-views/react/');
    await send(page, mode);
    await expect
      .poll(
        async () => (await (await request.get('/__lifetime')).json()).active
      )
      .toBe(true);
    await expect(page.getByRole('status')).toHaveText(
      'Getting a weather reading…'
    );
    await expect(
      page.getByRole('button', { name: 'New conversation' })
    ).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Send', exact: true })
    ).toBeDisabled();
    await page
      .getByRole('button', { name: 'Send', exact: true })
      .evaluate((button) => (button as HTMLButtonElement).click());
    expect(await (await request.get('/__requests')).json()).toHaveLength(1);
    await expect(page.locator('.weather-card h3')).toHaveCount(
      mode === 'Hold result' || mode === 'Hold final' ? 1 : 0
    );
    await request.post('/__release');
    await expect(page.getByRole('status')).toHaveText('Response complete.');
    await expect(rows(page)).toHaveCount(3);
    expect(await (await request.get('/__requests')).json()).toHaveLength(1);
  });
  for (const action of ['Stop', 'page exit']) {
    test(`${action} aborts ${mode} without replay`, async ({
      page,
      request,
    }) => {
      await page.goto('/ag-ui/tool-views/react/');
      await send(page, mode);
      await expect
        .poll(
          async () => (await (await request.get('/__lifetime')).json()).active
        )
        .toBe(true);
      if (action === 'Stop')
        await page.getByRole('button', { name: 'Stop', exact: true }).click();
      else await page.goto('/');
      await expect
        .poll(
          async () => (await (await request.get('/__lifetime')).json()).active
        )
        .toBe(false);
      await request.post('/__release');
      expect(await (await request.get('/__requests')).json()).toHaveLength(1);
      if (action === 'Stop')
        await expect(page.getByRole('status')).toHaveText(
          'Start a new conversation to continue.'
        );
    });
  }
}
for (const mode of [
  'HTTP error',
  'Run error',
  'Child',
  'Decision',
  'Pending tools',
  'Wrong terminal',
  'Truncated prefix',
  'Duplicate result',
  'Orphan result',
  'Unknown tool',
  'Malformed args',
  'Malformed weather',
  'Unstable result identity',
  'Legacy notice',
  'Notice EOF',
  'EOF',
]) {
  test(`${mode} requires New and never replays uncertain work`, async ({
    page,
    request,
  }) => {
    await page.goto('/ag-ui/tool-views/react/');
    if (mode === 'Truncated prefix') {
      await send(page, 'One');
      await expect(page.getByRole('status')).toHaveText('Response complete.');
    }
    await send(page, mode);
    await expect(page.getByRole('status')).toHaveText(
      'Start a new conversation to continue.'
    );
    await expect(page.locator('main')).not.toContainText('PRIVATE');
    await expect(
      page.getByRole('button', { name: 'Send', exact: true })
    ).toBeDisabled();
    const before = await (await request.get('/__requests')).json();
    expect(before).toHaveLength(mode === 'Truncated prefix' ? 2 : 1);
    await page.getByRole('button', { name: 'New conversation' }).click();
    await expect(rows(page)).toHaveCount(0);
    expect(await (await request.get('/__requests')).json()).toEqual(before);
    await send(page, 'Zero');
    await expect(page.getByRole('status')).toHaveText('Response complete.');
  });
}
test('mobile literal tool fields stay inert', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/ag-ui/tool-views/react/');
  await send(page, 'Literal');
  await expect(page.getByRole('status')).toHaveText('Response complete.');
  await expect(page.locator('[data-weather-tool]')).toContainText(
    '<img src=x onerror=alert(1)>'
  );
  await expect(rows(page).last()).toContainText(
    '<script>private markup</script>'
  );
  await expect(page.locator('main img, main script')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('127.0.0.1');
  const wire = await (await request.get('/__requests')).json();
  expect(wire[0].path).toBe('/ag-ui/tool-views/agent');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath('weather-mobile.png'),
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
      if (event.origin !== 'http://127.0.0.1:4611' || event.source !== frame.contentWindow) return;
      if (event.data.type === 'tplane:runtime-child-ready') frame.contentWindow.postMessage({
        type: 'tplane:runtime-configure', version: 2, nonce: event.data.nonce, generation: 1,
        target: { kind: 'ag-ui', endpoint: 'http://127.0.0.1:4611/developer-agent' }
      }, event.origin);
      if (event.data.type === 'tplane:runtime-configured') frame.contentWindow.postMessage({
        type: 'tplane:runtime-check', version: 1, nonce: 'parent-health', capability: 'tool-views'
      }, event.origin);
      if (event.data.type === 'tplane:runtime-ready' && event.data.nonce === 'parent-health') document.getElementById('state').textContent = 'Ready';
    });</script><iframe id="pilot" title="React preview" src="http://127.0.0.1:4611/ag-ui/tool-views/react/"></iframe></body></html>`);
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
  const wire: { path: string; method: string; body: { threadId: string } }[] =
    await (await request.get('/__requests')).json();
  expect(wire).toHaveLength(2);
  expect(
    wire.every((x) => x.path === '/developer-agent' && x.method === 'POST')
  ).toBe(true);
  expect(wire[0].body.threadId).toBe(wire[1].body.threadId);
  await expect(frame.locator('body')).not.toContainText('/developer-agent');
});
