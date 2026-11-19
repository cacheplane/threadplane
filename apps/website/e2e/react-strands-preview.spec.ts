import { selectWorkspaceMode } from './fixtures/workspace-controls';
import { writeFile } from 'node:fs/promises';
import { test, expect, type Page, type Locator, type APIRequestContext } from '@playwright/test';

const origin = 'http://127.0.0.1:4643';
const approved = 'Meeting booked for Tuesday 10:00: Q3 roadmap review';
const rejected = 'The human declined. Meeting NOT booked: Q3 roadmap review';
const browserErrors = new WeakMap<Page, string[]>();
// The preview's backend: aimock replays cockpit/runtimes/aws-strands/angular/e2e/fixtures
// into the example's real Strands AG-UI server, behind the recording proxy
// (scripts/react-cockpit/ag-ui-proxy.mjs): /__requests lists each agent POST with the
// events the server streamed (`events`) and what the browser got (`sent`).
const runs = async (request: APIRequestContext) => (await request.get(origin + '/__requests')).json();
const model = async (request: APIRequestContext) => (await request.get(origin + '/__model-requests')).json();
async function mode(page: Page, name: 'Docs' | 'Code' | 'Run') {
  await selectWorkspaceMode(page, name);
}
async function fits(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeVisible();
  expect(await locator.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= innerWidth + 1 && element.scrollWidth <= element.clientWidth + 1;
  })).toBe(true);
}

