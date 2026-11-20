import { test, expect } from '@playwright/test';
import { messageInput, openDemo, sendButton, waitForFinalAssistant } from './test-helpers';

test('error handling: failed stream surfaces a legible error message and a Check status button', async ({
  page,
}) => {
  // State the client's retry budget explicitly: no connect retries, so the
  // alert appears promptly. (A session never retries a request by default; a
  // higher budget would hold the error back for the SDK's backoff window.)
  // Set before bootstrap via addInitScript.
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

  // A stream that fails before any response leaves the run's outcome open:
  // the request may have reached the backend. The session therefore offers a
  // read-only status check, never a blind re-send, so the alert carries
  // "Check status" and no Retry.
  await expect(alert.getByRole('button', { name: 'Check status', exact: true })).toBeVisible();
  await expect(alert.getByRole('button', { name: /retry/i })).toHaveCount(0);
});

test('error handling: after a failed stream, checking finds nothing saved and sending again recovers', async ({
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
  const checkButton = alert.getByRole('button', { name: 'Check status', exact: true });
  await expect(checkButton).toBeVisible();

  // Unblock the network. The request never reached the backend, so the check
  // finds no saved turn: the error stays and nothing is re-sent on its own.
  await page.unroute('**/runs/stream');
  const history = page.waitForResponse(
    (response) => /\/threads\/[^/]+\/history$/.test(new URL(response.url()).pathname),
  );
  await checkButton.click();
  await history;
  await expect(alert).toBeVisible();
  await expect(page.locator('chat-message[data-role="assistant"]')).toHaveCount(0);

  // The visitor recovers by sending the prompt again.
  await messageInput(page).fill('say hi briefly');
  await sendButton(page).click();

  const bubble = await waitForFinalAssistant(page);
  await expect(bubble).toContainText(/hi/i);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
