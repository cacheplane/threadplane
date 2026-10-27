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
  key: string | null;
  body: { assistant_id?: string; thread_id?: string; command?: unknown };
};
test('installed SDK preserves canonical history on the confirmed UUID and creates a new one lazily', async ({
  page,
  request,
}) => {
  await page.goto('/langgraph/deployment-runtime/react/');
  expect(await (await request.get('/__requests')).json()).toEqual([]);
  await send(page, 'Alpha');
  await expect(page.getByRole('status')).toHaveText('Response complete.');
  await expect(conversation(page).locator('article')).toHaveCount(2);
  await send(page, 'Beta');
  await expect(page.getByRole('status')).toHaveText('Response complete.');
  await expect(conversation(page).locator('article')).toHaveCount(4);
  await expect(conversation(page)).toContainText('Reply to Alpha');
  await expect(conversation(page)).toContainText('Reply to Beta');
  const before: Wire[] = await (await request.get('/__requests')).json();
  const runs = before.filter((x) => x.path.endsWith('/runs/stream'));
  expect(runs).toHaveLength(2);
  expect(runs[0].path).toBe(runs[1].path);
  expect(
    runs.every(
      (x) => x.body.assistant_id === 'deployment-runtime' && !x.body.command
    )
  ).toBe(true);
  await page.getByRole('button', { name: 'New conversation' }).click();
  await expect(conversation(page).locator('article')).toHaveCount(0);
  expect(await (await request.get('/__requests')).json()).toEqual(before);
  await send(page, 'Gamma');
  await expect(page.getByRole('status')).toHaveText('Response complete.');
  await expect(conversation(page).locator('article')).toHaveCount(2);
  await expect(conversation(page)).not.toContainText('Alpha');
  const wire: Wire[] = await (await request.get('/__requests')).json();
  const creates = wire.filter((x) => x.path.endsWith('/threads'));
  expect(creates).toHaveLength(2);
  expect(new Set(creates.map((x) => x.body.thread_id)).size).toBe(2);
  expect(wire.filter((x) => x.method === 'GET')).toHaveLength(3);
  expect(
    wire.filter((x) => x.path.endsWith('/history') || x.path.includes('/state'))
  ).toHaveLength(0);
});
test('held incremental content settles to one canonical answer without duplicate aliases', async ({
  page,
  request,
}) => {
  await page.goto('/langgraph/deployment-runtime/react/');
  await send(page, 'Hold');
  await expect(conversation(page)).toContainText('Live partial');
  await expect(
    page.getByRole('button', { name: 'Stop', exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'New conversation' })
  ).toBeDisabled();
  await request.post('/__release');
  await expect(page.getByRole('status')).toHaveText('Response complete.');
  await expect(conversation(page).locator('article')).toHaveCount(2);
  await expect(conversation(page)).toContainText('Reply to Hold');
  await expect(conversation(page)).not.toContainText('Live partial');
});
for (const text of [
  'Error',
  'Interrupt',
  'Tool',
  'Missing markers',
  'Wrong pair',
  'Truncated prefix',
  'Duplicate identity',
  'Old pair',
  'No final values',
]) {
  test(`${text} requires New without replay or a recovery request`, async ({
    page,
    request,
  }) => {
    await page.goto('/langgraph/deployment-runtime/react/');
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
    const before = await (await request.get('/__requests')).json();
    await page.waitForTimeout(200);
    expect(await (await request.get('/__requests')).json()).toEqual(before);
    expect(
      before.filter((x: Wire) => x.path.endsWith('/runs/stream'))
    ).toHaveLength(text === 'Truncated prefix' || text === 'Old pair' ? 2 : 1);
    await page.getByRole('button', { name: 'New conversation' }).click();
    await send(page, 'Recovered');
    await expect(page.getByRole('status')).toHaveText('Response complete.');
    await expect(conversation(page).locator('article')).toHaveCount(2);
  });
}
test('creation failure stays lazy and does not retry or expose the response', async ({
  page,
  request,
}) => {
  await request.post('/__fail-create');
  await page.goto('/langgraph/deployment-runtime/react/');
  await send(page, 'Alpha');
  await expect(page.getByRole('status')).toHaveText(
    'Start a new conversation to continue.'
  );
  const wire: Wire[] = await (await request.get('/__requests')).json();
  expect(wire).toHaveLength(1);
  expect(wire[0].path).toBe('/api/threads');
  await expect(page.locator('body')).not.toContainText('PRIVATE');
});

