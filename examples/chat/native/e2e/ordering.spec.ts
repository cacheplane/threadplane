import { test } from './fixtures';
import { expect, type Locator } from '@playwright/test';
import assert from 'node:assert/strict';

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

test('installed React pinned conversation grouping and ordering preserve a running selection and recover partial writes explicitly', async ({
  page,
  retainedConsumer,
}, testInfo) => {
  test.setTimeout(300_000);
  const { startProofServer, threadEnvelope } = await import(
    '../tooling/proof-server.mjs'
  );
  const { startCheckedServer } =
    await import('../tooling/retained-build.mjs');
  const alpha = threadEnvelope('a', 'Selected conversation');
  const one = {
    ...threadEnvelope('p1', 'Alpha pinned'),
    metadata: { title: 'Alpha pinned', pinned: true, pinnedOrder: 10 },
  };
  const two = {
    ...threadEnvelope('p2', 'Beta pinned'),
    metadata: { title: 'Beta pinned', pinned: true, pinnedOrder: 20 },
  };
  const three = {
    ...threadEnvelope('p3', 'Gamma pinned'),
    metadata: { title: 'Gamma pinned', pinned: true },
  };
  const archived = {
    ...threadEnvelope('z', 'Archived pinned'),
    metadata: {
      title: 'Archived pinned',
      pinned: true,
      pinnedOrder: -1,
      archived: true,
    },
  };
  const rank = (
    row: typeof one | typeof three,
    value: number,
    extras = {}
  ) => ({
    ...row,
    metadata: { ...row.metadata, ...extras, pinnedOrder: value },
  });
  const backend = await startProofServer([
    {
      method: 'POST',
      path: '/api/threads/search',
      payload: { limit: 50, offset: 0 },
      body: [alpha, two, one, three, archived],
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
                content: 'Ordering response remains active.',
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
          'Keep responding while I reorder.'
        );
        assert.equal(body.on_disconnect, 'continue');
      },
    },
    {
      method: 'PATCH',
      path: '/api/threads/p2',
      payload: { metadata: { pinnedOrder: 0 } },
      body: rank(two, 0),
    },
    {
      method: 'PATCH',
      path: '/api/threads/p1',
      payload: { metadata: { pinnedOrder: 1 } },
      body: rank(one, 1),
    },
    {
      method: 'PATCH',
      path: '/api/threads/p3',
      payload: { metadata: { pinnedOrder: 2 } },
      body: rank(three, 2),
      holdBody: true,
    },
    {
      method: 'PATCH',
      path: '/api/threads/p2',
      payload: { metadata: { title: 'Beta renamed' } },
      body: { ...two, metadata: { ...two.metadata, title: 'Beta renamed' } },
    },
    {
      method: 'PATCH',
      path: '/api/threads/p3',
      payload: { metadata: { pinned: false } },
      body: { ...three, metadata: { ...three.metadata, pinned: false } },
    },
    {
      method: 'PATCH',
      path: '/api/threads/p1',
      payload: { metadata: { pinnedOrder: 0 } },
      body: rank(one, 0),
    },
    {
      method: 'PATCH',
      path: '/api/threads/p2',
      payload: { metadata: { pinnedOrder: 1 } },
      status: 500,
    },
    {
      method: 'POST',
      path: '/api/threads/search',
      payload: { limit: 50, offset: 0 },
      body: [
        alpha,
        rank(two, 0, { title: 'Beta renamed' }),
        rank(one, 0),
        rank(three, 2, { pinned: false }),
        archived,
      ],
    },
    {
      method: 'PATCH',
      path: '/api/threads/p2',
      payload: { metadata: { pinnedOrder: 1 } },
      body: rank(two, 1),
    },
    {
      method: 'PATCH',
      path: '/api/threads/p2',
      payload: { metadata: { pinnedOrder: 0 } },
      body: rank(two, 0),
    },
    {
      method: 'PATCH',
      path: '/api/threads/p1',
      payload: { metadata: { pinnedOrder: 1 } },
      body: rank(one, 1),
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
    const titles = () => list.locator('.tp-thread-list__button');
    const titleOrder = async () =>
      titles().evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute('title'))
      );
    const row = (name: string) =>
      list.getByRole('button', { name, exact: true });
    await expect(row('Selected conversation')).toHaveAttribute(
      'aria-current',
      'true'
    );
    expect(await titleOrder()).toEqual([
      'Alpha pinned',
      'Beta pinned',
      'Gamma pinned',
      'Selected conversation',
    ]);
    const draft = page.getByRole('textbox', { name: 'Message', exact: true });
    const draftNode = await draft.elementHandle();
    assert.ok(draftNode);
    await draft.fill('Retain the ordering draft.');
    await context(row('Beta pinned'));
    const moveUp = () => page.getByRole('menuitem', { name: /^Move up.*Beta/ });
    await expect(moveUp()).toBeEnabled();
    expect(backend.requests).toHaveLength(3);
    await page.keyboard.press('Escape');
    await expect(row('Beta pinned')).toBeFocused();
    await expect(draft).toHaveValue('Retain the ordering draft.');
    await draft.fill('Keep responding while I reorder.');
    await draft.press('Control+Enter');
    await backend.steps[3].received;
    const response = page.getByText('Ordering response remains active.', {
      exact: true,
    });
    await expect(response).toBeVisible();
    const responseNode = await response.elementHandle();
    assert.ok(responseNode);
    const heldDraft = await draft.inputValue();
    const filter = page.getByRole('searchbox', {
      name: 'Filter loaded conversations by title',
    });
    await filter.fill('Beta');
    await context(row('Beta pinned'));
    await moveUp().click();
    await backend.steps[6].received;
    await context(row('Beta pinned'));
    await expect(moveUp()).toBeDisabled();
    await expect(
      page.getByRole('menuitem', { name: /^Copy conversation ID for Beta/ })
    ).toBeEnabled();
    await page
      .getByRole('menuitem', { name: /^Rename conversation for Beta/ })
      .click();
    const editor = page.getByRole('textbox', {
      name: 'Conversation title',
      exact: true,
    });
    await editor.fill('Beta renamed');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editor).toHaveCount(0);
    await filter.fill('');
    const selectedNode = await row('Selected conversation').elementHandle();
    const movedNode = await row('Beta renamed').elementHandle();
    assert.ok(selectedNode && movedNode);
    await context(row('Gamma pinned'));
    await page
      .getByRole('menuitem', { name: /^Unpin conversation for Gamma/ })
      .click();
    await expect(row('Gamma pinned')).not.toHaveAccessibleDescription(
      /Pinned conversation/
    );
    await filter.focus();
    backend.steps[6].releaseBody();
    await expect
      .poll(titleOrder)
      .toEqual([
        'Beta renamed',
        'Alpha pinned',
        'Selected conversation',
        'Gamma pinned',
      ]);
    await expect(filter).toBeFocused();
    // The selected row and composer remain the same elements across grouping.
    expect(await selectedNode.evaluate((node) => node.isConnected)).toBe(true);
    expect(await draftNode.evaluate((node) => node.isConnected)).toBe(true);
    expect(await movedNode.evaluate((node) => node.isConnected)).toBe(true);
    await page
      .getByRole('button', { name: 'Collapse conversations', exact: true })
      .click();
    const compact = page.locator('.tp-chat-sidenav__collapsed-content');
    expect(
      await compact
        .locator('.tp-thread-list__button')
        .evaluateAll((buttons) =>
          buttons.map((button) => button.getAttribute('title'))
        )
    ).toEqual([
      'Beta renamed',
      'Alpha pinned',
      'Selected conversation',
      'Gamma pinned',
    ]);
    await expect(
      compact.getByRole('button', { name: /^Actions for/ })
    ).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Expand conversations', exact: true })
      .click();
    await context(row('Alpha pinned'));
    await page.getByRole('menuitem', { name: /^Move up.*Alpha/ }).click();
    const uncertain = page.getByRole('status').filter({
      hasText: /order.*unconfirmed|refresh.*order|refresh.*reorder/i,
    });
    await expect(uncertain).toBeVisible();
    expect(await titleOrder()).toEqual([
      'Beta renamed',
      'Alpha pinned',
      'Selected conversation',
      'Gamma pinned',
    ]);
    expect(backend.requests).toHaveLength(11);
    await context(row('Alpha pinned'));
    await expect(
      page.getByRole('menuitem', { name: /^Move up.*Alpha/ })
    ).toBeDisabled();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(uncertain).toHaveCount(0);
    await context(row('Alpha pinned'));
    const retry = page.getByRole('menuitem', { name: /^Move up.*Alpha/ });
    await expect(retry).toBeEnabled();
    await retry.focus();
    await page.keyboard.press('Enter');
    await expect
      .poll(titleOrder)
      .toEqual([
        'Alpha pinned',
        'Beta renamed',
        'Selected conversation',
        'Gamma pinned',
      ]);
    await page.screenshot({
      path: testInfo.outputPath('ordering-desktop.png'),
      fullPage: false,
    });
    await page.setViewportSize({ width: 390, height: 760 });
    await page
      .getByRole('button', { name: 'Open conversations', exact: true })
      .click();
    await settle(row('Alpha pinned'));
    await row('Alpha pinned').focus();
    await row('Alpha pinned').press('Shift+F10');
    const down = page.getByRole('menuitem', { name: /^Move down.*Alpha/ });
    await expect(down).toBeEnabled();
    const box = await page.getByRole('menu').boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= 390);
    await page.screenshot({
      path: testInfo.outputPath('ordering-mobile-390.png'),
      fullPage: false,
    });
    await down.click();
    await expect
      .poll(titleOrder)
      .toEqual([
        'Beta renamed',
        'Alpha pinned',
        'Selected conversation',
        'Gamma pinned',
      ]);
    await page
      .getByRole('button', { name: 'Close conversations', exact: true })
      .click();
    await expect(draft).toHaveValue(heldDraft);
    expect(await responseNode.evaluate((node) => node.isConnected)).toBe(true);
    await expect(page).toHaveURL(/thread=a/);
    const stop = page.getByRole('button', { name: 'Stop', exact: true });
    await expect(stop).toBeEnabled();
    expect(backend.requests).toHaveLength(15);
    await stop.click();
    expect(await backend.steps[3].closed).toEqual({ finished: false });
    backend.verify();
    expect(errors).toEqual([]);
  } finally {
    await server?.close();
    await backend.close();
  }
});
