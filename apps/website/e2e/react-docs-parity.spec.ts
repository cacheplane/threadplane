import { expect, test } from '@playwright/test';
import { frameworkControl, selectFramework } from './fixtures/framework-controls';

const route = '/docs/react/ag-ui/guides/interrupts';

for (const width of [320, 390, 768, 1440]) {
  test(`React shares the reading toolbar and compact navigation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(route);
    const shell = page.locator('[data-workspace-shell]');
    await expect(shell).toHaveAttribute('data-hydrated', 'true');
    await expect(shell).toHaveAttribute('data-workspace-navigation-layout', 'toolbar');
    const modes = page.getByRole('navigation', { name: 'Documentation modes', exact: true });
    for (const mode of ['Docs', 'Run', 'Code', 'API']) {
      await expect(modes.getByRole('button', { name: mode, exact: true })).toBeVisible();
    }
    await expect(page.locator('[data-control-plane-rail]')).toHaveCount(0);
    const picker = await frameworkControl(page);
    await expect(picker).toHaveAttribute('data-value', 'react');
    expect(await picker.evaluate(el => el.tagName)).toBe('BUTTON');
    await picker.click();
    const menu = page.getByRole('menu', { name: 'Frameworks', exact: true });
    await expect(menu.getByRole('menuitemradio', { name: 'React', exact: true })).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await expect(picker).toBeFocused();
    const compact = page.locator('[data-docs-navigation-compact]:visible');
    await expect(compact.getByRole('link', { name: 'React overview', exact: true })).toBeVisible();
    await expect(compact.getByRole('button', { name: 'Reference', exact: true })).toHaveAttribute('aria-expanded', 'false');
    await expect(compact.getByRole('button', { name: 'Guides', exact: true })).toHaveAttribute('aria-expanded', 'true');
    if (width < 1024) await page.keyboard.press('Escape');
    await modes.getByRole('button', { name: 'API', exact: true }).click();
    await expect(page.locator('[data-workspace-panel-target="API"]')).toBeVisible();
    await modes.getByRole('button', { name: 'Docs', exact: true }).click();
    await expect(page.locator('article h1')).toHaveText('React AG-UI interrupts preview');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('framework switching keeps the shared reading layout and resets it on a shared page', async ({ page }) => {
  await page.goto(route);
  const surface = page.locator('[data-workspace-desktop-navigation] [data-control-plane-pane]');
  await expect(surface).toHaveCSS('background-color', 'rgb(246, 247, 249)');
  await selectFramework(page, 'angular');
  await expect(surface).toHaveCSS('background-color', 'rgb(246, 247, 249)');
  await expect(page.locator('[data-workspace-shell]')).toHaveAttribute('data-workspace-navigation-layout', 'toolbar');
  await selectFramework(page, 'react');
  await expect(surface).toHaveCSS('background-color', 'rgb(246, 247, 249)');
  await page.goto('/docs/choosing-an-adapter');
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.locator('[data-website-workspace-host][data-docs-reading]')).toHaveCount(0);
  await expect(page.locator('[data-docs-navigation-compact]')).toHaveCount(0);
});
