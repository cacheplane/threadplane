import { test } from './fixtures';
import { expect } from '@playwright/test';
import assert from 'node:assert/strict';

test('installed React confirmed project move survives another project deletion and late selected and list reads', async ({
  page,
  retainedConsumer,
}) => {
  test.setTimeout(300_000);
  const { startProofServer, threadEnvelope } = await import(
    '../tooling/proof-server.mjs'
  );
  const { startCheckedServer } =
    await import('../tooling/retained-build.mjs');
  const sourceId = ' p/one ';
  const destinationId = '__proto__';
  const title = '<Alpha notes>';
  const alpha = {
    ...threadEnvelope('a', title),
    metadata: { title, projectId: sourceId, pinned: true, pinnedOrder: 0 },
  };
  const moved = {
    ...alpha,
    metadata: { ...alpha.metadata, projectId: destinationId },
  };
  const backend = await startProofServer([
    {
      method: 'POST',
      path: '/api/threads/search',
      payload: { limit: 50, offset: 0 },
      body: [alpha],
    },
    { method: 'GET', path: '/api/threads/a', body: alpha, holdBody: true },
    {
      method: 'PATCH',
      path: '/api/threads/a',
      payload: { metadata: { projectId: destinationId } },
      body: moved,
    },
    {
      method: 'POST',
      path: '/api/threads/search',
      payload: { limit: 50, offset: 0 },
      body: [moved],
      holdBody: true,
    },
    {
      method: 'POST',
      path: '/api/threads/search',
      payload: { metadata: { projectId: sourceId }, limit: 50, offset: 0 },
      body: [],
    },
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
      apiKey: 'project-deletion-race-proof-key',
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
      ({ sourceId, destinationId }) =>
        localStorage.setItem(
          'threadplane-native-react-projects-v1',
          JSON.stringify({
            version: 1,
            projects: [
              { id: sourceId, name: 'Source project' },
              { id: destinationId, name: 'Destination project' },
            ],
          })
        ),
      { sourceId, destinationId }
    );
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(origin + '/?presentation=sidenav&thread=a');
    await backend.steps[1].received;
    const nav = page.getByRole('navigation', {
      name: 'Conversations',
      exact: true,
    });
    const projects = nav.getByRole('list', { name: 'Projects', exact: true });
    const destination = projects.getByRole('button', {
      name: 'Destination project',
      exact: true,
    });
    const row = nav
      .getByRole('list', { name: 'Loaded conversations', exact: true })
      .getByRole('button', { name: title, exact: true });
    const draft = page.getByRole('textbox', { name: 'Message', exact: true });
    await expect(row).toBeVisible();
    await expect(draft).toBeDisabled();
    const draftNode = await draft.elementHandle();
    assert.ok(draftNode);
    await nav
      .getByRole('button', { name: `Actions for ${title} (a)`, exact: true })
      .click();
    await page
      .getByRole('menuitem', {
        name: `Move to project for ${title} (a)`,
        exact: true,
      })
      .click();
    const editor = nav.getByRole('region', {
      name: `Move conversation: ${title} (a)`,
      exact: true,
    });
    await editor
      .getByRole('button', { name: 'Destination project', exact: true })
      .click();
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(
      nav.getByText(`Conversation moved: ${title} (a) → Destination project.`, {
        exact: true,
      })
    ).toBeVisible();
    await nav.getByRole('button', { name: 'Refresh', exact: true }).click();
    await backend.steps[3].received;
    await projects
      .getByRole('button', {
        name: `Delete project Source project (${sourceId})`,
        exact: true,
      })
      .click();
    await page
      .getByRole('alertdialog', { name: 'Delete project?', exact: true })
      .getByRole('button', { name: 'Delete project', exact: true })
      .click();
    await expect(
      projects.getByRole('button', { name: 'Source project', exact: true })
    ).toHaveCount(0);
    await destination.click();
    await expect(destination).toHaveAttribute('aria-current', 'true');
    await expect(row).toBeVisible();
    // Admission began before the move. Its old p association must resolve to q
    // before applying p's later empty-membership evidence.
    backend.steps[1].releaseBody();
    await backend.steps[5].received;
    await expect(
      page.getByRole('heading', { name: title, exact: true })
    ).toBeVisible();
    await expect(draft).toBeEnabled();
    await draft.fill('Keep this draft after the late list read.');
    await expect(destination).toHaveAttribute('aria-current', 'true');
    await expect(row).toBeVisible();
    backend.steps[3].releaseBody();
    await expect(
      nav.getByRole('button', { name: 'Refresh', exact: true })
    ).toBeEnabled();
    await expect(destination).toHaveAttribute('aria-current', 'true');
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('aria-current', 'true');
    await expect(row.locator('..').locator('.tp-thread-list__pin')).toHaveCount(
      1
    );
    await expect(
      page.getByRole('heading', { name: title, exact: true })
    ).toBeVisible();
    await expect(draft).toHaveValue(
      'Keep this draft after the late list read.'
    );
    expect(await draftNode.evaluate((node) => node.isConnected)).toBe(true);
    expect(new URL(page.url()).searchParams.get('thread')).toBe('a');
    backend.verify();
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
        'project-deletion-race-proof-key'
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
