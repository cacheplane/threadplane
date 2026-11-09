import { expect, test } from '@playwright/test';
import { messageInput, openDemo, sendButton } from './test-helpers';

for (const mode of ['embed', 'popup', 'sidebar']) {
  test(`${mode}: mobile error recovery stays readable and retries the same input`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    const prompts: unknown[] = [];
    await page.route('**/agent', async route => {
      const input = route.request().postDataJSON();
      prompts.push(input.messages.filter((message: { role: string }) => message.role === 'user').at(-1)?.content);
      if (prompts.length === 1) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Temporarily unavailable"}' });
        return;
      }
      const events = [
        { type: 'RUN_STARTED', threadId: input.threadId, runId: input.runId },
        { type: 'TEXT_MESSAGE_START', messageId: 'recovered', role: 'assistant' },
        { type: 'TEXT_MESSAGE_CONTENT', messageId: 'recovered', delta: 'Recovered. You can continue.' },
        { type: 'TEXT_MESSAGE_END', messageId: 'recovered' },
        { type: 'RUN_FINISHED', threadId: input.threadId, runId: input.runId },
      ];
      await route.fulfill({ contentType: 'text/event-stream', body: events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') });
    });
    await openDemo(page, `/${mode}?theme=default-light&scheme=light`);
    if (mode === 'popup') await page.getByRole('button', { name: 'Open chat', exact: true }).click();
    await messageInput(page).fill('Help me recover this conversation.');
    await sendButton(page).click();
    const alert = page.locator('.chat-error');
    await expect(alert).toBeVisible();
    const retry = alert.getByRole('button', { name: /retry/i });
    const bounds = await retry.boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    expect(bounds?.x).toBeGreaterThanOrEqual(0);
    expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(320);
    await retry.click();
    await expect(alert).toHaveCount(0);
    await expect(page.locator('chat')).toContainText('Recovered. You can continue.');
    expect(prompts).toEqual(['Help me recover this conversation.', 'Help me recover this conversation.']);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  });
}
