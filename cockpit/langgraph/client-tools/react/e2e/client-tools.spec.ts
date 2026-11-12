import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
test.beforeEach(async ({ request }) => { await request.post('/__reset'); });
async function send(page: Page, text: string, navigate = true) {
  if (navigate) await page.goto('/langgraph/client-tools/react/');
  await page.getByLabel('Message', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}
interface WireRequest {
  path: string; method: string; key: string | null;
  body: { input?: { client_tools: { name: string; parameters: unknown }[]; messages: { type: string; tool_call_id?: string; content: string }[] }; values?: { messages: { tool_call_id: string; content: string }[] } };
}
async function proof(request: APIRequestContext): Promise<WireRequest[]> {
  return (await request.get('/__requests')).json();
}
/** The application's own status line, below Chat's composer. */
const status = (page: Page) => page.locator('.tp-chat-input__footer > [role="status"]');
const streams = (entries: WireRequest[]) => entries.filter((entry) => entry.path.endsWith('/runs/stream'));
test('executes simulated weather then follows up in the same confirmed thread with all five tools', async ({ page, request }) => {
  await send(page, 'Weather');
  await expect(status(page)).toHaveText('Response complete.');
  await expect(page.getByRole('region', { name: 'Conversation' })).toContainText('Browser result received.');
  const entries = await proof(request), runs = streams(entries);
  expect(runs).toHaveLength(2);
  expect(runs[0].path).toBe(runs[1].path);
  expect(runs[0].body.input!.client_tools.map((tool) => tool.name)).toEqual(['get_weather', 'slow_status_check', 'weather_card', 'weather_snapshot', 'confirm_booking']);
  expect(runs[0].body.input!.client_tools.every((tool) => tool.parameters)).toBe(true);
  expect(runs[1].body.input!.messages[0]).toMatchObject({ type: 'tool', tool_call_id: 'weather-1', content: JSON.stringify({ location: 'Portland', temperatureF: 68, conditions: 'Sunny', humidity: 55, windMph: 8 }) });
  const reads = entries.filter((entry) => entry.method === 'GET');
  expect(reads).toHaveLength(2);
  expect(new Set(reads.map((entry) => entry.path)).size).toBe(2);
});
test('publishes a finalized literal weather card and its normal shown acknowledgement', async ({ page, request }) => {
  await send(page, 'Card');
  await expect(status(page)).toHaveText('Response complete.');
  await expect(page.getByRole('region', { name: 'Weather panels' })).toContainText('<script>Portland</script>');
  expect(await page.locator('script').filter({ hasText: 'Portland' }).count()).toBe(0);
  const runs = streams(await proof(request));
  expect(runs).toHaveLength(2);
  expect(runs[1].body.input!.messages[0]).toMatchObject({ tool_call_id: 'card-1', content: '{"shown":true}' });
});
test('persists a standalone snapshot result without another model run and waits for acknowledgement', async ({ page, request }) => {
  await request.post('/__hold-state');
  await send(page, 'Snapshot');
  await expect(page.getByRole('region', { name: 'Weather panels' })).toContainText('Portland');
  await expect.poll(async () => (await proof(request)).filter((entry) => entry.path.endsWith('/state')).length).toBe(1);
  await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'New conversation' })).toBeDisabled();
  await request.post('/__release');
  await expect(status(page)).toHaveText('Response complete.');
  const entries = await proof(request);
  expect(streams(entries)).toHaveLength(1);
  const write = entries.find((entry) => entry.path.endsWith('/state'))!;
  expect(write.path.replace(/\/state$/, '/runs/stream')).toBe(streams(entries)[0].path);
  expect(write.body.values!.messages[0]).toMatchObject({ tool_call_id: 'snapshot-1', content: '{"shown":true}' });
  expect((await (await request.get('/__threads')).json())[0].messages.at(-1)).toMatchObject({ tool_call_id: 'snapshot-1', content: '{"shown":true}' });
});
test('mixed snapshot and normal tools follow up as one batch with exact result identities', async ({ page, request }) => {
  await send(page, 'Mixed');
  await expect(status(page)).toHaveText('Response complete.');
  const entries = await proof(request), runs = streams(entries);
  expect(runs).toHaveLength(2);
  expect(entries.filter((entry) => entry.path.endsWith('/state'))).toHaveLength(0);
  expect(runs[1].body.input!.messages.map((message) => message.tool_call_id).sort()).toEqual(['snapshot-1', 'weather-1']);
});
test('identical parallel bookings wait in the transcript, confirm and decline independently, and leave records', async ({ page, request }) => {
  await send(page, 'Bookings');
  const conversation = page.getByRole('region', { name: 'Conversation' });
  await expect(conversation.getByRole('button', { name: 'Confirm booking' })).toHaveCount(2);
  await expect(conversation.locator('.tp-approval-card').first()).toContainText('Waiting for your approval.');
  // The first card takes focus; the second does not steal it.
  await expect(page.getByRole('button', { name: 'Confirm booking' }).nth(0)).toBeFocused();
  await expect(page.getByLabel('Message', { exact: true })).toHaveAttribute('placeholder', 'Answer the approval to continue');
  await page.getByRole('button', { name: 'Confirm booking' }).nth(0).click();
  await expect(conversation.getByText('Approved: Booking', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: "Don't book" }).click();
  await expect(status(page)).toHaveText('Response complete.');
  await expect(conversation.getByText('Declined: Booking', { exact: true })).toBeVisible();
  await expect(conversation.locator('.tp-approval-card')).toHaveCount(0);
  await expect(page.getByLabel('Message', { exact: true })).toBeFocused();
  const runs = streams(await proof(request));
  expect(runs).toHaveLength(2);
  expect(runs[1].body.input!.messages).toEqual(expect.arrayContaining([
    expect.objectContaining({ tool_call_id: 'booking-a', content: '{"confirmed":true}' }),
    expect.objectContaining({ tool_call_id: 'booking-b', content: '{"confirmed":false}' }),
  ]));
});
for (const text of ['Bookings', 'Slow']) test(`Stop during ${text} revokes handlers and never starts a follow-up`, async ({ page, request }) => {
  await send(page, text);
  await expect(page.getByRole('region', { name: 'Conversation' })).toContainText(text === 'Slow' ? 'slow_status_check' : 'confirm_booking');
  // The composer's Stop; a running group offers the same action.
  await page.locator('.tp-chat-input').getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(status(page)).toContainText('Stopped');
  await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Confirm booking' })).toHaveCount(0);
  await page.waitForTimeout(3200);
  expect(streams(await proof(request))).toHaveLength(1);
  await page.getByRole('button', { name: 'New conversation' }).click();
  await send(page, 'Weather', false);
  await expect(status(page)).toHaveText('Response complete.');
  expect((await proof(request)).filter((entry) => entry.path === '/api/threads')).toHaveLength(2);
});
test('invalid authored arguments produce a terminal error result explained by model follow-up', async ({ page, request }) => {
  await send(page, 'Malformed');
  await expect(status(page)).toHaveText('Response complete.');
  const runs = streams(await proof(request));
  expect(runs).toHaveLength(2);
  expect(runs[1].body.input!.messages[0].content).toContain('Invalid tool arguments.');
  await expect(page.getByRole('region', { name: 'Weather panels' })).toContainText('No weather panels yet.');
});
for (const text of ['Unknown', 'Pause']) test(`${text} requires reset without effects or follow-up`, async ({ page, request }) => {
  await send(page, text);
  await expect(status(page)).toContainText('new conversation');
  await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
  expect(streams(await proof(request))).toHaveLength(1);
});
test('an uncertain snapshot write is not replayed and requires reset', async ({ page, request }) => {
  await request.post('/__fail-state');
  await send(page, 'Snapshot');
  await expect(status(page)).toContainText('new conversation');
  expect((await proof(request)).filter((entry) => entry.path.endsWith('/state'))).toHaveLength(1);
  expect(streams(await proof(request))).toHaveLength(1);
});

