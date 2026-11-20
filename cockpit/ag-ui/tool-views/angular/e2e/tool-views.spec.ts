import { test, expect } from '@playwright/test';
import { submitAndWaitForResponse } from '@threadplane-internal/e2e-harness';

test('tool-views: weather_card tool call renders the registered component with result values', async ({ page }) => {
  await submitAndWaitForResponse(page, "What's the weather in San Francisco?");

  // The registered WeatherCardComponent (app-weather-card) must mount for the
  // weather_card tool call and show the deterministic result. Proves: aimock
  // returned the tool call, ag-ui-langgraph emitted TOOL_CALL_* events, the
  // session projected them into toolCalls(), and the chat composition bridged
  // the call into the views registry via the synthetic-spec path.
  const card = page.locator('app-weather-card');
  await expect(card).toBeVisible({ timeout: 30000 });
  await expect(card).toContainText('San Francisco');
  await expect(card).toContainText('68');
});
