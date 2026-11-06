// eslint-disable-next-line @nx/enforce-module-boundaries -- Same full viewport contract for both framework examples.
import { expectExampleShell } from '../../../../shared/chat-shell-contract';
import { test } from '@playwright/test';
for (const width of [375, 1280]) for (const colorScheme of ['light', 'dark'] as const) {
  test(`matched example shell: ${width}px ${colorScheme}`, async ({ page }, info) => {
    const height = width === 375 ? 812 : 900;
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme });
    await page.goto('/chat/input/react/');
    await page.locator('textarea').first().waitFor();
    await page.evaluate(async () => { await document.fonts.ready; });
    await expectExampleShell(page, 'Chat input', width, height, 127.4);
    await info.attach('matched shell', { body: await page.screenshot(), contentType: 'image/png' });
  });
}
