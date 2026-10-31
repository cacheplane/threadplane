import { test } from './fixtures';
import { expect } from '@playwright/test';
import assert from 'node:assert/strict';

test('installed React checkpoint timeline inspects loaded occurrences through a held response', async ({
  page,
  retainedConsumer,
}, testInfo) => {
  const { startProofServer, threadEnvelope } = await import(
    '../tooling/proof-server.mjs'
  );
  const { startCheckedServer } = await import('../tooling/retained-build.mjs');
  const key = 'checkpoint-timeline-proof-key';
  const literalId = '<checkpoint>duplicate</checkpoint>';
  const literalTime = '<time>literal timestamp</time>';
  const literalParent = '<parent>literal parent</parent>';
  const literalNext = '<next>literal next</next>';
  const longNamespace = '<namespace>' + 'x'.repeat(550) + '</namespace>';
  const saved = [
    { id: 'saved-answer', type: 'ai', content: 'Saved timeline answer' },
  ];
  const rows = [
    threadEnvelope('a', 'Conversation A'),
    threadEnvelope('b', 'Conversation B'),
  ];
  const entry = (checkpoint: unknown, extra = {}) => ({
    values: { messages: saved, privateValue: 'RAW_VALUES_MUST_STAY_HIDDEN' },
    tasks: [{ id: 'raw-task', name: 'RAW_TASKS_MUST_STAY_HIDDEN' }],
    checkpoint,
    parent_checkpoint: null,
    next: [],
    metadata: { source: 'input', step: 0, parents: {} },
    created_at: '2026-09-30T00:00:00.000Z',
    ...extra,
  });
  const history = [
    entry(
      {
        thread_id: 'a',
        checkpoint_id: literalId,
        checkpoint_ns: longNamespace,
      },
      {
        created_at: literalTime,
        parent_checkpoint: { checkpoint_id: literalParent },
        next: [literalNext, ''],
      }
    ),
    entry({ thread_id: 'a', checkpoint_id: literalId, checkpoint_ns: '' }),
    entry(
      { thread_id: 'a' },
      { created_at: null, parent_checkpoint: {}, next: [42] }
    ),
    entry(
      { thread_id: 'a', checkpoint_id: '', checkpoint_ns: false },
      {
        created_at: '',
        parent_checkpoint: { checkpoint_id: '' },
        next: null,
      }
    ),
    entry(
      { thread_id: 'a' },
      { created_at: '<missing>second missing occurrence</missing>' }
    ),
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
      holdBody: true,
      events: [
        {
          event: 'values',
          data: {
            messages: [
              ...saved,
              { id: 'new-answer', type: 'ai', content: 'New timeline answer' },
            ],
          },
        },
      ],
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
    await expect(transcript).toContainText('Saved timeline answer');
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
    const details = page.locator('details.loaded-checkpoint-timeline');
    const toggle = details.locator('summary');
    const list = details.getByRole('list', {
      name: 'Loaded checkpoints',
      exact: true,
    });
    const selected = details.getByRole('region', {
      name: 'Selected checkpoint metadata',
      exact: true,
    });
    const retained = async (value: string, requestCount: number) => {
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
      expect(backend.requests).toHaveLength(requestCount);
    };
    await expect(details).not.toHaveAttribute('open');
    await expect(selected).toHaveCount(0);
    await toggle.click();
    await expect(list).toHaveJSProperty('tagName', 'OL');
    await expect(list.getByRole('listitem')).toHaveCount(5);
    await expect(list.locator('[aria-current]')).toHaveCount(0);
    const buttons = list.getByRole('button');
    await expect(buttons).toHaveText([
      '1Checkpoint 1' + literalId,
      '2Checkpoint 2' + literalId,
      '3Checkpoint 3Checkpoint ID unavailable',
      '4Checkpoint 4Checkpoint ID empty',
      '5Checkpoint 5Checkpoint ID unavailable',
    ]);
    const pick = async (index: number, activation: 'Enter' | 'Space') => {
      const button = list.getByRole('button', {
        name: new RegExp(`^Checkpoint ${index + 1} `),
      });
      await button.focus();
      await button.press(activation);
      await expect(selected).toBeVisible();
      await expect(button).toHaveAttribute('aria-current', 'true');
      await expect(list.locator('[aria-current="true"]')).toHaveCount(1);
    };
    await pick(0, 'Enter');
    await expect(selected.locator('dd')).toHaveText([
      literalId,
      longNamespace.slice(0, 512),
      literalTime,
      literalParent,
      literalNext + ', Empty next-node name',
    ]);
    await expect(selected).toContainText(
      'Metadata truncated for display; showing up to 10 next-node names.'
    );
    expect(await selected.textContent()).not.toContain(longNamespace);
    await retained('Continue this conversation.', 3);
    await page.evaluate(() => (document.documentElement.dir = 'rtl'));
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true);
      for (const locator of [selected, ...(await buttons.all())]) {
        const box = await locator.boundingBox();
        assert.ok(box);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
      await page.screenshot({
        path: testInfo.outputPath(`checkpoint-timeline-rtl-${width}.png`),
        fullPage: true,
      });
    }
    await pick(1, 'Space');
    await expect(selected.locator('dd')).toHaveText([
      literalId,
      'Root namespace (empty)',
      '2026-09-30T00:00:00.000Z',
      'No parent checkpoint',
      'No next nodes',
    ]);
    await pick(2, 'Enter');
    await expect(selected.locator('dd')).toHaveText([
      'Checkpoint ID unavailable',
      'Namespace unavailable',
      'Created timestamp unavailable',
      'Parent checkpoint ID unavailable',
      'Next nodes unavailable',
    ]);
    await pick(3, 'Space');
    await expect(selected.locator('dd')).toHaveText([
      'Checkpoint ID empty',
      'Namespace unavailable',
      'Created timestamp empty',
      'Parent checkpoint ID empty',
      'Next nodes unavailable',
    ]);
    await pick(4, 'Enter');
    await expect(selected).toContainText(
      '<missing>second missing occurrence</missing>'
    );
    await expect(
      details.locator(
        'checkpoint, namespace, time, parent, next, missing, script'
      )
    ).toHaveCount(0);
    expect(await selected.textContent()).not.toMatch(
      /RAW_VALUES|RAW_TASKS|Saved timeline answer/
    );
    await expect(
      details.getByRole('button', { name: /replay|fork|execute|resume/i })
    ).toHaveCount(0);
    await toggle.click();
    await retained('Continue this conversation.', 3);
    await draft.press('Control+Enter');
    await backend.steps[3].received;
    await expect(transcript).toContainText('New timeline answer');
    await expect(draft).toBeDisabled();
    await expect(
      page.getByText('Response in progress…', { exact: true })
    ).toBeVisible();
    const activeDraft = await draft.inputValue();
    retainedTranscript = await transcript.innerHTML();
    await toggle.click();
    await expect(selected).toContainText(
      '<missing>second missing occurrence</missing>'
    );
    await pick(0, 'Space');
    await toggle.click();
    await toggle.click();
    await expect(selected).toContainText(literalParent);
    await retained(activeDraft, 4);
    await expect(
      page.getByText('Response in progress…', { exact: true })
    ).toBeVisible();
    backend.steps[3].releaseBody();
    expect((await backend.steps[3].closed).finished).toBe(true);
    await expect(
      page.getByText('Response complete.', { exact: true })
    ).toBeVisible();
    await expect(draft).toBeEnabled();
    await expect(transcript).toContainText('New timeline answer');
    await retained(activeDraft, 4);
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
    await expect(selected).toHaveCount(0);
    await toggle.click();
    await expect(details).toContainText('No checkpoints in the loaded page.');
    await expect(list).toHaveCount(0);
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
