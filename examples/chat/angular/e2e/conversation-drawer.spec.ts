import { expect, test } from '@playwright/test';
import { openDemo } from './test-helpers';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openDemo(page, '/popup');
});

test('closed conversations are inaccessible; the modal traps focus and restores its launcher', async ({ page, browserName }) => {
  const drawer = page.locator('chat-sidenav');
  const launcher = page.getByRole('button', { name: 'Open conversations', exact: true });
  await expect(launcher).toBeVisible();
  await expect(drawer).toHaveAttribute('inert', '');
  // Playwright's synthetic role selector includes inert subtrees. Check the
  // actual browser accessibility tree as well as native focus rejection.
  const cdp = browserName === 'chromium' ? await page.context().newCDPSession(page) : null;
  const accessibleNames = async () => {
    if (!cdp) throw new Error('Native AX inspection requires Chromium');
    return (await cdp.send('Accessibility.getFullAXTree')).nodes
      .filter(node => !node.ignored).map(node => node.name?.value);
  };
  if (cdp) await expect.poll(accessibleNames).not.toContain('New chat');
  await drawer.locator('button').first().evaluate((button: HTMLButtonElement) => button.focus());
  await expect.poll(() => drawer.evaluate(element => element.contains(document.activeElement))).toBe(false);

  await launcher.click();
  const dialog = page.getByRole('dialog', { name: 'Conversations', exact: true });
  const close = dialog.getByRole('button', { name: 'Close conversations', exact: true });
  await expect(close).toBeFocused();
  await expect(page.locator('.demo-shell__hamburger')).toHaveAttribute('aria-expanded', 'true');
  if (cdp) {
    await expect.poll(accessibleNames).toContain('New chat');
    await expect.poll(accessibleNames).not.toContain('Demo controls');
  }
  const first = dialog.getByRole('button', { name: 'New chat', exact: true });
  const last = dialog.getByRole('button', { name: 'Switch to light theme', exact: true });
  await first.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(last).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(first).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(launcher).toBeFocused();
  await expect(drawer).toHaveAttribute('inert', '');

  await launcher.click();
  await page.locator('chat-sidenav-scrim button').click({ position: { x: 310, y: 400 } });
  await expect(launcher).toBeFocused();
  await expect(drawer).toHaveAttribute('inert', '');
  await cdp?.detach();
});

test('conversation search temporarily owns focus and returns it to the drawer', async ({ page }) => {
  await page.getByRole('button', { name: 'Open conversations', exact: true }).click();
  const drawer = page.locator('chat-sidenav');
  const search = drawer.getByRole('button', { name: 'Search conversations', exact: true });
  await search.click();
  const palette = page.getByRole('dialog', { name: 'Search conversations', exact: true });
  const input = palette.getByRole('combobox');
  await expect(input).toBeFocused();
  await expect(drawer).toHaveAttribute('inert', '');
  await expect(drawer).not.toHaveAttribute('aria-modal', 'true');
  await palette.getByRole('button', { name: 'Close', exact: true }).focus();
  await page.keyboard.press('Tab');
  // The search scrim is also a legitimate dismissal control inside its trap.
  await expect.poll(() => page.locator('chat-history-search-palette').evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(palette).toHaveCount(0);
  await expect(search).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open conversations', exact: true })).toBeFocused();
});

test('desktop resize releases modal interaction and returning mobile closes the drawer', async ({ page }) => {
  await page.getByRole('button', { name: 'Open conversations', exact: true }).click();
  await expect(page.locator('chat-sidenav').getByRole('button', { name: 'Close conversations', exact: true })).toBeFocused();
  await page.setViewportSize({ width: 1200, height: 800 });
  const drawer = page.locator('chat-sidenav');
  await expect(drawer).toHaveAttribute('data-mode', 'expanded');
  await expect(drawer).not.toHaveAttribute('inert', '');
  await expect(page.getByRole('toolbar', { name: 'Demo controls' })).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'New chat', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Embed', exact: true }).focus();
  await expect(page.getByRole('button', { name: 'Embed', exact: true })).toBeFocused();
  await drawer.getByRole('button', { name: 'Search conversations', exact: true }).focus();
  await page.setViewportSize({ width: 320, height: 640 });
  await expect(drawer).toHaveAttribute('data-mode', 'drawer');
  await expect(drawer).toHaveAttribute('inert', '');
  await expect(page.getByRole('button', { name: 'Open conversations', exact: true })).toBeFocused();
});