test('partial streamed arguments cannot publish a panel or acknowledge a tool before finalization', async ({ page, request }) => {
  await request.post('/__hold-calls');
  await send(page, 'Card');
  await expect.poll(async () => (await (await request.get('/__lifetime')).json()).active).toBe(true);
  await expect(page.getByRole('region', { name: 'Weather panels' })).toContainText('No weather panels yet.');
  expect(streams(await proof(request))).toHaveLength(1);
  await request.post('/__release');
  await expect(status(page)).toHaveText('Response complete.');
  await expect(page.getByRole('region', { name: 'Weather panels' })).toContainText('Portland');
  expect(streams(await proof(request))).toHaveLength(2);
});

test('page exit aborts pending browser decisions without a model continuation', async ({ page, request }) => {
  await send(page, 'Bookings');
  await expect(page.getByRole('button', { name: 'Confirm booking' })).toHaveCount(2);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect(page.locator('main')).toHaveCount(0);
  await page.waitForTimeout(100);
  expect(streams(await proof(request))).toHaveLength(1);
});

test('a slow status handler completes normally and follows up once', async ({ page, request }) => {
  await send(page, 'Slow');
  await expect(status(page)).toHaveText('Response complete.');
  const runs = streams(await proof(request));
  expect(runs).toHaveLength(2);
  expect(runs[1].body.input!.messages[0]).toMatchObject({ tool_call_id: 'slow-1', content: '{"label":"status check","status":"complete"}' });
});

