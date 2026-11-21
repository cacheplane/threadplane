import { test, expect } from '@playwright/test';
import { sendPromptAndWait } from './test-helpers';

// Twin of examples/chat's citations spec. AG-UI delivers citations differently
// (the backend surfaces them as state.citations[messageId], which the AG-UI
// session reads onto each message's citations) — but
// the rendered surface is the shared @threadplane/angular/chat markers/preview/panel, so
// the assertions match. The graph runs the REAL search_documents tool; its
// no-match fallback returns the first 3 corpus docs, so the set is deterministic:
// ng-signals-overview, ng-signals-rxjs, ng-control-flow.
const PROMPT = 'cite your sources on angular signals';

test('inline citation markers render as resolved pills', async ({ page }) => {
  const bubble = await sendPromptAndWait(page, PROMPT);
  const markers = bubble.locator('.chat-citation-marker');
  await expect(markers.first()).toBeVisible();
  expect(await markers.count()).toBeGreaterThanOrEqual(3);
  await expect(bubble.locator('a.chat-citation-marker').first()).toHaveAttribute('href', /angular\.dev/);
  await expect(bubble.locator('.chat-citation-marker--unresolved')).toHaveCount(0);
});

test('sources panel is collapsed by default and expands to the cited sources', async ({ page }) => {
  const bubble = await sendPromptAndWait(page, PROMPT);

  await expect(bubble.locator('.chat-citations')).toBeVisible();
  await expect(bubble.locator('.chat-citations__count')).toHaveText('3');

  await expect(bubble.locator('.chat-citations__header')).toBeVisible();
  await expect(bubble.locator('.chat-citations__list')).toHaveCount(0);

  await bubble.locator('.chat-citations__header').click();
  const cards = bubble.locator('.chat-citations-card');
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toContainText('Signals');
  await expect(cards.nth(1)).toContainText('RxJS interop');
  await expect(cards.nth(2)).toContainText('control flow');
  await expect(cards.nth(2).locator('.chat-citation-type-badge')).toContainText('File');
  await expect(cards.nth(2).locator('.chat-citation-source-icon--file')).toBeVisible();
  await expect(cards.nth(0)).toHaveAttribute('href', /angular\.dev\/guide\/signals/);
});

test('focusing a marker opens the portaled provenance preview card', async ({ page }) => {
  const bubble = await sendPromptAndWait(page, PROMPT);

  const fileMarker = bubble.locator('a.chat-citation-marker').filter({ hasText: '3' });
  await expect(fileMarker).toHaveCount(1);
  await fileMarker.focus();

  const preview = page.locator('.chat-citation-preview');
  await expect(preview).toBeVisible();
  await expect(preview.locator('.chat-citation-type-badge')).toContainText('File');
  await expect(preview.locator('.chat-citation-source-icon--file')).toBeVisible();
  await expect(preview.locator('.chat-citation-preview__domain')).toContainText('angular.dev');
  await expect(preview.locator('.chat-citation-preview__open')).toBeVisible();
});
