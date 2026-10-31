import { test } from './fixtures';
import { expect } from '@playwright/test';
import assert from 'node:assert/strict';

test('installed React observed state comparison preserves a held conversation', async ({
  page,
  retainedConsumer,
}, testInfo) => {
  const { startProofServer, threadEnvelope } = await import(
    '../tooling/proof-server.mjs'
  );
  const { startCheckedServer } = await import('../tooling/retained-build.mjs');
  const key = 'observed-state-comparison-proof-key';
  const literal =
    '<state><img src=x onerror="window.__stateInjected=true"></state>' +
    'x'.repeat(450);
  const saved = [
    { id: 'saved-answer', type: 'ai', content: 'Saved comparison answer' },
  ];
  const messages = [
    ...saved,
    { id: 'new-answer', type: 'ai', content: 'New comparison answer' },
  ];
  const before = {
    messages: saved,
    phase: 'before',
    removed: true,
    literal,
    items: ['saved'],
  };
  const after = {
    messages,
    phase: 'after',
    literal: literal + '<after>changed</after>',
    items: ['saved', 'next'],
    added: { value: 42 },
  };
  const rows = [
    threadEnvelope('a', 'Conversation A'),
    threadEnvelope('b', 'Conversation B'),
  ];
  rows[0].values = before;
  const history = [
    {
      values: before,
      tasks: [],
      checkpoint: {
        thread_id: 'a',
        checkpoint_id: 'saved-a',
        checkpoint_ns: '',
      },
      parent_checkpoint: null,
      next: [],
      metadata: { source: 'input', step: 0, parents: {} },
      created_at: '2026-09-30T00:00:00.000Z',
    },
  ];
  const backend = await startProofServer([
    {
      method: 'POST',
      path: '/api/threads/search',
      payload: { limit: 50, offset: 0 },
      body: rows,
    },
    { method: 'GET', path: '/api/threads/a', body: rows[0] },
    {
      method: 'POST',
      path: '/api/threads/a/history',
      payload: { limit: 10 },
      body: history,
    },
    {
      method: 'POST',
      path: '/api/threads/a/runs/stream',
      holdHeaders: true,
      holdBody: true,
      events: [{ event: 'values', data: after }],
      assertPayload(payload: unknown) {
        const id = (payload as { input: { messages: { id: string }[] } }).input
          .messages[0].id;
        assert.match(
          id,
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        );
        assert.deepEqual(payload, {
          assistant_id: 'assistant',
          input: {
            messages: [
              { type: 'human', id, content: 'Continue this conversation.' },
            ],
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
          stream_mode: [
            'values',
            'messages-tuple',
            'updates',
            'custom',
            'checkpoints',
          ],
          stream_subgraphs: true,
          stream_resumable: true,
          on_disconnect: 'continue',
        });
      },
    },
    { method: 'GET', path: '/api/threads/b', body: rows[1] },
    {
      method: 'POST',
      path: '/api/threads/b/history',
      payload: { limit: 10 },
      body: [],
    },
  ]);
  let server: Awaited<ReturnType<typeof startCheckedServer>> | undefined;
  const errors: string[] = [];
  const browserApiPaths: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    server = await startCheckedServer({
      retained: retainedConsumer,
      target: backend.origin + '/api',
      apiKey: key,
    });
    const origin = server.url;
    await page.route('**/*', (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin) {
        errors.push(`Unexpected external request: ${url}`);
        return route.abort();
      }
      expect(request.headers()['x-api-key']).toBeUndefined();
      expect(JSON.stringify(request.headers())).not.toContain(key);
      expect(request.postData() ?? '').not.toContain(key);
      expect(request.url()).not.toContain(key);
      if (url.pathname.startsWith('/api/')) browserApiPaths.push(url.pathname);
      return route.continue();
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(origin + '/?thread=a');
    const draft = page.getByRole('textbox', { name: 'Message', exact: true });
    const transcript = page.getByRole('region', {
      name: 'Conversation messages',
      exact: true,
    });
    await expect(transcript).toContainText('Saved comparison answer');
    await expect.poll(() => backend.requests.length).toBe(3);
    await draft.fill('Continue this conversation.');
    const draftNode = await draft.elementHandle();
    const transcriptNode = await transcript.elementHandle();
    const savedNode = await transcript
      .getByRole('article')
      .first()
      .elementHandle();
    assert.ok(draftNode && transcriptNode && savedNode);
    let retainedTranscript = await transcript.innerHTML();
    const url = page.url();
    const details = page.locator('details.observed-state-comparison');
    const toggle = details.locator('summary');
    const capture = details.getByRole('button', {
      name: 'Capture current state baseline',
      exact: true,
    });
    const clear = details.getByRole('button', {
      name: 'Clear baseline',
      exact: true,
    });
    const comparison = details.getByRole('region', {
      name: 'Observed baseline to current state',
      exact: true,
    });
    const json = comparison.getByLabel(
      'Observed baseline to current state JSON',
      { exact: true }
    );
    const retained = async (value: string, requests: number) => {
      expect(page.url()).toBe(url);
      await expect(page.locator('.conversation-id')).toHaveText(
        'Conversation ID: a'
      );
      await expect(
        page.getByRole('button', { name: 'Conversation A', exact: true })
      ).toHaveAttribute('aria-current', 'true');
      await expect(draft).toHaveValue(value);
      expect(
        await draftNode.evaluate(
          (node) => node === document.querySelector('#message')
        )
      ).toBe(true);
      expect(await transcriptNode.evaluate((node) => node.isConnected)).toBe(
        true
      );
      expect(await savedNode.evaluate((node) => node.isConnected)).toBe(true);
      expect(await transcript.innerHTML()).toBe(retainedTranscript);
      expect(backend.requests).toHaveLength(requests);
    };
    const noChanges = async () => {
      await expect(comparison).toContainText(
        'No changes in the supplied states.'
      );
      await expect(json).toHaveCount(0);
    };
    await expect(details).not.toHaveAttribute('open');
    await expect(comparison).toHaveCount(0);
    await toggle.click();
    await expect(clear).toBeDisabled();
    await capture.click();
    await noChanges();
    await retained('Continue this conversation.', 3);
    await clear.click();
    await expect(comparison).toHaveCount(0);
    await expect(details).toContainText('No observed baseline captured.');
    await capture.click();
    await toggle.click();
    await retained('Continue this conversation.', 3);

    // Normal submit changes the transcript. Capture its actual held epoch only
    // after POST receipt; comparison controls must preserve that epoch.
    await draft.press('Control+Enter');
    await backend.steps[3].received;
    await expect(draft).toBeDisabled();
    await expect(
      page.getByText('Response in progress…', { exact: true })
    ).toBeVisible();
    const heldDraft = await draft.inputValue();
    retainedTranscript = await transcript.innerHTML();
    await toggle.click();
    await clear.click();
    await capture.click();
    await noChanges();
    await toggle.click();
    await toggle.click();
    await retained(heldDraft, 4);
    await expect(
      page.getByText('Response in progress…', { exact: true })
    ).toBeVisible();

    backend.steps[3].releaseHeaders();
    await expect(transcript).toContainText('New comparison answer');
    await expect(json).toBeVisible();
    const expectedChanges = [
      { kind: 'changed', path: '/phase', before: 'before', after: 'after' },
      { kind: 'removed', path: '/removed', before: true },
      {
        kind: 'changed',
        path: '/literal',
        before: literal,
        after: after.literal,
      },
      {
        kind: 'changed',
        path: '/items',
        before: ['saved'],
        after: ['saved', 'next'],
      },
      { kind: 'added', path: '/added', after: { value: 42 } },
    ];
    expect(JSON.parse(await json.innerText())).toEqual(expectedChanges);
    await expect(
      page.getByText('Response in progress…', { exact: true })
    ).toBeVisible();
    retainedTranscript = await transcript.innerHTML();
    await toggle.click();
    await toggle.click();
    await retained(heldDraft, 4);
    backend.steps[3].releaseBody();
    expect((await backend.steps[3].closed).finished).toBe(true);
    await expect(
      page.getByText('Response complete.', { exact: true })
    ).toBeVisible();
    await expect(draft).toBeEnabled();
    expect(JSON.parse(await json.innerText())).toEqual(expectedChanges);
    await expect(json).toContainText('<state><img src=x onerror=');
    await expect(details.locator('state, img, after, script')).toHaveCount(0);
    expect(
      await page.evaluate(() => Reflect.get(window, '__stateInjected'))
    ).toBeUndefined();
    await page.evaluate(() => (document.documentElement.dir = 'rtl'));
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true);
      const box = await json.boundingBox();
      assert.ok(box);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(
        await json.evaluate((node) => node.scrollWidth <= node.clientWidth)
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`state-comparison-rtl-${width}.png`),
        fullPage: true,
      });
    }
    // Recapture and clear remain local after submit has settled too.
    const settledDraft = await draft.inputValue();
    retainedTranscript = await transcript.innerHTML();
    await clear.click();
    await expect(comparison).toHaveCount(0);
    await capture.click();
    await noChanges();
    await clear.click();
    await retained(settledDraft, 4);
    await expect(details).toContainText('No observed baseline captured.');
    await expect(details.locator('state, img, script')).toHaveCount(0);
    expect(
      await page.evaluate(() => Reflect.get(window, '__stateInjected'))
    ).toBeUndefined();
    await expect(
      details.getByRole('button', { name: /replay|fork|execute|resume/i })
    ).toHaveCount(0);
    expect(backend.requests).toHaveLength(4);
    await capture.click();
    await noChanges();
    await page
      .getByRole('button', { name: 'Conversation B', exact: true })
      .click();
    await expect(page).toHaveURL(/thread=b/);
    await expect(page.locator('.conversation-id')).toHaveText(
      'Conversation ID: b'
    );
    await expect(draft).toHaveValue('');
    expect(await draftNode.evaluate((node) => node.isConnected)).toBe(false);
    await expect(details).not.toHaveAttribute('open');
    await toggle.click();
    await expect(capture).toBeDisabled();
    await expect(clear).toBeDisabled();
    await expect(details).toContainText(
      'Current observed state is unavailable.'
    );
    await expect(comparison).toHaveCount(0);
    expect(await details.textContent()).not.toMatch(
      /before|after|Saved comparison answer|New comparison answer|saved-a|<state>/
    );
    await expect.poll(() => backend.requests.length).toBe(6);
    backend.verify();
    expect(browserApiPaths).toEqual(
      backend.requests.map((request) => request.path)
    );
    for (const request of backend.requests)
      expect(request.headers['x-api-key']).toBe(key);
    for (const step of backend.steps)
      expect((await step.closed).finished).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await server?.close();
    await backend.close();
  }
});
