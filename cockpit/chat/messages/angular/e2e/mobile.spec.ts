import { expect, test } from '@playwright/test';

test('mobile transcript follows long replies and preserves a scrolled-up reader', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 450 });
  await page.goto('/');
  const input = page.getByRole('textbox', {
    name: 'Type a message',
    exact: true,
  });
  const list = page.locator('.message-scroll');
  await input.fill('Mobile long response');
  await input.press('Enter');
  await expect(page.locator('.submission-status')).toHaveText(
    'Response complete.',
    { timeout: 30000 }
  );
  await expect
    .poll(() =>
      list.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)
    )
    .toBeLessThan(2);
  await list.evaluate((el) => {
    el.scrollTop = 100;
  });
  await input.fill('Hello');
  await input.press('Enter');
  await expect(page.locator('.submission-status')).toHaveText(
    'Response complete.',
    { timeout: 30000 }
  );
  expect(await list.evaluate((el) => el.scrollTop)).toBeCloseTo(100, 0);
  await input.fill('Draft survives the viewport change');
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(input).toHaveValue('Draft survives the viewport change');
  await expect(input).toBeFocused();
  expect(
    await page.evaluate(
      () => scrollY === 0 && document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
});
