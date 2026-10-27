import { test, expect, type Page, type APIRequestContext, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const base = '/chat/a2ui/react/';
const current = (page: Page) => page.getByRole('region', { name: 'Current flight preview', exact: true });
const earlier = (page: Page) => page.getByRole('region', { name: 'Earlier flight preview', exact: true });
const lifetime = async (request: APIRequestContext) => (await request.get('/__lifetime')).json();
const streamRequests = (receipt: any) => receipt.requests.filter((r: any) => r.method === 'POST' && r.path.endsWith('/runs/stream'));
async function save(request: APIRequestContext, info: TestInfo, extra: unknown = {}) {
  const path = info.outputPath('actual-graph-and-transport.json');
  await writeFile(path, JSON.stringify({ receipt: await lifetime(request), extra }, null, 2));
  await info.attach('actual-graph-and-transport.json', { path, contentType: 'application/json' });
}
async function form(page: Page) {
  await page.getByRole('button', { name: 'Try a flight request' }).click();
  await page.getByRole('textbox', { name: 'Message', exact: true }).press('Enter');
  await expect(current(page).getByRole('heading', { name: 'Book a flight' })).toBeVisible();
}
async function edit(page: Page) {
  await current(page).getByLabel('Origin', { exact: true }).selectOption('SFO');
  await current(page).getByLabel('Destination', { exact: true }).selectOption('SEA');
  await current(page).getByLabel('Departure date (YYYY-MM-DD)', { exact: true }).fill('2027-02-17');
  await current(page).getByLabel('Passengers', { exact: true }).fill('3');
  await current(page).getByLabel('Fare class', { exact: true }).selectOption('Business');
}
async function restored(page: Page) {
  await expect(current(page).getByLabel('Origin', { exact: true })).toHaveValue('SFO');
  await expect(current(page).getByLabel('Destination', { exact: true })).toHaveValue('SEA');
  await expect(current(page).getByLabel('Departure date (YYYY-MM-DD)', { exact: true })).toHaveValue('2027-02-17');
  await expect(current(page).getByLabel('Passengers', { exact: true })).toHaveValue('3');
  await expect(current(page).getByLabel('Fare class', { exact: true })).toHaveValue('Business');
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}
test.beforeEach(async ({ page, request }) => {
  await request.post('/__reset');
  await page.goto(base);
  await expect(page.getByRole('heading', { name: 'Plan a flight' })).toBeVisible();
});

test('installed native application saves request, edited Search, Select and server-restored Modify', async ({ page, request }, info) => {
  const exactReads: any[] = [];
  page.on('response', async response => {
    if (response.url().endsWith('/state/checkpoint') && response.status() === 200)
      exactReads.push(await response.json());
  });
  expect((await lifetime(request)).requests).toEqual([]);
  await page.getByRole('button', { name: 'Try a flight request' }).click();
  expect((await lifetime(request)).requests).toEqual([]);
  await page.getByRole('textbox', { name: 'Message', exact: true }).press('Enter');
  await expect(current(page).getByLabel('Origin', { exact: true })).toHaveValue('LAX');
  await expect(current(page).getByLabel('Destination', { exact: true })).toHaveValue('JFK');
  await expect(current(page).getByLabel('Passengers', { exact: true })).toHaveValue('1');
  await edit(page);
  await page.screenshot({ path: info.outputPath('desktop-edited-form.png'), fullPage: true });
  await current(page).getByRole('button', { name: 'Search flights', exact: true }).click();
  await expect(current(page).getByRole('heading', { name: 'UA flight UA204' })).toBeVisible();
  await expect(earlier(page).getByLabel('Passengers', { exact: true })).toBeDisabled();
  await expect(earlier(page).getByLabel('Passengers', { exact: true })).toHaveValue('3');
  await current(page).getByRole('button', { name: 'Select', exact: true }).click();
  await expect(current(page).getByRole('button', { name: 'Modify search', exact: true })).toBeVisible();
  await expect(current(page)).toContainText('UA flight UA204');
  await expect(current(page)).toContainText('3 passengers');
  await expect(current(page)).toContainText('Business');
  await page.screenshot({ path: info.outputPath('desktop-confirmation.png'), fullPage: true });
  await current(page).getByRole('button', { name: 'Modify search', exact: true }).click();
  await restored(page);
  await expect(earlier(page)).toHaveCount(3);
  const receipt = await lifetime(request), runs = streamRequests(receipt);
  const creation = receipt.requests.filter((r: any) => r.path === '/api/threads' && r.method === 'POST');
  expect(creation).toHaveLength(1);
  expect(runs).toHaveLength(4);
  const threadId = creation[0].body.thread_id;
  expect(runs.every((r: any) => r.path === `/api/threads/${threadId}/runs/stream` && r.body.assistant_id === 'c-a2ui' && r.body.input.messages.length === 1)).toBe(true);
  expect(new Set(runs.map((r: any) => r.body.input.messages[0].id)).size).toBe(4);
  const search = JSON.parse(runs[1].body.input.messages[0].content);
  expect(search.action).toMatchObject({ name: 'bookingSubmit', surfaceId: 'booking', context: { formId: 'booking', origin: ['SFO'], dest: ['SEA'], date: '2027-02-17', passengers: 3, fare_class: ['Business'] } });
  expect(JSON.parse(runs[2].body.input.messages[0].content).action).toMatchObject({ name: 'flightSelect', context: { flightId: 'UA204' } });
  expect(JSON.parse(runs[3].body.input.messages[0].content).action.name).toBe('modifySearch');
  expect(receipt.runReads).toHaveLength(4);
  expect(receipt.runReads.every((r: any) => r.run.status === 'success' && r.threadId === threadId)).toBe(true);
  expect(new Set(receipt.runReads.map((r: any) => r.run.run_id)).size).toBe(4);
  await expect.poll(() => exactReads.length).toBe(4);
  for (const [index, state] of exactReads.entries()) {
    expect(state.checkpoint).toMatchObject({ thread_id: threadId, checkpoint_ns: '' });
    expect(state.checkpoint.checkpoint_id).toBeTruthy();
    expect(state.next).toEqual([]); expect(state.tasks).toEqual([]);
    expect(state.values.messages).toHaveLength((index + 1) * 2);
    expect(state.values.messages.at(-2).id).toBe(runs[index].body.input.messages[0].id);
  }
  expect(receipt.proofs.every((p: any) => p.actualCompiledGraph && p.networkConnectAttempts === 0 && p.sourceSha256 === '9a54abf5d03dfd7d285265fc4f3c37ca3b5a830dee319cf52093584907ea8462' && p.lockSha256 === '56247b7f8c8a4cd27f43238a3c99f37f251c8e3a850a94d1761d7ac472abf303')).toBe(true);
  expect(JSON.stringify(receipt.proofs)).toContain('_find_routes_impl');
  expect(JSON.stringify(receipt.events)).toContain('generate_title');
  expect(JSON.stringify(receipt.events)).toContain('messages');
  await save(request, info, { exactReads });
});

test('invalid lexical drafts and direct user activation send zero actions; rapid valid Search sends exactly one', async ({ page, request }, info) => {
  await form(page);
  const passengers = current(page).getByLabel('Passengers', { exact: true });
  const search = current(page).getByRole('button', { name: 'Search flights', exact: true });
  for (const lexical of ['', '9007199254740992', '0']) {
    await passengers.fill(lexical);
    await search.click();
    await expect(passengers).toHaveValue(lexical);
    await expect(passengers).toHaveAttribute('aria-invalid', 'true');
    await expect(current(page).getByText('Enter a positive safe whole number.')).toBeVisible();
    expect(streamRequests(await lifetime(request))).toHaveLength(1);
  }
  await passengers.fill('3');
  await current(page).getByLabel('Origin', { exact: true }).selectOption('LAX');
  await current(page).getByLabel('Destination', { exact: true }).selectOption('LAX');
  await search.click();
  await expect(current(page).getByText('Choose different origin and destination airports.')).toBeVisible();
  await expect(current(page).getByText('Enter a real date as YYYY-MM-DD.')).toBeVisible();
  expect(streamRequests(await lifetime(request))).toHaveLength(1);
  await edit(page);
  await request.post('/__hold/stream');
  await search.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect.poll(async () => (await lifetime(request)).heldCompleted).toBe(1);
  expect(streamRequests(await lifetime(request))).toHaveLength(2);
  await request.post('/__release');
  await expect(current(page).getByRole('button', { name: 'Select', exact: true })).toBeVisible();
  const runs = streamRequests(await lifetime(request));
  expect(runs).toHaveLength(2);
  const action = JSON.parse(runs[1].body.input.messages[0].content);
  expect(action.action.context).toMatchObject({ origin: ['SFO'], dest: ['SEA'], date: '2027-02-17', passengers: 3, fare_class: ['Business'] });
  expect(runs[1].body.input.messages[0].content).not.toMatch(/NaN|"passengers":0/);
  await save(request, info, { invalidDrafts: ['', '9007199254740992', '0', 'same-airports', 'empty-date'] });
});

test('untrusted saved boundaries fail closed, retain prior cards, and late held delivery cannot restore Stop or New', async ({ page, request }, info) => {
  const failures: any[] = [];
  for (const mode of ['checkpoint', 'task', 'title', 'structured-prefix', 'catalog', 'view', 'exact-read']) {
    await page.getByRole('button', { name: 'New conversation', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Ready.');
    let exact = 0;
    await page.route('**/api/**', async route => {
      const response = await route.fetch();
      const exactRequest = route.request().url().endsWith('/state/checkpoint');
      if (exactRequest) exact++;
      if (mode === 'catalog' || mode === 'view') {
        const text = await response.text();
        return route.fulfill({ response, body: mode === 'catalog' ? text.replaceAll('catalog.json', 'unknown.json') : text.replaceAll('Column', 'Slider') });
      }
      if (!exactRequest) return route.fulfill({ response });
      if (mode === 'exact-read') return route.fulfill({ status: 503, json: { error: 'Deliberate exact-read failure' } });
      const value = await response.json();
      if (mode === 'checkpoint') value.checkpoint.checkpoint_id = 'wrong-root';
      if (mode === 'task') value.tasks = [{ id: 'unfinished', name: 'build_form' }];
      if (mode === 'title') value.values.messages.at(-1).name = 'generate_title';
      if (mode === 'structured-prefix') value.values.messages.at(-1).content = [{ type: 'text', text: value.values.messages.at(-1).content }];
      await route.fulfill({ response, json: value });
    });
    await page.getByRole('button', { name: 'Try a flight request' }).click();
    await page.getByRole('textbox', { name: 'Message', exact: true }).press('Enter');
    await expect(page.getByRole('status')).toHaveText('Start a new conversation to continue.');
    await expect(current(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Search flights', exact: true })).toHaveCount(0);
    failures.push({ mode, exactReads: exact });
    expect(exact).toBe(1);
    await page.unroute('**/api/**');
  }
  await page.getByRole('button', { name: 'New conversation', exact: true }).click();
  await form(page); await edit(page);
  await page.route('**/state/checkpoint', route => route.fulfill({ status: 503, json: {} }));
  await current(page).getByRole('button', { name: 'Search flights', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Start a new conversation to continue.');
  await expect(earlier(page).getByLabel('Passengers', { exact: true })).toHaveValue('3');
  await expect(earlier(page).getByLabel('Passengers', { exact: true })).toBeDisabled();
  await page.unroute('**/state/checkpoint');
  for (const command of ['Stop', 'New conversation']) {
    await page.getByRole('button', { name: 'New conversation', exact: true }).click();
    await form(page); await edit(page);
    await request.post('/__hold/stream');
    await current(page).getByRole('button', { name: 'Search flights', exact: true }).click();
    await expect.poll(async () => (await lifetime(request)).heldCompleted).toBe(1);
    await page.getByRole('button', { name: command, exact: true }).click();
    await expect.poll(async () => (await lifetime(request)).heldStreams).toBe(0);
    await request.post('/__release');
    await expect(current(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Select', exact: true })).toHaveCount(0);
  }
  await save(request, info, { failures, lifetimeMeaning: 'Actual graph completed; HTTP delivery was held. No server-side graph-cancellation claim.' });
});

test('390px keyboard workflow remains readable and pagehide revokes held HTTP delivery and views', async ({ page, request }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Try a flight request' }).focus();
  await page.keyboard.press('Enter');
  const message = page.getByRole('textbox', { name: 'Message', exact: true });
  await message.focus(); await page.keyboard.press('Enter');
  await expect(current(page).getByLabel('Origin', { exact: true })).toBeVisible();
  await edit(page); await noOverflow(page);
  await current(page).getByLabel('Origin', { exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(current(page).getByLabel('Destination', { exact: true })).toBeFocused();
  await page.screenshot({ path: info.outputPath('mobile-form.png'), fullPage: true });
  await current(page).getByRole('button', { name: 'Search flights', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(current(page).getByRole('button', { name: 'Select', exact: true })).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('mobile-results.png'), fullPage: true });
  await current(page).getByRole('button', { name: 'Select', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(current(page).getByRole('button', { name: 'Modify search', exact: true })).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('mobile-confirmation.png'), fullPage: true });
  await request.post('/__hold/stream');
  await current(page).getByRole('button', { name: 'Modify search', exact: true }).click();
  await expect.poll(async () => (await lifetime(request)).heldCompleted).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect(page.locator('#root')).toBeEmpty();
  await expect.poll(async () => (await lifetime(request)).heldStreams).toBe(0);
  await request.post('/__release');
  await expect(page.locator('#root')).toBeEmpty();
  const receipt = await lifetime(request);
  expect(receipt.streamCloses.some((closed: any) => closed.held && closed.destroyed)).toBe(true);
  expect(streamRequests(receipt)).toHaveLength(4);
  await save(request, info, { scope: 'Chromium desktop/mobile viewport, labels, Tab/Enter, synthetic pagehide; graph completed before held HTTP close.' });
});
