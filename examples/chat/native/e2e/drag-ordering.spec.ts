import { test } from './fixtures';
import { expect, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';

// Genuine Chromium HTML drag sessions: no synthetic DragEvent/DataTransfer.
async function hoverDrag(
  page: Page,
  source: Locator,
  target: Locator,
  side: 'before' | 'after'
) {
  await source.scrollIntoViewIfNeeded();
  const start = await source.boundingBox();
  assert.ok(start);
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    start.x + start.width / 2 + 8,
    start.y + start.height / 2,
    { steps: 4 }
  );
  await target.scrollIntoViewIfNeeded();
  const end = await target.boundingBox();
  assert.ok(end);
  const x = end.x + end.width / 2;
  const y = end.y + end.height * (side === 'before' ? 0.2 : 0.8);
  // Chromium needs a second move over the destination to deliver dragover.
  await page.mouse.move(x, y, { steps: 8 });
  await page.mouse.move(x, y);
  await expect(source).toHaveAttribute('data-dragging', 'true');
  await expect(target).toHaveAttribute('data-drop-position', side);
}

async function finishDrag(
  page: Page,
  target: Locator,
  side: 'before' | 'after'
) {
  // Re-read the live target rectangle after any runtime render during the drag.
  const box = await target.boundingBox();
  assert.ok(box);
  await page.mouse.move(
    box.x + box.width / 2,
    box.y + box.height * (side === 'before' ? 0.2 : 0.8)
  );
  await page.mouse.up();
}

