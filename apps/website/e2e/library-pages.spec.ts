import { expect, test } from '@playwright/test';

const routes = ['langgraph', 'ag-ui', 'chat', 'render'];

for (const width of [320, 375, 768, 1440]) {
  test(`library pages fit with readable media and forms at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const route of routes) {
      await page.goto(`/${route}`);
      await expect(page.locator('h1')).toHaveCount(1);
      expect(
        (await page.locator('h1').boundingBox())?.y
      ).toBeGreaterThanOrEqual(112);
      await expect(
        page.getByRole('link', { name: 'React docs', exact: true })
      ).toBeVisible();
      await expect(
        page.getByRole('link', { name: 'Angular docs', exact: true })
      ).toBeVisible();
      const code = page.getByRole('tab', { name: 'Code', exact: true });
      if (await code.count()) {
        await code.click();
        await expect(code).toHaveAttribute('aria-selected', 'true');
        await expect(page.getByRole('tabpanel')).toBeVisible();
      }
      const examples = page.locator('.library-code-examples summary');
      if (await examples.count()) {
        await examples.click();
        await expect(page.locator('.library-code-examples')).toHaveAttribute(
          'open',
          ''
        );
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
        route
      ).toBe(width);
      const report = page.locator('#whitepaper-block');
      await expect(
        report.getByRole('button', { name: 'Get the field report' })
      ).toBeVisible();
      expect(
        (await report.getByLabel('Work email').boundingBox())?.width
      ).toBeGreaterThanOrEqual(200);
      expect(
        (await report.getByLabel('Work email').boundingBox())?.height
      ).toBeLessThanOrEqual(56);
    }
  });
}

test('AG-UI media switches with the keyboard and does not mount an unrelated live demo', async ({
  page,
}) => {
  await page.goto('/ag-ui');
  const video = page.getByRole('tab', { name: 'Video', exact: true });
  await video.focus();
  await video.press('ArrowRight');
  const code = page.getByRole('tab', { name: 'Code', exact: true });
  await expect(code).toBeFocused();
  await expect(code).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toContainText('provideAgent');
  await expect(
    page.getByRole('tab', { name: 'Live', exact: true })
  ).toHaveCount(0);
  await expect(page.locator('iframe')).toHaveCount(0);
});
