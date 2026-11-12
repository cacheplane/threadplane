import { test, expect } from '@playwright/test';
import { submitAndWaitForResponse } from '@threadplane-internal/e2e-harness';

// function tool: get_weather executes in the browser, returns data, the model summarizes.
test('client-tools: function tool executes and the model summarizes the result', async ({ page }) => {
  await submitAndWaitForResponse(page, "What's the weather in San Francisco?");
  await expect(page.getByText("It's 68°F and sunny in San Francisco")).toBeVisible({ timeout: 30000 });
});

// view tool: weather_card renders the model-filled props inline, auto-acks.
test('client-tools: view tool renders the model-filled component', async ({ page }) => {
  await submitAndWaitForResponse(page, 'Show me a weather card for Tokyo');
  const card = page.locator('app-weather-card');
  await expect(card).toBeVisible({ timeout: 30000 });
  await expect(card).toContainText('Tokyo');
  await expect(card).toContainText('72');
  await expect(page.getByText("Here's the weather card for Tokyo")).toBeVisible({ timeout: 30000 });
});

test('client-tools: terminal view tool renders without a follow-up assistant run', async ({ page }) => {
  await page.goto('/');
  const input = page.getByRole('textbox', { name: /message|prompt/i });
  await input.fill('Show me a quiet weather snapshot for Oslo');
  await page.getByRole('button', { name: /send message/i }).click();

  const card = page.locator('app-weather-card');
  await expect(card).toBeVisible({ timeout: 30000 });
  await expect(card).toContainText('Oslo');
  await expect(page.getByText(/quiet weather snapshot/i)).toHaveCount(1);
  await expect(page.getByText(/Here's the weather card for Oslo/i)).toHaveCount(0);
});

// ask tool (HITL): confirm_booking renders, the user confirms, the emitted value resumes the run.
// This test does NOT use submitAndWaitForResponse because that helper awaits a finalized assistant
// message — but the first run ends with only a tool call, so the helper would block until the user
// clicks Confirm. We use an inline submit instead so we can interact with the component mid-flow.
test('client-tools: ask tool collects user confirmation and resumes the run', async ({ page }) => {
  await page.goto('/');
  const input = page.getByRole('textbox', { name: /message|prompt/i });
  await input.fill('Book a table for two at 7pm');
  await page.getByRole('button', { name: /send message/i }).click();

  const confirm = page.locator('app-confirm-booking');
  await expect(confirm).toBeVisible({ timeout: 30000 });
  await expect(confirm).toContainText('Table for two at 7pm');
  await confirm.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('Your booking is confirmed')).toBeVisible({ timeout: 30000 });

  // The confirm card freezes once resolved: the adapter writes the emitted
  // result back onto the local tool call, so the component re-renders into its
  // frozen state — the interactive buttons disappear and a confirmed line shows.
  await expect(confirm).toContainText('Booking confirmed');
  await expect(confirm.getByRole('button', { name: 'Confirm' })).toHaveCount(0);
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
});
