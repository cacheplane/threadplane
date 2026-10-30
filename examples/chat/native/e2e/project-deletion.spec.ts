import { test } from './fixtures';
import { expect } from '@playwright/test';
import assert from 'node:assert/strict';

test('installed React project deletion drains unloaded membership and explicitly retries without resetting a running conversation', async ({
  page,
  retainedConsumer,
}, testInfo) => {
  test.setTimeout(300_000);
  const { startProofServer, threadEnvelope } = await import(
    '../tooling/proof-server.mjs'
  );
  const { startCheckedServer } = await import('../tooling/retained-build.mjs');
  const projectId = ' p/one ';
  const name = '<Project> ' + 'W'.repeat(160);
  const otherId = '__proto__';
  const alpha = {
    ...threadEnvelope('a', '<Alpha notes>'),
    metadata: {
      title: '<Alpha notes>',
      projectId,
      pinned: true,
      pinnedOrder: 0,
    },
  };
  const beta = {
    ...threadEnvelope('b', 'Other project notes'),
    metadata: { title: 'Other project notes', projectId: otherId },
  };
  const archived = {
    ...threadEnvelope('c', 'Archived notes'),
    metadata: { title: 'Archived notes', projectId, archived: true },
  };
  const hidden = Array.from({ length: 50 }, (_, index) => ({
    ...threadEnvelope(`hidden-${index}`, `Unloaded ${index}`),
    metadata: { title: `Unloaded ${index}`, projectId, archived: true },
  }));
  const unassigned = {
    ...alpha,
    metadata: { ...alpha.metadata, projectId: null },
  };
  const membership = (body: unknown[], holdBody = false) => ({
    method: 'POST',
    path: '/api/threads/search',
    payload: { metadata: { projectId }, limit: 50, offset: 0 },
    body,
    holdBody,
  });
  const clear = (thread: typeof archived, holdBody = false) => ({
    method: 'PATCH',
    path: `/api/threads/${thread.thread_id}`,
    payload: { metadata: { projectId: null } },
    // Unrelated stale metadata must not overwrite local title/pin/archive state.
    body: {
      ...thread,
      metadata: {
        title: 'Stale title',
        archived: false,
        pinned: false,
        projectId: null,
      },
    },
    holdBody,
  });
  const expectations = [
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
          'Keep responding while I delete the project.'
        );
        assert.equal(body.on_disconnect, 'continue');
      },
    },
    membership([alpha, archived, ...hidden.slice(0, 48)]),
    {
      method: 'PATCH',
      path: '/api/threads/a',
      payload: { metadata: { projectId: null } },
      // The server cleared a, but its uncertain response cannot confirm that write.
      body: {
        ...alpha,
        metadata: { ...alpha.metadata, projectId: 'wrong destination' },
      },
      holdBody: true,
    },
    // Retry re-queries current membership instead of replaying a's uncertain PATCH.
    membership([archived, ...hidden.slice(0, 48)]),
    clear(archived, true),
    ...hidden.slice(0, 48).map((thread) => clear(thread)),
    membership(hidden.slice(48)),
    ...hidden.slice(48).map((thread) => clear(thread)),
    membership([], true),
    {
      method: 'POST',
      path: '/api/threads/search',
      payload: { limit: 50, offset: 0 },
      body: [
        unassigned,
        beta,
        { ...archived, metadata: { ...archived.metadata, projectId: null } },
      ],
    },
    { method: 'GET', path: '/api/threads/a', body: unassigned },
    {
      method: 'POST',
      path: '/api/threads/a/history',
      payload: { limit: 10 },
      body: [],
    },
  ];
  const finalEmptyIndex = expectations.length - 4;
  const backend = await startProofServer(expectations);
  let server: Awaited<ReturnType<typeof startCheckedServer>> | undefined;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    server = await startCheckedServer({
      retained: retainedConsumer,
      target: backend.origin + '/api',
      apiKey: 'project-deletion-proof-key',
    });
    const origin = server.url;
    await page.route('**/*', (route) => {
      if (new URL(route.request().url()).origin === origin) {
        expect(route.request().headers()['x-api-key']).toBeUndefined();
        return route.continue();
      }
      errors.push('Unexpected external request');
      return route.abort();
    });
    await page.addInitScript(
      ({ projectId, name, otherId }) => {
        if (localStorage.getItem('project-deletion-seeded')) return;
        localStorage.setItem('project-deletion-seeded', 'true');
        localStorage.setItem(
          'threadplane-native-react-projects-v1',
          JSON.stringify({
            version: 1,
            projects: [
              { id: projectId, name },
              { id: otherId, name: 'Other project' },
            ],
          })
        );
      },
      { projectId, name, otherId }
    );
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(origin + '/?presentation=sidenav&thread=a');
    const nav = page.getByRole('navigation', {
      name: 'Conversations',
      exact: true,
    });
    const projects = nav.getByRole('list', { name: 'Projects', exact: true });
    const target = projects.getByRole('button', { name, exact: true });
    const other = projects.getByRole('button', {
      name: 'Other project',
      exact: true,
    });
    const draft = page.getByRole('textbox', { name: 'Message', exact: true });
    const title = page.getByRole('heading', {
      name: '<Alpha notes>',
      exact: true,
    });
    await expect(title).toBeVisible();
    const draftNode = await draft.elementHandle();
    assert.ok(draftNode);
    await target.click();
    await draft.fill('Keep responding while I delete the project.');
    await draft.press('Control+Enter');
    await backend.steps[3].received;
    await expect(
      page.getByText('Deletion response remains active.', { exact: true })
    ).toBeVisible();
    const heldDraft = await draft.inputValue();
    const stop = page.getByRole('button', { name: 'Stop', exact: true });
    await expect(stop).toBeEnabled();
    const deleteButton = projects.getByRole('button', {
      name: `Delete project ${name} (${projectId})`,
      exact: true,
    });
    await deleteButton.click();
    const dialog = page.getByRole('alertdialog', {
      name: 'Delete project?',
      exact: true,
    });
    await expect(dialog).toContainText(
      'Conversations will remain and become unassigned'
    );
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(backend.requests).toHaveLength(4);
    await expect(target).toBeVisible();
    await deleteButton.click();
    await page.screenshot({
      path: testInfo.outputPath('project-deletion-desktop.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(dialog).toBeVisible();
    expect(
      await dialog.evaluate(
        (node) =>
          node.scrollWidth <= node.clientWidth &&
          node.getBoundingClientRect().right <= innerWidth &&
          node.getBoundingClientRect().left >= 0
      )
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath('project-deletion-mobile.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await dialog
      .getByRole('button', { name: 'Delete project', exact: true })
      .click();
    await backend.steps[5].received;
    await expect(dialog).toHaveCount(0);
    await expect(
      nav.getByRole('status').filter({ hasText: 'Deleting project:' })
    ).toBeVisible();
    await expect(target).toBeVisible();
    await expect(
      nav.getByRole('button', { name: 'New', exact: true })
    ).toBeDisabled();
    await other.click();
    await expect(other).toHaveAttribute('aria-current', 'true');
    backend.steps[5].releaseBody();
    await expect(nav.getByRole('alert')).toContainText(
      'Project deletion is unconfirmed'
    );
    expect(backend.requests).toHaveLength(6);
    await expect(target).toBeVisible();
    await expect(title).toBeVisible();
    await expect(draft).toHaveValue(heldDraft);
    await expect(stop).toBeEnabled();
    await nav
      .getByRole('button', { name: 'Retry project deletion', exact: true })
      .click();
    await backend.steps[7].received;
    expect(backend.requests).toHaveLength(8);
    await expect(target).toBeVisible();
    backend.steps[7].releaseBody();
    await backend.steps[finalEmptyIndex].received;
    await expect(target).toBeVisible();
    await expect(other).toHaveAttribute('aria-current', 'true');
    await expect(title).toBeVisible();
    await expect(draft).toHaveValue(heldDraft);
    await expect(stop).toBeEnabled();
    expect(await draftNode.evaluate((node) => node.isConnected)).toBe(true);
    expect(new URL(page.url()).searchParams.get('thread')).toBe('a');
    backend.steps[finalEmptyIndex].releaseBody();
    await expect(target).toHaveCount(0);
    await expect(
      page.getByText('Deletion response remains active.', { exact: true })
    ).toBeVisible();
    await expect(
      nav.getByRole('status').filter({ hasText: 'Project deleted:' })
    ).toBeVisible();
    await expect(other).toHaveAttribute('aria-current', 'true');
    await expect(title).toBeVisible();
    await expect(draft).toHaveValue(heldDraft);
    await expect(stop).toBeEnabled();
    expect(await draftNode.evaluate((node) => node.isConnected)).toBe(true);
    await nav
      .getByRole('button', { name: 'All conversations', exact: true })
      .click();
    const active = nav.getByRole('list', {
      name: 'Loaded conversations',
      exact: true,
    });
    const alphaRow = active.getByRole('button', {
      name: '<Alpha notes>',
      exact: true,
    });
    await expect(alphaRow).toBeVisible();
    await expect(
      alphaRow.locator('..').locator('.tp-thread-list__pin')
    ).toHaveCount(1);
    await nav.getByText('Archived conversations', { exact: true }).click();
    await expect(
      nav
        .getByRole('list', {
          name: 'Archived loaded conversations',
          exact: true,
        })
        .getByRole('button', { name: 'Archived notes', exact: true })
    ).toBeVisible();
    expect(backend.requests).toHaveLength(finalEmptyIndex + 1);
    expect(
      backend.requests.filter(
        (request) =>
          request.method === 'PATCH' && request.path === '/api/threads/a'
      )
    ).toHaveLength(1);
    expect(
      backend.requests.some(
        (request) =>
          request.method === 'DELETE' ||
          (request.method === 'POST' && request.path === '/api/threads')
      )
    ).toBe(false);
    await stop.click();
    expect(await backend.steps[3].closed).toEqual({ finished: false });
    await page.reload();
    await expect(title).toBeVisible();
    await expect(target).toHaveCount(0);
    await expect(other).toBeVisible();
    await expect(
      active.getByRole('button', { name: '<Alpha notes>', exact: true })
    ).toBeVisible();
    backend.verify();
    for (const request of backend.requests)
      expect(request.headers['x-api-key']).toBe('project-deletion-proof-key');
    expect(errors).toEqual([]);
    for (const [index, step] of backend.steps.entries())
      if (index !== 3) expect((await step.closed).finished).toBe(true);
  } finally {
    await page.close();
    await server?.close();
    await backend.close();
  }
});

for (const focus of ['project controls', 'draft'] as const) {
  test(`installed React last project deletion preserves ${focus} focus and the selected conversation`, async ({
    page,
    retainedConsumer,
  }) => {
    const { startProofServer, threadEnvelope } = await import(
      '../tooling/proof-server.mjs'
    );
    const { startCheckedServer } = await import(
      '../tooling/retained-build.mjs'
    );
    const alpha = {
      ...threadEnvelope('a', 'Last project conversation'),
      metadata: { title: 'Last project conversation', projectId: 'last' },
    };
    const backend = await startProofServer([
      {
        method: 'POST',
        path: '/api/threads/search',
        payload: { limit: 50, offset: 0 },
        body: [alpha],
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
        path: '/api/threads/search',
        payload: { metadata: { projectId: 'last' }, limit: 50, offset: 0 },
        body: [alpha],
      },
      {
        method: 'PATCH',
        path: '/api/threads/a',
        payload: { metadata: { projectId: null } },
        body: { ...alpha, metadata: { ...alpha.metadata, projectId: null } },
        holdBody: true,
      },
      {
        method: 'POST',
        path: '/api/threads/search',
        payload: { metadata: { projectId: 'last' }, limit: 50, offset: 0 },
        body: [],
        holdBody: true,
      },
    ]);
    let server: Awaited<ReturnType<typeof startCheckedServer>> | undefined;
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      server = await startCheckedServer({
        retained: retainedConsumer,
        target: backend.origin + '/api',
        apiKey: 'last-project-focus-proof-key',
      });
      await page.addInitScript(() => {
        localStorage.setItem(
          'threadplane-native-react-projects-v1',
          JSON.stringify({
            version: 1,
            projects: [{ id: 'last', name: 'Last project' }],
          })
        );
      });
      await page.goto(server.url + '/?presentation=sidenav&thread=a');
      const nav = page.getByRole('navigation', {
        name: 'Conversations',
        exact: true,
      });
      const draft = page.getByRole('textbox', { name: 'Message', exact: true });
      await expect(draft).toBeEnabled();
      await draft.fill('Keep the last project draft.');
      const draftNode = await draft.elementHandle();
      assert.ok(draftNode);
      await nav
        .getByRole('button', { name: 'Last project', exact: true })
        .click();
      await nav
        .getByRole('button', {
          name: 'Delete project Last project (last)',
          exact: true,
        })
        .click();
      await page
        .getByRole('alertdialog', { name: 'Delete project?', exact: true })
        .getByRole('button', { name: 'Delete project', exact: true })
        .click();
      await backend.steps[4].received;
      const all = nav.getByRole('button', {
        name: 'All conversations',
        exact: true,
      });
      await expect(all).toBeFocused();
      if (focus === 'draft') await draft.focus();
      backend.steps[4].releaseBody();
      await backend.steps[5].received;
      backend.steps[5].releaseBody();
      await expect(all).toHaveCount(0);
      await expect(
        nav.getByRole('status').filter({ hasText: 'Project deleted:' })
      ).toHaveText(
        'Project deleted: Last project (last). Conversations were preserved.'
      );
      await expect(
        focus === 'draft'
          ? draft
          : nav.getByRole('button', { name: 'New project', exact: true })
      ).toBeFocused();
      await expect(
        nav.getByRole('button', {
          name: 'Last project conversation',
          exact: true,
        })
      ).toHaveAttribute('aria-current', 'true');
      await expect(
        page.getByRole('heading', {
          name: 'Last project conversation',
          exact: true,
        })
      ).toBeVisible();
      await expect(draft).toHaveValue('Keep the last project draft.');
      expect(await draftNode.evaluate((node) => node.isConnected)).toBe(true);
      expect(new URL(page.url()).searchParams.get('thread')).toBe('a');
      backend.verify();
      expect(backend.requests).toHaveLength(6);
      expect(
        backend.requests.filter((request) => request.method === 'PATCH')
      ).toHaveLength(1);
      expect(
        backend.requests.some(
          (request) =>
            request.method === 'DELETE' ||
            (request.method === 'POST' && request.path === '/api/threads')
        )
      ).toBe(false);
      for (const request of backend.requests)
        expect(request.headers['x-api-key']).toBe(
          'last-project-focus-proof-key'
        );
      expect(errors).toEqual([]);
      for (const step of backend.steps)
        expect((await step.closed).finished).toBe(true);
    } finally {
      await page.close();
      await server?.close();
      await backend.close();
    }
  });
}
