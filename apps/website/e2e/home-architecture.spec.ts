import { test, expect } from '@playwright/test';

for (const width of [1440, 768, 375]) {
  test(`architecture reads in order and aligns at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const section = page.locator('#architecture');
    await expect(section.getByRole('heading', { level: 3 })).toHaveText([
      'Your application',
      'Threadplane',
      'Your agent backend',
    ]);
    await expect(section).toContainText(
      'no extra Threadplane runtime to deploy'
    );
    const boxes = await section
      .locator('.home-architecture-card')
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const r = node.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        })
      );
    for (const box of boxes) {
      expect(box.width).toBeCloseTo(boxes[0].width, 0);
      if (width >= 768) {
        expect(box.y).toBeCloseTo(boxes[0].y, 0);
        expect(box.height).toBeCloseTo(boxes[0].height, 0);
      }
    }
    const link = section.getByRole('link', {
      name: 'Explore the architecture',
    });
    await link.focus();
    await expect(link).toBeFocused();
    await expect(link).toHaveAttribute('href', '/docs/choosing-an-adapter');
  });
}
