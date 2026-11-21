import { test, expect } from '@playwright/test';
import { openChatDevtools, openDemo } from './test-helpers';

test('chat-debug devtools: opens from the sidenav with accessible controls and closes cleanly', async ({
  page,
}) => {
  await openDemo(page, '/embed');
  await openChatDevtools(page);

  const panel = page.getByRole('region', { name: 'Chat devtools' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('tab', { name: 'Timeline' })).toBeVisible();
  await expect(panel.getByRole('tab', { name: 'State' })).toBeVisible();

  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('chat-debug .panel')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Open chat devtools' })
  ).toBeVisible();
});

test.describe('chat-debug × chat-sidebar coexistence', () => {
  test('sidebar surface remains reachable while chat-debug is open', async ({
    page,
  }) => {
    await openDemo(page, '/sidebar');
    await expect(page.locator('chat-sidebar')).toBeAttached();

    // Sidebar mode auto-opens its panel on entry. With the panel open the
    // launcher is hidden by design (its close button on the panel handles
    // dismissal). Verify the open chat-sidebar surface stays reachable
    // (its close button is visible) while chat-debug is open.
    await openChatDevtools(page);

    // Debug auto-picks bottom dock because <chat-sidebar> is present.
    const debugPanel = page.locator('.panel.panel--bottom');
    await expect(debugPanel).toBeVisible();

    // The edge-claim attribute on <html> reflects the dock.
    await expect(page.locator('html')).toHaveAttribute(
      'data-threadplane-chat-debug',
      'bottom'
    );

    // The chat-sidebar panel is auto-opened on entry — verify it remains
    // visible (the bottom-docked debug panel did not cover or unmount it)
    // and the close button stays reachable.
    const sidebarPanel = page.locator('.chat-sidebar__panel[data-open="true"]');
    await expect(sidebarPanel).toBeVisible();
    await expect(sidebarPanel.locator('.chat-sidebar__close')).toBeVisible();

    // The edge-claim attribute reflects the open sidebar.
    await expect(page.locator('html')).toHaveAttribute(
      'data-threadplane-chat-sidebar',
      'open'
    );
  });

  test('user override survives mode switch: explicit right-dock stays right', async ({
    page,
  }) => {
    await openDemo(page, '/embed');
    await openChatDevtools(page);
    // Click right-dock explicitly — sets userDockOverride.
    await page.locator('.panel__dock-btn').nth(2).click(); // 0=left, 1=bottom, 2=right
    // Switch to sidebar mode via the demo-owned top toolbar.
    await page
      .locator('.demo-shell__segmented-button', { hasText: 'Sidebar' })
      .click();
    await openChatDevtools(page);

    // Debug stays right-docked despite chat-sidebar now being on the page.
    await expect(page.locator('.panel.panel--right')).toBeVisible();
    await expect(page.locator('.panel.panel--bottom')).not.toBeVisible();
  });
});