test('developer target credentials travel only in SDK headers and the runtime label remains nonsensitive', async ({
  page,
  request,
}) => {
  await page.goto('http://127.0.0.1:3000/');
  await page.setContent(`<!doctype html><html><body><p id="state">Waiting</p><script>
    addEventListener('message', (event) => {
      const frame = document.getElementById('pilot');
      if (event.origin !== 'http://127.0.0.1:4608' || event.source !== frame.contentWindow) return;
      if (event.data.type === 'tplane:runtime-child-ready') frame.contentWindow.postMessage({
        type: 'tplane:runtime-configure', version: 2, nonce: event.data.nonce, generation: 1,
        target: { kind: 'langsmith', apiUrl: 'http://127.0.0.1:4608/developer-api', apiKey: 'TEST_DEVELOPER_KEY' }
      }, event.origin);
      if (event.data.type === 'tplane:runtime-configured') frame.contentWindow.postMessage({
        type: 'tplane:runtime-check', version: 1, nonce: 'parent-health', capability: 'deployment-runtime'
      }, event.origin);
      if (event.data.type === 'tplane:runtime-ready' && event.data.nonce === 'parent-health') document.getElementById('state').textContent = 'Ready';
    });</script><iframe id="pilot" title="React pilot" src="http://127.0.0.1:4608/langgraph/deployment-runtime/react/"></iframe></body></html>`);
  await expect(page.locator('#state')).toHaveText('Ready');
  const frame = page.frameLocator('#pilot');
  await expect(
    frame.getByRole('region', { name: 'Runtime connection' })
  ).toContainText('Developer runtime');
  await frame.getByLabel('Message', { exact: true }).fill('Alpha');
  await frame.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(frame.getByRole('status')).toHaveText('Response complete.');
  const entries: Wire[] = await (await request.get('/__requests')).json();
  expect(entries).toHaveLength(3);
  expect(
    entries.every(
      (entry) =>
        entry.path.startsWith('/developer-api/') &&
        entry.key === 'TEST_DEVELOPER_KEY'
    )
  ).toBe(true);
  expect(entries.filter((entry) => entry.method === 'GET')).toHaveLength(1);
  expect(JSON.stringify(entries.map((entry) => entry.body))).not.toContain(
    'TEST_DEVELOPER_KEY'
  );
  await expect(frame.locator('body')).not.toContainText('TEST_DEVELOPER_KEY');
  await expect(frame.locator('body')).not.toContainText('/developer-api');
});
for (const exit of ['Stop', 'pagehide']) {
  test(`${exit} closes the held physical run and rejects late content`, async ({
    page,
    request,
  }) => {
    await page.goto('/langgraph/deployment-runtime/react/');
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
    const wire: Wire[] = await (await request.get('/__requests')).json();
    expect(wire.filter((x) => x.path.endsWith('/runs/stream'))).toHaveLength(1);
    if (exit === 'Stop')
      await expect(conversation(page)).not.toContainText('Reply to Hold');
    else await expect(conversation(page)).toHaveCount(0);
  });
}
test('literal messages and all controls fit a narrow viewport', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/langgraph/deployment-runtime/react/');
  await send(page, '<script>fictional literal</script>');
  await expect(page.getByRole('status')).toHaveText('Response complete.');
  await expect(conversation(page)).toContainText(
    '<script>fictional literal</script>'
  );
  expect(
    await page
      .locator('body')
      .evaluate((element) => element.scrollWidth <= window.innerWidth)
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('deployment-runtime-mobile.png'),
    fullPage: true,
  });
});
