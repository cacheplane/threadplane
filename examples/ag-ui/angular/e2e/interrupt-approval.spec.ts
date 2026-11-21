import { test, expect } from '@playwright/test';
import { openDemo } from './test-helpers';

const PROMPT =
  'I want to clean up old database backups older than 90 days. Walk me through ' +
  'what you would delete, and call request_approval before doing anything ' +
  'destructive so I can review your plan.';

// Mirrors examples/chat's interrupt-approval spec over the AG-UI transport:
// the langgraph node calls interrupt({...}), ag-ui-langgraph emits the
// on_interrupt CUSTOM event, the session lists it in agent.interrupts(), and the
// app shell renders <chat-interrupt-panel> (added for parity in #649).
test('interrupt approval: pause renders the interrupt panel with the captured reason', async ({
  page,
}) => {
  await openDemo(page);

  const input = page.getByRole('textbox', { name: /message|prompt/i });
  await input.fill(PROMPT);
  await page.getByRole('button', { name: /send/i }).click();

  // The run stays paused until a human responds — the interrupt panel is the
  // durable signal, so don't wait on streaming-complete.
  const panel = page.locator('chat-interrupt-panel');
  await expect(panel).toBeAttached({ timeout: 45_000 });

  await expect(panel).toContainText(/agent paused/i);

  // The captured reason mentions the destructive plan — assert it plumbed
  // through the on_interrupt payload to the panel body.
  await expect.poll(
    async () => (await panel.innerText()).toLowerCase(),
    { timeout: 30_000 },
  ).toMatch(/approval|delete|backup/i);

  await expect(panel.getByRole('button', { name: /accept/i })).toBeVisible();
  await expect(panel.getByRole('button', { name: /edit|respond/i }).first()).toBeVisible();
  await expect(panel.getByRole('button', { name: /ignore/i })).toBeVisible();
  await expect(page.locator('chat-message').filter({ has: panel })).toHaveCount(0);
});
