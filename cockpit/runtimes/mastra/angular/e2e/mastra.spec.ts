import { test, expect } from '@playwright/test';
import { submitAndWaitForResponse } from '@threadplane-internal/e2e-harness';

// First cockpit e2e whose backend is neither LangGraph nor Python: the
// rt-mastra topic runs against the deployments/ag-ui-mastra Node service
// (Mastra agents behind the hand-written AG-UI SSE endpoint). Interrupts
// surface as CUSTOM on_interrupt (Mastra-shaped payload with toolCallId +
// runId) plus the protocol-standard RUN_FINISHED outcome, and resume rides
// forwardedProps.command.interruptEvent — the session's `mastra-command` path, shipped in
// #888/#889/#891, proven live here for the first time.
test.describe('cockpit runtimes/mastra: camping trip planner', () => {
  test('backend tool result streams into the reply', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Check trail conditions').click();
    await expect(page.getByText(/Clear skies at Yosemite Valley/i)).toBeVisible({ timeout: 30_000 });
  });

  test('working memory streams into the shared-state panel', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Start a packing list').click();
    const panel = page.getByTestId('packing-state');
    await expect(panel).toContainText('Yosemite Weekend', { timeout: 30_000 });
    await expect(panel).toContainText('tent');
    await expect(panel).toContainText('sleeping bag');
    await expect(page.getByText(/packing list is ready/i)).toBeVisible({ timeout: 30_000 });
  });

  test('suspended reserve_campsite shows the approval card', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Reserve the campsite').click();
    const panel = page.locator('.chat-approval-card--inline');
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel).toContainText('Reservation approval required');
    await expect(panel).toContainText('North Pines');
    await expect(panel).toContainText('$90.00');
  });

  for (const approved of [true, false]) {
    const action = approved ? 'Approve' : 'Cancel';
    test(`${action} sends the decision and displays the matching reservation outcome`, async ({ page }) => {
      if (process.env['AIMOCK_MODE'] === 'record') test.setTimeout(120_000);
      await page.goto('/');
      await page.getByText('Reserve the campsite').click();
      const panel = page.locator('.chat-approval-card--inline');
      await expect(panel).toBeVisible({ timeout: 30_000 });
      await expect(panel).toContainText('North Pines');
      await expect(panel).toContainText('$90.00');

      // The session leaves a response at its run's terminal event, so the
      // browser does not keep the body for `response.text()`. The answering
      // request is read where it passes through instead.
      type ResumeCommand = {
        resume?: { approved?: boolean };
        interruptEvent?: { toolCallId?: string; runId?: string };
      };
      let resumed: { status: number; command: ResumeCommand; body: string } | undefined;
      await page.route(url => url.pathname.endsWith('/agent'), async route => {
        const request = route.request();
        const command: ResumeCommand | undefined =
          request.method() === 'POST' ? request.postDataJSON()?.forwardedProps?.command : undefined;
        if (command?.resume?.approved !== approved) return route.fallback();
        const response = await route.fetch();
        const body = await response.text();
        resumed = { status: response.status(), command, body };
        await route.fulfill({ response, body });
      });
      await panel.getByRole('button', { name: action, exact: true }).click();
      await expect.poll(() => resumed?.status, { timeout: 30_000 }).toBe(200);
      const command = resumed?.command;
      const body = resumed?.body ?? '';
      expect(command?.interruptEvent?.toolCallId).toEqual(expect.any(String));
      expect(command?.interruptEvent?.runId).toEqual(expect.any(String));
      const events = body.split('\n')
        .filter(line => line.startsWith('data: '))
        .map(line => JSON.parse(line.slice(6)));
      const result = events.find(event => event.type === 'TOOL_CALL_RESULT');
      expect(result?.toolCallId).toBe(command?.interruptEvent?.toolCallId);
      expect(result?.content).toContain(approved ? 'Reserved North Pines' : 'Nothing was booked.');
      await expect(panel).not.toBeVisible();
      const reply = page.locator('chat-message[data-role="assistant"]').last();
      await expect(reply).toContainText(approved
        ? /reserved|confirmed|booked/i
        : /declined|cancelled|canceled|not.{0,20}(booked|completed|confirmed|reserved)|nothing.{0,20}booked/i);
      if (approved) {
        await expect(reply).not.toContainText(/declined|cancelled|canceled|nothing.{0,20}booked|not.{0,20}(booked|completed|confirmed|reserved)/i);
      } else {
        await expect(reply).not.toContainText('TP-0288');
      }
    });
  }

  // Delegation: the supervisor calls the registered weather_forecaster
  // sub-agent (wire tool `agent-weather_forecaster`); the server-side
  // emitter (deployments/ag-ui-mastra/subagent-emitter.mjs) injects
  // SUBAGENT_STARTED + attributed TEXT_MESSAGE_* + SUBAGENT_FINISHED, which
  // the session projects into a subagent card on the tool-call group.
  test('rt-mastra: delegated forecast renders a subagent card with the final text', async ({ page }) => {
    const bubble = await submitAndWaitForResponse(page, 'Plan a trip to Bear Lake this weekend — what will the weather be?');
    await expect(page.locator('chat-subagent-card')).toHaveCount(1);
    await expect(page.locator('chat-subagent-card')).toContainText('weather_forecaster');
    await expect(bubble).toContainText(/forecast|weather/i);
  });
});
