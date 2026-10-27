import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ request }) => {
  await request.post('/__reset');
});
test('shows incremental draft text before publishing the complete approval batch', async ({
  page,
  request,
}) => {
  await request.post('/__hold-draft');
  await pause(page);
  await expect(
    page.getByRole('region', { name: 'Conversation' })
  ).toContainText('Refund draft');
  await expect(
    page.getByRole('region', { name: 'Refund approval required' })
  ).toHaveCount(0);
  await expect
    .poll(async () => (await (await request.get('/__lifetime')).json()).active)
    .toBe(true);
  await request.post('/__release');
  await expect(
    page.getByRole('region', { name: 'Refund approval required' })
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Conversation' })
  ).toContainText('Refund draft ready for review.');
});
async function pause(page: Page, text = 'Refund') {
  await page.goto('/langgraph/interrupts/react/');
  await page.getByLabel('Message', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}
test('mobile approval fields and actions fit without horizontal overflow', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pause(page);
  await expect(page.getByRole('region', { name: 'Refund approval required' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('refund-approval-mobile.png'), fullPage: true });
});
test('uncertain thread creation is protected and never replayed', async ({
  page,
  request,
}) => {
  await request.post('/__fail-create');
  await pause(page);
  await expect(page.getByRole('alert')).toHaveText(
    'The LangGraph request failed.'
  );
  await expect(page.locator('body')).not.toContainText('PRIVATE');
  await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
  const proof = await (await request.get('/__requests')).json();
  expect(
    proof.filter((entry: { path: string }) => entry.path.endsWith('/threads'))
  ).toHaveLength(1);
  expect(
    proof.filter((entry: { path: string }) =>
      entry.path.endsWith('/runs/stream')
    )
  ).toHaveLength(0);
});
for (const [label, response, final] of [
  ['Approve refund', { approved: true }, 'Simulated refund of $47.50'],
  ['Decline refund', { approved: false }, 'Refund cancelled'],
] as const) {
  test(`real SDK ${label} resumes the same confirmed thread without text`, async ({
    page,
    request,
  }) => {
    await pause(page);
    await expect(
      page.getByRole('region', { name: 'Refund approval required' })
    ).toBeVisible();
    await expect(
      page.getByText('<script>literal refund reason</script>', { exact: true })
    ).toBeVisible();
    await expect(
      page.locator('script').filter({ hasText: 'literal refund reason' })
    ).toHaveCount(0);
    await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
    await page.getByRole('button', { name: label }).click();
    await expect(page.getByRole('status')).toHaveText('Response complete.');
    await expect(
      page.getByRole('region', { name: 'Conversation' })
    ).toContainText(final);
    const proof = await (await request.get('/__requests')).json();
    const streams = proof.filter((entry: { path: string }) =>
      entry.path.endsWith('/runs/stream')
    );
    expect(streams).toHaveLength(2);
    expect(streams[1].path).toBe(streams[0].path);
    expect(streams[1].body.input).toBeNull();
    expect(streams[1].body.command).toEqual({ resume: response });
    expect(
      proof.filter((entry: { path: string }) => entry.path === '/api/threads')
    ).toHaveLength(1);
    const reads = proof.filter(
      (entry: { method: string }) => entry.method === 'GET'
    );
    expect(reads).toHaveLength(2);
    expect(reads[0].path).not.toBe(reads[1].path);
  });
}
test('edits an amount explicitly and rejects blank or negative values', async ({
  page,
  request,
}) => {
  await pause(page);
  await page.getByRole('button', { name: 'Edit amount' }).click();
  await page.getByLabel('Refund amount (USD)').fill('');
  await expect(
    page.getByRole('button', { name: 'Approve edited amount' })
  ).toBeDisabled();
  await page.getByLabel('Refund amount (USD)').fill('-1');
  await expect(
    page.getByRole('button', { name: 'Approve edited amount' })
  ).toBeDisabled();
  await page.getByLabel('Refund amount (USD)').fill('12.25');
  await page.getByRole('button', { name: 'Approve edited amount' }).click();
  await expect(
    page.getByRole('region', { name: 'Conversation' })
  ).toContainText('Simulated refund of $12.25');
  const proof = await (await request.get('/__requests')).json();
  expect(
    proof.filter((entry: { path: string }) =>
      entry.path.endsWith('/runs/stream')
    )[1].body.command
  ).toEqual({ resume: { approved: true, amount: 12.25 } });
});
test('held decision blocks duplicate clicks and Stop requires explicit fresh work', async ({
  page,
  request,
}) => {
  await request.post('/__hold-resume');
  await pause(page);
  const button = page.getByRole('button', { name: 'Approve refund' });
  await button.evaluate((element: HTMLButtonElement) => {
    element.click();
    element.click();
  });
  await expect(page.getByRole('status')).toHaveText('Sending decision…');
  await expect(
    page.getByRole('button', { name: 'New conversation' })
  ).toBeDisabled();
  await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Stopped');
  await expect
    .poll(async () => (await (await request.get('/__lifetime')).json()).active)
    .toBe(false);
  const proof = await (await request.get('/__requests')).json();
  expect(
    proof.filter((entry: { body: { command?: unknown } }) => entry.body.command)
  ).toHaveLength(1);
  await request.post('/__release');
  await expect(page.getByRole('status')).toContainText('Stopped');
  await page.getByRole('button', { name: 'New conversation' }).click();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await page.getByLabel('Message', { exact: true }).fill('Refund');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Refund approval required' })
  ).toBeVisible();
  expect(
    (await (await request.get('/__requests')).json()).filter(
      (entry: { path: string }) => entry.path === '/api/threads'
    )
  ).toHaveLength(2);
});
for (const text of ['Unknown', 'Malformed', 'Multiple']) {
  test(`protects unsupported ${text} root batches without guessed resume`, async ({
    page,
    request,
  }) => {
    await pause(page, text);
    await expect(page.getByRole('status')).toHaveText(
      'Start a new conversation to continue.'
    );
    await expect(
      page.getByRole('region', { name: 'Refund approval required' })
    ).toHaveCount(0);
    await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
    const proof = await (await request.get('/__requests')).json();
    expect(
      proof.filter(
        (entry: { body: { command?: unknown } }) => entry.body.command
      )
    ).toHaveLength(0);
  });
}
test('uncertain resume fails without replay or leaked diagnostics', async ({
  page,
  request,
}) => {
  await request.post('/__fail-resume');
  await pause(page);
  await page.getByRole('button', { name: 'Approve refund' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'The LangGraph request failed.'
  );
  await expect(page.locator('body')).not.toContainText('PRIVATE');
  await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
  expect(
    (await (await request.get('/__requests')).json()).filter(
      (entry: { body: { command?: unknown } }) => entry.body.command
    )
  ).toHaveLength(1);
});
test('pagehide disposes a held resume and fences late publication', async ({
  page,
  request,
}) => {
  await request.post('/__hold-resume');
  await pause(page);
  await page.getByRole('button', { name: 'Approve refund' }).click();
  await expect
    .poll(async () => (await (await request.get('/__lifetime')).json()).active)
    .toBe(true);
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
});
test('uses developer bridge headers while keeping credentials out of the body', async ({
  page,
  request,
}) => {
  await page.goto('http://127.0.0.1:3000/');
  await page.setContent(`<!doctype html><html><body><p id="state">Waiting</p><script>
    addEventListener('message', (event) => {
      const frame = document.getElementById('pilot');
      if (event.origin !== 'http://127.0.0.1:4601' || event.source !== frame.contentWindow) return;
      if (event.data.type === 'tplane:runtime-child-ready') frame.contentWindow.postMessage({
        type: 'tplane:runtime-configure', version: 2, nonce: event.data.nonce, generation: 1,
        target: { kind: 'langsmith', apiUrl: 'http://127.0.0.1:4601/developer-api', apiKey: 'TEST_DEVELOPER_KEY' }
      }, event.origin);
      if (event.data.type === 'tplane:runtime-configured') frame.contentWindow.postMessage({
        type: 'tplane:runtime-check', version: 1, nonce: 'parent-health', capability: 'interrupts'
      }, event.origin);
      if (event.data.type === 'tplane:runtime-ready' && event.data.nonce === 'parent-health') document.getElementById('state').textContent = 'Ready';
    });</script><iframe id="pilot" title="React pilot" src="http://127.0.0.1:4601/langgraph/interrupts/react/"></iframe></body></html>`);
  await expect(page.locator('#state')).toHaveText('Ready');
  const frame = page.frameLocator('#pilot');
  await frame.getByLabel('Message', { exact: true }).fill('Refund');
  await frame.getByRole('button', { name: 'Send', exact: true }).click();
  await frame.getByRole('button', { name: 'Decline refund' }).click();
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
