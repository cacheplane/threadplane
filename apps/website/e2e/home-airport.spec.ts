import { test, expect } from '@playwright/test';

for (const width of [1440, 1024, 768, 375]) {
  test(`compatibility cards align and remain readable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);
    const section = page.locator('#compatibility');
    await expect(section.getByRole('heading', { level: 2 })).toHaveText(
      'Bring your stack.'
    );
    await expect(section.getByRole('article')).toHaveCount(2);
    const cards = await section.locator('.home-adapter').evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        const link = node.querySelector('a')!.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          linkY: link.y,
          padding: getComputedStyle(node).padding,
        };
      })
    );
    expect(cards[0].width).toBeCloseTo(cards[1].width, 0);
    expect(cards[0].padding).toBe(cards[1].padding);
    if (width >= 768) {
      expect(cards[0].height).toBeCloseTo(cards[1].height, 0);
      expect(cards[0].y).toBeCloseTo(cards[1].y, 0);
      expect(cards[0].linkY).toBeCloseTo(cards[1].linkY, 0);
    } else expect(cards[1].y).toBeGreaterThan(cards[0].y + cards[0].height);
    await expect(
      section
        .getByRole('list', { name: 'AG-UI-compatible runtimes' })
        .getByRole('listitem')
    ).toHaveCount(5);
    await expect(
      section
        .getByRole('list', {
          name: 'Model providers available through your backend',
        })
        .getByRole('listitem')
    ).toHaveCount(5);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth
      )
    ).toBeLessThanOrEqual(1);
  });
}
