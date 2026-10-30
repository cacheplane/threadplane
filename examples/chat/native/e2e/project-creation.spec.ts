import { test } from './fixtures';
import { expect } from '@playwright/test';

test('installed React New captures project in its initial POST and admits only confirmed creation', async ({
  page,
  retainedConsumer,
}) => {
  test.setTimeout(300_000);
  const { startProofServer, threadEnvelope } = await import(
    '../tooling/proof-server.mjs'
  );
  const { startCheckedServer } =
    await import('../tooling/retained-build.mjs');
  const projectId = ' p/one ';
  const alpha = {
    ...threadEnvelope('a', 'Alpha notes'),
    metadata: { title: 'Alpha notes' },
  };
  const created = {
    ...threadEnvelope('new', 'Created in project'),
    metadata: { title: 'Created in project', projectId },
  };
  const unconfirmed = {
    ...threadEnvelope('uncertain', 'Unconfirmed server creation'),
    metadata: { title: 'Unconfirmed server creation', projectId: '__proto__' },
  };
  const history = (id: string) => ({
    method: 'POST',
    path: `/api/threads/${id}/history`,
    payload: { limit: 10 },
    body: [],
  });
  const backend = await startProofServer([
    {
      method: 'POST',
      path: '/api/threads/search',
      payload: { limit: 50, offset: 0 },
      body: [alpha],
    },
    { method: 'GET', path: '/api/threads/a', body: alpha },
    history('a'),
    {
      method: 'POST',
      path: '/api/threads',
      payload: { metadata: { projectId } },
      body: unconfirmed,
      holdBody: true,
    },
    {
      method: 'POST',
      path: '/api/threads/search',
      payload: { limit: 50, offset: 0 },
      body: [alpha, unconfirmed],
    },
    {
      method: 'POST',
      path: '/api/threads',
      payload: { metadata: { projectId } },
      body: created,
      holdBody: true,
    },
    { method: 'GET', path: '/api/threads/new', body: created },
    history('new'),
    {
      method: 'POST',
      path: '/api/threads/search',
      payload: { limit: 50, offset: 0 },
      body: [alpha, unconfirmed, created],
    },
    { method: 'GET', path: '/api/threads/new', body: created },
    history('new'),
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
      localStorage.setItem(
        'threadplane-native-react-projects-v1',
        JSON.stringify({
          version: 1,
          projects: [
            { id: ' p/one ', name: '<First project>' },
            { id: '__proto__', name: 'Second project' },
          ],
        })
      )
    );
    await page.goto(origin + '/?presentation=sidenav&thread=a');
    const nav = page.getByRole('navigation', {
      name: 'Conversations',
      exact: true,
    });
    const draft = page.getByRole('textbox', { name: 'Message', exact: true });
    await expect(
      page.getByRole('heading', { name: 'Alpha notes', exact: true })
    ).toBeVisible();
    await draft.fill('Keep this draft while creation is unconfirmed');
    const draftNode = await draft.elementHandle();
    const first = nav.getByRole('button', {
      name: '<First project>',
      exact: true,
    });
    const second = nav.getByRole('button', {
      name: 'Second project',
      exact: true,
    });
    const newButton = nav.getByRole('button', { name: 'New', exact: true });
    await first.click();
    await newButton.click();
    await backend.steps[3].received;
    await expect(newButton).toBeDisabled();
    await second.click();
    await newButton.evaluate((node: HTMLButtonElement) => node.click());
    expect(backend.requests).toHaveLength(4);
    await expect(draft).toHaveValue(
      'Keep this draft while creation is unconfirmed'
    );
    expect(
      await draft.evaluate((node, original) => node === original, draftNode)
    ).toBe(true);
    expect(new URL(page.url()).searchParams.get('thread')).toBe('a');
    backend.steps[3].releaseBody();
    await expect(nav.getByRole('alert')).toContainText(
      'Creation could not be confirmed'
    );
    await expect(newButton).toBeEnabled();
    await expect(second).toHaveAttribute('aria-current', 'true');
    expect(backend.requests).toHaveLength(4);
    await expect(draft).toHaveValue(
      'Keep this draft while creation is unconfirmed'
    );
    await expect(
      page.getByRole('heading', { name: 'Alpha notes', exact: true })
    ).toBeVisible();
    await nav.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(
      nav
        .getByRole('list', { name: 'Loaded conversations', exact: true })
        .getByRole('button', {
          name: 'Unconfirmed server creation',
          exact: true,
        })
    ).toBeVisible();
    expect(backend.requests).toHaveLength(5);
    await first.click();
    await newButton.click();
    await backend.steps[5].received;
    await expect(newButton).toBeDisabled();
    await second.click();
    await newButton.evaluate((node: HTMLButtonElement) => node.click());
    expect(backend.requests).toHaveLength(6);
    backend.steps[5].releaseBody();
    await expect(
      page.getByRole('heading', { name: 'Created in project', exact: true })
    ).toBeVisible();
    await expect(second).toHaveAttribute('aria-current', 'true');
    expect(new URL(page.url()).searchParams.get('thread')).toBe('new');
    const list = nav.getByRole('list', {
      name: 'Loaded conversations',
      exact: true,
    });
    await expect(
      list.getByRole('button', { name: 'Created in project', exact: true })
    ).toHaveCount(0);
    await first.click();
    await expect(
      list.getByRole('button', { name: 'Created in project', exact: true })
    ).toBeVisible();
    expect(backend.requests).toHaveLength(8);
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Created in project', exact: true })
    ).toBeVisible();
    await first.click();
    await expect(
      list.getByRole('button', { name: 'Created in project', exact: true })
    ).toBeVisible();
    await expect(
      list.getByRole('button', { name: 'Alpha notes', exact: true })
    ).toHaveCount(0);
    expect(backend.requests).toHaveLength(11);
    backend.verify();
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await server?.close();
    await backend.close();
  }
});
