import { test, expect } from '@playwright/test';

for (const colorScheme of ['light', 'dark'] as const) {
  for (const width of [375, 1280]) {
    test(`polished chat geometry and usable composer: ${width}px ${colorScheme}`, async ({
      page,
      request,
    }) => {
      await request.post('/__reset');
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await page.goto('/chat/messages/react/');
      const draft = page.getByLabel('Message', { exact: true });
      await expect(draft).toBeEnabled();
      await expect(draft).toHaveCSS('font-size', '16px');
      await expect(draft).toHaveCSS('line-height', '24px');
      const pill = page.locator('.tp-chat-input__pill');
      await expect(pill).toHaveCSS('min-height', '56px');
      expect((await pill.boundingBox())?.width).toBe(width === 375 ? 343 : 768);
      expect(await draft.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return document.elementFromPoint(
          bounds.x + bounds.width / 2,
          bounds.y + bounds.height / 2
        ) === element;
      })).toBe(true);
      await draft.click();
      await page.keyboard.type('Visual `contract`');
      await expect(pill).toHaveCSS('box-shadow', 'none');
      const composerText = await draft.evaluate((element) => getComputedStyle(element).color);
      await expect(page.getByRole('button', { name: 'Send', exact: true }))
        .toHaveCSS('background-color', composerText);
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(page.getByRole('status')).toHaveText('Response saved.');
      const user = page.locator('.tp-chat-message--user').last();
      await expect(user).toHaveCSS('font-size', '16px');
      await expect(user).toHaveCSS('padding', '8px 12px');
      const inlineContrast = await user.locator('code').evaluate((element) => {
        const context = document.createElement('canvas').getContext('2d');
        if (!context) throw new Error('Color readback requires a canvas context');
        const style = getComputedStyle(element);
        const luminance = (color: string) => {
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
          const channels = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
            .map((channel) => channel / 255)
            .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
          return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
        };
        const text = luminance(style.color), background = luminance(style.backgroundColor);
        return (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05);
      });
      expect(inlineContrast).toBeGreaterThanOrEqual(4.5);
      const paragraph = page.locator('.tp-chat-message--assistant .tp-markdown p').first();
      await expect(paragraph).toHaveCSS('font-size', '16px');
      await expect(paragraph).toHaveCSS('line-height', '25.6px');
      await expect(paragraph).toHaveCSS('margin', '0px');
      const code = page.locator('.tp-chat-message--assistant pre');
      await expect(code).toHaveCSS('white-space', 'pre');
      await expect(code).toHaveCSS('padding', '12px 16px');
      await expect(code).toHaveCSS('border-radius', '8px');
      await expect(code.locator('code')).toHaveCSS('font-size', '14px');
      if (width === 1280) {
        expect((await paragraph.boundingBox())?.width).toBe(704);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
      await draft.click();
      await page.keyboard.type('Next question');
      await expect(draft).toHaveValue('Next question');
    });
  }
}
