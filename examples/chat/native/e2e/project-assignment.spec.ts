import { test } from './fixtures';
import { expect } from '@playwright/test';
import assert from 'node:assert/strict';

test('installed React project assignment confirms exact metadata while preserving a filtered running conversation', async ({
  page,
  retainedConsumer,
}, testInfo) => {
  test.setTimeout(300_000);
  const { startProofServer, threadEnvelope } = await import(
    '../tooling/proof-server.mjs'
  );
  const { startCheckedServer } =
    await import('../tooling/retained-build.mjs');
  const destination = '00000000-0000-4000-8000-000000000001';
  const name = '<Destination> ' + 'W'.repeat(160);
  const alpha = {
    ...threadEnvelope('a', '<Alpha notes>'),
    metadata: {
      title: '<Alpha notes>',
      projectId: ' p/b ',
      pinned: true,
      pinnedOrder: 0,
    },
  };
  const beta = {
    ...threadEnvelope('b', 'Beta notes'),
    metadata: { title: 'Beta notes', projectId: '__proto__' },
  };
  const archived = {
    ...threadEnvelope('c', 'Archived notes'),
    metadata: { title: 'Archived notes', projectId: ' p/b ', archived: true },
  };
  const unassigned = {
    ...alpha,
    metadata: {
      title: '<Alpha notes>',
      projectId: null,
      pinned: true,
      pinnedOrder: 0,
    },
  };
  const movedArchive = {
    ...archived,
    metadata: { ...archived.metadata, projectId: destination },
  };
  const backend = await startProofServer([
    {
      method: 'POST',
      path: '/api/threads/search',
      payload: { limit: 50, offset: 0 },
      body: [alpha, beta, archived],
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
                content: 'Assignment response remains active.',
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
          'Keep responding while I move.'
        );
        assert.equal(body.on_disconnect, 'continue');
      },
    },
    {
      method: 'PATCH',
      path: '/api/threads/a',
      payload: { metadata: { projectId: destination } },
      body: {
        ...alpha,
        metadata: { ...alpha.metadata, projectId: 'wrong destination' },
      },
    },
    {
      method: 'PATCH',
      path: '/api/threads/a',
      payload: { metadata: { projectId: destination } },
      holdBody: true,
      body: {
        ...alpha,
        metadata: {
          title: 'Stale unrelated title',
          archived: true,
          pinned: false,
          projectId: destination,
        },
      },
    },
    {
      method: 'PATCH',
      path: '/api/threads/a',
      payload: { metadata: { projectId: null } },
      body: { ...alpha, metadata: { title: '<Alpha notes>' } },
    },
    {
      method: 'PATCH',
      path: '/api/threads/a',
      payload: { metadata: { projectId: null } },
      body: unassigned,
    },
    {
      method: 'PATCH',
      path: '/api/threads/c',
      payload: { metadata: { projectId: destination } },
      body: movedArchive,
    },
    {
      method: 'POST',
      path: '/api/threads/search',
      payload: { limit: 50, offset: 0 },
      body: [unassigned, beta, movedArchive],
    },
    { method: 'GET', path: '/api/threads/a', body: unassigned },
    {
      method: 'POST',
      path: '/api/threads/a/history',
      payload: { limit: 10 },
      body: [],
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
      errors.push('Unexpected external request');
      return route.abort();
    });
    await page.addInitScript(() =>
      Object.defineProperty(crypto, 'randomUUID', {
        configurable: true,
        value: () => '00000000-0000-4000-8000-000000000001',
      })
    );
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(origin + '/?presentation=sidenav&thread=a');
    const nav = page.getByRole('navigation', {
      name: 'Conversations',
      exact: true,
    });
    const projects = nav.getByRole('list', { name: 'Projects', exact: true });
    const active = nav.getByRole('list', {
      name: 'Loaded conversations',
      exact: true,
    });
    const draft = page.getByRole('textbox', { name: 'Message', exact: true });
    await expect(
      page.getByRole('heading', { name: '<Alpha notes>', exact: true })
    ).toBeVisible();
    const draftNode = await draft.elementHandle();
    assert.ok(draftNode);
    await nav.getByRole('button', { name: 'New project', exact: true }).click();
    await nav
      .getByRole('textbox', { name: 'Project name', exact: true })
      .fill(name);
    await nav.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(
      projects.getByRole('button', { name, exact: true })
    ).toHaveAttribute('aria-current', 'true');
    await nav
      .getByRole('button', { name: 'All conversations', exact: true })
      .click();
    await projects.getByRole('button', { name: 'p/b', exact: true }).click();
    await draft.fill('Keep responding while I move.');
    await draft.press('Control+Enter');
    await backend.steps[3].received;
    await expect(
      page.getByText('Assignment response remains active.', { exact: true })
    ).toBeVisible();
    const heldDraft = await draft.inputValue();
    await expect(draft).toBeDisabled();
    const stop = page.getByRole('button', { name: 'Stop', exact: true });
    await expect(stop).toBeEnabled();
    const openMove = async (title: string, id: string) => {
      await nav
        .getByRole('button', {
          name: `Actions for ${title} (${id})`,
          exact: true,
        })
        .click();
      await page
        .getByRole('menuitem', {
          name: `Move to project for ${title} (${id})`,
          exact: true,
        })
        .click();
      return nav.getByRole('region', {
        name: `Move conversation: ${title} (${id})`,
        exact: true,
      });
    };
    let editor = await openMove('<Alpha notes>', 'a');
    await editor.getByRole('button', { name, exact: true }).press('Enter');
    expect(backend.requests).toHaveLength(4);
    await page.screenshot({
      path: testInfo.outputPath('project-assignment-desktop.png'),
      fullPage: true,
    });
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editor.getByRole('alert')).toContainText('Could not confirm');
    await expect(
      active.getByRole('button', { name: '<Alpha notes>', exact: true })
    ).toBeVisible();
    expect(backend.requests).toHaveLength(5);
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await backend.steps[5].received;
    await expect(
      editor.getByRole('button', { name: 'Save', exact: true })
    ).toBeDisabled();
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    await nav
      .getByRole('button', {
        name: 'Actions for <Alpha notes> (a)',
        exact: true,
      })
      .click();
    await expect(
      page.getByRole('menuitem', {
        name: 'Move to project for <Alpha notes> (a)',
        exact: true,
      })
    ).toBeDisabled();
    await page.keyboard.press('Escape');
    expect(backend.requests).toHaveLength(6);
    await nav.getByText('Archived conversations', { exact: true }).click();
    const archivedEditor = await openMove('Archived notes', 'c');
    backend.steps[5].releaseBody();
    await expect(
      nav.getByText(`Conversation moved: <Alpha notes> (a) → ${name}.`, {
        exact: true,
      })
    ).toBeVisible();
    await expect(archivedEditor).toBeVisible();
    await expect(
      active.getByRole('button', { name: '<Alpha notes>', exact: true })
    ).toHaveCount(0);
    await expect(
      projects.getByRole('button', { name: 'p/b', exact: true })
    ).toHaveAttribute('aria-current', 'true');
    await archivedEditor
      .getByRole('button', { name: 'Cancel', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: '<Alpha notes>', exact: true })
    ).toBeVisible();
    await expect(draft).toHaveValue(heldDraft);
    await expect(stop).toBeEnabled();
    expect(await draftNode.evaluate((node) => node.isConnected)).toBe(true);
    await projects.getByRole('button', { name, exact: true }).click();
    const alphaRow = active.getByRole('button', {
      name: '<Alpha notes>',
      exact: true,
    });
    await expect(alphaRow).toBeVisible();
    await expect(
      alphaRow.locator('..').locator('.tp-thread-list__pin')
    ).toHaveCount(1);
    editor = await openMove('<Alpha notes>', 'a');
    await editor
      .getByRole('button', { name: 'No project', exact: true })
      .click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole('button', { name: 'Open conversations', exact: true })
      .click();
    await expect(
      editor.getByRole('button', { name: 'No project', exact: true })
    ).toHaveAttribute('aria-current', 'true');
    expect(
      await editor.evaluate(
        (node) =>
          node.scrollWidth <= node.clientWidth &&
          node.getBoundingClientRect().right <= innerWidth
      )
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath('project-assignment-mobile.png'),
      fullPage: true,
    });
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editor.getByRole('alert')).toContainText('Could not confirm');
    expect(backend.requests).toHaveLength(7);
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(
      active.getByRole('button', { name: '<Alpha notes>', exact: true })
    ).toHaveCount(0);
    expect(backend.requests).toHaveLength(8);
    await nav
      .getByRole('button', { name: 'All conversations', exact: true })
      .click();
    editor = await openMove('Archived notes', 'c');
    await editor.getByRole('button', { name, exact: true }).click();
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(
      nav
        .getByRole('list', {
          name: 'Archived loaded conversations',
          exact: true,
        })
        .getByRole('button', { name: 'Archived notes', exact: true })
    ).toBeVisible();
    expect(backend.requests).toHaveLength(9);
    await page
      .getByRole('button', { name: 'Close conversations', exact: true })
      .click();
    await expect(draft).toHaveValue(heldDraft);
    await expect(stop).toBeEnabled();
    await expect(page).toHaveURL(/thread=a/);
    expect(await draftNode.evaluate((node) => node.isConnected)).toBe(true);
    await stop.click();
    expect(await backend.steps[3].closed).toEqual({ finished: false });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload();
    await expect(
      page.getByRole('heading', { name: '<Alpha notes>', exact: true })
    ).toBeVisible();
    await expect(
      projects.getByRole('button', { name, exact: true })
    ).toBeVisible();
    await projects.getByRole('button', { name, exact: true }).click();
    await expect(
      active.getByRole('button', { name: '<Alpha notes>', exact: true })
    ).toHaveCount(0);
    await nav.getByText('Archived conversations', { exact: true }).click();
    editor = await openMove('Archived notes', 'c');
    await expect(
      editor.getByRole('button', { name, exact: true })
    ).toHaveAttribute('aria-current', 'true');
    await expect(
      editor.getByRole('button', { name: 'Save', exact: true })
    ).toBeDisabled();
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(backend.requests).toHaveLength(12);
    backend.verify();
    expect(errors).toEqual([]);
    for (const [index, step] of backend.steps.entries())
      if (index !== 3) expect((await step.closed).finished).toBe(true);
  } finally {
    await page.close();
    await server?.close();
    await backend.close();
  }
});