test('installed React pinned drag ordering retains a held response and recovers partial writes with keyboard actions', async ({
  page,
  retainedConsumer,
}, testInfo) => {
  test.setTimeout(300_000);
  const { startProofServer, threadEnvelope } = await import(
    '../tooling/proof-server.mjs'
  );
  const { startCheckedServer } = await import('../tooling/retained-build.mjs');
  const selected = threadEnvelope('a', 'Selected visible');
  const pin = (id: string, title: string, pinnedOrder: number) => ({
    ...threadEnvelope(id, title),
    metadata: { title, pinned: true, pinnedOrder },
  });
  const b = pin('b', 'Alpha visible', 0);
  const h = pin('h', 'Hidden neighbor', 1);
  const c = pin('c', 'Beta visible', 2);
  const d = pin('d', 'Gamma visible', 3);
  const archived = {
    ...pin('z', 'Archived pinned', -1),
    metadata: {
      title: 'Archived pinned',
      pinned: true,
      pinnedOrder: -1,
      archived: true,
    },
  };
  const ranked = (row: typeof b, pinnedOrder: number) => ({
    ...row,
    metadata: { ...row.metadata, pinnedOrder },
  });
  const patch = (row: typeof b, pinnedOrder: number) => ({
    method: 'PATCH',
    path: `/api/threads/${row.thread_id}`,
    payload: { metadata: { pinnedOrder } },
    body: ranked(row, pinnedOrder),
  });
  const backend = await startProofServer([
    {
      method: 'POST',
      path: '/api/threads/search',
      payload: { limit: 50, offset: 0 },
      body: [selected, b, h, c, d, archived],
    },
    { method: 'GET', path: '/api/threads/a', body: selected },
    {
      method: 'POST',
      path: '/api/threads/a/history',
      payload: { limit: 10 },
      body: [],
    },
    {
      method: 'POST',
      path: '/api/threads/a/runs/stream',
      holdHeaders: true,
      holdBody: true,
      events: [
        {
          event: 'values',
          data: {
            messages: [
              {
                type: 'ai',
                id: 'drag-response',
                content: 'Response survives a real drag.',
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
        assert.equal(body.on_disconnect, 'continue');
        assert.equal(body.input.messages.length, 1);
        assert.equal(body.input.messages[0].type, 'human');
        assert.equal(
          body.input.messages[0].content,
          'Retain this draft while I drag.'
        );
      },
    },
    patch(h, 0),
    patch(c, 1),
    { ...patch(b, 2), holdBody: true },
    patch(b, 0),
    { ...patch(h, 1), status: 500 },
    patch(c, 2),
    {
      method: 'POST',
      path: '/api/threads/search',
      payload: { limit: 50, offset: 0 },
      body: [selected, ranked(b, 0), ranked(h, 0), ranked(c, 2), d, archived],
    },
    patch(b, 1),
    patch(b, 0),
    patch(h, 1),
  ]);
  let server: Awaited<ReturnType<typeof startCheckedServer>> | undefined;
  const errors: string[] = [];
  const browserApiPaths: string[] = [];
  let streamFinished = false;
  void backend.steps[3].closed.then(({ finished }) => {
    streamFinished = finished;
  });
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    server = await startCheckedServer({
      retained: retainedConsumer,
      target: backend.origin + '/api',
    });
    const origin = server.url;
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) {
        errors.push('Unexpected external request: ' + url);
        return route.abort();
      }
      if (url.pathname.startsWith('/api/')) browserApiPaths.push(url.pathname);
      return route.continue();
    });
    await page.setViewportSize({ width: 1280, height: 760 });
    await page.goto(origin + '/?presentation=sidenav&thread=a');
    const list = page.getByRole('list', {
      name: 'Loaded conversations',
      exact: true,
    });
    const row = (name: string) =>
      list.getByRole('button', { name, exact: true });
    const handle = (title: string, id: string) =>
      page.getByRole('button', {
        name: `Drag to reorder conversation for ${title} (${id})`,
        exact: true,
      });
    const alpha = handle('Alpha visible', 'b');
    const hidden = handle('Hidden neighbor', 'h');
    const beta = handle('Beta visible', 'c');
    const order = () =>
      list
        .locator('.tp-thread-list__button')
        .evaluateAll((buttons) =>
          buttons.map((button) => button.getAttribute('title'))
        );
    const initial = [
      'Alpha visible',
      'Hidden neighbor',
      'Beta visible',
      'Gamma visible',
      'Selected visible',
    ];
    const confirmed = [
      'Hidden neighbor',
      'Beta visible',
      'Alpha visible',
      'Gamma visible',
      'Selected visible',
    ];
    await expect.poll(order).toEqual(initial);
    await expect(page.locator('.native-pinned-drag')).toHaveCount(4);
    await expect(handle('Selected visible', 'a')).toHaveCount(0);
    await page.getByText('Archived conversations', { exact: true }).click();
    await expect(
      page
        .getByRole('list', {
          name: 'Archived loaded conversations',
          exact: true,
        })
        .getByRole('button', { name: 'Archived pinned', exact: true })
    ).toBeVisible();
    await expect(handle('Archived pinned', 'z')).toHaveCount(0);
    const draft = page.getByRole('textbox', { name: 'Message', exact: true });
    const transcript = page.getByRole('region', {
      name: 'Conversation messages',
      exact: true,
    });
    const draftNode = await draft.elementHandle();
    const transcriptNode = await transcript.elementHandle();
    const selectedNode = await row('Selected visible').elementHandle();
    const alphaNode = await row('Alpha visible').elementHandle();
    assert.ok(draftNode && transcriptNode && selectedNode && alphaNode);
    const url = page.url();
    await draft.fill('Retain this draft while I drag.');
    await hoverDrag(page, alpha, beta, 'after');
    expect(backend.requests).toHaveLength(3);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(alpha).not.toHaveAttribute('data-dragging');
    await expect(beta).not.toHaveAttribute('data-drop-position');
    // A real semantic no-op (already immediately before h) also issues no HTTP.
    await hoverDrag(page, alpha, hidden, 'before');
    await finishDrag(page, hidden, 'before');
    await expect(alpha).not.toHaveAttribute('data-dragging');
    expect(backend.requests).toHaveLength(3);
    await expect(draft).toHaveValue('Retain this draft while I drag.');
    expect(page.url()).toBe(url);
    expect(await order()).toEqual(initial);
    await draft.press('Control+Enter');
    await backend.steps[3].received;
    await expect(draft).toBeDisabled();
    const heldDraft = await draft.inputValue();
    const filter = page.getByRole('searchbox', {
      name: 'Filter loaded conversations by title',
    });
    await filter.fill('visible');
    await expect(hidden).toHaveCount(0);
    await hoverDrag(page, alpha, beta, 'after');
    expect(backend.requests).toHaveLength(4);
    backend.steps[3].releaseHeaders();
    const response = page.getByText('Response survives a real drag.', {
      exact: true,
    });
    await expect(response).toBeVisible();
    await expect(alpha).toHaveAttribute('data-dragging', 'true');
    await expect(beta).toHaveAttribute('data-drop-position', 'after');
    const responseNode = await response.elementHandle();
    assert.ok(responseNode);
    const heldTranscript = await transcript.innerHTML();
    await finishDrag(page, beta, 'after');
    await backend.steps[6].received;
    expect(backend.requests).toHaveLength(7);
    expect(await order()).toEqual(
      initial.filter((title) => title !== 'Hidden neighbor')
    );
    for (const item of await page.locator('.native-pinned-drag').all())
      await expect(item).toBeDisabled();
    await filter.fill('');
    await filter.focus();
    backend.steps[6].releaseBody();
    await expect.poll(order).toEqual(confirmed);
    await expect(filter).toBeFocused();
    await expect(alpha).toBeEnabled();
    const retained = async () => {
      expect(page.url()).toBe(url);
      expect(await selectedNode.getAttribute('aria-current')).toBe('true');
      await expect(draft).toHaveValue(heldDraft);
      for (const node of [
        draftNode,
        transcriptNode,
        selectedNode,
        alphaNode,
        responseNode,
      ])
        expect(await node.evaluate((element) => element.isConnected)).toBe(
          true
        );
      expect(await transcript.innerHTML()).toBe(heldTranscript);
      await expect(
        page.getByText('Response in progress…', { exact: true })
      ).toBeVisible();
      expect(streamFinished).toBe(false);
    };
    await retained();
    await page.screenshot({
      path: testInfo.outputPath('drag-ordering-desktop.png'),
    });
    // A successful write precedes the failure; the third serial write still runs.
    await hoverDrag(page, alpha, hidden, 'before');
    await finishDrag(page, hidden, 'before');
    const uncertain = page.getByRole('status').filter({
      hasText: /order.*unconfirmed|refresh.*order|refresh.*reorder/i,
    });
    await expect(uncertain).toBeVisible();
    expect(backend.requests).toHaveLength(10);
    expect(await order()).toEqual(confirmed);
    for (const item of await page.locator('.native-pinned-drag').all())
      await expect(item).toBeDisabled();
    await retained();
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(uncertain).toHaveCount(0);
    await expect.poll(order).toEqual(initial);
    await expect(alpha).toBeEnabled();
    // Keyboard fallback remains available after explicit recovery.
    await row('Alpha visible').focus();
    await row('Alpha visible').press('Shift+F10');
    const down = page.getByRole('menuitem', { name: /^Move down.*Alpha/ });
    await expect(down).toBeEnabled();
    await down.focus();
    await page.keyboard.press('Enter');
    await expect
      .poll(order)
      .toEqual([
        'Hidden neighbor',
        'Alpha visible',
        'Beta visible',
        'Gamma visible',
        'Selected visible',
      ]);
    await retained();
    await page
      .getByRole('button', { name: 'Collapse conversations', exact: true })
      .click();
    await expect(
      page.locator('.tp-chat-sidenav__collapsed-content .native-pinned-drag')
    ).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Expand conversations', exact: true })
      .click();
    await page.evaluate(() => {
      document.documentElement.dir = 'rtl';
    });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      const open = page.getByRole('button', {
        name: 'Open conversations',
        exact: true,
      });
      await expect(open).toBeVisible();
      await open.click();
      await expect(alpha).toBeVisible();
      await expect(alpha).toBeEnabled();
      await row('Alpha visible').scrollIntoViewIfNeeded();
      await row('Alpha visible').focus();
      await row('Alpha visible').press('Shift+F10');
      const up = page.getByRole('menuitem', { name: /^Move up.*Alpha/ });
      await expect(up).toBeEnabled();
      const box = await page.getByRole('menu').boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`drag-ordering-rtl-${width}.png`),
      });
      if (width === 320) {
        await up.focus();
        await page.keyboard.press('Enter');
        await expect.poll(order).toEqual(initial);
      } else await page.keyboard.press('Escape');
      await page
        .getByRole('button', { name: 'Close conversations', exact: true })
        .click();
    }
    await retained();
    expect(backend.requests).toHaveLength(14);
    backend.steps[3].releaseBody();
    expect(await backend.steps[3].closed).toEqual({ finished: true });
    await expect(
      page.getByText('Response complete.', { exact: true })
    ).toBeVisible();
    await expect(draft).toBeEnabled();
    backend.verify();
    expect(browserApiPaths).toEqual(
      backend.requests.map((request) => request.path)
    );
    for (const step of backend.steps)
      expect((await step.closed).finished).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await server?.close();
    await backend.close();
  }
});
