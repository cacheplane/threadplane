import { test, expect } from '@playwright/test';
import { submitAndWaitForResponse } from '@threadplane-internal/e2e-harness';
import type { ThreadState } from '@langchain/langgraph-sdk';

test('time-travel: hello prompt produces assistant turn', async ({ page }) => {
  const bubble = await submitAndWaitForResponse(page, 'Hello');
  // Smoke: backend booted, aimock replayed fixture, assistant bubble
  // finalized (data-streaming="false") and is present in the DOM.
  await expect(bubble).toBeVisible();
});

test('time-travel: fork starts at the selected checkpoint, not the thread tip', async ({
  page,
}) => {
  const firstRun = page.waitForRequest(
    (request) =>
      request.method() === 'POST' &&
      new URL(request.url()).pathname.endsWith('/runs/stream')
  );
  await submitAndWaitForResponse(page, 'Hello');
  const stateUrl = (await firstRun).url().replace(/\/runs\/stream$/, '/state');
  const readState = async (): Promise<
    ThreadState<{
      messages: { id: string; content: string }[];
    }>
  > => {
    const response = await page.request.get(stateUrl);
    expect(response.ok()).toBe(true);
    return response.json();
  };
  await expect
    .poll(async () => (await readState()).values.messages.length)
    .toBe(2);
  const original = await readState();
  const checkpointId = original.checkpoint.checkpoint_id;
  if (!checkpointId)
    throw new Error('Completed first turn did not produce a checkpoint');

  await page
    .getByRole('textbox', { name: /message|prompt/i })
    .fill('Continue the original path.');
  await page.getByRole('button', { name: /send message/i }).click();
  await expect(
    page
      .locator('chat-message[data-role="assistant"][data-streaming="false"]')
      .last()
  ).toContainText('This reply belongs only to the original path.');
  await expect
    .poll(async () => (await readState()).values.messages.length)
    .toBe(4);
  const originalTipId = (await readState()).checkpoint.checkpoint_id;
  if (!originalTipId)
    throw new Error('Completed second turn did not produce a checkpoint');

  const forkRun = page.waitForRequest(
    (request) =>
      request.method() === 'POST' &&
      new URL(request.url()).pathname.endsWith('/runs/stream')
  );
  await page
    .locator('.row')
    .filter({ hasText: checkpointId })
    .getByRole('button', { name: 'Fork', exact: true })
    .click();
  const body = (await forkRun).postDataJSON();
  expect(body.checkpoint).toEqual({
    checkpoint_id: checkpointId,
    checkpoint_ns: '',
    checkpoint_map: {},
  });
  expect(body).not.toHaveProperty('checkpoint_id');
  await expect(
    page
      .locator('chat-message[data-role="assistant"][data-streaming="false"]')
      .last()
  ).toContainText('This reply belongs to the checkpoint fork.');

  // The real server must preserve the first turn and exclude the later original
  // turn. Merely observing a completed reply would pass with the broken alias.
  await expect
    .poll(async () =>
      (await readState()).values.messages.map((message) => message.content)
    )
    .toEqual([
      ...original.values.messages.map((message) => message.content),
      'Try a different approach from here.',
      'This reply belongs to the checkpoint fork.',
    ]);
  await expect(page.locator('.row--active .id')).toHaveText(checkpointId);

  // The thread now has two branches from that checkpoint. Selecting a
  // checkpoint must select the branch it is on: a branch is the fork choices
  // that lead to a checkpoint, not the checkpoint's own id, and a value that
  // names no branch silently shows the newest one instead.
  const forkTipId = (await readState()).checkpoint.checkpoint_id;
  if (!forkTipId) throw new Error('The fork did not produce a checkpoint');
  expect(forkTipId).not.toBe(originalTipId);
  const row = (id: string) => page.locator('.row').filter({ hasText: id });
  const branch = page.getByTestId('selected-branch');
  // With no selection the timeline marks the latest path: the fork.
  await expect(row(forkTipId)).toHaveAttribute('data-on-branch', 'true');
  await expect(row(originalTipId)).toHaveAttribute('data-on-branch', 'false');
  await expect(row(checkpointId)).toHaveAttribute('data-on-branch', 'true');
  await expect(branch).toHaveText('Branch: latest');

  await row(originalTipId)
    .getByRole('button', { name: 'Select', exact: true })
    .click();
  await expect(page.locator('.row--active .id')).toHaveText(originalTipId);
  // The original path is now the one shown, and the fork is not.
  await expect(row(originalTipId)).toHaveAttribute('data-on-branch', 'true');
  await expect(row(forkTipId)).toHaveAttribute('data-on-branch', 'false');
  // The checkpoint both branches grew from is on either.
  await expect(row(checkpointId)).toHaveAttribute('data-on-branch', 'true');
  await expect(branch).not.toHaveText('Branch: latest');
  // The branch is named by the first checkpoint of the chosen alternative,
  // which is one the timeline lists on that branch.
  const selected = ((await branch.textContent()) ?? '').replace('Branch: ', '').trim();
  expect(selected).not.toBe('');
  await expect(row(selected)).toHaveAttribute('data-on-branch', 'true');

  // Selecting is a view selection: the transcript still shows the fork, and
  // an ordinary Send continues that conversation, not the selected branch.
  await expect(
    page
      .locator('chat-message[data-role="assistant"][data-streaming="false"]')
      .last()
  ).toContainText('This reply belongs to the checkpoint fork.');

  // Selecting a checkpoint on the fork returns the timeline to it.
  await row(forkTipId)
    .getByRole('button', { name: 'Select', exact: true })
    .click();
  await expect(row(forkTipId)).toHaveAttribute('data-on-branch', 'true');
  await expect(row(originalTipId)).toHaveAttribute('data-on-branch', 'false');
});
