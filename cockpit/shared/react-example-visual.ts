import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** Initial-state coverage complements each example's capability-specific flows. */
export function exampleVisualChecks(path: string, name: string) {
  for (const width of [375, 1280]) {
    for (const theme of ['light', 'dark'] as const) {
      test(`example presentation: ${width}px ${theme}`, async ({ page }, info) => {
        await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(path);
        await expect(page.locator('main.tp-example')).toBeVisible();
        await page.waitForLoadState('networkidle');
        // This standalone suite uses browser preference; the theming demo also
        // has an explicit app-owned palette, which must be selected through UI.
        if (await page.locator('.theming-demo__palettes').count()) {
          await page.locator('.theming-demo__palettes')
            .getByRole('button', { name: theme === 'light' ? 'Light' : 'Dark', exact: true }).click();
        }
        await page.evaluate(async () => { await document.fonts.ready; });
        const inputs = page.locator('.tp-chat-input__textarea');
        for (const input of await inputs.all()) {
          if (!(await input.isVisible())) continue;
          await expect(input).toHaveCSS('font-size', '16px');
          await expect(input).toHaveCSS('line-height', '24px');
          await expect.poll(() => input.evaluate((element) => {
            const b = element.getBoundingClientRect();
            return b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight &&
              [[b.x + b.width / 2, b.y + b.height / 2], [b.left + 2, b.top + 2],
                [b.right - 2, b.top + 2], [b.left + 2, b.bottom - 2], [b.right - 2, b.bottom - 2]]
                .every(([x, y]) => document.elementFromPoint(x, y) === element);
          })).toBe(true);
          if (await input.isEnabled()) {
            await input.fill(Array.from({ length: 40 }, (_, index) => `Draft line ${index + 1}`).join('\n'));
            await expect.poll(() => input.evaluate((element) => {
              const b = element.getBoundingClientRect();
              return b.top >= 0 && b.bottom <= innerHeight &&
                document.elementFromPoint(b.x + b.width / 2, b.bottom - 2) === element;
            })).toBe(true);
            await input.fill('');
          }
        }
        const header = page.locator('.tp-example__conversation > header');
        await expect(header).toBeVisible();
        await expect(header.locator('h1')).toHaveCSS('font-size', '14px');
        const docs = page.getByRole('complementary', { name: 'About this example' });
        const headerBox = await header.boundingBox();
        const docsBox = await docs.boundingBox();
        expect(headerBox?.y).toBe(0);
        expect(headerBox?.height).toBe(53);
        for (const status of await page.locator('.tp-example__footer > [role="status"]').all()) {
          await expect(status).toHaveCSS('font-weight', '400');
        }
        if (width === 1280) {
          expect(docsBox?.y).toBe(0);
          expect(docsBox?.width).toBe(288);
        }
        const composers = page.locator('.tp-example__footer .tp-chat-input');
        await expect(composers).toHaveCount(await inputs.count());
        for (const composer of await composers.all()) {
          const available = await composer.evaluate((element) => element.closest('.tp-example__footer')?.getBoundingClientRect().width ?? 0);
          const pill = await composer.locator('.tp-chat-input__pill').boundingBox();
          expect(pill?.width).toBeCloseTo(Math.min(768, available - 32), 1);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
        expect(errors).toEqual([]);
        await info.attach('presentation state', {
          body: JSON.stringify(await page.locator('main.tp-example').evaluate((element) => ({
            scheme: getComputedStyle(element).colorScheme,
            background: getComputedStyle(element).backgroundColor,
            color: getComputedStyle(element).color,
            palette: element.getAttribute('data-theme'),
          }))),
          contentType: 'application/json',
        });
        const directory = process.env['REACT_VISUAL_ARTIFACTS'];
        if (directory) mkdirSync(directory, { recursive: true });
        const screenshot = directory
          ? join(directory, `${name}-${width}-${theme}.png`)
          : info.outputPath('example.png');
        await page.screenshot({ path: screenshot, animations: 'disabled' });
        await info.attach('example presentation', { path: screenshot, contentType: 'image/png' });
      });
    }
  }
}
