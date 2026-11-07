import { test, expect } from '@playwright/test';
import { submitAndWaitForResponse } from '@threadplane-internal/e2e-harness';

test('a2ui: booking prompt renders an a2ui-surface over AG-UI', async ({ page }) => {
  await submitAndWaitForResponse(page, 'I want to fly LAX to JFK');
  // The BookingFormSpec → A2UI envelope arrives in AI message content;
  // the content classifier mounts <a2ui-surface> against a2uiBasicCatalog.
  await expect(page.locator('a2ui-surface').first()).toBeVisible({ timeout: 30000 });
  expect((await page.locator('a2ui-surface').first().boundingBox())?.height).toBeLessThan(700);
});
