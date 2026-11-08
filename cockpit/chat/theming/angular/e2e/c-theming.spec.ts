import { test, expect } from '@playwright/test';
import { submitAndWaitForResponse } from '@threadplane-internal/e2e-harness';

const PROMPT = 'Hello';

test('c-theming: AI response renders in composed chat surface', async ({ page }) => {
  const bubble = await submitAndWaitForResponse(page, PROMPT);
  await expect(bubble).toContainText('chat-theming demo');
});

test('c-theming: theme picker buttons are present in sidebar', async ({ page }) => {
  await page.goto('/');
  // Distinctive surface — four theme-picker buttons that set CSS custom
  // properties on document.documentElement.
  for (const label of ['Dark', 'Light', 'Ocean', 'Forest']) {
    await expect(page.getByRole('button', { name: label })).toBeVisible();
  }
});

test('c-theming: presets theme the complete shell with the shared palette', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.layout__header')).toHaveCSS('background-color', 'rgb(28, 28, 28)');
  for (const [name, surface, text, border, muted] of [
    ['Dark', 'rgb(28, 28, 28)', 'rgb(224, 224, 224)', 'rgb(118, 118, 118)', 'rgb(163, 163, 163)'],
    ['Light', 'rgb(255, 255, 255)', 'rgb(26, 26, 26)', 'rgb(133, 138, 148)', 'rgb(107, 114, 128)'],
    ['Ocean', 'rgb(17, 27, 49)', 'rgb(200, 214, 229)', 'rgb(96, 123, 156)', 'rgb(163, 184, 207)'],
    ['Forest', 'rgb(32, 52, 32)', 'rgb(212, 230, 212)', 'rgb(118, 144, 118)', 'rgb(167, 192, 167)'],
  ]) {
    await page.getByRole('button', { name, exact: true }).click();
    const header = page.locator('.layout__header');
    await expect(header).toHaveCSS('background-color', surface);
    await expect(header).toHaveCSS('color', text);
    await expect(header).toHaveCSS('border-bottom-color', border);
    await expect(page.locator('.layout__about')).toHaveCSS('color', muted);
    await expect(page.locator('.example-submission-status')).toHaveCSS('color', muted);
  }
});
