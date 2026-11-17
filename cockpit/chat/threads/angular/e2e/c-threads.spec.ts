import { randomUUID } from 'node:crypto';
import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { submitAndWaitForResponse } from '@threadplane-internal/e2e-harness';

const PROMPT = 'Hello';
const PROJECTS = ['threadplane', 'projects'];

// The dev server proxies /api to the LangGraph dev server, which keeps its
// threads and store items between runs. Each test names what it creates and
// removes it afterwards, so leftovers never reorder another run's list.
const created = { threads: new Set<string>(), projects: new Set<string>() };

async function createThread(request: APIRequestContext, title: string) {
  const response = await request.post('/api/threads', {
    data: { metadata: { title } },
  });
  expect(response.ok()).toBe(true);
  const { thread_id } = (await response.json()) as { thread_id: string };
  created.threads.add(thread_id);
  return thread_id;
}

async function readThread(request: APIRequestContext, id: string) {
  const response = await request.get(`/api/threads/${id}`);
  expect(response.ok()).toBe(true);
  return (await response.json()) as { metadata: Record<string, unknown> };
}

test.afterEach(async ({ request }) => {
  for (const id of created.threads) await request.delete(`/api/threads/${id}`);
  for (const key of created.projects)
    await request.delete('/api/store/items', {
      data: { namespace: PROJECTS, key },
    });
  created.threads.clear();
  created.projects.clear();
});

const sidebar = (page: Page) => page.locator('chat-thread-sidebar');
const recent = (page: Page) =>
  sidebar(page).locator('chat-thread-list').first();
const row = (page: Page, title: string): Locator =>
  recent(page).locator('li').filter({ hasText: title });
const rowTitles = (page: Page) =>
  recent(page).locator('li .chat-thread-list__item-title');

async function rowCommand(page: Page, title: string, command: string) {
  await row(page, title)
    .getByRole('button', { name: 'More actions', exact: true })
    .click();
  await page.getByRole('menuitem', { name: command, exact: true }).click();
}

test('c-threads: AI response renders in composed chat surface', async ({ page }) => {
  const bubble = await submitAndWaitForResponse(page, PROMPT);
  await expect(bubble).toContainText('chat-threads demo');
});

test('c-threads: chat-thread-list sidebar is mounted', async ({ page }) => {
  await page.goto('/');
  // Sidebar's distinctive surface — thread switcher seeded with 3 hardcoded
  // threads (thread-1/2/3). Existence + non-zero entry count proves wiring.
  await expect(page.locator('chat-thread-list')).toBeVisible();
});

test('c-threads: a renamed conversation keeps its title after reload', async ({
  page,
  request,
}) => {
  const original = `Rename me ${randomUUID()}`;
  const renamed = `Renamed ${randomUUID()}`;
  await createThread(request, original);
  await page.goto('/');
  await rowCommand(page, original, 'Rename');
  const input = sidebar(page).getByRole('textbox', {
    name: 'Rename conversation',
  });
  await input.fill(renamed);
  await input.press('Enter');
  await expect(row(page, renamed)).toHaveCount(1);
  await page.reload();
  await expect(row(page, renamed)).toHaveCount(1);
  await expect(row(page, original)).toHaveCount(0);
});

test('c-threads: pinned conversations reorder by drag and keep the order after reload', async ({
  page,
  request,
}) => {
  const first = `Pin first ${randomUUID()}`;
  const second = `Pin second ${randomUUID()}`;
  await createThread(request, first);
  await createThread(request, second);
  await page.goto('/');
  await rowCommand(page, first, 'Pin');
  await expect(row(page, first).locator('.chat-thread-list__item-pin')).toBeVisible();
  await rowCommand(page, second, 'Pin');
  await expect(row(page, second).locator('.chat-thread-list__item-pin')).toBeVisible();

  const order = async () => {
    const titles = await rowTitles(page).allTextContents();
    const at = (title: string) => titles.findIndex((t) => t.includes(title));
    return at(first) < at(second) ? [first, second] : [second, first];
  };
  const [top, bottom] = await order();
  await row(page, bottom).dragTo(row(page, top), {
    targetPosition: { x: 20, y: 2 },
  });
  await expect.poll(order).toEqual([bottom, top]);
  await page.reload();
  await expect(row(page, top)).toHaveCount(1);
  await expect.poll(order).toEqual([bottom, top]);
});

test('c-threads: a conversation moved into a new project keeps it after reload', async ({
  page,
  request,
}) => {
  const title = `Project member ${randomUUID()}`;
  const project = `Project ${randomUUID().slice(0, 8)}`;
  const id = await createThread(request, title);
  await page.goto('/');
  await sidebar(page).getByRole('button', { name: '+ New project' }).click();
  const name = sidebar(page).getByRole('textbox', { name: 'New project name' });
  await name.fill(project);
  await name.press('Enter');
  const projectButton = sidebar(page)
    .locator('chat-project-list')
    .getByRole('button', { name: project, exact: true });
  await expect(projectButton).toBeVisible();

  await rowCommand(page, title, 'Move to project');
  await page.getByRole('menuitem', { name: project, exact: true }).click();
  await expect
    .poll(async () => (await readThread(request, id)).metadata['projectId'])
    .toEqual(expect.any(String));
  const projectId = (await readThread(request, id)).metadata['projectId'] as string;
  created.projects.add(projectId);

  await page.reload();
  await expect(projectButton).toBeVisible();
  await expect(row(page, title)).toHaveCount(1);
  const stored = await request.post('/api/store/items/search', {
    data: { namespace_prefix: PROJECTS, limit: 100 },
  });
  const { items } = (await stored.json()) as {
    items: { key: string; value: { name: string } }[];
  };
  expect(items.find((item) => item.key === projectId)?.value.name).toBe(project);
});

test('c-threads: deleting the active conversation returns to a new chat', async ({
  page,
  request,
}) => {
  const createdIds: string[] = [];
  page.on('response', async (response) => {
    if (
      response.request().method() === 'POST' &&
      /\/api\/threads$/.test(new URL(response.url()).pathname) &&
      response.ok()
    ) {
      const { thread_id } = (await response.json()) as { thread_id: string };
      created.threads.add(thread_id);
      createdIds.push(thread_id);
    }
  });
  await submitAndWaitForResponse(page, PROMPT);
  const active = recent(page).locator('li').filter({
    has: page.locator('button[aria-current="true"]'),
  });
  await expect(active).toHaveCount(1);
  await active.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await page
    .locator('chat-confirm-dialog')
    .getByRole('button', { name: 'Delete', exact: true })
    .click();

  await expect(sidebar(page).locator('button[aria-current="true"]')).toHaveCount(0);
  await expect(page.locator('chat-message')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: /message|prompt/i })).toBeEnabled();
  expect(createdIds).toHaveLength(1);
  expect((await request.get(`/api/threads/${createdIds[0]}`)).status()).toBe(404);
});
