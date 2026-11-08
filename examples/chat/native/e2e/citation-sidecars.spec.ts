import { test } from './fixtures';
import { expect } from '@playwright/test';
import assert from 'node:assert/strict';

test('installed Markdown Sources merge exact metadata, retain streamed cards and retire message ownership', async ({
  page,
  retainedConsumer,
}) => {
  const { startProofServer, threadEnvelope } = await import(
    '../tooling/proof-server.mjs'
  );
  const { startCheckedServer } = await import('../tooling/retained-build.mjs');
  const a = threadEnvelope('a', 'Conversation A');
  const b = threadEnvelope('b', 'Conversation B');
  const answer = (title = 'Sidecar', removed = false) => ({
    id: 'answer',
    type: 'ai',
    content:
      'Answer [^side] [^collision].\n\n' +
      (removed
        ? ''
        : `[^side]: ${title} [first](/${title.toLowerCase()}) ${title} snippet [later](/later)\n\n`) +
      '[^collision]: Hidden [fallback](/never) hidden snippet\n',
    additional_kwargs: {
      citations: [
        { id: 'collision', index: 4, url: 'javascript:blocked' },
        { id: 'provider', index: 1, title: 'Provider' },
      ],
    },
  });
  const markdownOnly = {
    id: 'markdown-only',
    type: 'ai',
    content:
      'Only [^only].\n\n[^only]: Markdown only [link](/only) standalone snippet\n',
  };
  const saved = [
    answer(),
    markdownOnly,
    {
      id: 'question',
      type: 'human',
      content: 'User [^user].\n\n[^user]: User source\n',
    },
  ];
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
        metadata: null,
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
          messages: [answer('Corrected', index === 2), markdownOnly, saved[2]],
        },
      },
    ],
    assertPayload(payload: unknown) {
      const value = payload as {
        input: {
          messages: { id: string; content: string; type: string }[];
          client_tools: unknown[];
        };
        assistant_id: string;
        stream_mode: string[];
        stream_subgraphs: boolean;
        stream_resumable: boolean;
        on_disconnect: string;
      };
      assert.match(value.input.messages[0].id, /^[0-9a-f-]{36}$/i);
      assert.deepEqual(value.input.messages, [
        {
          id: value.input.messages[0].id,
          type: 'human',
          content: `Request ${index}`,
        },
      ]);
      assert.equal(value.assistant_id, 'assistant');
      assert.deepEqual(value.stream_mode, [
        'values',
        'messages-tuple',
        'updates',
        'custom',
        'checkpoints',
      ]);
      assert.equal(value.stream_subgraphs, true);
      assert.equal(value.stream_resumable, true);
      assert.equal(value.on_disconnect, 'continue');
      assert.equal(value.input.client_tools.length, 1);
    },
  });
  const backend = await startProofServer([
    {
      method: 'POST',
      path: '/api/threads/search',
      payload: { limit: 50, offset: 0 },
      body: [a, b],
    },
    { method: 'GET', path: '/api/threads/a', body: a },
    history('a'),
    run(1),
    run(2),
    { method: 'GET', path: '/api/threads/b', body: b },
    history('b'),
    { method: 'GET', path: '/api/threads/a', body: a },
    history('a'),
  ]);
  let server: Awaited<ReturnType<typeof startCheckedServer>> | undefined;
  const errors: string[] = [];
  const sourceRequests: string[] = [];
  const sourcePaths = new Set([
    '/only',
    '/sidecar',
    '/corrected',
    '/never',
    '/later',
  ]);
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    server = await startCheckedServer({
      retained: retainedConsumer,
      target: backend.origin + '/api',
    });
    const origin = server.url;
    await page.route('**/*', (route) => {
      const requested = new URL(route.request().url());
      if (sourcePaths.has(requested.pathname)) {
        sourceRequests.push(route.request().url());
        return route.abort();
      }
      if (requested.origin === origin) return route.continue();
      errors.push(route.request().url());
      return route.abort();
    });
    await page.goto(origin + '/?thread=a');
    const draft = page.getByLabel('Message', { exact: true });
    await expect(draft).toBeEnabled();
    const textarea = await draft.elementHandle();
    assert.ok(textarea);
    await draft.fill('Retained sidecar draft');
    const panels = page.getByRole('region', { name: 'Sources', exact: true });
    await expect(panels).toHaveCount(2);
    const mixed = panels.first();
    const header = mixed.getByRole('button', { name: /^Sources \(/ });
    await expect(header).toHaveAccessibleName('Sources (3)');
    await header.click();
    await expect(
      mixed.getByRole('listitem').locator('.tp-citation-card__heading')
    ).toHaveText(['[1] Provider', '[1] Sidecar', '[4] javascript:blocked']);
    await mixed
      .getByRole('button', {
        name: 'Preview source 4: javascript:blocked',
        exact: true,
      })
      .click();
    const blocked = page.getByRole('dialog', { name: 'Source 4', exact: true });
    await expect(blocked.getByRole('link')).toHaveCount(0);
    await expect(blocked).not.toContainText('hidden snippet');
    await blocked.getByRole('button', { name: 'Close', exact: true }).click();
    const onlyHeader = panels
      .nth(1)
      .getByRole('button', { name: 'Sources (1)', exact: true });
    await onlyHeader.click();
    await panels
      .nth(1)
      .getByRole('button', {
        name: 'Preview source 1: Markdown only',
        exact: true,
      })
      .click();
    const only = page.getByRole('dialog', { name: 'Source 1', exact: true });
    await expect(only).toContainText('standalone snippet');
    await expect(only.getByRole('link')).toHaveAttribute('href', '/only');
    await only.getByRole('button', { name: 'Close', exact: true }).click();
    const item = await mixed.getByRole('listitem').nth(1).elementHandle();
    const trigger = await mixed
      .getByRole('button', { name: 'Preview source 1: Sidecar', exact: true })
      .elementHandle();
    assert.ok(item && trigger);
    await trigger.click();
    const card = page.getByRole('dialog', { name: 'Source 1', exact: true });
    await expect(card).toContainText('Sidecar snippet later');
    // Sending requires closing the modal; reopen while each held response is gated.
    await card.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(draft).toHaveValue('Retained sidecar draft');
    for (const index of [1, 2]) {
      await draft.fill(`Request ${index}`);
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      const step = backend.steps[index + 2];
      await step.received;
      await mixed
        .getByRole('button', {
          name:
            index === 1
              ? 'Preview source 1: Sidecar'
              : 'Preview source 1: Corrected',
          exact: true,
        })
        .click();
      const open = await card.elementHandle();
      assert.ok(open);
      step.releaseHeaders();
      if (index === 1) {
        await expect(card).toContainText('Corrected snippet later');
        await expect(card.getByRole('link')).toHaveAttribute(
          'href',
          '/corrected'
        );
        expect(
          await open.evaluate(
            (node) => node === document.querySelector('dialog[open]')
          )
        ).toBe(true);
        expect(await item.evaluate((node) => node.isConnected)).toBe(true);
        const corrected = mixed.getByRole('button', {
          name: 'Preview source 1: Corrected',
          exact: true,
        });
        expect(
          await corrected.evaluate(
            (node, retained) => node.closest('li') === retained,
            item
          )
        ).toBe(true);
        await card.getByRole('button', { name: 'Close', exact: true }).click();
      } else {
        // Baseline values remain interim until EOF accepts their canonical correction.
        await step.headersSent;
        await expect(card).toContainText('Corrected snippet later');
        expect(await open.evaluate((node) => node.isConnected)).toBe(true);
        expect(
          await mixed
            .getByRole('button', {
              name: 'Preview source 1: Corrected',
              exact: true,
            })
            .evaluate((node, retained) => node.closest('li') === retained, item)
        ).toBe(true);
        step.releaseBody();
        await step.closed;
        await expect(card).toHaveCount(0);
        expect(await item.evaluate((node) => node.isConnected)).toBe(false);
        expect(await open.evaluate((node) => node.isConnected)).toBe(false);
        await trigger.evaluate((node) => (node as HTMLButtonElement).click());
        await expect(card).toHaveCount(0);
        await expect(header).toHaveAccessibleName('Sources (2)');
      }
      await expect(header).toHaveAttribute('aria-expanded', 'true');
      if (index === 1) step.releaseBody();
      await step.closed;
      await expect(draft).toBeEnabled();
      await expect(draft).toHaveValue('');
      await draft.fill('Retained sidecar draft');
      expect(
        await textarea.evaluate(
          (node) => node === document.querySelector('#message')
        )
      ).toBe(true);
      expect(backend.requests).toHaveLength(index + 3);
    }
    const retiredHeader = await header.elementHandle();
    assert.ok(retiredHeader);
    let previousTextarea = textarea;
    for (const [id, count] of [
      ['B', 7],
      ['A', 9],
    ] as const) {
      await page.evaluate((thread) => {
        const next = new URL(location.href);
        next.searchParams.set('thread', thread);
        history.pushState(null, '', next);
        dispatchEvent(new PopStateEvent('popstate'));
      }, id.toLowerCase());
      await backend.steps[count - 1].received;
      await expect(page.locator('.conversation-id')).toHaveText(
        `Conversation ID: ${id.toLowerCase()}`
      );
      await expect(
        panels.first().getByRole('button', { name: 'Sources (3)', exact: true })
      ).toHaveAttribute('aria-expanded', 'false');
      expect(backend.requests).toHaveLength(count);
      // The app keys its composer by conversation; selection owns a fresh draft.
      await expect(draft).toBeEnabled();
      await expect(draft).toHaveValue('');
      expect(await previousTextarea.evaluate((node) => node.isConnected)).toBe(
        false
      );
      const selectedTextarea = await draft.elementHandle();
      assert.ok(selectedTextarea);
      expect(
        await selectedTextarea.evaluate(
          (node, retired) => node !== retired,
          previousTextarea
        )
      ).toBe(true);
      previousTextarea = selectedTextarea;
      await draft.fill(`Draft for ${id}`);
      if (id === 'B')
        await panels
          .first()
          .getByRole('button', { name: 'Sources (3)', exact: true })
          .click();
      await expect(draft).toHaveValue(`Draft for ${id}`);
      expect(
        await selectedTextarea.evaluate(
          (node) => node === document.querySelector('#message')
        )
      ).toBe(true);
    }
    expect(await retiredHeader.evaluate((node) => node.isConnected)).toBe(
      false
    );
    await retiredHeader.evaluate((node) => (node as HTMLButtonElement).click());
    await expect(
      panels.first().getByRole('button', { name: 'Sources (3)', exact: true })
    ).toHaveAttribute('aria-expanded', 'false');
    await expect(draft).toHaveValue('Draft for A');
    expect(
      await previousTextarea.evaluate(
        (node) => node === document.querySelector('#message')
      )
    ).toBe(true);
    expect(errors).toEqual([]);
    expect(sourceRequests).toEqual([]);
    backend.verify();
  } finally {
    await page.close();
    await server?.close();
    await backend.close();
  }
});
