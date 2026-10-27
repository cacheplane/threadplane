import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fromPageOrReactPreview } from './fixtures/react-preview-requests';

const origin = 'http://127.0.0.1:4645';
const route = '/docs/chat/components/chat-debug';
const frameURL = /(?:localhost:4645|chat\/debug\/react)/;
const observations = new WeakMap<Page, { errors: string[]; requests: { method: string; url: string; body: string | null }[] }>();
const read = async (request: APIRequestContext, path: string) => (await request.get(origin + path)).json();

async function mode(page: Page, name: 'Docs' | 'Code' | 'Run', width: number) {
  const navigation = width === 390
    ? page.getByRole('dialog')
    : page.locator('[data-workspace-desktop-navigation]');
  if (width === 390) await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await navigation.getByRole('button', { name: name === 'Run' ? /^Run(?:,|$)/ : name, exact: name !== 'Run' }).click();
  await expect(page.locator('[data-workspace-shell]')).toHaveAttribute('data-workspace-mode', name);
  if (width === 390) await expect(navigation).toBeHidden();
  expect(new URL(page.url()).searchParams.get('frontend')).toBe('react');
}

async function file(page: Page, name: string, width: number) {
  if (width === 390) {
    await page.getByRole('tab').filter({ has: page.locator(`[data-tab-close][aria-label="Close ${name}"]`) }).click();
  } else {
    await page.getByRole('complementary', { name: 'File tree' }).getByRole('button', { name, exact: true }).click();
  }
}

