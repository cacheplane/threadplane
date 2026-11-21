import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
const backend = 'http://localhost:5313';
const key = 'threadplane.deep-agents-memory.scope.v1';
async function records(request: APIRequestContext) { return (await request.get(backend + '/__requests')).json(); }
// Backend: aimock replays ./fixtures (shared with the React example; scenarios
// are tagged prompts) into a real `langgraph dev` with a real store, behind the
// recording proxy (global-setup-impl.ts, scripts/react-cockpit/langgraph-proxy.mjs).
// The fail-* scenarios stand in for a store read failing inside the graph at
// one observation phase, which aimock can't cause: the browser's stream ends
// with the graph's own error just before that phase's memory event (injected;
// cockpit/deep-agents/memory/python/tests covers the real failure).
const failures: Record<string, [scenario: string, phase: string]> = {
  'fail-initial': ['recall', 'initial'], 'fail-model': ['recall', 'model'], 'fail-terminal': ['teach', 'terminal'],
};
let scenario = 'teach';
async function configure(request: APIRequestContext, next: string) {
  const failure = failures[next];
  scenario = failure ? failure[0] : next;
  if (failure) expect((await request.post(backend + '/__stream/cut', { data: {
    beforePattern: `"phase": ?"${failure[1]}"`,
    error: { error: 'MemoryObservationError', message: 'Memory observation unavailable' },
  } })).ok()).toBe(true);
}
async function send(page: Page, text: string) {
  // The scenario tag selects the scripted model turns (shared fixtures).
  await page.getByRole('textbox', { name: /message|prompt/i }).fill(`${text} [scenario:${scenario}]`);
  await page.getByRole('button', { name: /send message/i }).click();
}
/** Server-sent events as the real server framed them (CRLF or LF). */
function events(text: string) {
  return text.split(/\r?\n\r?\n/).filter(Boolean).map(block => {
    const lines = block.split(/\r?\n/);
    return { event: lines.find(line => line.startsWith('event: '))!.slice(7), data: JSON.parse(lines.find(line => line.startsWith('data: '))!.slice(6)) };
  });
}
test.beforeEach(async ({ request }) => { await request.post(backend + '/__reset'); scenario = 'teach'; });
test.afterEach(async ({ request }, info) => {
  mkdirSync(info.outputDir, { recursive: true });
  for (const endpoint of ['requests', 'captures']) {
    const data = await (await request.get(backend + '/__' + endpoint)).json();
    writeFileSync(info.outputPath(endpoint + '.json'), JSON.stringify(data, null, 2));
  }
});
test('canonical Angular auto-send suggestion, provider-owned followup and scoped reload recall use real store', async ({ page, request }) => {
  await configure(request, 'teach'); const before = await records(request); await page.goto('/');
  expect(await records(request)).toEqual(before);
  const scope = await page.evaluate(k => localStorage.getItem(k), key);
  // The older Angular suggestion explicitly sends; React suggestions are drafts.
  // Its recorded prompt replays the recorded model turns (ls, then write_file).
  await page.getByText('Tell it about your operation', { exact: true }).click();
  await expect(page.getByTestId('memory-line').first()).toHaveText('## Crew notes', { timeout: 45000 });
  await expect(page.getByTestId('memory-source')).toHaveAttribute('data-source', 'live');
  // Angular retains trimmed nonblank lines rather than React's literal pre.
  await expect(page.getByTestId('memory-line')).toHaveText(['## Crew notes', '- Aircraft: Citation CJ3', '- Home base: KASE', '- Briefing preference: Always provide briefings in bullet points']);
  await expect(page.getByRole('button', { name: /send message/i })).toBeVisible();
  await configure(request, 'edit-crew'); await send(page, 'Edit the crew notes');
  await expect(page.getByTestId('memory-line').first()).toHaveText('## Updated crew notes', { timeout: 45000 });
  let own = (await records(request)).slice(before.length); const authored = own.filter((r: any) => r.path.endsWith('/runs/stream'));
  expect(authored).toHaveLength(2); expect(authored[0].path).toBe(authored[1].path);
  expect(own.filter((r: any) => r.path === '/api/threads' && r.method === 'POST')).toHaveLength(1);
  await page.reload(); expect(await page.evaluate(k => localStorage.getItem(k), key)).toBe(scope);
  await configure(request, 'recall'); await send(page, 'Recall the crew notes');
  await expect(page.getByTestId('memory-line').first()).toHaveText('## Updated crew notes', { timeout: 45000 });
  own = (await records(request)).slice(before.length); const runs = own.filter((r: any) => r.path.endsWith('/runs/stream'));
  expect(runs).toHaveLength(3); expect(runs[2].path).not.toBe(runs[0].path);
  for (const run of runs) expect(run.body.context).toEqual({ memory_scope: scope });
  // The recall reply is scripted per system prompt (shared fixtures): it names
  // the notes only when the graph put the stored memory into the model prompt.
  await expect(page.getByText('Offline prompt observation: Updated crew notes')).toBeVisible();
  // The writes landed in the real store, under this browser's scope.
  const stored = await (await request.post(backend + '/store/items/search', { data: { namespace_prefix: ['cockpit', 'deep-agents-memory', 'browser-v1', scope] } })).json();
  expect(stored.items.length).toBeGreaterThan(0);
  await configure(request, 'empty'); await send(page, 'Empty the current store');
  // Count zero also occurs during custom-event reset. Establish the actual
  // preceding author's terminal empty observation and provider settlement
  // before measuring the later read-only restoration window.
  await expect.poll(async () => (await records(request)).slice(before.length).filter((r: any) => r.path.endsWith('/runs/stream')).length).toBe(4);
  const emptyRun = (await records(request)).slice(before.length).filter((r: any) => r.path.endsWith('/runs/stream')).at(-1);
  expect(emptyRun.path).toBe(runs[2].path);
  expect(emptyRun.body.input.messages[0].content).toBe('Empty the current store [scenario:empty]');
  expect(emptyRun.body.context).toEqual({ memory_scope: scope });
  await expect.poll(async () => {
    // What the real server streamed for that run, as the proxy received it.
    const actual = (await (await request.get(backend + '/__captures')).json()).at(-1);
    if (!actual?.path.includes(`/threads/${emptyRun.path.split('/')[3]}/`)) return undefined;
    return events(actual.sse).filter(event => event.event === 'custom' && event.data.data.phase === 'terminal').at(-1)?.data.data.memory_contents;
  }).toEqual({ '/memories/AGENTS.md': '' });
  await expect.poll(() => page.evaluate(() => {
    const debug = (window as unknown as { ng: { getComponent(element: Element): { agent: { isLoading(): boolean } } } }).ng;
    return debug.getComponent(document.querySelector('app-da-memory')!).agent.isLoading();
  })).toBe(false);
  await expect(page.getByTestId('memory-line')).toHaveCount(0);
  const beforeRestore = await records(request);
  const firstThread = runs[0].path.split('/')[3];
  // Exercise the real public provider restoration method through Angular's
  // development debug API; the product has no saved-history selector.
  // This performs SDK reads, never injects synthetic state or custom events.
  await page.evaluate(thread => {
    const debug = (window as unknown as { ng: { getComponent(element: Element): { agent: { switchThread(id: string): void } } } }).ng;
    debug.getComponent(document.querySelector('app-da-memory')!).agent.switchThread(thread);
  }, firstThread);
  await expect(page.getByTestId('memory-source')).toHaveAttribute('data-source', 'checkpoint');
  await expect(page.getByTestId('memory-line').first()).toHaveText('## Updated crew notes');
  const restoredReads = (await records(request)).slice(beforeRestore.length);
  expect(restoredReads.length).toBeGreaterThan(0);
  expect(restoredReads.every((r: any) => !r.path.endsWith('/runs/stream') && !(r.path === '/api/threads' && r.method === 'POST'))).toBe(true);
});
test('ordinary composer with corrupt scope cannot create or run', async ({ page, request }) => {
  await page.addInitScript(k => localStorage.setItem(k, 'corrupt'), key);
  const before = await records(request); await page.goto('/');
  await expect(page.getByTestId('memory-scope-warning')).toBeVisible();
  const composer = page.getByRole('textbox', { name: /message|prompt/i });
  if (await composer.isEnabled()) { await composer.fill('ordinary chat'); await composer.press('Enter'); }
  expect(await records(request)).toEqual(before);
});
for (const scenario of ['fail-initial', 'fail-model', 'fail-terminal', 'oversize']) test(`Angular ${scenario} shows unavailable read evidence`, async ({ page, request }) => {
  await configure(request, scenario); await page.goto('/'); const before = await records(request); await send(page, 'Observe memory');
  await expect(page.getByTestId('memory-source')).toHaveAttribute('data-source', 'unavailable', { timeout: 45000 });
  await expect(page.getByTestId('memory-file')).toHaveCount(0);
  expect((await records(request)).slice(before.length).filter((r: any) => r.path.endsWith('/runs/stream'))).toHaveLength(1);
});