test('literal weather and booking panels fit a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await send(page, 'Card');
  await expect(status(page)).toHaveText('Response complete.');
  await expect(page.getByRole('region', { name: 'Weather panels' }).locator('dl')).toHaveCSS('display', 'block');
  await send(page, 'Bookings', false);
  await expect(page.getByRole('button', { name: 'Confirm booking' })).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('ambiguous thread creation never dispatches or retries and protects diagnostics', async ({ page, request }) => {
  await request.post('/__fail-create'); await send(page, 'Weather');
  await expect(status(page)).toContainText('new conversation');
  await expect(page.getByRole('alert')).toHaveText('The LangGraph request failed.');
  await expect(page.locator('body')).not.toContainText('PRIVATE');
  expect((await proof(request)).filter((entry) => entry.path === '/api/threads')).toHaveLength(1);
  expect(streams(await proof(request))).toHaveLength(0);
});

test('successful weather turns reuse the thread with distinct server tool invocation identities', async ({ page, request }) => {
  await send(page, 'Weather');
  await expect(status(page)).toHaveText('Response complete.');
  await send(page, 'Weather', false);
  await expect(status(page)).toHaveText('Response complete.');
  const entries = await proof(request), runs = streams(entries);
  expect(runs).toHaveLength(4);
  expect(new Set(runs.map((entry) => entry.path)).size).toBe(1);
  expect(entries.filter((entry) => entry.path === '/api/threads')).toHaveLength(1);
  expect(runs[1].body.input!.messages[0].tool_call_id).toBe('weather-1');
  expect(runs[3].body.input!.messages[0].tool_call_id).toBe('weather-1-3');
});

test('an embedded developer target sends credentials only in SDK headers', async ({ page, request }) => {
  await page.goto('http://127.0.0.1:3000/');
  await page.setContent(`<!doctype html><html><body><p id="state">Waiting</p>
    <script>
    addEventListener('message', (event) => {
      const frame = document.getElementById('pilot');
      if (event.origin !== 'http://127.0.0.1:4603' || event.source !== frame.contentWindow) return;
      if (event.data.type === 'tplane:runtime-child-ready') frame.contentWindow.postMessage({
        type: 'tplane:runtime-configure', version: 2, nonce: event.data.nonce, generation: 1,
        target: { kind: 'langsmith', apiUrl: 'http://127.0.0.1:4603/developer-api', apiKey: 'TEST_DEVELOPER_KEY' }
      }, event.origin);
      if (event.data.type === 'tplane:runtime-configured') frame.contentWindow.postMessage({ type: 'tplane:runtime-check', version: 1, nonce: 'parent-health', capability: 'client-tools' }, event.origin);
      if (event.data.type === 'tplane:runtime-ready' && event.data.nonce === 'parent-health') document.getElementById('state').textContent = 'Ready';
    });
    </script><iframe id="pilot" title="React pilot" style="width:100%;height:700px" src="http://127.0.0.1:4603/langgraph/client-tools/react/"></iframe></body></html>`);
  await expect(page.locator('#state')).toHaveText('Ready');
  const frame = page.frameLocator('#pilot');
  await frame.getByLabel('Message', { exact: true }).fill('Snapshot');
  await frame.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(frame.locator('.tp-chat-input__footer > [role="status"]')).toHaveText('Response complete.');
  const entries = await proof(request);
  expect(entries).toHaveLength(4);
  expect(entries.every((entry) => entry.path.startsWith('/developer-api/') && entry.key === 'TEST_DEVELOPER_KEY')).toBe(true);
  expect(JSON.stringify(entries.map((entry) => entry.body))).not.toContain('TEST_DEVELOPER_KEY');
  await expect(frame.locator('body')).not.toContainText('TEST_DEVELOPER_KEY');
});

test('a planned trip shows Chat progress with plan steps, waits for the booking, records it and returns focus', async ({ page, request }) => {
  await send(page, 'Trip');
  const conversation = page.getByRole('region', { name: 'Conversation' });
  const group = conversation.locator('.tp-tool-activity-group[data-active="true"]');
  await expect(group).toBeVisible();
  await expect(group.locator('.tp-tool-activity-group__elapsed')).toHaveText(/^\d+s$/);
  await expect(group.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  // The booking waits in Chat's approval slot at the end of the transcript.
  const card = conversation.locator('.tp-approval-card');
  await expect(card).toContainText('Waiting for your approval.');
  await expect(card).toContainText('Fictional trip to Portland');
  await expect(page.getByRole('button', { name: 'Confirm booking' })).toBeFocused();
  await expect(page.getByLabel('Message', { exact: true })).toHaveAttribute('placeholder', 'Answer the approval to continue');
  // Opened while running: a static count, then the plan's pending steps after the calls.
  await group.locator('.tp-tool-activity-group__details > summary').click();
  await expect(group.locator('.tp-tool-activity-group__details > summary')).toContainText('Working · 1 of 2 done');
  await expect(group.locator('.tp-tool-activity-group__plan-step')).toHaveText(['Summarize the results']);
  await page.getByRole('button', { name: 'Confirm booking' }).click();
  await expect(conversation.getByText('Approved: Booking', { exact: true })).toBeVisible();
  await expect(status(page)).toHaveText('Response complete.');
  await expect(card).toHaveCount(0);
  await expect(page.getByLabel('Message', { exact: true })).toBeFocused();
  await expect(page.getByLabel('Message', { exact: true })).toHaveAttribute('placeholder', 'Ask for weather or a fictional booking…');
  // Settled: no progress row and no upcoming steps.
  await expect(conversation.locator('.tp-tool-activity-group__progress')).toHaveCount(0);
  await expect(conversation.locator('.tp-tool-activity-group__plan-step')).toHaveCount(0);
  const runs = streams(await proof(request));
  expect(runs).toHaveLength(2);
  expect(runs[1].body.input!.messages).toEqual(expect.arrayContaining([
    expect.objectContaining({ tool_call_id: 'trip-booking', content: '{"confirmed":true}' }),
  ]));
});

test('Stop in the running group stops the trip, revokes the booking and never follows up', async ({ page, request }) => {
  await send(page, 'Trip');
  const conversation = page.getByRole('region', { name: 'Conversation' });
  await expect(conversation.locator('.tp-approval-card')).toBeVisible();
  await conversation.locator('.tp-tool-activity-group').getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(status(page)).toContainText('Stopped');
  await expect(conversation.locator('.tp-approval-card')).toHaveCount(0);
  await expect(conversation.getByText(/^(Approved|Declined):/)).toHaveCount(0);
  await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
  await page.waitForTimeout(500);
  expect(streams(await proof(request))).toHaveLength(1);
});
