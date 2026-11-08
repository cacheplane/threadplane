import { test, expect } from '@playwright/test';

for (const width of [1440, 1024, 768, 375]) {
  test(`capability cards keep a consistent grid at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);
    const section = page.getByRole('region', {
      name: 'Agent work, carried through.',
    });
    await expect(section.getByRole('heading', { level: 3 })).toHaveText([
      'Persistent.',
      'Durable.',
      'Visible.',
      'Reviewable.',
      'Resumable.',
    ]);
    const cards = section.locator('article');
    const layout = await cards.evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        const copy = element
          .querySelector('.capability-copy')!
          .getBoundingClientRect();
        const illustration = element
          .querySelector('svg')!
          .getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          x: rect.x,
          right: rect.right,
          y: rect.y,
          bottom: rect.bottom,
          height: rect.height,
          copyX: copy.x,
          copyBottom: copy.bottom,
          imageX: illustration.x,
          imageY: illustration.y,
          imageRight: illustration.right,
          imageBottom: illustration.bottom,
          imageWidth: illustration.width,
          imageHeight: illustration.height,
          padding: style.padding,
          headingSize: getComputedStyle(element.querySelector('h3')!).fontSize,
        };
      })
    );
    for (const [index, card] of layout.entries()) {
      expect(card.x).toBeCloseTo(layout[0].x, 0);
      expect(card.right).toBeCloseTo(layout[0].right, 0);
      expect(card.padding).toBe(layout[0].padding);
      expect(card.headingSize).toBe(layout[0].headingSize);
      expect(card.imageWidth).toBeCloseTo(layout[0].imageWidth, 0);
      expect(card.imageWidth / card.imageHeight).toBeCloseTo(1.5, 2);
      expect(card.imageRight).toBeLessThan(card.right);
      expect(card.imageBottom).toBeLessThan(card.bottom);
      if (index > 0)
        expect(card.y - layout[index - 1].bottom).toBeCloseTo(16, 0);
      if (width >= 768) {
        expect(card.height).toBeCloseTo(layout[0].height, 0);
        if (index % 2 === 0) expect(card.copyX).toBeLessThan(card.imageX);
        else expect(card.imageX).toBeLessThan(card.copyX);
      } else {
        expect(card.copyBottom).toBeLessThan(card.imageY);
      }
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth
      )
    ).toBeLessThanOrEqual(1);
  });
}

test('capabilities link to their relevant guides and expose descriptive illustrations', async ({
  page,
}) => {
  await page.goto('/');
  const section = page.getByRole('region', {
    name: 'Agent work, carried through.',
  });
  const destinations = [
    '/docs/langgraph/guides/persistence',
    '/docs/langgraph/guides/persistence#choosing-a-checkpointer',
    '/docs/chat/components/chat-tool-calls',
    '/docs/langgraph/guides/interrupts',
    '/docs/langgraph/guides/persistence#checkpoint-recovery',
  ];
  for (const [index, href] of destinations.entries()) {
    const card = section.locator('article').nth(index);
    await expect(card.getByRole('link')).toHaveAttribute('href', href);
    await expect(card.getByRole('img')).toHaveAttribute('aria-label', /\S+/);
  }
  await section.getByRole('link', { name: 'Explore human approval' }).focus();
  await expect(
    section.getByRole('link', { name: 'Explore human approval' })
  ).toBeFocused();
});
