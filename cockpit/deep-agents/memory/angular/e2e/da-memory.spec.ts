import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
const backend = 'http://localhost:5313';
const key = 'threadplane.deep-agents-memory.scope.v1';
async function records(request: APIRequestContext) { return (await request.get(backend + '/__requests')).json(); }
async function configure(request: APIRequestContext, scenario: string) {
  expect((await request.post(backend + '/__configure', { data: { scenario, holdStream: false, holdState: false, holdCheckpoint: false, failCreation: false, failStream: false, failCheckpoint: false } })).ok()).toBe(true);
}
async function send(page: Page, text: string) { await page.getByRole('textbox', { name: /message|prompt/i }).fill(text); await page.getByRole('button', { name: /send message/i }).click(); }
test.afterEach(async ({ request }, info) => {
  mkdirSync(info.outputDir, { recursive: true });
  for (const endpoint of ['requests', 'raw-events', 'graph-proof']) {
    const data = await (await request.get(backend + '/__' + endpoint)).json();
    writeFileSync(info.outputPath(endpoint + '.json'), JSON.stringify(data, null, 2));
    if (endpoint === 'graph-proof') for (const proof of data) { expect(proof.actualCompiledGraph).toBe(true); expect(proof.networkConnectAttempts).toBe(0); }
  }
});
test('canonical Angular auto-send suggestion, provider-owned followup and scoped reload recall use real store', async ({ page, request }) => {
  await configure(request, 'teach'); const before = await records(request); await page.goto('/');
  expect(await records(request)).toEqual(before);
  const scope = await page.evaluate(k => localStorage.getItem(k), key);
  // The older Angular suggestion explicitly sends; React suggestions are drafts.
  await page.getByText('Tell it about your operation', { exact: true }).click();
  await expect(page.getByTestId('memory-line').first()).toHaveText('Fleet note', { timeout: 45000 });
  await expect(page.getByTestId('memory-source')).toHaveAttribute('data-source', 'live');
  // Angular retains trimmed nonblank lines rather than React's literal pre.
  await expect(page.getByTestId('memory-line')).toHaveText(['Fleet note', 'Ω literal whitespace']);
  await expect(page.getByRole('button', { name: /send message/i })).toBeVisible();
  await configure(request, 'edit'); await send(page, 'Edit the fleet note');
  await expect(page.getByTestId('memory-line').first()).toHaveText('Updated fleet note', { timeout: 45000 });
  let own = (await records(request)).slice(before.length); const authored = own.filter((r: any) => r.path.endsWith('/runs/stream'));
  expect(authored).toHaveLength(2); expect(authored[0].path).toBe(authored[1].path);
  expect(own.filter((r: any) => r.path === '/api/threads' && r.method === 'POST')).toHaveLength(1);
  await page.reload(); expect(await page.evaluate(k => localStorage.getItem(k), key)).toBe(scope);
  await configure(request, 'recall'); await send(page, 'Recall the fleet note');
  await expect(page.getByTestId('memory-line').first()).toHaveText('Updated fleet note', { timeout: 45000 });
  own = (await records(request)).slice(before.length); const runs = own.filter((r: any) => r.path.endsWith('/runs/stream'));
  expect(runs).toHaveLength(3); expect(runs[2].path).not.toBe(runs[0].path);
  for (const run of runs) expect(run.body.context).toEqual({ memory_scope: scope });
  const raw = await (await request.get(backend + '/__raw-events')).json();
  expect(raw.at(-1).modelPrompts.some((p: string) => p.includes('Updated fleet note'))).toBe(true);
  expect(raw.some((r: any) => r.storeOperations.some((op: any) => op.type === 'PutOp'))).toBe(true);
  await configure(request, 'empty'); await send(page, 'Empty the current store');
  // Count zero also occurs during custom-event reset. Establish the actual
  // preceding author's terminal empty observation and provider settlement
  // before measuring the later read-only restoration window.
  await expect.poll(async () => (await records(request)).slice(before.length).filter((r: any) => r.path.endsWith('/runs/stream')).length).toBe(4);
  const emptyRun = (await records(request)).slice(before.length).filter((r: any) => r.path.endsWith('/runs/stream')).at(-1);
  expect(emptyRun.path).toBe(runs[2].path);
  expect(emptyRun.body.input.messages[0].content).toBe('Empty the current store');
  expect(emptyRun.body.context).toEqual({ memory_scope: scope });
  await expect.poll(async () => {
    const actual = (await (await request.get(backend + '/__raw-events')).json()).at(-1);
    if (actual.threadId !== emptyRun.path.split('/')[3]) return undefined;
    const events = actual.events;
    return events.filter((event: any) => event[1] === 'custom' && event[2].data.phase === 'terminal').at(-1)?.[2].data.memory_contents;
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
  await expect(page.getByTestId('memory-line').first()).toHaveText('Updated fleet note');
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
