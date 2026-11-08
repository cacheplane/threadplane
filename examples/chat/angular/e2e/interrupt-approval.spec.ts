import { test, expect } from '@playwright/test';
import { openDemo } from './test-helpers';

const PROMPT =
  'I want to clean up old database backups older than 90 days. Walk me through ' +
  'what you would delete, and call request_approval before doing anything ' +
  'destructive so I can review your plan.';

test('interrupt approval: pause renders the interrupt panel with the captured reason @drift', async ({
  page,
}) => {
  await openDemo(page, '/embed');

  const input = page.getByRole('textbox', { name: /message|prompt/i });
  await input.fill(PROMPT);
  await page.getByRole('button', { name: /send/i }).click();

  // When the parent emits request_approval, the langgraph node calls
  // interrupt({...}) and the graph pauses. The chat composition surfaces a
  // <chat-interrupt-panel> with the captured 'reason' text. We don't wait on
  // data-streaming="false" here because the agent stays in the paused state
  // until the human responds — the interrupt panel is the durable signal.
  const panel = page.locator('chat-interrupt-panel');
  await expect(panel).toBeAttached({ timeout: 45_000 });

  // The panel title is "Agent paused" (per the smoke checklist) — verifies
  // the panel actually rendered, not just the host element being attached.
  await expect(panel).toContainText(/agent paused/i);

  // The captured reason mentions "approval" and "delete" — assert one is in
  // the panel body so the reason text is plumbing through.
  await expect.poll(
    async () => (await panel.innerText()).toLowerCase(),
    { timeout: 30_000 },
  ).toMatch(/approval|delete|backup/i);

  await expect(panel.getByRole('button', { name: /accept/i })).toBeVisible();
  await expect(panel.getByRole('button', { name: /edit|respond/i }).first()).toBeVisible();
  await expect(panel.getByRole('button', { name: /ignore/i })).toBeVisible();
  await expect(page.locator('chat-message').filter({ has: panel })).toHaveCount(0);
});

for (const mode of ['embed', 'popup', 'sidebar']) {
  test(`interrupt approval: ${mode} keeps the phone decision in the scrolling conversation`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openDemo(page, `/${mode}`);
    if (mode === 'popup') await page.getByRole('button', { name: 'Open chat', exact: true }).click();
    await page.getByRole('textbox', { name: 'Type a message', exact: true }).fill(PROMPT);
    await page.getByRole('button', { name: 'Send message', exact: true }).click();

    const panel = page.locator('chat-interrupt-panel');
    await expect(panel).toBeVisible({ timeout: 45_000 });
    await expect(page.locator('.chat-scroll chat-interrupt-panel')).toHaveCount(1);
    await expect(page.locator('.demo-shell__interrupt-panel')).toHaveCount(0);
    await expect(panel).toContainText('86.5 GB');
    const accept = panel.getByRole('button', { name: 'Accept', exact: true });
    await accept.scrollIntoViewIfNeeded();
    await expect(accept).toBeInViewport();
    const decision = await accept.boundingBox();
    const composer = await page.getByRole('textbox', { name: 'Type a message', exact: true }).boundingBox();
    if (!decision || !composer) throw new Error('Decision and composer must be rendered');
    expect(decision.y + decision.height).toBeLessThanOrEqual(composer.y);

    // Cancelling either text prompt must leave the original decision pending.
    for (const action of ['Edit', 'Respond']) {
      page.once('dialog', dialog => dialog.dismiss());
      await panel.getByRole('button', { name: action, exact: true }).click();
      await expect(panel).toBeVisible();
    }
    await accept.click();
    await expect(panel).toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator('chat-message[data-role="assistant"]').last()).toContainText('Approved.', { timeout: 30_000 });
  });
}
