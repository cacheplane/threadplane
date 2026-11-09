import { expect, test } from '@playwright/test';
import { messageInput, openDemo, sendButton } from './test-helpers';

// Deterministic wire responses exercise the demo's real adapter and wrapped
// submit without needing a paid agent or changing the live approval scenario.
for (const mode of ['embed', 'popup', 'sidebar']) {
  for (const action of ['Accept', 'Ignore', 'Edit', 'Respond'] as const) {
    test(`${mode}: ${action} resumes the in-chat approval with palette state`, async ({ page }) => {
      const requests: Array<{ forwardedProps?: { command?: { resume?: unknown } }; state: unknown }> = [];
      await page.route('**/agent', async route => {
        const input = route.request().postDataJSON();
        requests.push(input);
        const events = [
          { type: 'RUN_STARTED', threadId: input.threadId, runId: input.runId },
          ...(requests.length === 1
            ? [{ type: 'CUSTOM', name: 'on_interrupt', value: { reason: 'Review deletion of backups older than 90 days' } }]
            : [
              { type: 'TEXT_MESSAGE_START', messageId: 'resumed', role: 'assistant' },
              { type: 'TEXT_MESSAGE_CONTENT', messageId: 'resumed', delta: 'Review response received.' },
              { type: 'TEXT_MESSAGE_END', messageId: 'resumed' },
            ]),
          { type: 'RUN_FINISHED', threadId: input.threadId, runId: input.runId },
        ];
        await route.fulfill({ contentType: 'text/event-stream', body: events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') });
      });
      await openDemo(page, `/${mode}?model=gpt-5-nano&effort=high&genui=json-render`);
      if (mode === 'popup') await page.locator('chat-launcher-button button').click();
      await messageInput(page).fill('Review old backups before deletion.');
      await sendButton(page).click();
      const panel = page.locator('chat chat-interrupt-panel');
      await expect(panel).toBeVisible();
      await expect(page.locator('chat-interrupt-panel')).toHaveCount(1);
      await expect(panel).toContainText('Review deletion of backups older than 90 days');
      for (const button of await panel.getByRole('button').all()) {
        const bounds = await button.boundingBox();
        expect(bounds?.height).toBeGreaterThanOrEqual(44);
        expect(bounds?.width).toBeGreaterThanOrEqual(44);
      }
      const cardBounds = await panel.locator('.chat-interrupt-panel').boundingBox();
      expect(cardBounds?.x).toBeGreaterThanOrEqual(12);
      expect((cardBounds?.x ?? 0) + (cardBounds?.width ?? 0)).toBeLessThanOrEqual((page.viewportSize()?.width ?? 0) - 12);
      if (mode !== 'embed') {
        await page.getByRole('button', { name: 'Close chat', exact: true }).click();
        const surface = page.locator(mode === 'popup' ? '.chat-popup__window' : '.chat-sidebar__panel');
        await expect(surface).toHaveAttribute('aria-hidden', 'true');
        await page.locator('chat-launcher-button button').click();
        await expect(surface).toHaveAttribute('aria-hidden', 'false');
        await expect(page.locator('chat-interrupt-panel')).toHaveCount(1);
        await expect(panel).toBeVisible();
      }
      if (action === 'Edit' || action === 'Respond') {
        // Cancel must leave the paused request intact and send nothing.
        page.once('dialog', dialog => dialog.dismiss());
        await panel.getByRole('button', { name: action, exact: true }).click();
        await expect(panel).toBeVisible();
        expect(requests).toHaveLength(1);
        page.once('dialog', dialog => dialog.accept('Keep the newest backup'));
      }
      await panel.getByRole('button', { name: action, exact: true }).click();
      await expect.poll(() => requests.length).toBe(2);
      const resume = action === 'Accept' ? 'approved' : action === 'Ignore' ? 'denied' : 'Keep the newest backup';
      expect(requests[1].forwardedProps?.command?.resume).toBe(resume);
      expect(requests[1].state).toMatchObject({ model: 'gpt-5-nano', reasoning_effort: 'high', gen_ui_mode: 'json-render' });
      await expect(page.locator('chat-interrupt-panel')).toHaveCount(0);
      await expect(page.locator('chat')).toContainText('Review response received.');
    });
  }
}
