import { test, expect, type Page } from '@playwright/test';

/**
 * Table readability (tables audit, 2026-10). The runtime matrix on
 * /docs/choosing-an-adapter was the worst table on the site: its short
 * status columns split "Yes" into "Ye/s". These checks measure the rendered
 * text, so they hold for any table layout rather than one stylesheet.
 */

/**
 * Words that break across lines between two letters ("Ye/s"). A wrap right
 * after a hyphen or slash ("AG-/UI") is ordinary typesetting and depends on
 * the platform's font metrics, so it does not count.
 */
async function splitWords(page: Page, selector: string): Promise<string[]> {
  return page.locator(selector).evaluate((table) => {
    const lineTop = (node: Text, start: number, end: number): number | undefined => {
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      const rect = [...range.getClientRects()].find((r) => r.width > 0);
      return rect ? Math.round(rect.top) : undefined;
    };
    const split: string[] = [];
    for (const cell of table.querySelectorAll('th, td')) {
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      let node: Text | null;
      while ((node = walker.nextNode() as Text | null)) {
        for (const match of node.data.matchAll(/\S+/g)) {
          const word = match[0];
          let previous: number | undefined;
          for (let i = 0; i < word.length; i++) {
            const top = lineTop(node, match.index + i, match.index + i + 1);
            if (top === undefined) continue;
            if (previous !== undefined && top !== previous && !/[-/_.,|]/.test(word[i - 1])) {
              split.push(word);
              break;
            }
            previous = top;
          }
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
