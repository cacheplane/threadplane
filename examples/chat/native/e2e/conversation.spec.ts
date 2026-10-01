import { expect, test } from '@playwright/test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
let threadEnvelope: typeof import('../tooling/proof-server.mjs').threadEnvelope;

const search = (body: unknown = [], extra = {}) => ({
  method: 'POST',
  path: '/api/threads/search',
  payload: { limit: 50, offset: 0 },
  body,
  ...extra,
});
const lookup = (id: string, extra = {}) => ({
  method: 'GET',
  path: `/api/threads/${id}`,
  body: threadEnvelope(id, 'Garden notes'),
  ...extra,
});
const history = (id: string, messages: unknown[] = []) => ({
  method: 'POST',
  path: `/api/threads/${id}/history`,
  payload: { limit: 10 },
  body: [
    {
      values: { messages },
      next: [],
      tasks: [],
      checkpoint: { thread_id: id, checkpoint_ns: '', checkpoint_id: 'saved' },
      parent_checkpoint: null,
      metadata: { source: 'input', step: 0, parents: {} },
      created_at: '2026-09-28T00:00:00.000Z',
    },
  ],
});
// Independent wire expectation; do not derive this from the authored catalog.
const expectedClientTools = [
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
];
const run = (text: string, events: unknown[], extra = {}) => ({
  method: 'POST',
  path: '/api/threads/garden/runs/stream',
  events,
  ...extra,
  assertPayload(payload: any) {
    const id = payload.input.messages[0].id;
    assert.match(
      id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    assert.deepEqual(payload, {
      assistant_id: 'assistant',
      input: {
        messages: [{ type: 'human', id, content: text }],
        client_tools: expectedClientTools,
      },
      stream_mode: ['values', 'messages-tuple', 'updates', 'custom'],
      stream_subgraphs: true,
      stream_resumable: true,
      on_disconnect: 'continue',
    });
  },
});
const answer = [
  {
    event: 'values',
    data: {
      messages: [{ type: 'ai', id: 'answer', content: 'Water gently.' }],
    },
  },
];

test('basic conversation: loaded views, exact submission, honest outcomes and browser lifetime', async ({
  page,
}, testInfo) => {
  const { startServe } = await import('../tooling/serve.mjs');
  const { selectedFramework } = await import('../tooling/commands.mjs');
  const framework = selectedFramework(testInfo.project.metadata.framework);
  const proof = await import('../tooling/proof-server.mjs');
  const { startProofServer } = proof;
  threadEnvelope = proof.threadEnvelope;
  const rows = [
    threadEnvelope('garden', 'Garden notes'),
    threadEnvelope('missing', 'Older notes'),
    threadEnvelope('failed', 'Travel notes'),
  ];
  const server = await startProofServer([
    search(rows),
    lookup('garden', { holdHeaders: true }),
    history('garden', [
      { id: 'human', type: 'human', content: 'What should I plant?' },
      {
        id: 'saved',
        type: 'ai',
        content:
          '# Planting plan\n\n- Basil\n- Mint\n\n| Plant | Light |\n| --- | --- |\n| Basil | Sun |\n\n$x+y$ [^source]',
        tool_calls: [
          { id: 'call', name: 'lookup', args: { query: '<b>herbs</b>' } },
        ],
      },
      {
        id: 'tool-result',
        type: 'tool',
        tool_call_id: 'call',
        name: 'lookup',
        content: '<b>literal result</b>',
      },
    ]),
    search([]),
    search([threadEnvelope('garden', 'Garden harvest')]),
    run('  Which herbs grow well?\nKeep it brief.  ', answer),
    run(
      'Tell me more about watering.',
      [
        ...answer,
        {
          event: 'values|research:one',
          data: {
            messages: [
              {
                type: 'ai',
                id: 'answer',
                content: '<script>Background literal</script>',
                tool_calls: [
                  {
                    id: 'child-only',
                    name: 'show_trip_summary',
                    args: { title: 'Child must not execute', days: [] },
                    type: 'tool_call',
                  },
                ],
              },
            ],
          },
        },
        {
          event: 'values|research:two|writer:nested',
          data: {
            messages: [
              { type: 'ai', id: 'answer', content: 'Nested background.' },
            ],
          },
        },
        {
          event: 'values|research:pending',
          data: {
            __interrupt__: [{ id: 'child-response', value: 'Respond?' }],
          },
        },
        {
          event: 'error|research:failed',
          data: {
            error: 'ChildFailure',
            message: 'PRIVATE background diagnostic',
          },
        },
      ],
      { holdBody: true }
    ),
    run('What about winter?', [
      { event: 'error', data: { message: 'hostile-body-secret' } },
    ]),
    run('Plan the next step.', [
      {
        event: 'values',
        data: { __interrupt__: [{ id: 'question', value: 'Continue?' }] },
      },
    ]),
    lookup('garden'),
    history('garden'),
    run('Explain the sunlight.', [
      { event: 'custom', data: { progress: 'Waiting' } },
    ]),
    history('garden'),
    {
      method: 'POST',
      path: '/api/threads',
      payload: { metadata: {} },
      status: 503,
    },
    search([], { status: 503 }),
    search(rows),
    lookup('missing', { status: 404 }),
    lookup('missing'),
    history('missing'),
    lookup('failed', { status: 503 }),
    lookup('failed'),
    history('failed'),
    {
      method: 'POST',
      path: '/api/threads',
      payload: { metadata: {} },
      body: threadEnvelope('new', 'New garden'),
    },
    lookup('new'),
    history('new'),
    search([]),
    search([], { holdHeaders: true }),
  ]);
  const reservation = http.createServer();
  await new Promise<void>((done) => reservation.listen(0, '127.0.0.1', done));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((done) => reservation.close(() => done()));
  const logs: string[] = [];
  const supervisor = startServe({
    root: resolve(__dirname, '../../../../'),
    options: {
      framework,
      configuration: 'development',
      assistantId: 'assistant',
      port,
    },
    env: { ...process.env, NATIVE_LANGGRAPH_URL: server.origin + '/api' },
    log: (line: string) => logs.push(line),
  });
  void supervisor.closed.catch(() => {});
  const errors: string[] = [];
  const consoleErrors: { text: string; url: string }[] = [];
  const failedResponses: { path: string; status: number }[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error')
      consoleErrors.push({ text: message.text(), url: message.location().url });
  });
  page.on('response', (response) => {
    if (response.status() >= 400)
      failedResponses.push({
        path: new URL(response.url()).pathname,
        status: response.status(),
      });
  });
  const origins = new Set<string>();
  page.on('request', (request) => origins.add(new URL(request.url()).origin));
  try {
    const { url } = await supervisor.ready;
    await page.route('**/*', (route) => {
      if (new URL(route.request().url()).origin === new URL(url).origin)
        return route.continue();
      errors.push('Blocked external request: ' + route.request().url());
      return route.abort();
    });
    await page.goto(url);
    await expect(
      page.getByRole('heading', { name: 'Loaded conversations' })
    ).toBeVisible();
    await expect(
      page.getByText('Select a conversation or start a new one.')
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Send', exact: true })
    ).toBeDisabled();
    await page
      .getByRole('button', { name: 'Garden notes', exact: true })
      .click();
    await expect(page.getByText('Loading conversation…')).toBeVisible();
    server.steps[1].releaseHeaders();
    await expect(
      page.getByRole('heading', { name: 'Planting plan' })
    ).toBeVisible();
    await expect(
      page.getByRole('cell', { name: 'Basil', exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('listitem').filter({ hasText: /^Mint$/ })
    ).toBeVisible();
    await expect(
      page.getByText('<b>literal result</b>', { exact: true }).first()
    ).toBeVisible();
    expect(await page.locator('b').count()).toBe(0);
    await expect(
      page.getByText('$x+y$ [^source]', { exact: true })
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('restored.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(
      page.getByRole('cell', { name: 'Basil', exact: true })
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath('restored-mobile.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    const filter = page.getByRole('searchbox', {
      name: 'Filter loaded conversations by title',
    });
    await filter.fill('Travel');
    await expect(
      page.getByRole('button', { name: 'Garden notes', exact: true })
    ).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'Planting plan' })
    ).toBeVisible();
    await filter.fill('');
    const draft = page.getByRole('textbox', { name: 'Message', exact: true });
    await draft.fill('Keep this draft while refreshing.');
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(
      page.getByText('No loaded conversations match.')
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Planting plan' })
    ).toBeVisible();
    await expect(draft).toHaveValue('Keep this draft while refreshing.');
    const selectedUrl = page.url();
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.locator('h1#conversation-title')).toHaveText(
      'Garden harvest'
    );
    await expect(
      page.getByRole('button', { name: 'Garden harvest', exact: true })
    ).toBeVisible();
    await expect(draft).toHaveValue('Keep this draft while refreshing.');
    expect(page.url()).toBe(selectedUrl);
    await expect(
      page.getByRole('heading', { name: 'Planting plan' })
    ).toBeVisible();
    await expect(
      page.getByText('What should I plant?', { exact: true })
    ).toBeVisible();
    await draft.fill('   \n  ');
    await expect(
      page.getByRole('button', { name: 'Send', exact: true })
    ).toBeDisabled();
    await draft.press('Control+Enter');
    await expect(draft).toHaveValue('   \n  ');
    await draft.fill('First line');
    await draft.press('Enter');
    await expect(draft).toHaveValue('First line\n');
    await draft.fill('  Which herbs grow well?\nKeep it brief.  ');
    await draft.dispatchEvent('keydown', {
      key: 'Enter',
      ctrlKey: true,
      isComposing: true,
    });
    await expect(draft).toHaveValue(
      '  Which herbs grow well?\nKeep it brief.  '
    );
    expect(server.requests).toHaveLength(5);
    await draft.press('Meta+Enter');
    await expect(
      page.getByText('Response complete.', { exact: true })
    ).toBeVisible();
    await expect(draft).toHaveValue('');
    await draft.fill('Tell me more about watering.');
    await draft.press('Control+Enter');
    await expect(
      page.getByRole('button', { name: 'Stop', exact: true })
    ).toBeEnabled();
    await expect(
      page.getByRole('button', { name: 'Send', exact: true })
    ).toBeDisabled();
    if (framework === 'react') {
      const background = page.getByRole('region', {
        name: 'Background activity',
        exact: true,
      });
      await expect(background).toBeVisible();
      await background.locator('summary').first().click();
      await expect(
        background.getByText('<script>Background literal</script>', {
          exact: true,
        })
      ).toBeVisible();
      expect(
        await page
          .getByRole('region', { name: 'Conversation messages', exact: true })
          .textContent()
      ).not.toContain('Background literal');
      await expect(
        page.getByText('Child must not execute', { exact: true })
      ).toHaveCount(0);
      await background.locator('summary').nth(1).click();
      await expect(
        background.getByText('Nested background.', { exact: true })
      ).toBeVisible();
      await background.locator('summary').nth(2).click();
      await expect(
        background.getByText(
          'Background work has requested a response. This example cannot respond here.',
          { exact: true }
        )
      ).toBeVisible();
      await expect(background.getByRole('button')).toHaveCount(0);
      await background.locator('summary').nth(3).click();
      await expect(
        background
          .locator('details')
          .nth(3)
          .getByText('The LangGraph request failed.', { exact: true })
      ).toBeVisible();
      expect(await page.locator('body').textContent()).not.toContain(
        'PRIVATE background diagnostic'
      );
      await page.evaluate(() => {
        const row = document.querySelector('.background-activity li');
        (window as unknown as { backgroundRow: Element | null }).backgroundRow =
          row;
      });
    }
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(
      page.getByText(
        'Response stopped locally. The server may still be running.',
        { exact: true }
      )
    ).toBeVisible();
    await expect
      .poll(async () => (await server.steps[6].closed).finished)
      .toBe(false);
    if (framework === 'react') {
      await expect(
        page.getByText('<script>Background literal</script>', { exact: true })
      ).toBeVisible();
      expect(
        await page.evaluate(
          () =>
            document.querySelector('.background-activity li') ===
            (window as unknown as { backgroundRow: Element | null })
              .backgroundRow
        )
      ).toBe(true);
    }
    for (const [text, outcome] of [
      ['What about winter?', 'The response failed.'],
      ['Plan the next step.', 'Response paused.'],
    ]) {
      await draft.fill(text);
      await draft.press('Control+Enter');
      await expect(page.getByText(outcome, { exact: true })).toBeVisible();
      if (framework === 'react') {
        await expect(
          page.getByRole('region', { name: 'Background activity', exact: true })
        ).toHaveCount(0);
      }
    }
    await expect(
      page.getByText(
        'This conversation is waiting for a response this example does not support.',
        { exact: true }
      )
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Approve request', exact: true })
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Decline request', exact: true })
    ).toHaveCount(0);
    await draft.fill('Keep this draft while reviewing the unsupported pause.');
    await expect(
      page.getByRole('button', { name: 'Send', exact: true })
    ).toBeDisabled();
    await draft.press('Control+Enter');
    await draft.press('Meta+Enter');
    await expect(draft).toHaveValue(
      'Keep this draft while reviewing the unsupported pause.'
    );
    expect(server.requests).toHaveLength(9);
    await page.goBack();
    await expect(
      page.getByText('Select a conversation or start a new one.', {
        exact: true,
      })
    ).toBeVisible();
    expect(server.requests).toHaveLength(9);
    await page.goForward();
    await expect(page.locator('.conversation-id')).toHaveText(
      'Conversation ID: garden'
    );
    await expect(draft).toBeEnabled();
    await expect(draft).toHaveValue('');
    await draft.fill('Explain the sunlight.');
    await draft.press('Control+Enter');
    await expect(
      page.getByText('Response interrupted before completion.', { exact: true })
    ).toBeVisible();
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await expect(
      page.getByText(
        'Creation could not be confirmed. A conversation may have been created; refresh before trying again.'
      )
    ).toBeVisible();
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(
      page.getByText('Could not refresh loaded conversations.')
    ).toBeVisible();
    await expect(
      page.getByText(/Creation could not be confirmed/)
    ).toBeVisible();
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await draft.fill('This draft belongs to Garden notes.');
    await page
      .getByRole('button', { name: 'Older notes', exact: true })
      .click();
    await expect(page.getByText('Conversation not found.')).toBeVisible();
    await expect(draft).toHaveValue('');
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(draft).toBeEnabled();
    await page
      .getByRole('button', { name: 'Travel notes', exact: true })
      .click();
    await expect(
      page.getByText('Could not load this conversation.')
    ).toBeVisible();
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(draft).toBeEnabled();
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await expect(page).toHaveURL(/thread=new/);
    await expect(draft).toBeEnabled();
    await page.evaluate(() => {
      window.dispatchEvent(
        new PageTransitionEvent('pagehide', { persisted: true })
      );
      window.dispatchEvent(
        new PageTransitionEvent('pageshow', { persisted: true })
      );
    });
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(
      page.getByText('No loaded conversations match.')
    ).toBeVisible();
    await draft.fill('How often should I water basil?');
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('button', { name: 'Send', exact: true })
    ).toBeFocused();
    expect(
      await page
        .locator(':focus')
        .evaluate((el) => getComputedStyle(el).outlineStyle)
    ).not.toBe('none');
    await page.screenshot({
      path: testInfo.outputPath('conversation.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath('mobile.png'),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect.poll(() => server.requests.length).toBe(27);
    await page.evaluate(() =>
      window.dispatchEvent(
        new PageTransitionEvent('pagehide', { persisted: false })
      )
    );
    await expect
      .poll(async () => (await server.steps[26].closed).finished)
      .toBe(false);
    server.verify();
    expect(errors).toEqual([]);
    expect(failedResponses).toEqual([
      { path: '/api/threads', status: 503 },
      { path: '/api/threads/search', status: 503 },
      { path: '/api/threads/missing', status: 404 },
      { path: '/api/threads/failed', status: 503 },
    ]);
    for (const error of consoleErrors) {
      const failure = failedResponses.find(
        (response) => new URL(error.url).pathname === response.path
      );
      expect(failure, error.text).toBeDefined();
      expect(error.text).toBe(
        `Failed to load resource: the server responded with a status of ${
          failure!.status
        } (${failure!.status === 404 ? 'Not Found' : 'Service Unavailable'})`
      );
    }
    expect([...origins]).toEqual([new URL(url).origin]);
    expect(await page.content()).not.toContain('hostile-body-secret');
  } finally {
    await supervisor.close();
    await server.close();
    writeFileSync(testInfo.outputPath('supervisor.log'), logs.join('\n'));
  }
});

test('production configuration required: no owner or network without an assistant', async ({
  page,
}, testInfo) => {
  const { selectedFramework } = await import('../tooling/commands.mjs');
  const { buildConsumer } = await import('../tooling/consumer.mjs');
  const { startCheckedServer } = await import('../tooling/retained-build.mjs');
  const { startProofServer } = await import('../tooling/proof-server.mjs');
  const framework = selectedFramework(testInfo.project.metadata.framework);
  const owned = mkdtempSync(join(tmpdir(), 'native-unconfigured-'));
  const backend = await startProofServer([]);
  let server: Awaited<ReturnType<typeof startCheckedServer>> | undefined;
  const errors: string[] = [],
    requests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', (request) => requests.push(request.url()));
  try {
    const assets = new Map<string, Buffer>();
    const built = await buildConsumer({
      root: resolve(__dirname, '../../../../'),
      framework,
      assistantId: '',
      output: join(owned, 'output'),
      temporaryParent: owned,
      capture({ bundle, provenance }: any) {
        for (const [path, expected] of Object.entries(provenance.outputs)) {
          const bytes = readFileSync(join(bundle.output, path));
          assert.equal(
            createHash('sha256').update(bytes).digest('hex'),
            expected
          );
          assets.set(path, bytes);
        }
      },
    });
    server = await startCheckedServer({
      target: backend.origin + '/api',
      retained: Object.freeze({
        outputs: Object.freeze([...assets.keys()]),
        readOutput(path: string) {
          return Buffer.from(assets.get(path)!);
        },
      }),
    });
    await page.goto(server.url + '/?thread=must-not-load');
    await expect(
      page.getByRole('heading', { name: 'Set up an assistant to begin' })
    ).toBeVisible();
    await expect(
      page.getByRole('textbox', { name: 'Message', exact: true })
    ).toHaveCount(0);
    await page.evaluate(() =>
      window.dispatchEvent(
        new PageTransitionEvent('pagehide', { persisted: false })
      )
    );
    expect(requests.every((url) => new URL(url).origin === server!.url)).toBe(
      true
    );
    expect(
      requests.filter((url) => new URL(url).pathname.startsWith('/api'))
    ).toEqual([]);
    backend.verify();
    expect(errors).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath('configuration-required.png'),
      fullPage: true,
    });
    writeFileSync(
      testInfo.outputPath('production-output-hashes.json'),
      JSON.stringify(built.provenance.outputs, null, 2)
    );
  } finally {
    await server?.close();
    await backend.close();
    rmSync(owned, { recursive: true, force: true });
  }
});