test.describe('native Debug Website', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!!process.env['BASE_URL'], 'Compiled graph controls and deterministic providers are local only.');

  test.beforeEach(async ({ page, request }) => {
    const observed = { errors: [] as string[], requests: [] as { method: string; url: string; body: string | null }[] };
    observations.set(page, observed);
    page.on('pageerror', error => observed.errors.push(error.message));
    page.on('request', request => {
      if (/\/threads(?:\/|$)/.test(new URL(request.url()).pathname) && fromPageOrReactPreview(request, frameURL))
        observed.requests.push({ method: request.method(), url: request.url(), body: request.postData() });
    });
    expect((await request.post(origin + '/__reset')).ok()).toBe(true);
  });

  test.afterEach(async ({ page, request }, info) => {
    // Preserve the business ledger before reset reaps workers and clears it.
    for (const path of ['/__requests', '/__captures'])
      await writeFile(info.outputPath(path.slice(3) + '.json'), JSON.stringify(await read(request, path), null, 2));
    await writeFile(info.outputPath('browser-observations.json'), JSON.stringify(observations.get(page), null, 2));
    await writeFile(info.outputPath('page.html'), await page.content());
    await page.goto('about:blank');
    expect((await request.post(origin + '/__release')).ok()).toBe(true);
    expect((await request.post(origin + '/__reset')).ok()).toBe(true);
    await expect.poll(async () => (await read(request, '/__lifetime')).active).toEqual({ children: 0, streams: 0, reads: 0, handlers: 0, responses: 0 });
    const lifetime = await read(request, '/__lifetime');
    for (const child of lifetime.children) {
      expect(child.reaped).toBe(true);
      for (const id of [child.pid, -child.pgid]) {
        let code;
        try { process.kill(id, 0); } catch (error) { code = (error as NodeJS.ErrnoException).code; }
        expect(code).toBe('ESRCH');
      }
    }
    await writeFile(info.outputPath('observed-child-absence.json'), JSON.stringify(lifetime, null, 2));
    expect(observations.get(page)?.errors).toEqual([]);
  });

  for (const width of [1280, 390]) test(`Docs Code Run retains the native Debug owner and exact reads at ${width}`, async ({ page, request }, info) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    expect((await page.goto(route + '?frontend=react'))?.status()).toBe(200);
    await expect(page.locator('[data-workspace-shell]')).toHaveAttribute('data-hydrated', 'true', { timeout: 30000 });
    await expect(page.getByRole('heading', { name: 'React chat debug preview', exact: true })).toBeVisible();
    await expect(page.getByLabel('Example UI')).toHaveValue('react');
    await page.screenshot({ path: info.outputPath('docs.png') });
    await mode(page, 'Code', width);
    const files = ['app.tsx', 'application.ts', 'authority.ts', 'checkpoint-page.ts', 'inspection-values.ts', 'connection.ts', 'main.tsx', 'styles.css', 'project.json', 'graph.py', 'debug.md'];
    for (const name of files) {
      if (width === 390) await expect(page.getByRole('tab').filter({ has: page.locator(`[data-tab-close][aria-label="Close ${name}"]`) })).toHaveCount(1);
      else await expect(page.getByRole('complementary', { name: 'File tree' }).getByRole('button', { name, exact: true })).toBeVisible();
    }
    if (width === 1280) await expect(page.getByRole('complementary', { name: 'File tree' })).not.toContainText(/fixture|\.spec\.|wire\.py|tests\//);
    await file(page, 'connection.ts', width);
    await expect(page.getByRole('tabpanel')).toContainText('readCheckpoint');
    await expect(page.getByRole('tabpanel')).toContainText("assistantId: 'c-debug'");
    await file(page, 'graph.py', width);
    await expect(page.getByRole('tabpanel')).toContainText('TAG_NOSTREAM');
    // Return to the far-left source after selecting a late file, then select
    // the far-right prompt. Both editors must stay inside the viewport.
    await file(page, 'app.tsx', width);
    await expect(page.getByRole('tabpanel')).toContainText('ChatDebug');
    const firstLine = page.getByRole('tabpanel').locator('pre .line').first();
    await expect(firstLine).toBeInViewport();
    const appViewport = await firstLine.boundingBox();
    expect(appViewport?.x).toBeGreaterThanOrEqual(0);
    expect(appViewport?.x).toBeLessThan(width);
    await writeFile(info.outputPath('code-app-viewport.json'), JSON.stringify(appViewport, null, 2));
    await page.screenshot({ path: info.outputPath('code-app.png') });
    await file(page, 'debug.md', width);
    await expect(page.getByRole('tabpanel')).toContainText('aviation');
    await page.screenshot({ path: info.outputPath('code.png') });
    const codeViewport = await page.getByRole('tabpanel').evaluate(panel => {
      const pre = panel.querySelector('pre');
      const range = document.createRange();
      if (!pre?.firstChild) throw Error('Selected source has no rendered text.');
      range.setStart(pre.firstChild, 0);
      range.setEnd(pre.firstChild, Math.min(30, pre.firstChild.textContent?.length ?? 0));
      const text = range.getBoundingClientRect();
      return {
        viewport: { width: innerWidth, height: innerHeight, x: scrollX, y: scrollY },
        text: { x: text.x, y: text.y, width: text.width, height: text.height },
        panel: panel.getBoundingClientRect().toJSON(),
        selected: [...document.querySelectorAll('[role="tab"][aria-selected="true"]')].map(tab => tab.textContent),
        scrollOwners: [...document.querySelectorAll('*')].filter(element => element.scrollLeft || element.scrollTop).map(element => ({ tag: element.tagName, className: element.className, x: element.scrollLeft, y: element.scrollTop, box: element.getBoundingClientRect().toJSON() })),
      };
    });
    await writeFile(info.outputPath('code-viewport.json'), JSON.stringify(codeViewport, null, 2));
    await writeFile(info.outputPath('code.html'), await page.content());
    expect(codeViewport.text.x).toBeGreaterThanOrEqual(0);
    expect(codeViewport.text.x).toBeLessThan(width);
    expect(codeViewport.text.y).toBeGreaterThanOrEqual(0);
    expect(codeViewport.text.y).toBeLessThan(width === 390 ? 844 : 900);
    await mode(page, 'Run', width);
    const iframe = page.locator('iframe');
    await expect(iframe).toHaveAttribute('src', frameURL);
    const original = await iframe.elementHandle();
    const frame = page.frameLocator('iframe');
    const status = frame.locator('main > p[role="status"]:not([aria-label])');
    await expect(status).toHaveText('Ready.');
    const draft = 'Exact unsent aviation draft ✈ café';
    await frame.getByLabel('Message', { exact: true }).fill(draft);
    for (const name of ['Docs', 'Code', 'Run'] as const) await mode(page, name, width);
    // Native history navigation retains frontend=react and the same owner.
    await page.goBack();
    await expect(page.locator('[data-workspace-shell]')).toHaveAttribute('data-workspace-mode', 'Code');
    await page.goForward();
    await expect(page.locator('[data-workspace-shell]')).toHaveAttribute('data-workspace-mode', 'Run');
    expect(new URL(page.url()).searchParams.get('frontend')).toBe('react');
    expect(await iframe.evaluate((node, previous) => node === previous, original)).toBe(true);
    await expect(frame.getByLabel('Message', { exact: true })).toHaveValue(draft);
    expect(await read(request, '/__requests')).toEqual([]);
    expect(observations.get(page)?.requests).toEqual([]);

    await frame.getByLabel('Message', { exact: true }).fill('Explain lift ✈ café');
    await frame.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(status).toHaveText('Response confirmed.');
    await expect(frame.locator('article')).toHaveCount(4);
    const captures = await read(request, '/__captures');
    expect(captures).toHaveLength(1);
    const capture = captures[0];
    expect(capture.proof).toMatchObject({ actualCompiledGraph: true, networkAttempts: 0, providerVariant: 'natural' });
    expect(capture.localCapturedReplay).toBe(true);
    expect(capture.sseSha256).toBe(createHash('sha256').update(capture.sse).digest('hex'));
    expect(capture.state.values.messages.filter((message: { type: string }) => message.type === 'ai')).toHaveLength(3);
    const answer = capture.state.values.messages[1].content;
    expect(capture.state.values.analysis).toEqual({ characters: [...answer].length, words: answer.split(' ').length });
    await frame.getByLabel('Message', { exact: true }).fill('Retained follow-up draft ✈ café');
    await frame.getByRole('button', { name: 'Open debug panel', exact: true }).click();
    await frame.getByRole('tab', { name: 'State', exact: true }).click();
    await expect.poll(async () => JSON.parse(await frame.locator('.tp-debug__value pre').first().textContent() ?? 'null')).toEqual({ analysis: capture.state.values.analysis });
    const historyResponse = page.waitForResponse(response => frameURL.test(response.frame().url()) && response.url().endsWith('/history'));
    await frame.getByRole('button', { name: 'Refresh checkpoints' }).click();
    const history = await (await historyResponse).json();
    const early = history.findIndex((row: { values: { analysis?: unknown; messages?: unknown[] } }) => row.values.analysis === undefined && row.values.messages?.length === 2);
    expect(early).toBeGreaterThanOrEqual(0);
    await frame.getByRole('tab', { name: 'Timeline', exact: true }).click();
    const exactResponse = page.waitForResponse(response => response.url().endsWith('/state/checkpoint'));
    await frame.getByRole('button', { name: /^Inspect / }).nth(early).click();
    const selected = await (await exactResponse).json();
    expect(selected.checkpoint).toEqual(history[early].checkpoint);
    await frame.getByRole('tab', { name: 'State', exact: true }).click();
    const region = frame.getByRole('region', { name: 'Selected checkpoint', exact: true });
    await region.getByText('Displayed checkpoint values', { exact: true }).click();
    await expect(region.locator('pre')).toHaveText('{}');
    await expect.poll(async () => JSON.parse(await frame.locator('.tp-debug__value pre').first().textContent() ?? 'null')).toEqual({ analysis: capture.state.values.analysis });
    const ledger = await read(request, '/__requests');
    const thread = capture.state.checkpoint.thread_id;
    expect(ledger.map((entry: { method: string; path: string }) => [entry.method, entry.path])).toEqual([
      ['POST', '/api/threads'],
      ['POST', `/api/threads/${thread}/runs/stream`],
      ['GET', `/api/threads/${thread}/runs/${capture.runId}`],
      ['GET', `/api/threads/${thread}/state`],
      ['POST', `/api/threads/${thread}/state/checkpoint`],
      ['POST', `/api/threads/${thread}/history`],
      ['POST', `/api/threads/${thread}/history`],
      ['POST', `/api/threads/${thread}/state/checkpoint`],
    ]);
    expect(ledger[1].body.assistant_id).toBe('c-debug');
    expect(ledger[1].body.input.messages[0].content).toBe('Explain lift ✈ café');
    expect(ledger[6].body).toMatchObject({ limit: 10 });
    expect(ledger[7].body.checkpoint).toEqual(history[early].checkpoint);
    await writeFile(info.outputPath('observed-selection.json'), JSON.stringify({ history, selected, current: capture.state, ledger }, null, 2));
    await page.screenshot({ path: info.outputPath('run-inspection.png') });
    await frame.getByRole('button', { name: 'Close debug panel', exact: true }).click();
    for (const name of ['Code', 'Docs', 'Run'] as const) await mode(page, name, width);
    expect(await iframe.evaluate((node, previous) => node === previous, original)).toBe(true);
    await expect(frame.getByLabel('Message', { exact: true })).toHaveValue('Retained follow-up draft ✈ café');
    await expect(frame.locator('article')).toHaveCount(4);
    expect(await read(request, '/__requests')).toEqual(ledger);
    expect(observations.get(page)?.requests).toHaveLength(8);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test('keeps Angular canonical and selects native React explicitly without business requests', async ({ page, request }) => {
    await page.goto(route);
    await expect(page.locator('[data-workspace-shell]')).toHaveAttribute('data-hydrated', 'true', { timeout: 30000 });
    await expect(page.getByLabel('Example UI')).toHaveValue('angular');
    await expect(page.getByRole('heading', { name: 'ChatDebugComponent', exact: true })).toBeVisible();
    await page.getByLabel('Example UI').selectOption('react');
    await expect(page).toHaveURL(/frontend=react/);
    await expect(page.getByRole('heading', { name: 'React chat debug preview', exact: true })).toBeVisible();
    expect(await read(request, '/__requests')).toEqual([]);
    expect(observations.get(page)?.requests).toEqual([]);
  });
});
