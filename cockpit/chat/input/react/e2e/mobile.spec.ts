import { expect, test } from '@playwright/test';

for (const width of [320, 375]) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`reduced mobile viewport preserves transcript and editable composer: ${width}px ${colorScheme}`, async ({
      page,
      request,
    }) => {
      await request.post('/__reset');
      await page.setViewportSize({ width, height: 450 });
      await page.emulateMedia({ colorScheme });
      await page.goto('/chat/input/react/');
      const input = page.getByRole('textbox', { name: 'Message', exact: true });
      await input.fill('Mobile conversation');
      await input.press('Enter');
      await expect(page.getByRole('status')).toHaveText('Response saved.');
      const transcript = page.getByRole('region', {
        name: 'Conversation',
        exact: true,
      });
      const rect = await transcript.boundingBox();
      expect(rect?.height).toBeGreaterThan(80);
      const composer = await input.boundingBox();
      if (!rect || !composer) throw new Error('Transcript or composer is hidden');
      expect(rect.y + rect.height).toBeLessThanOrEqual(composer.y);
      await input.fill('A draft after resizing');
      await page.setViewportSize({ width, height: 812 });
      await page.setViewportSize({ width, height: 450 });
      await expect(input).toHaveValue('A draft after resizing');
      await expect(input).toBeFocused();
      expect(
        await input.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return (
            document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) ===
            el
          );
        })
      ).toBe(true);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true);
      await expect(
        page
          .getByRole('complementary', { name: 'About this example' })
          .getByRole('group', { name: 'Composer settings' })
      ).toBeAttached();
    });
  }
}
