import { expect, test, type Locator } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

async function settle(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  await target.evaluate(
    () =>
      new Promise<void>((done) => {
        requestAnimationFrame(() => requestAnimationFrame(() => done()));
      })
  );
}
async function context(target: Locator) {
  await settle(target);
  await target.click({ button: 'right' });
}

test('installed React conversation deletion confirms intent and preserves a running selection through uncertain outcomes', async ({
  page,
}, testInfo) => {
  test.setTimeout(300_000);
  const { buildConsumer } = await import('../tooling/consumer.mjs');
  const { startProofServer, threadEnvelope } = await import(
    '../tooling/proof-server.mjs'
  );
  const { captureRetainedBuild, readRetainedBuild, startCheckedServer } =
    await import('../tooling/retained-build.mjs');
  const work = realpathSync(mkdtempSync(join(tmpdir(), 'native-delete-')));
  const alpha = threadEnvelope('a', 'Alpha selected');
  const beta = {
    ...threadEnvelope('b/opaque', 'Beta pinned'),
    metadata: { title: 'Beta pinned', pinned: true, pinnedOrder: 0 },
  };
  const gamma = {
    ...threadEnvelope('c', 'Gamma archived'),
    metadata: { title: 'Gamma archived', archived: true },
  };
  const delta = {
    ...threadEnvelope('d', 'Delta pinned'),
    metadata: { title: 'Delta pinned', pinned: true, pinnedOrder: 1 },
  };
  const renamedDelta = {
    ...delta,
    metadata: { ...delta.metadata, title: 'Delta renamed' },
  };
  const backend = await startProofServer([
    {
      method: 'POST',
      path: '/api/threads/search',
      payload: { limit: 50, offset: 0 },
      body: [alpha, beta, gamma, delta],
    },
    { method: 'GET', path: '/api/threads/a', body: alpha },
    {
      method: 'POST',
      path: '/api/threads/a/history',
      payload: { limit: 10 },
      body: [],
    },
    {
      method: 'POST',
      path: '/api/threads/a/runs/stream',
      holdBody: true,
      events: [
        {
          event: 'values',
          data: {
            messages: [
              {
                type: 'ai',
                id: 'delete-response',
                content: 'Deletion response remains active.',
              },
            ],
          },
        },
      ],
      assertPayload(value: unknown) {
        const body = value as {
          assistant_id: string;
          input: { messages: { type: string; content: string }[] };
          on_disconnect: string;
        };
        assert.equal(body.assistant_id, 'assistant');
        assert.equal(body.input.messages.length, 1);
        assert.equal(body.input.messages[0].type, 'human');
        assert.equal(
          body.input.messages[0].content,
          'Keep responding while I delete another conversation.'
        );
        assert.equal(body.on_disconnect, 'continue');
      },
    },
    {
      method: 'DELETE',
      path: '/api/threads/b%2Fopaque',
      status: 204,
      holdHeaders: true,
    },
    {
      method: 'PATCH',
      path: '/api/threads/d',
      payload: { metadata: { title: 'Delta renamed' } },
      body: {
        ...renamedDelta,
        metadata: { title: 'Delta renamed', pinned: false },
      },
    },
    // Even a later supplied stale slice cannot resurrect an ID retired by this owner.
    {
      method: 'POST',
      path: '/api/threads/search',
      payload: { limit: 50, offset: 0 },
      body: [alpha, beta, gamma, renamedDelta],
    },
    { method: 'DELETE', path: '/api/threads/c', status: 500 },
    { method: 'GET', path: '/api/threads/c', body: gamma },
    { method: 'DELETE', path: '/api/threads/c', status: 202 },
    { method: 'GET', path: '/api/threads/c', status: 404, holdBody: true },
    { method: 'GET', path: '/api/threads/d', body: renamedDelta },
    {
      method: 'POST',
      path: '/api/threads/d/history',
      payload: { limit: 10 },
      body: [],
    },
    {
      method: 'DELETE',
      path: '/api/threads/d',
      status: 204,
      holdHeaders: true,
    },
  ]);
  let server: Awaited<ReturnType<typeof startCheckedServer>> | undefined;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await buildConsumer({
      root: resolve(__dirname, '../../../../'),
      assistantId: 'assistant',
      output: join(work, 'production'),
      capture: (value: unknown) =>
        captureRetainedBuild(join(work, 'retained'), value),
    });
    server = await startCheckedServer({
      retained: readRetainedBuild(join(work, 'retained')),
      target: backend.origin + '/api',
    });
    const origin = server.url;
    await page.route('**/*', (route) => {
      if (new URL(route.request().url()).origin === origin)
        return route.continue();
      errors.push('Unexpected external request: ' + route.request().url());
      return route.abort();
    });
    await page.setViewportSize({ width: 1280, height: 700 });
    await page.goto(origin + '/?presentation=sidenav&thread=a');
    const list = page.getByRole('list', {
      name: 'Loaded conversations',
      exact: true,
    });
    const archived = page.getByRole('list', {
      name: 'Archived loaded conversations',
      exact: true,
    });
    const row = (title: string) =>
      list.getByRole('button', { name: title, exact: true });
    const draft = page.getByRole('textbox', { name: 'Message', exact: true });
    const modal = page.getByRole('alertdialog', {
      name: 'Delete conversation?',
      exact: true,
    });
    const cancel = () =>
      modal.getByRole('button', { name: 'Cancel', exact: true });
    const confirm = () =>
      modal.getByRole('button', { name: 'Delete', exact: true });
    const deleteItem = (title: string) =>
      page.getByRole('menuitem', {
        name: new RegExp('^Delete conversation for ' + title),
      });
    const openDeletion = async (target: Locator, title: string) => {
      await context(target);
      await deleteItem(title).click();
      await expect(modal).toBeVisible();
      await expect(cancel()).toBeFocused();
    };
    await expect(row('Alpha selected')).toHaveAttribute('aria-current', 'true');
    await draft.fill('Keep this unsubmitted draft.');
    await context(row('Beta pinned'));
    await expect(deleteItem('Beta pinned')).toBeEnabled();
    expect(backend.requests).toHaveLength(3);
    await deleteItem('Beta pinned').click();
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('Beta pinned');
    await expect(modal).toContainText('b/opaque');
    await expect(modal).toContainText(/permanent/i);
    await expect(cancel()).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(confirm()).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(cancel()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
    await expect(draft).toHaveValue('Keep this unsubmitted draft.');
    expect(backend.requests).toHaveLength(3);
    await page.setViewportSize({ width: 390, height: 760 });
    await page
      .getByRole('button', { name: 'Open conversations', exact: true })
      .click();
    await openDeletion(row('Beta pinned'), 'Beta pinned');
    const box = await modal.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= 390);
    await page.screenshot({
      path: testInfo.outputPath('delete-confirmation-mobile-390.png'),
      fullPage: false,
    });
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Close conversations', exact: true })
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Close conversations', exact: true })
      .click();
    expect(backend.requests).toHaveLength(3);
    await page.setViewportSize({ width: 1280, height: 700 });
    await draft.fill('Keep responding while I delete another conversation.');
    await draft.press('Control+Enter');
    await backend.steps[3].received;
    const response = page.getByText('Deletion response remains active.', {
      exact: true,
    });
    await expect(response).toBeVisible();
    const responseNode = await response.elementHandle();
    const draftNode = await draft.elementHandle();
    assert.ok(responseNode && draftNode);
    const heldDraft = await draft.inputValue();
    await context(row('Alpha selected'));
    await expect(deleteItem('Alpha selected')).toBeDisabled();
    await page.keyboard.press('Escape');
    await openDeletion(row('Beta pinned'), 'Beta pinned');
    await page.screenshot({
      path: testInfo.outputPath('delete-confirmation-desktop.png'),
      fullPage: false,
    });
    await confirm().click();
    await backend.steps[4].received;
    await expect(modal).toHaveCount(0);
    await expect(row('Beta pinned')).toBeVisible();
    const filter = page.getByRole('searchbox', {
      name: 'Filter loaded conversations by title',
    });
    await filter.fill('Beta');
    await context(row('Beta pinned'));
    for (const name of [
      /^Delete conversation/,
      /^Rename conversation/,
      /^Unpin conversation/,
      /^Archive conversation/,
      /^Move down/,
    ])
      await expect(page.getByRole('menuitem', { name })).toBeDisabled();
    await expect(
      page.getByRole('menuitem', { name: /^Copy conversation ID/ })
    ).toBeEnabled();
    await page.keyboard.press('Escape');
    await filter.fill('');
    await context(row('Delta pinned'));
    await expect(
      page.getByRole('menuitem', { name: /^Move up/ })
    ).toBeDisabled();
    await page.getByRole('menuitem', { name: /^Rename conversation/ }).click();
    const editor = page.getByRole('textbox', {
      name: 'Conversation title',
      exact: true,
    });
    await editor.fill('Delta renamed');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editor).toHaveCount(0);
    await filter.focus();
    backend.steps[4].releaseHeaders();
    await expect(row('Beta pinned')).toHaveCount(0);
    await expect(filter).toBeFocused();
    await expect(row('Delta renamed')).toHaveAccessibleDescription(
      /Pinned conversation/
    );
    expect(backend.requests).toHaveLength(6);
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await backend.steps[6].received;
    await expect(
      page.getByText('Refreshing conversations…', { exact: true })
    ).toHaveCount(0);
    await expect(row('Beta pinned')).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Collapse conversations', exact: true })
      .click();
    const compact = page.locator('.tp-chat-sidenav__collapsed-content');
    await expect(
      compact.getByRole('button', { name: 'Beta pinned', exact: true })
    ).toHaveCount(0);
    await expect(
      compact.getByRole('button', { name: /^Actions for/ })
    ).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Expand conversations', exact: true })
      .click();
    await page.getByText('Archived conversations', { exact: true }).click();
    const gammaRow = archived.getByRole('button', {
      name: 'Gamma archived',
      exact: true,
    });
    await openDeletion(gammaRow, 'Gamma archived');
    await confirm().click();
    const uncertain = page
      .getByRole('status')
      .filter({ hasText: /delet.*unconfirmed|could not confirm delet/i });
    await expect(uncertain).toBeVisible();
    await expect(gammaRow).toBeVisible();
    expect(backend.requests).toHaveLength(8);
    await context(gammaRow);
    await expect(deleteItem('Gamma archived')).toBeDisabled();
    await page.keyboard.press('Escape');
    const check = () =>
      page.getByRole('button', { name: /^Check deletion status/ });
    await check().click();
    await backend.steps[8].received;
    await expect(uncertain).toHaveCount(0);
    await openDeletion(gammaRow, 'Gamma archived');
    await confirm().click();
    await expect(uncertain).toBeVisible();
    await expect(gammaRow).toBeVisible();
    expect(backend.requests).toHaveLength(10);
    await check().click();
    await expect(gammaRow).toHaveCount(0);
    expect(await backend.steps[10].closed).toEqual({ finished: false });
    expect(backend.requests).toHaveLength(11);
    await expect(draft).toHaveValue(heldDraft);
    await expect(page).toHaveURL(/thread=a/);
    expect(await responseNode.evaluate((node) => node.isConnected)).toBe(true);
    expect(await draftNode.evaluate((node) => node.isConnected)).toBe(true);
    // Filtering explicitly remounts row buttons; the selected session/composer is retained.
    const stop = page.getByRole('button', { name: 'Stop', exact: true });
    await expect(stop).toBeEnabled();
    await stop.click();
    expect(await backend.steps[3].closed).toEqual({ finished: false });
    await row('Delta renamed').click();
    await expect(row('Delta renamed')).toHaveAttribute('aria-current', 'true');
    await expect(draft).toBeEnabled();
    await draft.fill('This draft is cleared only after confirmed deletion.');
    const selectedDraft = await draft.elementHandle();
    assert.ok(selectedDraft);
    await openDeletion(row('Delta renamed'), 'Delta renamed');
    await cancel().click();
    await expect(draft).toHaveValue(
      'This draft is cleared only after confirmed deletion.'
    );
    expect(backend.requests).toHaveLength(13);
    await openDeletion(row('Delta renamed'), 'Delta renamed');
    await confirm().focus();
    await page.keyboard.press('Enter');
    await backend.steps[13].received;
    await expect(row('Delta renamed')).toHaveAttribute('aria-current', 'true');
    await expect(draft).toBeDisabled();
    expect(await selectedDraft.evaluate((node) => node.isConnected)).toBe(true);
    backend.steps[13].releaseHeaders();
    await expect(row('Delta renamed')).toHaveCount(0);
    await expect(page).not.toHaveURL(/[?&]thread=/);
    await expect(
      page.getByText('Select a conversation or start a new one.', {
        exact: true,
      })
    ).toBeVisible();
    expect(await selectedDraft.evaluate((node) => node.isConnected)).toBe(
      false
    );
    await page.goBack();
    await expect(page).toHaveURL(/thread=d/);
    await expect(
      page.getByText('Conversation not found.', { exact: true })
    ).toBeVisible();
    expect(backend.requests).toHaveLength(14);
    backend.verify();
    expect(errors).toEqual([]);
  } finally {
    await server?.close();
    await backend.close();
    rmSync(work, { recursive: true, force: true });
  }
});
