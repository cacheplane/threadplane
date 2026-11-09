import { expect, test, type Locator, type Page } from '@playwright/test';
import { messageInput, openDemo, sendButton, waitForFinalAssistant } from './test-helpers';

const THREAD_ID = '11111111-1111-4111-8111-111111111111';
const REASON = 'Review the proposed itinerary before the agent continues.';
const ANSWER = 'Your itinerary is ready.';
const frame = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** Real SDK HTTP/SSE shapes, also covered by runtime/transport.integration.spec.ts. */
async function installConversationWire(page: Page, scenario: 'approval' | 'retry') {
  const runs: Array<Record<string, unknown>> = [];
  const unexpected: string[] = [];
  let created = false;
  await page.addInitScript(() => {
    localStorage.setItem('THREADPLANE_E2E_MAX_RETRIES', '0');
    (window as Window & { __THREADPLANE_TELEMETRY_DISABLED__?: boolean })
      .__THREADPLANE_TELEMETRY_DISABLED__ = true;
  });
  // Every API request stays local, including unexpected endpoints. Nothing can
  // fall through to the deployment proxy or incur a model call.
  await page.route(url => url.pathname.startsWith('/api/') ||
    (['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '2024'), async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.startsWith('/api/') ? url.pathname : `/api${url.pathname}`;
    const thread = {
      thread_id: THREAD_ID, created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z', metadata: {}, status: 'idle', values: {},
    };
    if (path === '/api/ingest') return route.fulfill({ status: 204 });
    if (path === '/api/threads/search' && request.method() === 'POST') {
      return route.fulfill({ json: created ? [thread] : [] });
    }
    if (path === '/api/threads' && request.method() === 'POST') {
      created = true;
      return route.fulfill({ json: thread });
    }
    if (path === `/api/threads/${THREAD_ID}` && request.method() === 'GET') {
      return route.fulfill({ json: thread });
    }
    if (path === `/api/threads/${THREAD_ID}/state` && request.method() === 'POST') {
      // The shell persists model preferences and the itinerary independently
      // of streaming through the SDK's threads.updateState endpoint.
      return route.fulfill({ json: { configurable: {
        thread_id: THREAD_ID, checkpoint_ns: '', checkpoint_id: 'fixture-checkpoint',
      } } });
    }
    if (path === `/api/threads/${THREAD_ID}/history` && request.method() === 'POST') {
      return route.fulfill({ json: [] });
    }
    if (path === `/api/threads/${THREAD_ID}/runs/stream` && request.method() === 'POST') {
      runs.push(request.postDataJSON());
      if (scenario === 'retry' && runs.length === 1) return route.abort('failed');
      const body = scenario === 'approval' && runs.length === 1
        ? frame('updates', { __interrupt__: [{ id: 'approval', value: { reason: REASON } }] })
        : frame('values', { messages: [{ type: 'ai', id: 'answer', content: ANSWER }] });
      return route.fulfill({ contentType: 'text/event-stream', body });
    }
    unexpected.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 500, json: { detail: 'Unrecognized local fixture request' } });
  });
  return { runs, unexpected };
}

async function expectMobileCard(card: Locator) {
  await expect(card).toBeVisible();
  await card.scrollIntoViewIfNeeded();
  const rect = await card.boundingBox();
  if (!rect) throw new Error('Conversation card has no visible bounds');
  expect(rect.x).toBeGreaterThanOrEqual(12);
  expect(rect.x + rect.width).toBeLessThanOrEqual(308);
}

async function expectTouchTarget(button: Locator) {
  const rect = await button.boundingBox();
  if (!rect) throw new Error('Conversation action has no visible bounds');
  expect(rect.width).toBeGreaterThanOrEqual(44);
  expect(rect.height).toBeGreaterThanOrEqual(44);
}

for (const mode of ['embed', 'popup', 'sidebar']) {
  test(`${mode} approval stays readable at 320px and resumes through the LangGraph wire`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    const wire = await installConversationWire(page, 'approval');
    await openDemo(page, `/${mode}?theme=default-light&color=light`);
    if (mode === 'popup') await page.getByRole('button', { name: 'Open chat', exact: true }).click();
    await messageInput(page).fill('Plan an itinerary for review');
    await sendButton(page).click();

    const panel = page.locator('.chat-interrupt-panel');
    await expectMobileCard(panel);
    await expect(panel).toContainText(REASON);
    for (const action of ['Accept', 'Edit', 'Respond', 'Ignore']) {
      await expectTouchTarget(panel.getByRole('button', { name: action, exact: true }));
    }
    await panel.getByRole('button', { name: 'Accept', exact: true }).click();
    await expect(await waitForFinalAssistant(page)).toContainText(ANSWER);
    await expect(panel).toHaveCount(0);
    expect(wire.runs).toHaveLength(2);
    expect(wire.runs[1]).toMatchObject({ command: { resume: 'approved' } });
    // The demo attaches model settings and its client-tool catalog on resume,
    // but must not send a second user turn with the approval decision.
    expect(wire.runs[1]['input']).not.toHaveProperty('messages');
    expect(wire.unexpected).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  });

  test(`${mode} error has a 44px Retry target and recovers through the LangGraph wire at 320px`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    const wire = await installConversationWire(page, 'retry');
    await openDemo(page, `/${mode}?theme=default-light&color=light`);
    if (mode === 'popup') await page.getByRole('button', { name: 'Open chat', exact: true }).click();
    await messageInput(page).fill('Plan an itinerary after retry');
    await sendButton(page).click();

    const error = page.locator('.chat-error');
    await expectMobileCard(error);
    await expect(error).toContainText(/can't reach|connection|server|try again/i);
    const retry = error.getByRole('button', { name: 'Retry', exact: true });
    await expectTouchTarget(retry);
    await retry.click();
    await expect(await waitForFinalAssistant(page)).toContainText(ANSWER);
    await expect(error).toHaveCount(0);
    expect(wire.runs).toHaveLength(2);
    expect(wire.runs[1]['input']).toEqual(wire.runs[0]['input']);
    expect(wire.unexpected).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  });
}
