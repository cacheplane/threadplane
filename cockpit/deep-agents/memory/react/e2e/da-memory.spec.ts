import { test, expect, type Page, type APIRequestContext, type TestInfo } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
const base = '/deep-agents/memory/react/';
const key = 'threadplane.deep-agents-memory.scope.v1';
const literal = 'Fleet note\n\n  Ω literal whitespace  \n';
const updated = 'Updated fleet note\n\n  Ω literal whitespace  \n';
const file = '/memories/AGENTS.md';
type Recorded = { path: string; method: string; body: Record<string, any> };
async function records(request: APIRequestContext): Promise<Recorded[]> { return (await request.get('/__requests')).json(); }
// Backend: aimock replays cockpit/deep-agents/memory/angular/e2e/fixtures
// (shared with the Angular example; React scenarios are tagged prompts) into a
// real `langgraph dev` with a real store. The proxy records requests and holds
// or fails the next call (scripts/react-cockpit/langgraph-proxy.mjs).
// The fail-* scenarios stand in for a store read failing inside the graph at
// one observation phase, which aimock can't cause: the browser's stream ends
// with the graph's own error just before that phase's memory event (injected;
// cockpit/deep-agents/memory/python/tests covers the real failure).
const failures: Record<string, [scenario: string, phase: string]> = {
  'fail-initial': ['recall', 'initial'], 'fail-model': ['recall', 'model'], 'fail-terminal': ['teach', 'terminal'],
};
let scenario = 'teach';
async function configure(request: APIRequestContext, next = 'teach', extra: Record<string, boolean> = {}) {
  const control = async (path: string, data: object = {}) => expect((await request.post(path, { data })).ok()).toBe(true);
  const failure = failures[next];
  scenario = failure ? failure[0] : next;
  if (failure) await control('/__stream/cut', {
    beforePattern: `"phase": ?"${failure[1]}"`,
    error: { error: 'MemoryObservationError', message: 'Memory observation unavailable' },
  });
  // The saved-conversation confirmation reads the exact checkpoint.
  if (extra.holdCheckpoint) await control('/__hold/state');
  if (extra.holdStream) await control('/__hold/stream', { immediate: true });
  if (extra.failCreation) await control('/__fail-create');
  await control(extra.failCheckpoint ? '/__state/failure' : '/__state/safe');
}
async function release(request: APIRequestContext) {
  await request.post('/__release-state');
  await request.post('/__release');
}
/** Server-sent events as the real server framed them (CRLF or LF). */
function events(text: string) {
  return text.split(/\r?\n\r?\n/).filter(Boolean).map(block => {
    const lines = block.split(/\r?\n/);
    return { event: lines.find(line => line.startsWith('event: '))!.slice(7), data: JSON.parse(lines.find(line => line.startsWith('data: '))!.slice(6)) };
  });
}
async function send(page: Page, text = 'Remember this fleet note') {
  // The scenario tag selects the scripted model turns (shared fixtures).
  await page.getByRole('textbox', { name: 'Message' }).fill(`${text} [scenario:${scenario}]`);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}
