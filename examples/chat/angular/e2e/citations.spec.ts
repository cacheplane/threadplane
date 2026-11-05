import { test, expect } from '@playwright/test';
import { sendPromptAndWait } from './test-helpers';

// Matches fixtures/citations.json. The graph runs the REAL search_documents
// tool; its no-match fallback returns the first 3 corpus docs, so the citation
// set is deterministic: ng-signals-overview, ng-signals-rxjs, ng-control-flow.
const PROMPT = 'cite your sources on angular signals';

test('inline citation markers render as resolved pills', async ({ page }) => {
  const bubble = await sendPromptAndWait(page, PROMPT);
  const markers = bubble.locator('.chat-citation-marker');
  await expect(markers.first()).toBeVisible();
  // 4 inline references across 3 distinct sources.
  expect(await markers.count()).toBeGreaterThanOrEqual(3);
  // Resolved markers with a URL render as anchors linking out; none unresolved.
  await expect(bubble.locator('a.chat-citation-marker').first()).toHaveAttribute('href', /angular\.dev/);
  await expect(bubble.locator('.chat-citation-marker--unresolved')).toHaveCount(0);
});

test('sources panel is collapsed by default and expands to the cited sources', async ({ page }) => {
  const bubble = await sendPromptAndWait(page, PROMPT);

  await expect(bubble.locator('.chat-citations')).toBeVisible();
  await expect(bubble.locator('.chat-citations__count')).toHaveText('3');

  // Collapsed by default: header shows, list is absent.
  await expect(bubble.locator('.chat-citations__header')).toBeVisible();
  await expect(bubble.locator('.chat-citations__list')).toHaveCount(0);

  // Expand → three detail cards in citation order.
  await bubble.locator('.chat-citations__header').click();
  const cards = bubble.locator('.chat-citations-card');
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toContainText('Signals');
  await expect(cards.nth(1)).toContainText('RxJS interop');
  await expect(cards.nth(2)).toContainText('control flow');
  await expect(cards.nth(2).locator('.chat-citation-type-badge')).toContainText('File');
  await expect(cards.nth(2).locator('.chat-citation-source-icon--file')).toBeVisible();
  // Cards are links to the source (the card element itself is the <a>).
  await expect(cards.nth(0)).toHaveAttribute('href', /angular\.dev\/guide\/signals/);
});

test('focusing a marker opens the portaled provenance preview card', async ({ page }) => {
  const bubble = await sendPromptAndWait(page, PROMPT);

  const fileMarker = bubble.locator('a.chat-citation-marker').filter({ hasText: '3' });
  await expect(fileMarker).toHaveCount(1);
  await fileMarker.focus();

  // The preview is portaled to the body-level overlay container, not the bubble.
  const preview = page.locator('.chat-citation-preview');
  await expect(preview).toBeVisible();
  await expect(preview.locator('.chat-citation-type-badge')).toContainText('File');
  await expect(preview.locator('.chat-citation-source-icon--file')).toBeVisible();
  await expect(preview.locator('.chat-citation-preview__domain')).toContainText('angular.dev');
  await expect(preview.locator('.chat-citation-preview__open')).toBeVisible();
});

test('a citation marker keeps the punctuation that follows it on its line at every width', async ({ page }) => {
  const bubble = await sendPromptAndWait(page, PROMPT);
  await expect(bubble.locator('.chat-citation-marker').first()).toBeVisible();

  // Reflow the reply across many column widths; at each one, a marker followed
  // directly by punctuation must not leave that punctuation to start a line.
  const results: { width: number; checked: number; stranded: number }[] = [];
  for (let width = 1280; width >= 420; width -= 12) {
    await page.setViewportSize({ width, height: 900 });
    results.push({ width, ...(await bubble.evaluate((root) => {
      let checked = 0, stranded = 0;
      for (const ref of root.querySelectorAll('chat-md-citation-reference')) {
        const marker = ref.querySelector('.chat-citation-marker');
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        walker.currentNode = ref;
        let next = walker.nextNode() as Text | null;
        while (next && ref.contains(next)) next = walker.nextNode() as Text | null;
        if (!marker || !next || !/^[.,;:!?)]/.test(next.data)) continue;
        const range = document.createRange();
        range.setStart(next, 0);
        range.setEnd(next, 1);
        checked++;
        if (range.getBoundingClientRect().top >= marker.getBoundingClientRect().bottom - 2) stranded++;
      }
      return { checked, stranded };
    })) });
  }
  expect(results.some((r) => r.checked > 0)).toBe(true);
  expect(results.filter((r) => r.stranded > 0)).toEqual([]);
});
