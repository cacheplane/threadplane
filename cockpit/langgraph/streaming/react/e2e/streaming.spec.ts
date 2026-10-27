import { test, expect } from '@playwright/test';

test.beforeEach(async ({ request }) => {
  await request.post('/__reset');
});

test('page exit releases the owned held stream without replay or late rendering', async ({
  page,
  request,
}) => {
  await page.goto('/langgraph/streaming/react/');
  await page.getByLabel('Message', { exact: true }).fill('First');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Conversation' })
  ).toContainText('Live partial');
  expect(await (await request.get('/__lifetime')).json()).toEqual({
    active: true,
  });
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pagehide'))
  );
  await expect(page.getByRole('region', { name: 'Conversation' })).toHaveCount(
    0
  );
  await expect
    .poll(async () => (await (await request.get('/__lifetime')).json()).active)
    .toBe(false);
  await request.post('/__release');
  await expect(page.getByRole('region', { name: 'Conversation' })).toHaveCount(
    0
  );
  const proof = await (await request.get('/__requests')).json();
  expect(
    proof.filter((entry: { path: string }) =>
      entry.path.endsWith('/runs/stream')
    )
  ).toHaveLength(1);
  expect(
    proof.filter((entry: { path: string }) => entry.path.endsWith('/threads'))
  ).toHaveLength(1);
});

test('does not retry uncertain conversation creation', async ({
  page,
  request,
}) => {
  await request.post('/__fail-create');
  await page.goto('/langgraph/streaming/react/');
  await page.getByLabel('Message', { exact: true }).fill('First');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'The LangGraph request failed.'
  );
  await expect(
    page.getByRole('button', { name: 'Send', exact: true })
  ).toBeDisabled();
  await expect(page.locator('body')).not.toContainText('PRIVATE');
  const proof = await (await request.get('/__requests')).json();
  expect(proof).toHaveLength(1);
  expect(proof[0].path).toBe('/api/threads');
  await page.getByRole('button', { name: 'New conversation' }).click();
  await page.getByLabel('Message', { exact: true }).fill('Second');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Response complete.');
});

test('streams actual SDK requests, settles content, and keeps one conversation', async ({
  page,
  request,
}) => {
  await page.goto('/langgraph/streaming/react/');
  await page.getByLabel('Message', { exact: true }).fill('First');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Conversation' })
  ).toContainText('Live partial');
  await expect(
    page.getByRole('button', { name: 'Stop', exact: true })
  ).toBeVisible();
  await request.post('/__release');
  await expect(page.getByRole('status')).toHaveText('Response complete.');
  await expect(
    page.getByRole('region', { name: 'Conversation' })
  ).toContainText('Live partial complete');
  await page.getByLabel('Message', { exact: true }).fill('Second');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Response complete.');
  const proof = await (await request.get('/__requests')).json();
  expect(
    proof.filter((entry: { path: string }) => entry.path === '/api/threads')
  ).toHaveLength(1);
  expect(
    proof.filter((entry: { path: string }) =>
      entry.path.endsWith('/runs/stream')
    )
  ).toHaveLength(2);
  expect(JSON.stringify(proof)).toContain('streaming');
});

test('Stop ends execution without replay and New conversation permits explicit fresh work', async ({
  page,
  request,
}) => {
  await page.goto('/langgraph/streaming/react/');
  await page.getByLabel('Message', { exact: true }).fill('First');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Conversation' })
  ).toContainText('Live partial');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Stopped');
  await expect(
    page.getByRole('button', { name: 'Send', exact: true })
  ).toBeDisabled();
  await page.getByRole('button', { name: 'New conversation' }).click();
  await expect(
    page.getByRole('button', { name: 'Send', exact: true })
  ).toBeDisabled();
  await page.getByLabel('Message', { exact: true }).fill('Second');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Response complete.');
  const proof = await (await request.get('/__requests')).json();
  expect(
    proof.filter((entry: { path: string }) =>
      entry.path.endsWith('/runs/stream')
    )
  ).toHaveLength(2);
});

test('protects server diagnostics and renders backend markup literally', async ({
  page,
}) => {
  await page.goto('/langgraph/streaming/react/');
  await page.getByLabel('Message', { exact: true }).fill('Literal');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Conversation' })
  ).toContainText('<script>private markup</script>');
  expect(
    await page.locator('script').filter({ hasText: 'private markup' }).count()
  ).toBe(0);
  await page.getByLabel('Message', { exact: true }).fill('Error');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'The LangGraph request failed.'
  );
  await expect(page.locator('body')).not.toContainText('PRIVATE response');
});

test('accepts an embedded developer target through the existing neutral bridge', async ({
  page,
  request,
}) => {
  await page.goto('http://127.0.0.1:3000/');
  await page.setContent(`<!doctype html><html><body><p id="state">Waiting</p>
      <script>
      addEventListener('message', (event) => {
        const frame = document.getElementById('pilot');
        if (event.origin !== 'http://127.0.0.1:4600' || event.source !== frame.contentWindow) return;
        if (event.data.type === 'tplane:runtime-child-ready') frame.contentWindow.postMessage({
          type: 'tplane:runtime-configure', version: 2, nonce: event.data.nonce, generation: 1,
          target: { kind: 'langsmith', apiUrl: 'http://127.0.0.1:4600/developer-api', apiKey: 'TEST_DEVELOPER_KEY' }
        }, event.origin);
        if (event.data.type === 'tplane:runtime-configured') frame.contentWindow.postMessage({
          type: 'tplane:runtime-check', version: 1, nonce: 'parent-health', capability: 'streaming'
        }, event.origin);
        if (event.data.type === 'tplane:runtime-ready' && event.data.nonce === 'parent-health') document.getElementById('state').textContent = 'Ready';
      });
      </script><iframe id="pilot" title="React pilot" src="http://127.0.0.1:4600/langgraph/streaming/react/"></iframe></body></html>`);
  await expect(page.locator('#state')).toHaveText('Ready');
  const frame = page.frameLocator('#pilot');
  await frame.getByLabel('Message', { exact: true }).fill('Second');
  await frame.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(frame.getByRole('status')).toHaveText('Response complete.');
  const proof = await (
    await request.get('http://127.0.0.1:4600/__requests')
  ).json();
  expect(proof).toHaveLength(3);
  expect(
    proof.every(
      (entry: { path: string; key: string }) =>
        entry.path.startsWith('/developer-api/') &&
        entry.key === 'TEST_DEVELOPER_KEY'
    )
  ).toBe(true);
  await expect(frame.locator('body')).not.toContainText('TEST_DEVELOPER_KEY');
});
