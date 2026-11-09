import { expect, test } from '@playwright/test';
import { openDemo } from './test-helpers';

for (const width of [320, 390, 768, 1440]) {
  for (const mode of ['embed', 'popup', 'sidebar']) {
    test(`${mode} welcome prompts remain readable and keyboard accessible at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openDemo(page, `/${mode}?theme=default-light&color=light`);
      if (mode === 'popup') {
        await page.getByRole('button', { name: 'Open chat', exact: true }).click();
      }

      const featured = page.locator('welcome-suggestions .welcome-suggestions__featured');
      await featured.scrollIntoViewIfNeeded();
      await expect(featured).toBeInViewport();
      const geometry = await featured.evaluate(button => {
        const rect = button.getBoundingClientRect();
        return {
          left: rect.left, right: rect.right, height: rect.height,
          copy: [...button.querySelectorAll('.welcome-suggestions__label, .welcome-suggestions__description')]
            .map(element => ({ text: element.textContent?.trim(), width: element.clientWidth, scrollWidth: element.scrollWidth })),
        };
      });
      expect(geometry.left).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(width);
      expect(geometry.height).toBeGreaterThanOrEqual(44);
      expect(geometry.copy).toHaveLength(2);
      for (const copy of geometry.copy) {
        expect(copy.text).toBeTruthy();
        expect(copy.scrollWidth).toBeLessThanOrEqual(copy.width + 1);
      }

      const more = page.getByRole('button', { name: 'More prompts', exact: true });
      await more.focus();
      await more.press('Enter');
      const menu = page.getByRole('listbox', { name: 'More demo prompts' });
      await expect(menu).toBeVisible();
      const box = await menu.boundingBox();
      if (!box) throw new Error('Prompt catalog must have visible bounds');
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(900);
      const option = menu.getByRole('option').first();
      await expect(option).toBeFocused();
      const optionBox = await option.boundingBox();
      expect(optionBox?.height).toBeGreaterThanOrEqual(44);
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(more).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    });
  }
}
