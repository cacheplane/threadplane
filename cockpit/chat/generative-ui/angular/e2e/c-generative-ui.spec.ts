import { test, expect } from '@playwright/test';
import { submitAndWaitForResponse } from '@threadplane-internal/e2e-harness';

test('c-generative-ui: dashboard prompt renders chat-generative-ui surface', async ({
  page,
}) => {
  await submitAndWaitForResponse(
    page,
    'Show me a dashboard of airline operations.'
  );

  // The render_spec tool call returns a dashboard JSON spec which the
  // content-classifier in @threadplane/chat mounts as a tree of
  // <chat-generative-ui> hosts (one per node in the dashboard view).
  // Multiple matches expected (≥5 for the standard dashboard layout);
  // assert the count proves the GenUI tree wired up. .first() unblocks
  // toBeVisible's strict-mode requirement.
  await expect(page.locator('chat-generative-ui').first()).toBeVisible();
  await expect(page.locator('chat-generative-ui')).not.toHaveCount(0);
});

test('c-generative-ui: filter prompt produces assistant turn', async ({
  page,
}) => {
  const runThreads: string[] = [];
  page.on('request', (request) => {
    const run = /\/threads\/([^/]+)\/runs\/stream/.exec(request.url());
    if (request.method() === 'POST' && run) runThreads.push(run[1]);
  });
  await submitAndWaitForResponse(
    page,
    'Show me a dashboard of airline operations.'
  );
  await expect(page.locator('chat-generative-ui').first()).toBeVisible();
  // Keep the accepted dashboard's conversation; the one-turn helper navigates
  // on every call and would make this a rejected first-turn filter.
  const send = page.getByRole('button', { name: /send message/i });
  await page
    .getByRole('textbox', { name: /message|prompt/i })
    .fill('Filter to only the cancelled flights.');
  await expect(send).toBeEnabled();
  await send.click();

  // The query_recent_disruptions tool returns data the assistant uses to
  // narrow the dashboard. Distinctive surface here is just that the
  // assistant turn finalized — the dashboard view update is internal state.
  await expect(
    page.locator('chat-message[data-role="assistant"]').last()
  ).toBeVisible();
  await expect(
    page.locator('chat-message[data-role="assistant"]').last()
  ).toContainText('Stored 3 cancelled disruption rows (limit 5).');
  expect(runThreads).toHaveLength(2);
  expect(new Set(runThreads).size).toBe(1);
});
