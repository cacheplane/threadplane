import { test } from './fixtures';
import { expect } from '@playwright/test';
import assert from 'node:assert/strict';

test('installed React conversation pin and unpin preserve metadata, draft, selection and a running response', async ({
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
  const backend = await startProofServer([
    {
      method: 'POST',
      path: '/api/threads/search',
      payload: { limit: 50, offset: 0 },
      body: [alpha, beta],
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
                content: 'Pin response remains active.',
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
          'Keep responding while I pin.'
        );
        assert.equal(body.on_disconnect, 'continue');
      },
    },
    {
      method: 'PATCH',
      path: '/api/threads/b',
      payload: { metadata: { pinned: true } },
      status: 500,
    },
    {
      method: 'PATCH',
      path: '/api/threads/b',
      payload: { metadata: { pinned: true } },
      body: { ...beta, metadata: { title: 'Beta notes', pinned: true } },
      holdBody: true,
    },
    {
      method: 'PATCH',
      path: '/api/threads/b',
      payload: { metadata: { title: 'Beta renamed while pinning' } },
      body: {
        ...beta,
        metadata: { title: 'Beta renamed while pinning', pinned: false },
      },
    },
    {
      method: 'PATCH',
      path: '/api/threads/b',
      payload: { metadata: { pinned: false } },
      body: {
        ...beta,
        metadata: { title: 'Beta renamed while pinning', pinned: false },
      },
    },
    {
      method: 'PATCH',
      path: '/api/threads/a',
      payload: { metadata: { pinned: true } },
      body: { ...alpha, metadata: { title: 'Alpha notes', pinned: true } },
    },
    {
      method: 'PATCH',
      path: '/api/threads/a',
      payload: { metadata: { pinned: false } },
      body: { ...alpha, metadata: { title: 'Alpha notes', pinned: false } },
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
    await page.setViewportSize({ width: 1280, height: 650 });
    await page.goto(origin + '/?presentation=sidenav&thread=a');
    const list = page.getByRole('list', {
      name: 'Loaded conversations',
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
    const alphaNode = await alphaRow.elementHandle();
    const betaNode = await betaRow.elementHandle();
    assert.ok(draftNode && alphaNode && betaNode);
    await draft.fill('Retain this pin draft.');
    // The shorter rail requires pre-click scrolling. Browsers may deliver its
    // already-settled scroll notification after the context menu opens.
    await page.evaluate(() => {
      const proof = { delivered: false, before: 0, after: 0 };
      Object.assign(window, { contextScrollProof: proof });
      document.addEventListener(
        'contextmenu',
        () => {
          const host = document.querySelector(
            '.tp-chat-sidenav__body'
          ) as HTMLElement;
          proof.before = host.scrollTop;
          setTimeout(() => {
            proof.after = host.scrollTop;
            host.dispatchEvent(new Event('scroll'));
            requestAnimationFrame(() => {
              proof.delivered = true;
            });
          }, 0);
        },
        { once: true }
      );
    });
    await betaRow.click({ button: 'right' });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                contextScrollProof: { delivered: boolean };
              }
            ).contextScrollProof.delivered
        )
      )
      .toBe(true);
    const openingScroll = await page.evaluate(
      () =>
        (
          window as unknown as {
            contextScrollProof: { before: number; after: number };
          }
        ).contextScrollProof
    );
    expect(openingScroll.before).toBeGreaterThan(0);
    expect(openingScroll.after).toBe(openingScroll.before);

    const pinBeta = page.getByRole('menuitem', {
      name: /^Pin conversation for Beta/,
    });
    await expect(pinBeta).toBeVisible();
    await expect(
      page.getByRole('menuitem', { name: /^Unpin conversation for Beta/ })
    ).toHaveCount(0);
    expect(backend.requests).toHaveLength(3);
    await page.evaluate(() => {
      const host = document.querySelector(
        '.tp-chat-sidenav__body'
      ) as HTMLElement;
      host.scrollTop = 0;
      host.dispatchEvent(new Event('scroll'));
    });
    await expect(pinBeta).toHaveCount(0);
    await betaRow.click({ button: 'right' });
    await expect(pinBeta).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(betaRow).toBeFocused();
    await expect(draft).toHaveValue('Retain this pin draft.');
    await expect(alphaRow).toHaveAttribute('aria-current', 'true');
    await draft.fill('Keep responding while I pin.');
    await draft.press('Control+Enter');
    await backend.steps[3].received;
    await expect(
      page.getByText('Pin response remains active.', { exact: true })
    ).toBeVisible();
    const heldDraft = await draft.inputValue();
    const stop = page.getByRole('button', { name: 'Stop', exact: true });
    await expect(stop).toBeEnabled();
    await betaRow.focus();
    await betaRow.press('Shift+F10');
    await pinBeta.click();
    await expect(
      page.getByText('Could not pin conversation. Try again.', { exact: true })
    ).toBeVisible();
    await expect(betaRow.locator('.tp-thread-list__pin')).toHaveCount(0);
    expect(backend.requests).toHaveLength(5);
    await list
      .getByRole('button', { name: 'Actions for Beta notes (b)', exact: true })
      .click();
    await pinBeta.click();
    await backend.steps[5].received;
    await expect(
      page.getByRole('status').filter({ hasText: 'Pinning conversation…' })
    ).toBeVisible();
    await betaRow.click({ button: 'right' });
    await expect(pinBeta).toBeDisabled();
    await expect(
      page.getByRole('menuitem', { name: /^Copy conversation ID for Beta/ })
    ).toBeEnabled();
    await expect(
      page.getByRole('menuitem', { name: /^Rename conversation for Beta/ })
    ).toBeEnabled();
    expect(backend.requests).toHaveLength(6);
    await page
      .getByRole('menuitem', { name: /^Rename conversation for Beta/ })
      .click();
    const editor = page.getByRole('textbox', {
      name: 'Conversation title',
      exact: true,
    });
    await editor.fill('Beta renamed while pinning');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editor).toHaveCount(0);
    betaRow = list.getByRole('button', {
      name: 'Beta renamed while pinning',
      exact: true,
    });
    await expect(betaRow).toBeVisible();
    const filter = page.getByRole('searchbox', {
      name: 'Filter loaded conversations by title',
    });
    await filter.focus();
    backend.steps[5].releaseBody();
    await expect(betaRow.locator('.tp-thread-list__pin')).toHaveCount(1);
    await expect(betaRow).toHaveAccessibleDescription(/Pinned conversation/);
    await expect(filter).toBeFocused();
    await expect(
      page.getByRole('heading', { name: 'Alpha notes', exact: true })
    ).toBeVisible();
    await betaRow.click({ button: 'right' });
    await expect(
      page.getByRole('menuitem', { name: /^Pin conversation for Beta/ })
    ).toHaveCount(0);
    await page
      .getByRole('menuitem', { name: /^Unpin conversation for Beta/ })
      .click();
    await expect(betaRow.locator('.tp-thread-list__pin')).toHaveCount(0);
    await expect(betaRow).not.toHaveAccessibleDescription(
      /Pinned conversation/
    );
    await expect(betaRow).toHaveAccessibleName('Beta renamed while pinning');
    await list
      .getByRole('button', { name: 'Actions for Alpha notes (a)', exact: true })
      .click();
    const pinAlpha = page.getByRole('menuitem', {
      name: /^Pin conversation for Alpha/,
    });
    await pinAlpha.focus();
    await page.keyboard.press('Enter');
    await expect(alphaRow.locator('.tp-thread-list__pin')).toHaveCount(1);
    await expect(alphaRow).toHaveAttribute('aria-current', 'true');
    await page.screenshot({
      path: testInfo.outputPath('pin-desktop.png'),
      fullPage: true,
    });
    await page
      .getByRole('button', { name: 'Collapse conversations', exact: true })
      .click();
    const compact = page.locator('.tp-chat-sidenav__collapsed-content');
    await expect(
      compact.getByRole('button', { name: 'Alpha notes', exact: true })
    ).toHaveAccessibleDescription(/Pinned conversation/);
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
    await alphaRow.click({ button: 'right' });
    const unpinAlpha = page.getByRole('menuitem', {
      name: /^Unpin conversation for Alpha/,
    });
    await expect(unpinAlpha).toBeVisible();
    const menuBox = await page.getByRole('menu').boundingBox();
    assert.ok(menuBox && menuBox.x >= 0 && menuBox.x + menuBox.width <= 390);
    await page.screenshot({
      path: testInfo.outputPath('unpin-mobile-390.png'),
      fullPage: false,
    });
    await expect(unpinAlpha).toBeVisible();
    await unpinAlpha.click();
    await expect(alphaRow.locator('.tp-thread-list__pin')).toHaveCount(0);
    expect(
      await list
        .locator('.tp-thread-list__button')
        .evaluateAll((buttons) =>
          buttons.map((button) => button.getAttribute('title'))
        )
    ).toEqual(['Alpha notes', 'Beta renamed while pinning']);
    await page
      .getByRole('button', { name: 'Close conversations', exact: true })
      .click();
    await expect(draft).toHaveValue(heldDraft);
    await expect(stop).toBeEnabled();
    await expect(page).toHaveURL(/thread=a/);
    expect(await draftNode.evaluate((node) => node.isConnected)).toBe(true);
    expect(await alphaNode.evaluate((node) => node.isConnected)).toBe(true);
    expect(await betaNode.evaluate((node) => node.isConnected)).toBe(true);
    expect(backend.requests).toHaveLength(10);
    await stop.click();
    expect(await backend.steps[3].closed).toEqual({ finished: false });
    backend.verify();
    expect(errors).toEqual([]);
  } finally {
    await server?.close();
    await backend.close();
  }
});
