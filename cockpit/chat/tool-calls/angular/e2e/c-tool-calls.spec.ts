import { test, expect } from '@playwright/test';
import { submitAndWaitForResponse } from '@threadplane-internal/e2e-harness';

const PROMPT = "What's the status of UA123?";

test('c-tool-calls: parent dispatches lookup_flight tool, continuation surfaces flight data', async ({ page }) => {
  const bubble = await submitAndWaitForResponse(page, PROMPT);

  // The chat-tool-calls primitive mounts as the wrapper for tool-call UI.
  // Tightened from a generic getByRole('button') (which would match any
  // unrelated button on the page) to the specific custom-element selectors
  // — proves the parent's tool_call routed through the actual @threadplane/chat
  // primitive, not just any DOM button that happens to mention the tool.
  await expect(page.locator('chat-tool-calls').first()).toBeVisible({ timeout: 30_000 });

  // The shared activity retains literal technical evidence inside Details.
  // Opted-in grouping keeps even the first call compact; its confirmed outcome
  // remains visible before the technical call is expanded.
  await expect(page.locator('chat .tp-tool-outcomes').first()).toContainText('UA123:');
  await page.locator('chat .ctc__group-header:visible').first().click();
  const card = page.locator('chat-tool-activity').first();
  await expect(card).toBeVisible();
  await expect(card).toContainText('lookup_flight');

  // The continuation's text mentions a distinctive phrase from the captured
  // response — proves the tool-result-then-text loop completed end-to-end.
  await expect(bubble).toContainText('UA123', { ignoreCase: true });
});
