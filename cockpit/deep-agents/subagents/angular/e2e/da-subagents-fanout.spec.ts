import { test, expect } from '@playwright/test';
import { submitAndWaitForResponse } from '@threadplane-internal/e2e-harness';

// Matches the welcome suggestion in subagents.component.ts and the fixture in
// e2e/fixtures/da-subagents-fanout.json.
const PROMPT =
  'Brief me on KASE and KDEN: I need field data for both and the current weather at both.';

test('da-subagents: a parallel fan-out lands as four separate cards', async ({ page }) => {
  const bubble = await submitAndWaitForResponse(page, PROMPT);

  // The orchestrator issued four `task` calls in ONE turn, so four child graphs
  // streamed concurrently. Each ran in its own `tools:<call_id>` namespace,
  // which is what lets the session keep them apart — a session guessing
  // from message order would fold concurrent children into one card.
  await expect(page.locator('chat-subagent-card')).toHaveCount(4, { timeout: 30_000 });
  await expect(page.getByTestId('dispatch-count')).toHaveText('4 dispatched, 0 running');

  // Both specialists were used, and each card is labelled with the
  // `subagent_type` the orchestrator chose.
  const cards = page.locator('chat-subagent-card');
  const labels = (await cards.locator('.sac__name').allInnerTexts()).sort();
  expect(labels).toEqual([
    'field-researcher',
    'field-researcher',
    'weather-analyst',
    'weather-analyst',
  ]);

  // Cards collapse when their child finishes. Expanding them shows each
  // child's OWN transcript — the numbers the researcher looked up and the
  // conditions the analyst read. Concurrent children that had been folded
  // together would not produce four distinct transcripts.
  for (const card of await cards.all()) {
    await card.getByRole('button', { expanded: false }).first().click();
  }
  const cardText = (await cards.allInnerTexts()).join('\n').toLowerCase();
  expect(cardText).toContain('kase');
  expect(cardText).toContain('kden');
  expect(cardText).toMatch(/7,?820|8,?006/);
  expect(cardText).toMatch(/visibility|wind|gust/);

  // The orchestrator wrote its own briefing rather than pasting a child's.
  const finalText = await bubble.innerText();
  expect(finalText.toLowerCase()).toMatch(/kase|kden/);
});