test.describe('native Strands Website', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!!process.env['BASE_URL'], 'The aimock-backed preview is local only.');
  test.beforeEach(async ({ page, request }) => {
    const errors: string[] = [];
    browserErrors.set(page, errors);
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    expect((await request.post(origin + '/__reset')).ok()).toBe(true);
  });
  test.afterEach(async ({ page, request }, info) => {
    await writeFile(info.outputPath('browser-errors.json'), JSON.stringify(browserErrors.get(page), null, 2));
    await writeFile(info.outputPath('dom.html'), await page.content());
    await page.screenshot({ path: info.outputPath('final-page.png') });
    await page.goto('about:blank');
    await writeFile(info.outputPath('actual-service-evidence.json'), JSON.stringify({ runs: await runs(request), model: await model(request) }, null, 2));
    expect(browserErrors.get(page)).toEqual([]);
  });
  for (const width of [1280, 390]) for (const decision of ['Approve', 'Decline'] as const) {
    test(`Docs Code Run and actual native ${decision} at ${width}`, async ({ page, request }, info) => {
      test.setTimeout(90000);
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      const response = await page.goto('/docs/react/runtimes/aws-strands/overview');
      expect(response?.status()).toBe(200);
      await expect(page.locator('[data-workspace-shell]')).toHaveAttribute('data-hydrated', 'true', { timeout: 30000 });
      await expect(page.getByRole('heading', { name: 'React AWS Strands meeting preview', exact: true })).toBeVisible();
      await expect(page.locator('[data-example-file="cockpit/runtimes/aws-strands/react/src/approval-policy.ts"]')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath('docs.png') });
      await mode(page, 'Code');
      const tree = page.getByRole('complementary', { name: 'File tree' });
      const files = ['app.tsx', 'application.ts', 'approval-policy.ts', 'schedule-projection.ts', 'connection.ts', 'main.tsx', 'styles.css', 'project.json', 'agent.py', 'server.py', 'subagent_emitter.py', 'aws-strands.md'];
      if (width === 390) {
        const tab = (file: string) => page.getByRole('tab').filter({ has: page.locator(`[data-tab-close][aria-label="Close ${file}"]`) });
        for (const file of files) await expect(tab(file)).toHaveCount(1);
        await tab('application.ts').click();
      } else {
        for (const file of files) await expect(tree.getByRole('button', { name: file, exact: true })).toBeVisible();
        await expect(tree).not.toContainText(/fixture|\.spec\.|type-test|model\.py|probe|helper/);
        await tree.getByRole('button', { name: 'application.ts', exact: true }).click();
      }
      await expect(page.getByRole('tabpanel')).toContainText('p.methods.resume.call');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath('code.png') });
      await mode(page, 'Run');
      await expect(page.locator('iframe')).toHaveAttribute('src', /^http:\/\/localhost:4643\/\?cockpit_did=/);
      const frame = page.frameLocator('iframe');
      await expect(frame.getByRole('status')).toHaveText('Ready.');
      await frame.getByRole('button', { name: 'Q3 roadmap review', exact: true }).click();
      const iframe = await page.locator('iframe').elementHandle();
      const draft = await frame.getByRole('textbox', { name: 'Message', exact: true }).inputValue();
      expect(draft).toContain('Q3 roadmap review');
      for (const destination of ['Docs', 'Code', 'Run'] as const) {
        await mode(page, destination);
        expect(await page.locator('iframe').evaluate((element, original) => element === original, iframe)).toBe(true);
      }
      await expect(frame.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(draft);
      expect(await runs(request)).toHaveLength(0);
      await frame.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(frame.getByRole('status')).toHaveText('Awaiting your decision.');
      for (const control of [frame.getByRole('button', { name: 'Approve', exact: true }), frame.getByRole('button', { name: 'Decline', exact: true }), frame.getByRole('textbox', { name: 'Message', exact: true }), frame.getByRole('status')]) await fits(control);
      await expect(frame.locator('.tp-approval-card')).toContainText('Q3 roadmap review');
      await fits(frame.locator('.tp-approval-card'));
      await page.screenshot({ path: info.outputPath('approval.png') });
      const before = await runs(request);
      expect(before).toHaveLength(1);
      const initial = before[0];
      expect(initial.sent).toEqual(initial.events);
      const pause = initial.events.find((event: { type: string }) => event.type === 'RUN_FINISHED');
      expect(pause).toMatchObject({ runId: initial.body.runId, threadId: initial.body.threadId, outcome: { type: 'interrupt' } });
      expect(pause.outcome.interrupts).toHaveLength(1);
      expect(initial.events.some((event: { type: string; content?: string }) => event.type === 'TOOL_CALL_RESULT' && /booked/i.test(event.content ?? ''))).toBe(false);
      expect(pause.outcome.interrupts[0]).toMatchObject({ reason: 'book_meeting', metadata: { reason: { topic: 'Q3 roadmap review', slot: 'Tuesday 10:00' } } });
      await frame.getByRole('button', { name: decision, exact: true }).click();
      await expect(frame.getByRole('status')).toHaveText(decision === 'Approve' ? 'Fictional meeting booked.' : 'Meeting declined.');
      const literal = decision === 'Approve' ? approved : rejected;
      const result = frame.getByRole('region', { name: 'Observed backend result' }).locator('pre');
      await expect(result).toHaveText(literal);
      for (const control of [result, frame.getByRole('textbox', { name: 'Message', exact: true }), frame.getByRole('button', { name: 'Send', exact: true }), frame.getByRole('button', { name: 'New conversation', exact: true }), frame.getByRole('status')]) await fits(control);
      await page.screenshot({ path: info.outputPath('result.png') });
      const after = await runs(request);
      expect(after).toHaveLength(2);
      const resumed = after[1];
      expect(resumed.body.threadId).toBe(initial.body.threadId);
      expect(resumed.body.resume).toEqual([{ interruptId: pause.outcome.interrupts[0].id, status: 'resolved', payload: { approved: decision === 'Approve' } }]);
      expect(resumed.body.forwardedProps).not.toHaveProperty('command');
      expect(resumed.sent).toEqual(resumed.events);
      expect(resumed.events.find((event: { type: string }) => event.type === 'RUN_FINISHED')).toMatchObject({ runId: resumed.body.runId, threadId: resumed.body.threadId });
      expect(resumed.body.runId).not.toBe(initial.body.runId);
      const canonical = resumed.events.filter((event: { type: string }) => event.type === 'MESSAGES_SNAPSHOT').at(-1).messages;
      const bookingCall = canonical.flatMap((row: { toolCalls?: { id: string; function: { name: string } }[] }) => row.toolCalls ?? []).find((call: { function: { name: string } }) => call.function.name === 'book_meeting');
      const results = canonical.filter((row: { role: string; toolCallId?: string }) => row.role === 'tool' && row.toolCallId === bookingCall.id);
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe(JSON.stringify(literal));
      await expect(frame.getByRole('region', { name: 'Last observed schedule' })).toContainText('Observed booking status: pending');
      const calls = await model(request);
      expect(calls).toHaveLength(3);
      const toolResults = calls.at(-1).body.messages.filter((row: { role: string; tool_call_id?: string }) => row.role === 'tool' && row.tool_call_id === bookingCall.id);
      expect(toolResults).toHaveLength(1);
      expect(toolResults[0].content).toBe(literal);
    });
  }
  for (const width of [1280, 390]) {
    test(`unconfirmed native result preserves revoked authority across modes at ${width}`, async ({ page, request }) => {
      test.setTimeout(90000);
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.goto('/docs/react/runtimes/aws-strands/overview');
      await expect(page.locator('[data-workspace-shell]')).toHaveAttribute('data-hydrated', 'true', { timeout: 30000 });
      await mode(page, 'Run');
      const frame = page.frameLocator('iframe');
      await expect(frame.getByRole('status')).toHaveText('Ready.');
      await frame.getByRole('button', { name: 'Q3 roadmap review', exact: true }).click();
      await frame.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(frame.getByRole('button', { name: 'Approve', exact: true })).toBeEnabled();
      // Injected data: the proxy drops the resumed run's real terminal on its way to the browser.
      expect((await request.post(origin + '/__stream/edit', { data: { ops: [{ type: 'RUN_FINISHED', op: 'drop' }] } })).ok()).toBe(true);
      await frame.getByRole('button', { name: 'Approve', exact: true }).click();
      await expect(frame.getByRole('status')).toHaveText('Meeting unconfirmed. Start a new conversation.');
      await expect(frame.getByRole('region', { name: 'Observed backend result' })).toHaveCount(0);
      await expect(frame.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
      await expect(frame.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
      const evidence = await runs(request);
      expect(evidence).toHaveLength(2);
      const resumed = evidence[1];
      // The real booking completed upstream; only the browser lost the terminal.
      expect(resumed.events.some((event: { type: string; content?: string }) => event.type === 'TOOL_CALL_RESULT' && (event.content ?? '').includes(approved))).toBe(true);
      expect(resumed.events.some((event: { type: string; runId?: string }) => event.type === 'RUN_FINISHED' && event.runId === resumed.body.runId)).toBe(true);
      expect(resumed.sent.some((event: { type: string; runId?: string }) => event.type === 'RUN_FINISHED' && event.runId === resumed.body.runId)).toBe(false);
      await mode(page, 'Docs');
      await expect(page.locator('iframe')).toHaveCount(1);
      await mode(page, 'Run');
      await expect(page.frameLocator('iframe').getByRole('status')).toHaveText('Meeting unconfirmed. Start a new conversation.');
      expect(await runs(request)).toHaveLength(2);
    });
  }
});
