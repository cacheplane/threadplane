import { writeFile } from 'node:fs/promises';
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
const route = '/docs/ag-ui/guides/client-tools';
const origin = 'http://127.0.0.1:4640';
const names = ['get_weather', 'slow_status_check', 'weather_card', 'weather_snapshot', 'confirm_booking'];
interface Message { id: string; role: string; content: string; toolCallId?: string; toolCalls?: { id: string }[] }
interface RecordRow {
  body: { threadId: string; runId: string; messages: Message[]; tools: { name: string }[] };
  events: { type: string; messages?: Message[] }[];
  observations: { socketAttempts: string[]; modelMessages: { type: string; id?: string; tool_call_id?: string; content: string }[][] };
}
async function records(request: APIRequestContext): Promise<RecordRow[]> {
  return (await request.get(origin + '/__requests')).json();
}
async function hydrated(page: Page, mode: string) {
  await expect(page.locator('[data-workspace-shell]')).toHaveAttribute('data-hydrated', 'true');
  await expect(page.locator('[data-workspace-shell]')).toHaveAttribute('data-workspace-mode', mode);
}
async function send(page: Page, text: string) {
  const frame = page.frameLocator('iframe');
  await frame.getByLabel('Message', { exact: true }).fill(text);
  await frame.getByRole('button', { name: 'Send', exact: true }).click();
}
function native(wire: RecordRow[], count: number) {
  expect(wire).toHaveLength(count);
  expect(new Set(wire.map(row => row.body.runId)).size).toBe(count);
  for (const row of wire) {
    expect(row.body.tools.map(tool => tool.name)).toEqual(names);
    expect(row.observations.socketAttempts).toEqual([]);
    const model = row.observations.modelMessages.at(-1) ?? [];
    const snapshot = row.events.filter(event => event.type === 'MESSAGES_SNAPSHOT').at(-1)?.messages ?? [];
    for (const result of row.body.messages.filter(message => message.role === 'tool')) {
      expect(row.body.messages.filter(message => message.toolCalls?.some(call => call.id === result.toolCallId))).toHaveLength(1);
      expect(model.filter(message => message.type === 'tool' && message.id === result.id && message.tool_call_id === result.toolCallId && message.content === result.content)).toHaveLength(1);
      expect(snapshot.filter(message => message.role === 'tool' && message.id === result.id && message.content === result.content)).toHaveLength(1);
    }
  }
}
test.describe('native React AG-UI Client Tools workspace', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ request }) => {
    test.skip(Boolean(process.env['BASE_URL']), 'Canonical offline ownership is verified locally');
    expect((await request.post(origin + '/__reset')).ok()).toBe(true);
  });
  test.afterEach(async ({ page, request }, info) => {
    if (process.env['BASE_URL']) return;
    // Both success and assertion failure dispose the iframe before closing its exact worker owner.
    try {
      await page.goto('about:blank');
      const wire = await records(request);
      await writeFile(info.outputPath('native-wire.json'), JSON.stringify(wire, null, 2));
    } finally {
      const stats = await (await request.post(origin + '/__finish')).json();
      await writeFile(info.outputPath('owned-fixture-receipt.json'), JSON.stringify(stats, null, 2));
      expect(Object.values(stats.closed.at(-1).closure).every(Boolean)).toBe(true);
    }
  });
  test('actual Docs, Code and Run retain native identity, source bytes and five inert presets', async ({ page, request }, info) => {
    await page.goto(route + '?frontend=react&topicProof=b4');
    await hydrated(page, 'Docs');
    await expect(page.getByRole('heading', { name: 'React AG-UI client tools preview', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'React AG-UI streaming preview', exact: true })).toHaveCount(0);
    await expect(page.locator('[data-example-file="cockpit/ag-ui/client-tools/react/src/tools.ts"]')).toBeVisible();
    await page.screenshot({ path: info.outputPath('docs-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('docs-mobile.png') });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator('[data-workspace-desktop-navigation]').getByRole('button', { name: 'Code', exact: true }).click();
    await hydrated(page, 'Code');
    const tree = page.getByRole('complementary', { name: 'File tree' });
    for (const file of ['app.tsx', 'tools.ts', 'application.ts', 'projection.ts', 'weather-card.tsx', 'confirm-booking.tsx', 'connection.ts', 'main.tsx', 'styles.css', 'project.json', 'graph.py', 'server.py', 'client-tools.md']) {
      await expect(tree.getByRole('button', { name: file, exact: true })).toBeVisible();
    }
    await expect(tree).not.toContainText(/fixture|scripted|\.spec\.|type-test/);
    for (const [file, text] of [['tools.ts', 'FunctionTool'], ['application.ts', 'createClientToolsApplication'], ['connection.ts', 'createSession'], ['graph.py', 'bind_client_tools'], ['client-tools.md', 'weather_card']]) {
      await tree.getByRole('button', { name: file, exact: true }).click();
      await expect(page.getByRole('tabpanel')).toContainText(text);
    }
    await page.screenshot({ path: info.outputPath('code-desktop.png') });
    await page.locator('[data-workspace-desktop-navigation]').getByRole('button', { name: /^Run(?:,|$)/ }).click();
    await hydrated(page, 'Run');
    await expect(page.locator('iframe')).toHaveAttribute('src', /^http:\/\/localhost:4640\/\?cockpit_did=/);
    const frame = page.frameLocator('iframe');
    await expect(frame.getByRole('status')).toHaveText('Ready.');
    for (const label of ['Weather result', 'Slow status', 'Weather card', 'Terminal snapshot', 'Fictional booking']) {
      await frame.getByRole('button', { name: label, exact: true }).click();
      await expect(frame.getByLabel('Message', { exact: true })).not.toHaveValue('');
      expect(await records(request)).toEqual([]);
    }
    await send(page, 'Use weather_card');
    await expect(frame.getByRole('status')).toHaveText('Command complete.');
    const wire = await records(request); native(wire, 2);
    const result = wire[1].body.messages.find(message => message.role === 'tool');
    expect(result?.content).toBe('{"displayed":true}');
    const owner = wire[1].body.messages.find(message => message.toolCalls?.some(call => call.id === result?.toolCallId));
    await expect(frame.locator(`[data-native-message="${owner?.id}"] [data-native-call="${result?.toolCallId}"]`)).toHaveCount(1);
    const card = frame.getByRole('region', { name: 'Simulated weather for San Francisco' });
    for (const value of ['68°F', 'Sunny', '55%', '8 mph']) await expect(card).toContainText(value);
    await expect(frame.getByRole('region', { name: 'Local tool evidence' })).toContainText('Delivery: observed');
    await page.screenshot({ path: info.outputPath('run-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('run-mobile.png') });
    await card.screenshot({ path: info.outputPath('weather-mobile.png') });
    await writeFile(info.outputPath('run-dom.json'), JSON.stringify({ conversation: await frame.getByRole('region', { name: 'Conversation', exact: true }).innerText(), reading: await card.innerText() }, null, 2));
  });
  test('terminal result is unsent until the next explicit human and New stays lazy', async ({ page, request }) => {
    await page.goto(route + '?frontend=react&mode=run');
    await send(page, 'Use weather_snapshot');
    const frame = page.frameLocator('iframe');
    await expect(frame.getByRole('status')).toHaveText('Command complete.');
    native(await records(request), 1);
    await expect(frame.getByRole('region', { name: 'Local tool evidence' })).toContainText('Delivery: unsent');
    await send(page, 'Plain next human');
    await expect(frame.getByRole('status')).toHaveText('Command complete.');
    const wire = await records(request); native(wire, 2);
    expect(wire[1].body.messages.filter(message => message.role === 'tool')).toHaveLength(1);
    await frame.getByRole('button', { name: 'New conversation', exact: true }).click();
    expect(await records(request)).toHaveLength(2);
    await send(page, 'Plain fresh human');
    await expect(frame.getByRole('status')).toHaveText('Command complete.');
    const after = await records(request); native(after, 3);
    expect(after[2].body.threadId).not.toBe(wire[0].body.threadId);
    expect(after[2].body.messages).toHaveLength(1);
  });
  test('explicit fictional booking continues once and Stop revokes slow work', async ({ page, request }, info) => {
    await page.goto(route + '?frontend=react&mode=run');
    await send(page, 'Use confirm_booking');
    const frame = page.frameLocator('iframe');
    const panel = frame.getByRole('region', { name: 'Fictional booking' });
    await expect(panel).toContainText('No real reservation');
    native(await records(request), 1);
    await frame.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(frame.getByRole('status')).toHaveText('Command complete.');
    const wire = await records(request); native(wire, 2);
    expect(wire[1].body.messages.filter(message => message.role === 'tool').map(message => JSON.parse(message.content))).toEqual([{ confirmed: true }]);
    await panel.screenshot({ path: info.outputPath('fictional-booking.png') });
    await frame.getByRole('button', { name: 'New conversation', exact: true }).click();
    await send(page, 'Use slow_status_check');
    await expect(frame.getByRole('region', { name: 'Local tool evidence' })).toContainText('Local execution: running');
    await frame.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(frame.getByRole('status')).toHaveText('Start a new conversation to continue.');
    await page.waitForTimeout(3200);
    expect(await records(request)).toHaveLength(3);
    await expect(frame.locator('main')).not.toContainText('"status":"complete"');
  });
  test('history, reload, frontend changes and route navigation dispose controls and retain canonical defaults', async ({ page, request }) => {
    await page.goto(route + '?frontend=react&mode=run&topicProof=b4');
    await send(page, 'Use confirm_booking');
    const frame = page.frameLocator('iframe');
    await expect(frame.getByRole('status')).toHaveText('Waiting for your fictional booking decision…');
    const oldFrame = await page.locator('iframe').elementHandle();
    await page.getByLabel('Example UI').selectOption('angular');
    await expect(page).not.toHaveURL(/frontend=react/);
    await expect(page).toHaveURL(/topicProof=b4/);
    expect(await oldFrame?.evaluate(element => element.isConnected)).toBe(false);
    await expect(page.locator('iframe')).toHaveAttribute('src', /^http:\/\/localhost:4325\//);
    await page.goBack();
    await expect(page.getByLabel('Example UI')).toHaveValue('react');
    await expect(frame.getByRole('status')).toHaveText('Ready.');
    await expect(frame.locator('[data-native-message]')).toHaveCount(0);
    await frame.getByLabel('Message', { exact: true }).fill('Unsubmitted draft');
    await page.reload();
    await expect(frame.getByRole('status')).toHaveText('Ready.');
    await expect(frame.getByLabel('Message', { exact: true })).toHaveValue('');
    expect(await records(request)).toHaveLength(1);
    await page.goto('/docs/ag-ui/guides/tool-views?frontend=react');
    await expect(page.getByRole('heading', { name: 'React AG-UI tool views preview', exact: true })).toBeVisible();
    await page.goto(route);
    await expect(page.getByLabel('Example UI')).toHaveValue('angular');
    await expect(page.getByRole('heading', { name: 'React AG-UI client tools preview', exact: true })).toHaveCount(0);
    await page.locator('[data-workspace-desktop-navigation]').getByRole('button', { name: 'Code', exact: true }).click();
    await expect(page.getByRole('complementary', { name: 'File tree' }).getByRole('button', { name: 'client-tools.component.ts', exact: true })).toBeVisible();
    expect(await records(request)).toHaveLength(1);
  });
});
