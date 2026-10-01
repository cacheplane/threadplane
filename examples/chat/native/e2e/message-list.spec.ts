import { expect, test, type Locator } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('installed React transcript follows only while pinned and resets on selection', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const { buildConsumer } = await import('../tooling/consumer.mjs');
  const { startProofServer, threadEnvelope } = await import(
    '../tooling/proof-server.mjs'
  );
  const { captureRetainedBuild, readRetainedBuild, startCheckedServer } =
    await import('../tooling/retained-build.mjs');
  const work = realpathSync(
    mkdtempSync(join(tmpdir(), 'native-message-list-'))
  );
  const saved = Array.from({ length: 24 }, (_, i) => ({
    id: `saved-${i}`,
    type: 'ai',
    content:
      i === 23
        ? 'Final saved answer.'
        : `Saved paragraph ${i}.\n\n${'A restored conversation needs room to read. '.repeat(
            12
          )}`,
    ...(i === 23
      ? { reasoning: 'A long retained explanation.\n\n'.repeat(30) }
      : {}),
  }));
  const rows = [
    threadEnvelope('a', 'Conversation A'),
    threadEnvelope('b', 'Conversation B'),
  ];
  const search = (title = 'Conversation A') => ({
    method: 'POST',
    path: '/api/threads/search',
    payload: { limit: 50, offset: 0 },
    body: [threadEnvelope('a', title), rows[1]],
  });
  const lookup = (id: string) => ({
    method: 'GET',
    path: `/api/threads/${id}`,
    body: rows[id === 'a' ? 0 : 1],
  });
  const history = (id: string) => ({
    method: 'POST',
    path: `/api/threads/${id}/history`,
    payload: { limit: 10 },
    body: [
      {
        values: { messages: saved },
        next: [],
        tasks: [],
        checkpoint: {
          thread_id: id,
          checkpoint_ns: '',
          checkpoint_id: 'saved',
        },
        parent_checkpoint: null,
        metadata: { source: 'input', step: 0, parents: {} },
        created_at: '2026-09-30T00:00:00.000Z',
      },
    ],
  });
  const run = (index: number) => ({
    method: 'POST',
    path: '/api/threads/a/runs/stream',
    holdHeaders: true,
    holdBody: true,
    events: [
      {
        event: 'values',
        data: {
          messages: [
            ...saved,
            ...Array.from({ length: index }, (_, i) => ({
              id: `reply-${i + 1}`,
              type: 'ai',
              content: `Reply ${
                i + 1
              }.\n\n${'A streamed response grows the transcript. '.repeat(12)}`,
            })),
          ],
        },
      },
    ],
    assertPayload(payload: unknown) {
      const id = (
        payload as { input: { messages: readonly { id: unknown }[] } }
      ).input.messages[0].id;
      assert.ok(typeof id === 'string');
      assert.match(
        id,
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
      assert.deepEqual(payload, {
        assistant_id: 'assistant',
        input: {
          messages: [{ type: 'human', id, content: `Request ${index}` }],
          client_tools: [
            {
              name: 'show_trip_summary',
              description:
                'Show a supplied trip recap with days and places. This terminal summary needs no follow-up; it does not plan or change an itinerary.',
              parameters: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  days: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        day: { type: 'integer', minimum: 1 },
                        places: { type: 'array', items: { type: 'string' } },
                      },
                      required: ['day', 'places'],
                    },
                  },
                  note: { type: 'string' },
                },
                required: ['title', 'days'],
              },
            },
          ],
        },
        stream_mode: ['values', 'messages-tuple', 'updates', 'custom'],
        stream_subgraphs: true,
        stream_resumable: true,
        on_disconnect: 'continue',
      });
    },
  });
  const backend = await startProofServer([
    search(),
    lookup('a'),
    history('a'),
    run(1),
    run(2),
    run(3),
    search('Renamed A'),
    lookup('b'),
    history('b'),
    lookup('a'),
    history('a'),
  ]);
  let server: Awaited<ReturnType<typeof startCheckedServer>> | undefined;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const geometry = (list: Locator) =>
    list.evaluate((el) => ({
      top: el.scrollTop,
      height: el.scrollHeight,
      viewport: el.clientHeight,
      gap: el.scrollHeight - el.clientHeight - el.scrollTop,
    }));
  const bottom = async (list: Locator) =>
    expect.poll(async () => (await geometry(list)).gap).toBeLessThanOrEqual(1);
  try {
    await buildConsumer({
      root: resolve(__dirname, '../../../../'),
      assistantId: 'assistant',
      output: join(work, 'production'),
      capture: (context: unknown) =>
        captureRetainedBuild(join(work, 'retained'), context),
    });
    server = await startCheckedServer({
      retained: readRetainedBuild(join(work, 'retained')),
      target: backend.origin + '/api',
    });
    const origin = server.url;
    await page.route('**/*', (route) => {
      if (new URL(route.request().url()).origin === origin)
        return route.continue();
      errors.push(`Unexpected external request: ${route.request().url()}`);
      return route.abort();
    });
    await page.goto(server.url);
    await page
      .getByRole('button', { name: 'Conversation A', exact: true })
      .click();
    const list = page.getByRole('region', {
      name: 'Conversation messages',
      exact: true,
    });
    await expect
      .poll(async () => {
        const g = await geometry(list);
        return g.height - g.viewport;
      })
      .toBeGreaterThan(1000);
    await expect(list).toHaveClass(/tp-chat-list/);
    await bottom(list);
    const disclosure = list.getByRole('button', {
      name: 'Show reasoning',
      exact: true,
    });
    await disclosure.click();
    await bottom(list);
    await list
      .getByRole('button', { name: 'Show reasoning', exact: true })
      .evaluate((el) => (el as HTMLButtonElement).click());
    await bottom(list);
    await list.evaluate((el) => {
      el.scrollTop = 100;
      el.dispatchEvent(new Event('scroll'));
    });
    await disclosure.evaluate((el) => (el as HTMLButtonElement).click());
    await list.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    );
    expect((await geometry(list)).top).toBe(100);
    await list
      .getByRole('button', { name: 'Show reasoning', exact: true })
      .evaluate((el) => (el as HTMLButtonElement).click());
    await list.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      el.dispatchEvent(new Event('scroll'));
    });
    await bottom(list);
    const original = await list.elementHandle();
    const first = await list.getByRole('article').first().elementHandle();
    assert.ok(original);
    assert.ok(first);
    const send = async (index: number) => {
      await page
        .getByLabel('Message', { exact: true })
        .fill(`Request ${index}`);
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await backend.steps[index + 2].received;
      backend.steps[index + 2].releaseHeaders();
      await expect(
        list.getByText(`Reply ${index}.`, { exact: true })
      ).toBeVisible();
    };
    await send(1);
    await bottom(list);
    await expect.poll(() => first.evaluate((el) => el.isConnected)).toBe(true);
    backend.steps[3].releaseBody();
    await backend.steps[3].closed;
    await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
    await list.evaluate((el) => {
      el.scrollTop = 100;
      el.dispatchEvent(new Event('scroll'));
    });
    await send(2);
    expect((await geometry(list)).top).toBe(100);
    backend.steps[4].releaseBody();
    await backend.steps[4].closed;
    await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
    await list.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      el.dispatchEvent(new Event('scroll'));
    });
    await send(3);
    await bottom(list);
    backend.steps[5].releaseBody();
    await backend.steps[5].closed;
    await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
    await list.evaluate((el) => {
      el.scrollTop = 100;
      el.dispatchEvent(new Event('scroll'));
    });
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Renamed A', exact: true })
    ).toBeVisible();
    expect(await original.evaluate((el) => el.isConnected)).toBe(true);
    expect((await geometry(list)).top).toBe(100);
    await page
      .getByRole('button', { name: 'Conversation B', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Conversation B', exact: true })
    ).toBeVisible();
    await bottom(list);
    expect(await original.evaluate((el) => el.isConnected)).toBe(false);
    await page.getByRole('button', { name: 'Renamed A', exact: true }).click();
    await expect(list.getByRole('article')).toHaveCount(24);
    await bottom(list);
    backend.verify();
    for (const step of backend.steps)
      expect((await step.closed).finished).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await server?.close();
    await backend.close();
    rmSync(work, { recursive: true, force: true });
  }
});
