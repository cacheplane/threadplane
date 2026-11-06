import { expect, test, type Locator } from '@playwright/test';

async function expectUnobstructed(input: Locator): Promise<void> {
  // Visibility alone misses partial clipping or another panel painting over it.
  await expect.poll(() => input.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const points = [
      [bounds.x + bounds.width / 2, bounds.y + bounds.height / 2],
      [bounds.left + 2, bounds.top + 2],
      [bounds.right - 2, bounds.top + 2],
      [bounds.left + 2, bounds.bottom - 2],
      [bounds.right - 2, bounds.bottom - 2],
    ];
    return {
      fullyInViewport: bounds.width > 0 && bounds.height > 0 &&
        bounds.left >= 0 && bounds.top >= 0 &&
        bounds.right <= innerWidth && bounds.bottom <= innerHeight,
      unobstructedPoints: points.map(([x, y]) => document.elementFromPoint(x, y) === element),
    };
  })).toEqual({ fullyInViewport: true, unobstructedPoints: [true, true, true, true, true] });
}

for (const viewport of [{ width: 375, height: 812 }, { width: 1280, height: 900 }]) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`layout: composer and documentation remain usable at ${viewport.width}px in ${colorScheme}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme });
      await page.goto('/');
      const input = page.getByRole('textbox', { name: /message|prompt/i });
      await expect(input).toBeVisible();
      await page.evaluate((theme) => {
        window.postMessage({ type: 'tplane:theme', theme }, location.origin);
      }, colorScheme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
      await expectUnobstructed(input);
      expect((await page.locator('.chat-input__pill').boundingBox())?.width)
        .toBe(viewport.width === 375 ? 343 : 768);

      // Real turns exercise the projected transcript's minimum size and overflow.
      for (let turn = 1; turn <= 8; turn++) {
        await input.fill('Hello');
        await page.getByRole('button', { name: 'Send message', exact: true }).click();
        await expect(page.locator('chat-message[data-role="assistant"][data-streaming="false"]'))
          .toHaveCount(turn, { timeout: 30_000 });
        if (turn === 1) {
          await expect(page.locator('chat-message[data-role="user"] .chat-message__bubble'))
            .toHaveCSS('line-height', '24px');
          await expect(page.locator('chat-streaming-md p').first())
            .toHaveCSS('line-height', '25.6px');
        }
        await expectUnobstructed(input);
      }

      const transcript = page.locator('.message-scroll');
      await expect.poll(() => transcript.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
      await transcript.evaluate((element) => { element.scrollTop = 0; });
      await transcript.hover();
      await page.mouse.wheel(0, 300);
      await expect.poll(() => transcript.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

      await expectUnobstructed(input);
      // Mouse focus + keyboard input catches occlusion that fill() can bypass.
      await input.click();
      await page.keyboard.type('A draft after scrolling');
      await expect(input).toHaveValue('A draft after scrolling');
      await expect(input).toBeFocused();

      const docs = page.locator('[sidebar]');
      await docs.getByText('ChatTypingIndicatorComponent', { exact: true }).scrollIntoViewIfNeeded();
      await expect(docs.getByRole('heading', { name: 'Primitives Used' })).toBeVisible();
      await expect(docs.getByText('ChatTypingIndicatorComponent', { exact: true })).toBeInViewport();
      await expectUnobstructed(input);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  }
}
