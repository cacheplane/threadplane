import { test } from './fixtures';
import { expect, type Locator } from '@playwright/test';
import assert from 'node:assert/strict';

// Finish scrolling before opening a viewport-anchored menu: ancestor scroll
// intentionally dismisses it, including delayed scroll events after automation.
async function settleMenuTarget(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  await target.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
  );
}

async function openRowMenu(target: Locator) {
  await settleMenuTarget(target);
  await target.click({ button: 'right' });
}

async function openActions(target: Locator) {
  await settleMenuTarget(target);
  await target.click();
}

test('installed React conversation archive and unarchive preserve independent metadata, draft and a running selection', async ({
  page,
  retainedConsumer,
}, testInfo) => {
  test.setTimeout(300_000);
  const { startProofServer, threadEnvelope } = await import(
    '../tooling/proof-server.mjs'
  );
  const { startCheckedServer } =
    await import('../tooling/retained-build.mjs');
  const alpha = threadEnvelope('a', 'Alpha notes');
  const beta = threadEnvelope('b', 'Beta notes');
  const gamma = {
    ...threadEnvelope('c', 'Gamma archived'),
    metadata: { title: 'Gamma archived', archived: true },
  };
  const backend = await startProofServer([
    {
      method: 'POST',
      path: '/api/threads/search',
      payload: { limit: 50, offset: 0 },
      body: [alpha, beta, gamma],
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
                id: 'response',
                content: 'Archive response remains active.',
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
          'Keep responding while I archive.'
        );
        assert.equal(body.on_disconnect, 'continue');
      },
    },
    {
      method: 'PATCH',
      path: '/api/threads/b',
      payload: { metadata: { archived: true } },
      status: 500,
    },
    {
      method: 'PATCH',
      path: '/api/threads/b',
      payload: { metadata: { archived: true } },
      body: {
        ...beta,
        metadata: { title: 'Beta notes', archived: true, pinned: false },
      },
      holdBody: true,
    },
    {
      method: 'PATCH',
      path: '/api/threads/b',
      payload: { metadata: { title: 'Beta renamed while archiving' } },
      body: {
        ...beta,
        metadata: {
          title: 'Beta renamed while archiving',
          archived: false,
          pinned: false,
        },
      },
    },
    {
      method: 'PATCH',
      path: '/api/threads/b',
      payload: { metadata: { pinned: true } },
      body: {
        ...beta,
        metadata: { title: 'Beta notes', archived: false, pinned: true },
      },
    },
    {
      method: 'PATCH',
      path: '/api/threads/b',
      payload: { metadata: { archived: false } },
      body: {
        ...beta,
        metadata: { title: 'Beta notes', archived: false, pinned: false },
      },
    },
    {
      method: 'PATCH',
      path: '/api/threads/a',
      payload: { metadata: { archived: true } },
      body: { ...alpha, metadata: { title: 'Alpha notes', archived: true } },
    },
    {
      method: 'PATCH',
      path: '/api/threads/a',
      payload: { metadata: { archived: false } },
      body: { ...alpha, metadata: { title: 'Alpha notes', archived: false } },
    },
    {
      method: 'PATCH',
      path: '/api/threads/c',
      payload: { metadata: { archived: false } },
      body: {
        ...gamma,
        metadata: { title: 'Gamma archived', archived: false },
      },
    },
  ]);
  let server: Awaited<ReturnType<typeof startCheckedServer>> | undefined;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    server = await startCheckedServer({
      retained: retainedConsumer,
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
    const alphaRow = list.getByRole('button', {
      name: 'Alpha notes',
      exact: true,
    });
    let betaRow = list.getByRole('button', { name: 'Beta notes', exact: true });
    await expect(alphaRow).toHaveAttribute('aria-current', 'true');
    const draft = page.getByRole('textbox', { name: 'Message', exact: true });
    const draftNode = await draft.elementHandle();
    assert.ok(draftNode);
    await draft.fill('Retain this archive draft.');
    await openRowMenu(betaRow);
    const archiveBeta = page.getByRole('menuitem', {
      name: /^Archive conversation for Beta/,
    });
    await expect(archiveBeta).toBeVisible();
    expect(backend.requests).toHaveLength(3);
    await page.keyboard.press('Escape');
    await expect(betaRow).toBeFocused();
    await expect(draft).toHaveValue('Retain this archive draft.');
    await page.getByText('Archived conversations', { exact: true }).click();
    await expect(
      archived.getByRole('button', { name: 'Gamma archived', exact: true })
    ).toBeVisible();
    await expect(
      list.getByRole('button', { name: 'Gamma archived', exact: true })
    ).toHaveCount(0);
    await draft.fill('Keep responding while I archive.');
    await draft.press('Control+Enter');
    await backend.steps[3].received;
    const response = page.getByText('Archive response remains active.', {
      exact: true,
    });
    await expect(response).toBeVisible();
    const responseNode = await response.elementHandle();
    assert.ok(responseNode);
    const heldDraft = await draft.inputValue();
    const stop = page.getByRole('button', { name: 'Stop', exact: true });
    await settleMenuTarget(betaRow);
    await betaRow.focus();
    await betaRow.press('Shift+F10');
    await archiveBeta.click();
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: /Could not archive conversation.*\(b\)/ })
    ).toBeVisible();
    await expect(betaRow).toBeVisible();
    expect(backend.requests).toHaveLength(5);
    await openActions(
      list.getByRole('button', {
        name: 'Actions for Beta notes (b)',
        exact: true,
      })
    );
    await archiveBeta.click();
    await backend.steps[5].received;
    const filter = page.getByRole('searchbox', {
      name: 'Filter loaded conversations by title',
    });
    await filter.fill('Alpha');
    await expect(betaRow).toHaveCount(0);
    await filter.fill('');
    await openRowMenu(betaRow);
    await expect(archiveBeta).toBeDisabled();
    await expect(
      page.getByRole('menuitem', { name: /^Copy conversation ID for Beta/ })
    ).toBeEnabled();
    await expect(
      page.getByRole('menuitem', { name: /^Pin conversation for Beta/ })
    ).toBeEnabled();
    expect(backend.requests).toHaveLength(6);
    await page
      .getByRole('menuitem', { name: /^Rename conversation for Beta/ })
      .click();
    const editor = page.getByRole('textbox', {
      name: 'Conversation title',
      exact: true,
    });
    await editor.fill('Beta renamed while archiving');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editor).toHaveCount(0);
    betaRow = list.getByRole('button', {
      name: 'Beta renamed while archiving',
      exact: true,
    });
    await openRowMenu(betaRow);
    await page
      .getByRole('menuitem', { name: /^Pin conversation for Beta/ })
      .click();
    await expect(betaRow).toHaveAccessibleDescription(/Pinned conversation/);
    await filter.focus();
    backend.steps[5].releaseBody();
    await expect(betaRow).toHaveCount(0);
    let restoredBeta = archived.getByRole('button', {
      name: 'Beta renamed while archiving',
      exact: true,
    });
    await expect(restoredBeta).toHaveAccessibleDescription(
      /Pinned conversation/
    );
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: /Conversation archived.*\(b\)/ })
    ).toBeVisible();
    await expect(filter).toBeFocused();
    await openRowMenu(restoredBeta);
    await expect(
      page.getByRole('menuitem', { name: /^Rename conversation for Beta/ })
    ).toHaveCount(0);
    await expect(
      page.getByRole('menuitem', {
        name: /^Pin conversation for Beta|^Unpin conversation for Beta/,
      })
    ).toHaveCount(0);
    await page
      .getByRole('menuitem', { name: /^Unarchive conversation for Beta/ })
      .click();
    restoredBeta = list.getByRole('button', {
      name: 'Beta renamed while archiving',
      exact: true,
    });
    await expect(restoredBeta).toHaveAccessibleDescription(
      /Pinned conversation/
    );
    await openActions(
      list.getByRole('button', {
        name: 'Actions for Alpha notes (a)',
        exact: true,
      })
    );
    const archiveAlpha = page.getByRole('menuitem', {
      name: /^Archive conversation for Alpha/,
    });
    await archiveAlpha.focus();
    await page.keyboard.press('Enter');
    await expect(alphaRow).toHaveCount(0);
    const archivedAlpha = archived.getByRole('button', {
      name: 'Alpha notes',
      exact: true,
    });
    await expect(archivedAlpha).toHaveAttribute('aria-current', 'true');
    await expect(
      page.getByRole('heading', { name: 'Alpha notes', exact: true })
    ).toBeVisible();
    await expect(stop).toBeEnabled();
    await expect(page).toHaveURL(/thread=a/);
    await page.screenshot({
      path: testInfo.outputPath('archive-selected-desktop.png'),
      fullPage: false,
    });
    await page
      .getByRole('button', { name: 'Collapse conversations', exact: true })
      .click();
    const compact = page.locator('.tp-chat-sidenav__collapsed-content');
    await expect(
      compact.getByRole('button', { name: 'Alpha notes', exact: true })
    ).toHaveCount(0);
    await expect(
      compact.getByRole('button', {
        name: 'Beta renamed while archiving',
        exact: true,
      })
    ).toBeVisible();
    await expect(
      compact.getByRole('button', { name: /^Actions for/ })
    ).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Expand conversations', exact: true })
      .click();
    await page.setViewportSize({ width: 390, height: 760 });
    await page
      .getByRole('button', { name: 'Open conversations', exact: true })
      .click();
    await openRowMenu(archivedAlpha);
    const unarchiveAlpha = page.getByRole('menuitem', {
      name: /^Unarchive conversation for Alpha/,
    });
    await expect(unarchiveAlpha).toBeVisible();
    const box = await page.getByRole('menu').boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= 390);
    await page.screenshot({
      path: testInfo.outputPath('unarchive-mobile-390.png'),
      fullPage: false,
    });
    await expect(unarchiveAlpha).toBeVisible();
    await unarchiveAlpha.click();
    await expect(alphaRow).toHaveAttribute('aria-current', 'true');
    const gammaActions = archived.getByRole('button', {
      name: 'Actions for Gamma archived (c)',
      exact: true,
    });
    await openActions(gammaActions);
    await page
      .getByRole('menuitem', { name: /^Unarchive conversation for Gamma/ })
      .click();
    await expect(
      list.getByRole('button', { name: 'Gamma archived', exact: true })
    ).toBeVisible();
    expect(
      await list
        .locator('.tp-thread-list__button')
        .evaluateAll((buttons) =>
          buttons.map((button) => button.getAttribute('title'))
        )
    ).toEqual([
      'Beta renamed while archiving',
      'Alpha notes',
      'Gamma archived',
    ]);
    await page
      .getByRole('button', { name: 'Close conversations', exact: true })
      .click();
    await expect(draft).toHaveValue(heldDraft);
    await expect(stop).toBeEnabled();
    await expect(page).toHaveURL(/thread=a/);
    expect(await draftNode.evaluate((node) => node.isConnected)).toBe(true);
    expect(await responseNode.evaluate((node) => node.isConnected)).toBe(true);
    expect(backend.requests).toHaveLength(12);
    await stop.click();
    expect(await backend.steps[3].closed).toEqual({ finished: false });
    backend.verify();
    expect(errors).toEqual([]);
  } finally {
    await server?.close();
    await backend.close();
  }
});
