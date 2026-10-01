import { expect, test } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('installed React reasoning borrows snapshots and preserves response disclosure choices', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const { buildConsumer } = await import('../tooling/consumer.mjs');
  const { startProofServer, threadEnvelope } = await import(
    '../tooling/proof-server.mjs'
  );
  const { captureRetainedBuild, readRetainedBuild, startCheckedServer } =
    await import('../tooling/retained-build.mjs');
  const work = realpathSync(mkdtempSync(join(tmpdir(), 'native-reasoning-')));
  const saved = [
    {
      id: 'saved-one',
      type: 'ai',
      content: 'Saved answer',
      reasoning: '**Saved reasoning**',
    },
    {
      id: 'saved-two',
      type: 'ai',
      content: 'Another answer',
      reasoning: '<script>bad()</script>\n\n[blocked](javascript:bad)',
    },
    {
      id: 'saved-user',
      type: 'human',
      content: 'Saved question',
      reasoning: 'Do not display user reasoning',
    },
  ];
  const envelope = threadEnvelope('a', 'Conversation A');
  const history = () => ({
    method: 'POST',
    path: '/api/threads/a/history',
    payload: { limit: 10 },
    body: [
      {
        values: { messages: saved },
        next: [],
        tasks: [],
        checkpoint: {
          thread_id: 'a',
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
            ...Array.from({ length: index }, (_, position) => ({
              id: `response-${position + 1}`,
              type: 'ai',
              content: `Answer ${position + 1}`,
              reasoning: `**Reason ${position + 1}**`,
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
    {
      method: 'POST',
      path: '/api/threads/search',
      payload: { limit: 50, offset: 0 },
      body: [envelope],
    },
    { method: 'GET', path: '/api/threads/a', body: envelope },
    history(),
    run(1),
    run(2),
    { method: 'GET', path: '/api/threads/a', body: envelope },
    history(),
  ]);
  let server: Awaited<ReturnType<typeof startCheckedServer>> | undefined;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
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
    await page.goto(origin);
    await page
      .getByRole('button', { name: 'Conversation A', exact: true })
      .click();
    const list = page.getByRole('region', {
      name: 'Conversation messages',
      exact: true,
    });
    await expect(
      list.getByRole('button', { name: 'Show reasoning', exact: true })
    ).toHaveCount(2);
    const first = list
      .getByRole('article', { name: 'assistant message' })
      .first();
    const savedNode = await first.elementHandle();
    assert.ok(savedNode);
    const toggle = first.getByRole('button', { name: 'Show reasoning' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(
      first.getByRole('region', { name: 'Reasoning' })
    ).toContainText('Saved reasoning');
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const second = list
      .getByRole('article', { name: 'assistant message' })
      .nth(1);
    await second.getByRole('button').click();
    await expect(
      second.getByRole('region', { name: 'Reasoning' })
    ).toContainText('<script>bad()</script>');
    await expect(second.locator('script, a')).toHaveCount(0);
    await expect(list.getByText('Do not display user reasoning')).toHaveCount(
      0
    );
    const ids = await list
      .locator('.tp-reasoning__toggle')
      .evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute('aria-controls'))
      );
    expect(new Set(ids).size).toBe(2);
    const send = async (index: number) => {
      await page
        .getByLabel('Message', { exact: true })
        .fill(`Request ${index}`);
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await backend.steps[index + 2].received;
      backend.steps[index + 2].releaseHeaders();
      await expect(
        list.getByText(`Answer ${index}`, { exact: true })
      ).toBeVisible();
      await expect(
        list.getByRole('button', { name: 'Thinking…' })
      ).toHaveAttribute('aria-expanded', 'true');
      await expect(
        list.getByRole('region', { name: 'Reasoning' }).last()
      ).toContainText(`Reason ${index}`);
    };
    await send(1);
    await list.getByRole('button', { name: 'Thinking…' }).click();
    backend.steps[3].releaseBody();
    await backend.steps[3].closed;
    await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
    await expect(
      list
        .getByRole('article', { name: 'assistant message' })
        .last()
        .getByRole('button')
    ).toHaveAttribute('aria-expanded', 'false');
    expect(await savedNode.evaluate((el) => el.isConnected)).toBe(true);
    await send(2);
    await expect(
      list
        .getByRole('article', { name: 'assistant message' })
        .nth(2)
        .getByRole('button')
    ).toHaveAttribute('aria-expanded', 'false');
    await list.getByRole('button', { name: 'Thinking…' }).click();
    await list.getByRole('button', { name: 'Thinking…' }).click();
    backend.steps[4].releaseBody();
    await backend.steps[4].closed;
    await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
    await expect(
      list
        .getByRole('article', { name: 'assistant message' })
        .last()
        .getByRole('button')
    ).toHaveAttribute('aria-expanded', 'true');
    // A fresh selection owns fresh history and a fresh disclosure, without a run.
    await page.evaluate(() => {
      const url = new URL(location.href);
      url.searchParams.delete('thread');
      history.pushState(null, '', url);
      dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(
      page.getByRole('heading', { name: 'A place for your next conversation.' })
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Conversation A', exact: true })
      .click();
    await expect(list.getByRole('article')).toHaveCount(3);
    await expect(
      list.getByRole('button', { name: 'Show reasoning' }).first()
    ).toHaveAttribute('aria-expanded', 'false');
    expect(await savedNode.evaluate((el) => el.isConnected)).toBe(false);
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
