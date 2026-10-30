import { test } from './fixtures';
import { expect } from '@playwright/test';
import assert from 'node:assert/strict';

test('installed React conversation rename preserves draft, selection and a running response', async ({
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
                content: 'Rename response remains active.',
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
          'Keep responding while I rename.'
        );
        assert.equal(body.on_disconnect, 'continue');
      },
    },
    {
      method: 'PATCH',
      path: '/api/threads/b',
      payload: { metadata: { title: 'Beta renamed' } },
      status: 500,
    },
    {
      method: 'PATCH',
      path: '/api/threads/b',
      payload: { metadata: { title: 'Beta renamed' } },
      body: { ...beta, metadata: { title: 'Beta renamed' } },
      holdBody: true,
    },
    {
      method: 'PATCH',
      path: '/api/threads/a',
      payload: { metadata: { title: 'Alpha renamed' } },
      body: { ...alpha, metadata: { title: 'Alpha renamed' } },
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
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(origin + '/?presentation=sidenav&thread=a');
    const list = page.getByRole('list', {
      name: 'Loaded conversations',
      exact: true,
    });
    const alphaRow = list.getByRole('button', {
      name: 'Alpha notes',
      exact: true,
    });
    const betaRow = list.getByRole('button', {
      name: 'Beta notes',
      exact: true,
    });
    await expect(alphaRow).toHaveAttribute('aria-current', 'true');
    const draft = page.getByRole('textbox', { name: 'Message', exact: true });
    const draftNode = await draft.elementHandle();
    const alphaNode = await alphaRow.elementHandle();
    const betaNode = await betaRow.elementHandle();
    assert.ok(draftNode && alphaNode && betaNode);
    await draft.fill('Retain this exact rename draft.');
    const stop = page.getByRole('button', { name: 'Stop', exact: true });

    const editor = page.getByRole('textbox', {
      name: 'Conversation title',
      exact: true,
    });
    const renameItem = page.getByRole('menuitem', {
      name: /^Rename conversation for/,
    });
    await betaRow.click({ button: 'right' });
    await renameItem.click();
    await expect(editor).toBeFocused();
    await expect(editor).toHaveValue('Beta notes');
    await editor.fill('Discard this change');
    await editor.press('Escape');
    await expect(editor).toHaveCount(0);
    expect(backend.requests).toHaveLength(3);
    await expect(draft).toHaveValue('Retain this exact rename draft.');
    await draft.fill('Keep responding while I rename.');
    await draft.press('Control+Enter');
    await backend.steps[3].received;
    await expect(
      page.getByText('Rename response remains active.', { exact: true })
    ).toBeVisible();
    await expect(stop).toBeEnabled();
    const heldDraft = await draft.inputValue();
    await betaRow.focus();
    await betaRow.press('Shift+F10');
    await renameItem.click();
    await editor.fill('   ');
    await expect(
      page.getByRole('button', { name: 'Save', exact: true })
    ).toBeDisabled();
    await editor.fill('  Beta renamed  ');
    await editor.press('Enter');
    await expect(page.getByRole('alert')).toContainText(
      'Could not rename conversation'
    );
    await expect(editor).toHaveValue('  Beta renamed  ');
    expect(backend.requests).toHaveLength(5);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await backend.steps[5].received;
    await expect(editor).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Save', exact: true })
    ).toBeDisabled();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(editor).toHaveCount(0);
    await betaRow.click({ button: 'right' });
    await renameItem.click();
    await expect(
      page.getByRole('button', { name: 'Save', exact: true })
    ).toBeDisabled();
    expect(backend.requests).toHaveLength(6);
    await expect(
      page.getByRole('button', { name: 'Cancel', exact: true })
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(editor).toHaveCount(0);
    const filter = page.getByRole('searchbox', {
      name: 'Filter loaded conversations by title',
    });
    await filter.focus();
    backend.steps[5].releaseBody();
    await expect(
      list.getByRole('button', { name: 'Beta renamed', exact: true })
    ).toBeVisible();
    await expect(filter).toBeFocused();
    await expect(editor).toHaveCount(0);
    await expect(alphaRow).toHaveAttribute('aria-current', 'true');
    await expect(page).toHaveURL(/thread=a/);

    await list
      .getByRole('button', { name: 'Actions for Alpha notes (a)', exact: true })
      .click();
    await renameItem.click();
    await editor.fill('Alpha renamed');
    await page.screenshot({
      path: testInfo.outputPath('rename-desktop.png'),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(
      list.getByRole('button', { name: 'Alpha renamed', exact: true })
    ).toHaveAttribute('aria-current', 'true');
    await expect(
      page.getByRole('heading', { name: 'Alpha renamed', exact: true })
    ).toBeVisible();
    await expect(draft).toHaveValue(heldDraft);
    await expect(stop).toBeEnabled();
    expect(await draftNode.evaluate((node) => node.isConnected)).toBe(true);
    expect(await alphaNode.evaluate((node) => node.isConnected)).toBe(true);
    expect(await betaNode.evaluate((node) => node.isConnected)).toBe(true);
    expect(backend.requests).toHaveLength(7);

    await page.setViewportSize({ width: 390, height: 760 });
    await page
      .getByRole('button', { name: 'Open conversations', exact: true })
      .click();
    await list
      .getByRole('button', { name: 'Beta renamed', exact: true })
      .click({ button: 'right' });
    await renameItem.click();
    await expect(editor).toBeFocused();
    const box = await editor.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= 390);
    await page.screenshot({
      path: testInfo.outputPath('rename-mobile-390.png'),
      fullPage: true,
    });
    await editor.press('Escape');
    await expect(
      page.getByRole('navigation', { name: 'Conversations', exact: true })
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Close conversations', exact: true })
      .click();
    await stop.click();
    expect(await backend.steps[3].closed).toEqual({ finished: false });
    backend.verify();
    expect(errors).toEqual([]);
  } finally {
    await server?.close();
    await backend.close();
  }
});
