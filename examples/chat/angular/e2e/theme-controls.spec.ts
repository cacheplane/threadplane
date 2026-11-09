import { expect, test } from '@playwright/test';
import { openDemo, selectToolbarOption, toolbarSelect } from './test-helpers';

test('default theme picker pairs the page scheme and survives reload and the sun/moon toggle', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await openDemo(page);
  const root = page.locator('html');
  await selectToolbarOption(page, 'Theme', 'Default light');
  await expect(toolbarSelect(page, 'Theme')).toContainText('Default light');
  await expect(root).toHaveAttribute('data-theme', 'default-light');
  await expect(root).toHaveAttribute('data-color-scheme', 'light');
  await expect(root).toHaveAttribute('data-threadplane-chat-theme', 'light');
  await expect(page).toHaveURL(/color=light/);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('threadplane-chat-demo:palette') ?? '{}')))
    .toMatchObject({ theme: 'default-light', colorScheme: 'light' });
  await page.reload();
  await expect(toolbarSelect(page, 'Theme')).toContainText('Default light');
  await page.getByRole('button', { name: 'Switch to dark theme', exact: true }).click();
  await expect(toolbarSelect(page, 'Theme')).toContainText('Default dark');
  await expect(root).toHaveAttribute('data-color-scheme', 'dark');
  await expect(page).not.toHaveURL(/theme=default-light|color=light/);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('threadplane-chat-demo:palette') ?? '{}')))
    .toMatchObject({ theme: 'default-dark', colorScheme: 'dark' });
  await selectToolbarOption(page, 'Theme', 'Default light');
  await selectToolbarOption(page, 'Theme', 'Default dark');
  await expect(root).toHaveAttribute('data-color-scheme', 'dark');
  await page.reload();
  await expect(toolbarSelect(page, 'Theme')).toContainText('Default dark');
  await expect(root).toHaveAttribute('data-color-scheme', 'dark');
});

test('theme and color URL overrides leave stored preferences untouched', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await openDemo(page);
  const stored = JSON.stringify({ theme: 'default-dark', colorScheme: 'dark', model: 'gpt-5-nano' });
  await page.evaluate(value => localStorage.setItem('threadplane-chat-demo:palette', value), stored);
  for (const query of ['theme=default-light', 'color=light']) {
    await page.goto(`/embed?${query}`);
    await expect(toolbarSelect(page, 'Theme')).toContainText('Default light');
    await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'light');
    expect(await page.evaluate(() => localStorage.getItem('threadplane-chat-demo:palette'))).toBe(stored);
  }
  await page.goto('/embed');
  await expect(toolbarSelect(page, 'Theme')).toContainText('Default dark');
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'dark');
});

test('material presets remain independent of the page scheme toggle', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await openDemo(page);
  await selectToolbarOption(page, 'Theme', 'Material light');
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'dark');
  await page.getByRole('button', { name: 'Switch to light theme', exact: true }).click();
  await expect(toolbarSelect(page, 'Theme')).toContainText('Material light');
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'light');
  await page.getByRole('button', { name: 'Switch to dark theme', exact: true }).click();
  await expect(toolbarSelect(page, 'Theme')).toContainText('Material light');
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'dark');
});
