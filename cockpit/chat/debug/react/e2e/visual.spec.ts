// eslint-disable-next-line @nx/enforce-module-boundaries -- Shared browser coverage for the authored examples.
import { exampleVisualChecks } from '../../../../shared/react-example-visual';
import { test, expect } from '@playwright/test';

exampleVisualChecks('/chat/debug/react/', 'cockpit-chat-debug-react');

for (const theme of ['light', 'dark'] as const) {
  test(`Debug shell follows the page theme: ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/chat/debug/react/');
    const header = page.locator('.tp-example__conversation > header');
    await expect(header).toHaveCSS('background-color', theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(28, 28, 28)');
    await expect(header).toHaveCSS('color', theme === 'light' ? 'rgb(28, 28, 28)' : 'rgb(245, 245, 245)');
    await expect(header).toHaveCSS('border-bottom-color', theme === 'light' ? 'rgb(229, 229, 229)' : 'rgb(45, 45, 45)');
    await expect(page.locator('.tp-example__footer > [role="status"]')).toHaveCSS('color', theme === 'light' ? 'rgb(115, 115, 115)' : 'rgb(160, 160, 160)');
  });
}
