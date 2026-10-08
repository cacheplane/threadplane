import { test, expect, type Page } from '@playwright/test';

/**
 * Table readability (tables audit, 2026-10). The runtime matrix on
 * /docs/choosing-an-adapter was the worst table on the site: its short
 * status columns split "Yes" into "Ye/s". These checks measure the rendered
 * text, so they hold for any table layout rather than one stylesheet.
 */

/** Words that wrap onto a second line inside a table cell. */
async function splitWords(page: Page, selector: string): Promise<string[]> {
  return page.locator(selector).evaluate((table) => {
    const split: string[] = [];
    for (const cell of table.querySelectorAll('th, td')) {
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      let node: Text | null;
      while ((node = walker.nextNode() as Text | null)) {
        for (const match of node.data.matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          const tops = new Set(
            [...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top))
          );
          if (tops.size > 1) split.push(match[0]);
        }
      }
    }
    return split;
  });
}

const MATRIX = 'table[data-shape="matrix"]';

test.describe('Docs tables', () => {
  test('desktop: the runtime matrix splits no words', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/docs/choosing-an-adapter');
    await expect(page.locator(MATRIX)).toBeVisible();
    expect(await splitWords(page, MATRIX)).toEqual([]);
  });

  test('phone: the runtime matrix stacks into cards without scrolling sideways', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/docs/choosing-an-adapter');
    const matrix = page.locator(MATRIX);
    await expect(matrix).toBeVisible();

    expect(await matrix.evaluate((t) => getComputedStyle(t.querySelector('tbody tr')!).display)).toBe('block');
    const overflow = await matrix.evaluate((t) => {
      const scroller = t.parentElement!;
      return scroller.scrollWidth - scroller.clientWidth;
    });
    expect(overflow).toBe(0);
    expect(await splitWords(page, MATRIX)).toEqual([]);
    // Each status chip still names its column.
    await expect(matrix.locator('td[data-label="State"][data-status="partial"]')).toHaveCount(1);
  });
});