async function saved(page: Page) { await expect(page.getByRole('status')).toHaveText('Response saved.', { timeout: 45000 }); }
async function capture(request: APIRequestContext, info: TestInfo) {
  mkdirSync(info.outputDir, { recursive: true });
  for (const endpoint of ['requests', 'captures']) {
    const data = await (await request.get('/__' + endpoint)).json();
    writeFileSync(info.outputPath(endpoint + '.json'), JSON.stringify(data, null, 2));
  }
  // Native snapshots are verified inside application confirmation; no extraction endpoint exists.
  writeFileSync(info.outputPath('native-evidence.json'), JSON.stringify({ nativeSnapshotsExtracted: false, evidence: 'Actual native app Saved plus independent current/newest/exact reads.' }));
}
test.beforeEach(async ({ request }) => { await request.post('/__reset'); scenario = 'teach'; });
test.afterEach(async ({ request }, info) => { await capture(request, info); });
test('literal genuine teach, same-thread edit, new-thread scoped prompt recall and historical read-only restore', async ({ page, request }, info) => {
  // Chromium doesn't keep a long-lived event-stream body for response.text();
  // the stream's content is read from the proxy's capture of the real server.
  const streams: Promise<{ url: string; status: number; contentLocation: string | undefined }>[] = [];
  page.on('response', response => {
    if (new URL(response.url()).pathname.endsWith('/runs/stream')) streams.push((async () => ({
      url: response.url(), status: response.status(), contentLocation: (await response.allHeaders())['content-location'],
    }))());
  });
  await configure(request, 'teach', { holdCheckpoint: true });
  const before = await records(request);
  await page.goto(base);
  await page.getByRole('button', { name: 'Teach', exact: true }).click();
  await expect(page.getByRole('textbox')).toHaveValue(/Citation CJ3/);
  await page.getByRole('button', { name: 'Recall', exact: true }).click();
  await page.getByRole('button', { name: 'New conversation' }).click();
  await page.reload();
  expect(await records(request)).toEqual(before);
  const scope = await page.evaluate(k => localStorage.getItem(k), key);
  expect(scope).toMatch(/^[0-9a-f-]{36}$/);
  await send(page);
  // A real `langgraph dev` turn (model, tool, model) can take a few seconds.
  await expect(page.getByRole('status')).toHaveText('Confirming saved conversation…', { timeout: 30000 });
  await expect(page.getByTestId('memory-source')).toHaveText('store observed during this run');
  await expect(page.getByTestId('memory-file').locator('pre')).toHaveText(literal, { useInnerText: false });
  await release(request);
  await saved(page);
  await configure(request, 'teach');
  const first = await page.getByLabel('Saved conversations').inputValue();
  const current = await (await request.get('/api/threads/' + first + '/state')).json();
  const newest = (await (await request.post('/api/threads/' + first + '/history', { data: { limit: 1 } })).json())[0];
  const exact = await (await request.post('/api/threads/' + first + '/state/checkpoint', { data: { checkpoint: newest.checkpoint } })).json();
  expect(current).toEqual(newest);
  expect(current).toEqual(exact);
  expect(current.checkpoint.thread_id).toBe(first);
  expect(current.checkpoint.checkpoint_ns).toBe('');
  expect(current.checkpoint.checkpoint_id).toBeTruthy();
  expect(current.next).toEqual([]);
  expect(current.tasks).toEqual([]);
  const firstRequest = (await records(request)).slice(before.length).find(r => r.path.endsWith('/runs/stream'))!;
  const human = firstRequest.body.input.messages[0];
  expect(exact.values.messages.filter((message: any) => message.type === 'human')).toEqual([expect.objectContaining(human)]);
  // What the real server streamed for this run, as the proxy received it.
  const firstRaw = (await (await request.get('/__captures')).json()).find((record: any) => record.path.includes(`/threads/${first}/`));
  const rawEvents = events(firstRaw.sse);
  const sse = await streams[0];
  expect(sse.status).toBe(200);
  const metadata = rawEvents[0].data;
  expect(sse.contentLocation).toMatch(new RegExp(`/threads/${first}/runs/${metadata.run_id}$`));
  expect(firstRaw.sse).toContain('event: custom');
  const terminalCustom = rawEvents.filter(event => event.event === 'custom' && event.data.name === 'deep_agents.memory' && event.data.data.phase === 'terminal').at(-1)!;
  const terminalValues = rawEvents.filter(event => event.event === 'values').at(-1)!;
  mkdirSync(info.outputDir, { recursive: true });
  writeFileSync(info.outputPath('whole-read-proof.json'), JSON.stringify({
    nativeSnapshotsExtracted: false,
    owner: { threadId: first, memoryScope: scope, actualSdkHuman: human },
    readResponses: { current, newest, exact }, rootCheckpoint: current.checkpoint,
    actualBrowserResponse: sse, actualServerStream: { ...firstRaw, parsedEvents: rawEvents },
  }, null, 2));
  expect(firstRaw.sse).toContain('Ω');
  expect(terminalCustom.data.data.memory_contents).toEqual({ [file]: literal });
  // Values events omit the private memory channels; the saved checkpoint has them.
  expect(terminalValues.data.memory_contents).toBeUndefined();
  expect(exact.values.memory_contents).toEqual({ [file]: literal });
  const write = exact.values.messages.find((m: any) => m.type === 'ai' && m.tool_calls?.some((c: any) => c.name === 'write_file'));
  expect(write.tool_calls[0].args).toEqual({ file_path: file, content: literal });
  expect(exact.values.messages.some((m: any) => m.type === 'tool' && m.status === 'success')).toBe(true);
  await configure(request, 'edit');
  await send(page, 'Edit the fleet note');
  await saved(page);
  expect(await page.getByLabel('Saved conversations').inputValue()).toBe(first);
  await expect(page.getByTestId('memory-file').locator('pre')).toHaveText(updated, { useInnerText: false });
  await page.getByRole('button', { name: 'New conversation' }).click();
  await configure(request, 'recall');
  await send(page, 'Recall the fleet note');
  await saved(page);
  const second = await page.getByLabel('Saved conversations').inputValue();
  expect(second).not.toBe(first);
  await expect(page.getByRole('region', { name: 'Conversation' })).toContainText('Updated fleet note');
  const authored = (await records(request)).slice(before.length).filter(r => r.path.endsWith('/runs/stream'));
  expect(authored).toHaveLength(3);
  expect(authored.map(r => r.path.split('/')[3])).toEqual([first, first, second]);
  for (const run of authored) { expect(run.body.assistant_id).toBe('da-memory'); expect(run.body.context).toEqual({ memory_scope: scope }); expect(run.body.input.messages).toHaveLength(1); }
  const creates = (await records(request)).slice(before.length).filter(r => r.path === '/api/threads' && r.method === 'POST');
  expect(creates).toHaveLength(2);
  for (const creation of creates) expect(creation.body.if_exists).toBe('raise');
  // The recall reply is scripted per system prompt (shared fixtures): it names
  // the note only when the graph put the stored memory into the model prompt.
  await expect(page.getByRole('region', { name: 'Conversation' })).toContainText('Offline prompt observation: Updated fleet note');
  // The write landed in the real store, under this browser's scope.
  const stored = await (await request.post('/api/store/items/search', { data: { namespace_prefix: ['cockpit', 'deep-agents-memory', 'browser-v1', scope] } })).json();
  expect(stored.items.length).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'New conversation' }).click();
  await configure(request, 'empty');
  await send(page, 'Empty the current store'); await saved(page);
  await expect(page.getByText('The memory file is present and empty.')).toBeVisible();
  const emptyThread = await page.getByLabel('Saved conversations').inputValue();
  const emptyObservation = await (await request.get('/api/threads/' + emptyThread + '/state')).json();
  expect(emptyObservation.values.memory_contents).toEqual({ [file]: '' });
  await page.getByRole('button', { name: 'New conversation' }).click();
  const beforeRestore = await records(request);
  await page.getByLabel('Saved conversations').selectOption(first);
  await saved(page);
  await expect(page.getByTestId('memory-file').locator('pre')).toHaveText(updated, { useInnerText: false });
  const restoreReads = (await records(request)).slice(beforeRestore.length);
  expect(restoreReads.every(r => !r.path.endsWith('/runs/stream') && !(r.path === '/api/threads' && r.method === 'POST'))).toBe(true);
  const restoreRequest = restoreReads.find(r => r.path.endsWith('/state/checkpoint'))!;
  expect(restoreRequest.body.checkpoint.checkpoint_id).not.toBe(current.checkpoint.checkpoint_id);
  const restored = await (await request.post(restoreRequest.path, { data: restoreRequest.body })).json();
  expect(restored.checkpoint).toEqual(restoreRequest.body.checkpoint);
  expect(restored.values.memory_contents).toEqual({ [file]: updated });
  writeFileSync(info.outputPath('historical-read-proof.json'), JSON.stringify({
    nativeSnapshotsExtracted: false, firstTeachCheckpoint: current.checkpoint,
    actualEmptyStoreReadTimeObservation: emptyObservation,
    actualHistoricalReadRequest: restoreRequest, actualHistoricalReadResponse: restored,
  }, null, 2));
  await page.screenshot({ path: info.outputPath('memory-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('memory-mobile.png'), fullPage: true });
  await page.reload();
  await expect(page.getByRole('textbox')).toHaveValue('');
  expect(await page.evaluate(k => localStorage.getItem(k), key)).toBe(scope);
  await configure(request, 'recall');
  await send(page, 'Recall after reload'); await saved(page);
  expect(await page.getByLabel('Saved conversations').inputValue()).not.toBe(second);
  await expect(page.getByText('The memory file is present and empty.')).toBeVisible();
});
for (const scenario of ['recall', 'empty'] as const) test(`missing and present empty remain distinct: ${scenario}`, async ({ page, request }) => {
  await configure(request, scenario); await page.goto(base); await send(page); await saved(page);
  if (scenario === 'recall') { await expect(page.getByText('No memory file at this observation’s read time.')).toBeVisible(); await expect(page.getByTestId('memory-file')).toHaveCount(0); }
  else { await expect(page.getByText('The memory file is present and empty.')).toBeVisible(); await expect(page.getByTestId('memory-file').locator('pre')).toHaveText(''); }
});
for (const scenario of ['fail-initial', 'fail-model', 'fail-terminal', 'oversize'] as const) test(`${scenario} cannot confirm Saved`, async ({ page, request }) => {
  await configure(request, scenario); await page.goto(base); const before = await records(request); await send(page);
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 45000 });
  await expect(page.getByTestId('memory-source')).toHaveText('memory observation unavailable');
  await expect(page.getByRole('status')).not.toHaveText('Response saved.');
  await expect(page.getByRole('textbox')).toBeDisabled();
  expect((await records(request)).slice(before.length).filter(r => r.path.endsWith('/runs/stream'))).toHaveLength(1);
  if (scenario === 'fail-terminal') {
    await page.getByRole('button', { name: 'New conversation' }).click();
    await configure(request, 'recall'); await send(page, 'Recall the write despite failed terminal read'); await saved(page);
    await expect(page.getByTestId('memory-file').locator('pre')).toHaveText(literal, { useInnerText: false });
    await expect(page.getByRole('region', { name: 'Conversation' })).toContainText('Offline prompt observation: Fleet note');
  }
});
for (const mode of ['corrupt', 'unavailable'] as const) test(`storage ${mode} blocks creation`, async ({ page, request }) => {
  await page.addInitScript(({ key, mode }) => { if (mode === 'corrupt') localStorage.setItem(key, 'corrupt'); else Object.defineProperty(Storage.prototype, 'getItem', { value() { throw Error('denied'); } }); }, { key, mode });
  const before = await records(request); await page.goto(base);
  await expect(page.getByTestId('memory-scope-warning')).toBeVisible(); await expect(page.getByRole('textbox')).toBeDisabled();
  await page.getByRole('button', { name: 'New conversation' }).click(); expect(await records(request)).toEqual(before);
});
test('active captured scope settles with warning and later replacement blocks future turns', async ({ page, request }) => {
  await configure(request, 'teach', { holdCheckpoint: true }); await page.goto(base); await send(page);
  await expect(page.getByRole('status')).toHaveText('Confirming saved conversation…');
  const other = await page.context().newPage();
  await other.goto(base);
  await other.evaluate(k => localStorage.setItem(k, crypto.randomUUID()), key);
  await other.close();
  await release(request);
  await expect(page.getByTestId('memory-scope-warning')).toBeVisible();
  await expect(page.getByTestId('memory-source')).toHaveText('confirmed checkpoint at read time');
  const before = await records(request); await page.getByRole('button', { name: 'New conversation' }).click(); await expect(page.getByRole('textbox')).toBeDisabled(); expect(await records(request)).toEqual(before);
});
for (const action of ['replace', 'delete'] as const) test(`same-document scope ${action} is rejected on author admission before creation`, async ({ page, request }) => {
  await configure(request); await page.goto(base); const before = await records(request);
  await page.evaluate(({ key, action }) => { if (action === 'delete') localStorage.removeItem(key); else localStorage.setItem(key, crypto.randomUUID()); }, { key, action });
  await send(page); await expect(page.getByTestId('memory-scope-warning')).toBeVisible();
  await expect(page.getByRole('textbox')).toBeDisabled(); expect(await records(request)).toEqual(before);
});
test('Stop and New invalidate held delivery and never replay', async ({ page, request }) => {
  await configure(request, 'teach', { holdStream: true }); await page.goto(base); const before = await records(request); await send(page);
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stop', exact: true }).click(); await expect(page.getByRole('textbox')).toBeDisabled();
  await page.getByRole('button', { name: 'New conversation' }).click(); await release(request);
  await expect(page.getByRole('status')).toHaveText('Ready.'); await expect(page.getByTestId('memory-file')).toHaveCount(0);
  expect((await records(request)).slice(before.length).filter(r => r.path.endsWith('/runs/stream'))).toHaveLength(1);
});
test('held exact read cannot resurrect the old view after New', async ({ page, request }) => {
  await configure(request, 'teach', { holdCheckpoint: true }); await page.goto(base); await send(page); await expect(page.getByRole('status')).toHaveText('Confirming saved conversation…');
  await page.getByRole('button', { name: 'New conversation' }).click(); await release(request); await expect(page.getByRole('status')).toHaveText('Ready.'); await expect(page.getByTestId('memory-file')).toHaveCount(0); await expect(page.getByLabel('Saved conversations').locator('option')).toHaveCount(1);
});
for (const control of ['failCheckpoint', 'failCreation'] as const) test(`${control} remains unavailable without retries`, async ({ page, request }) => {
  await configure(request, 'teach', { [control]: true }); await page.goto(base); const before = await records(request); await send(page); await expect(page.getByRole('alert')).toBeVisible({ timeout: 45000 }); await expect(page.getByRole('textbox')).toBeDisabled();
  const own = (await records(request)).slice(before.length); expect(own.filter(r => r.path === '/api/threads' && r.method === 'POST')).toHaveLength(1); expect(own.filter(r => r.path.endsWith('/runs/stream'))).toHaveLength(control === 'failCreation' ? 0 : 1); await expect(page.getByRole('status')).not.toHaveText('Response saved.');
});
