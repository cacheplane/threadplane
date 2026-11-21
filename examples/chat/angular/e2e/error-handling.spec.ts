import { test, expect } from '@playwright/test';
import { messageInput, openDemo, sendButton, waitForFinalAssistant } from './test-helpers';

test('error handling: failed stream surfaces a legible error message and Retry button', async ({
  page,
}) => {
  // The LangGraph SDK retries a failed stream connect with exponential backoff
  // (~15s) before surfacing the error — fine for production resilience, too slow
  // to assert here. Opt this app instance into fail-fast (0 connect retries) so
  // the alert appears promptly. Set before bootstrap via addInitScript.
  await page.addInitScript(() => {
    localStorage.setItem('THREADPLANE_E2E_MAX_RETRIES', '0');
  });

  await openDemo(page, '/embed');

  await page.route('**/runs/stream', async (route) => {
    await route.abort('failed');
  });

  await messageInput(page).fill('say hi briefly');
  await sendButton(page).click();

  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible({ timeout: 15_000 });

  // The message should be human-legible copy from AGENT_ERROR_MESSAGES —
  // not a raw SDK string like "HTTP 500" or "Failed to fetch".
  await expect(alert).toContainText(/can't reach|connection|server|interrupted|try again/i);
  await expect(alert).not.toContainText(/HTTP \d{3}/);

  // The Retry button must be present inside the alert (retryable: true).
  const retryButton = alert.getByRole('button', { name: /retry/i });
  await expect(retryButton).toBeVisible();
});

test('error handling: Retry button re-runs the last input and recovers', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('THREADPLANE_E2E_MAX_RETRIES', '0');
  });

  await openDemo(page, '/embed');

  await page.route('**/runs/stream', async (route) => {
    await route.abort('failed');
  });

  await messageInput(page).fill('say hi briefly');
  await sendButton(page).click();

  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible({ timeout: 15_000 });
  const retryButton = alert.getByRole('button', { name: /retry/i });
  await expect(retryButton).toBeVisible();

  // Unblock the network, then click Retry — it re-submits the last input.
  await page.unroute('**/runs/stream');
  await retryButton.click();

  const bubble = await waitForFinalAssistant(page);
  await expect(bubble).toContainText(/hi/i);
});
