import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createMarkdown,
  type MarkdownDocument,
} from '@threadplane/content/markdown';
import { createSession, type LangGraphSession } from '@threadplane/langgraph';
import { createApplication } from './application.js';
import { createThreadDirectory } from './directory.js';
import { startProofServer, threadEnvelope } from '../tooling/proof-server.mjs';

const saved = (id: string, content: string) => [
  {
    values: { messages: [{ id: 'same-message', type: 'ai', content }] },
    next: [],
    tasks: [],
    checkpoint: {
      thread_id: id,
      checkpoint_ns: '',
      checkpoint_id: 'checkpoint',
    },
    parent_checkpoint: null,
    metadata: { source: 'input', step: 0, parents: {} },
    created_at: '2026-09-28T00:00:00.000Z',
  },
];
const history = (id: string, content: string) => ({
  method: 'POST',
  path: `/api/threads/${id}/history`,
  payload: { limit: 10 },
  body: saved(id, content),
});
const lookup = (id: string) => ({
  method: 'GET',
  path: `/api/threads/${id}`,
  body: threadEnvelope(id),
});
async function until(predicate: () => boolean) {
  const end = Date.now() + 4000;
  while (!predicate()) {
    assert.ok(
      Date.now() < end,
      'Expected application notification before deadline'
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
function workCounter() {
  const created: MarkdownDocument[] = [];
  const updated: MarkdownDocument[] = [];
  let disposed = 0;
  const factory: typeof createMarkdown = (document, options) => {
    assert.deepEqual(options, { violationPolicy: 'rebuild' });
    created.push(document);
    const owner = createMarkdown(document, options);
    return {
      ...owner,
      update(next) {
        updated.push(next);
        owner.update(next);
      },
      dispose() {
        disposed++;
        owner.dispose();
      },
    };
  };
  return {
    factory,
    created,
    updated,
    get disposed() {
      return disposed;
    },
  };
}
type App = ReturnType<typeof createApplication>;
function assertDocuments(app: App) {
  const state = app.getSnapshot();
  assert.equal(state.messages.length, state.runtime?.messages.length);
  state.messages.forEach((row, index) => {
    const message = state.runtime!.messages[index];
    assert.strictEqual(row.message, message);
    assert.equal(row.id, message.id);
    assert.equal(row.role, message.role);
    assert.deepEqual(row.markdown.document, {
      content: message.content,
      generation: message.delivery.generation,
      phase: message.delivery.phase,
    });
    assert.ok(Object.isFrozen(row));
    assert.ok(Object.isFrozen(row.markdown));
    assert.equal('update' in row, false);
    assert.equal('dispose' in row, false);
  });
}

test(
  'markdown application ownership follows real history notifications and isolates reused message IDs across selected sessions',
  { timeout: 10000 },
  async (t) => {
    const server = await startProofServer([
      {
        method: 'POST',
        path: '/api/threads/search',
        payload: { limit: 50, offset: 0 },
        body: [],
        concurrentGroup: 'start',
      },
      { ...lookup('a'), concurrentGroup: 'start' },
      history('a', '# Saved A'),
      lookup('b'),
      history('b', '# Saved A'),
      lookup('a'),
      history('a', '# Saved A'),
    ]);
    const work = workCounter();
    let sessions = 0;
    let url = server.origin + '/chat?thread=a';
    const app = createApplication({
      assistantId: 'assistant',
      apiUrl: server.origin + '/api',
      directory: createThreadDirectory({
        apiBase: server.origin + '/api',
        browserOrigin: server.origin,
      }),
      history: {
        currentUrl: () => url,
        push(next) {
          url = next;
        },
        subscribe: () => () => {},
      },
      markdownFactory: work.factory,
      sessionFactory(id) {
        sessions++;
        return createSession({
          assistantId: 'assistant',
          threadId: id,
          apiUrl: server.origin + '/api',
          clientOptions: { maxRetries: 0 },
        });
      },
    });
    t.after(async () => {
      app.dispose();
      await server.close();
    });
    const initial = app.getSnapshot();
    let release = app.subscribe(() => {
      app.getSnapshot();
    });
    release();
    release = app.subscribe(() => {});
    assert.strictEqual(app.getSnapshot(), initial);
    assert.deepEqual(
      [
        work.created.length,
        work.updated.length,
        work.disposed,
        sessions,
        server.requests.length,
      ],
      [0, 0, 0, 0, 0]
    );
    app.start();
    await until(() => app.getSnapshot().selection.status === 'ready');
    assertDocuments(app);
    assert.equal(work.created.length, 1);
    assert.equal(work.updated.length, 0);
    const retained = app.getSnapshot();
    const bytes = JSON.stringify(retained.messages);
    const counts = [
      work.created.length,
      work.updated.length,
      work.disposed,
      sessions,
      server.requests.length,
    ];
    release();
    release = app.subscribe(() => {});
    for (let i = 0; i < 5; i++) assert.strictEqual(app.getSnapshot(), retained);
    assert.deepEqual(
      [
        work.created.length,
        work.updated.length,
        work.disposed,
        sessions,
        server.requests.length,
      ],
      counts
    );
    release();
    app.select('b');
    assert.deepEqual(app.getSnapshot().messages, []);
    assert.equal(work.disposed, 1);
    await until(() => app.getSnapshot().selection.status === 'ready');
    assertDocuments(app);
    const replacement = app.getSnapshot().messages[0].markdown;
    assert.deepEqual(
      replacement.document,
      retained.messages[0].markdown.document
    );
    assert.notStrictEqual(replacement, retained.messages[0].markdown);
    app.select('a');
    await until(() => app.getSnapshot().selection.status === 'ready');
    assert.notStrictEqual(app.getSnapshot().messages[0].markdown, replacement);
    assert.equal(work.created.length, 3);
    const current = app.getSnapshot();
    app.dispose();
    app.dispose();
    assert.equal(work.disposed, 3);
    assert.strictEqual(app.getSnapshot(), current);
    assert.equal(JSON.stringify(retained.messages), bytes);
    assert.equal(
      app.getSnapshot().messages[0].markdown.document.content,
      '# Saved A'
    );
    server.verify();
  }
);

test(
  'markdown application processes real stream notifications and history replacement while views are detached',
  { timeout: 10000 },
  async (t) => {
    const server = await startProofServer([
      {
        method: 'POST',
        path: '/api/threads/search',
        payload: { limit: 50, offset: 0 },
        body: [],
        concurrentGroup: 'start',
      },
      { ...lookup('a'), concurrentGroup: 'start' },
      history('a', '# Saved'),
      {
        method: 'POST',
        path: '/api/threads/a/runs/stream',
        assertPayload(payload) {
          assert.equal(
            (payload as { assistant_id: string }).assistant_id,
            'assistant'
          );
        },
        holdBody: true,
        events: [
          {
            event: 'messages',
            data: [
              { type: 'AIMessageChunk', id: 'answer', content: '**Hello' },
              {},
            ],
          },
          {
            event: 'messages',
            data: [{ type: 'AIMessageChunk', id: 'answer', content: '**' }, {}],
          },
          {
            event: 'values',
            data: {
              messages: [
                {
                  type: 'ai',
                  id: 'answer',
                  content: '# Canonical',
                  tool_calls: [{ id: 'call', name: 'lookup', args: {} }],
                },
                {
                  type: 'tool',
                  id: 'result',
                  tool_call_id: 'call',
                  name: 'lookup',
                  content: 'Found',
                },
              ],
            },
          },
        ],
      },
      history('a', '> History replacement'),
    ]);
    const work = workCounter();
    let session!: LangGraphSession;
    const app = createApplication({
      assistantId: 'assistant',
      apiUrl: server.origin + '/api',
      directory: createThreadDirectory({
        apiBase: server.origin + '/api',
        browserOrigin: server.origin,
      }),
      history: {
        currentUrl: () => server.origin + '/chat?thread=a',
        push() {},
        subscribe: () => () => {},
      },
      markdownFactory: work.factory,
      sessionFactory(id) {
        session = createSession({
          assistantId: 'assistant',
          threadId: id,
          apiUrl: server.origin + '/api',
          clientOptions: { maxRetries: 0 },
        });
        return session;
      },
    });
    t.after(async () => {
      app.dispose();
      await server.close();
    });
    app.start();
    await until(() => app.getSnapshot().selection.status === 'ready');
    assertDocuments(app);
    const savedSnapshot = app.getSnapshot().messages;
    const bytes = JSON.stringify(savedSnapshot);
    const observed: ReturnType<App['getSnapshot']>[] = [];
    const release = app.subscribe(() => {
      observed.push(app.getSnapshot());
    });
    assert.equal(app.submit('Say hello'), true);
    await until(
      () =>
        app
          .getSnapshot()
          .runtime?.messages.some((message) => message.id === 'result') ?? false
    );
    assertDocuments(app);
    const answer = app
      .getSnapshot()
      .messages.find((row) => row.id === 'answer')!;
    assert.equal(answer.markdown.document.content, '# Canonical');
    assert.equal(answer.markdown.document.phase, 'streaming');
    assert.equal(answer.toolCalls[0].name, 'lookup');
    assert.equal(answer.toolCalls[0].status, 'complete');
    const result = app
      .getSnapshot()
      .messages.find((row) => row.role === 'tool')!;
    assert.equal(result.message.toolCallId, 'call');
    assert.equal(result.markdown.document.content, 'Found');
    assert.strictEqual(
      answer.toolCalls[0],
      app.getSnapshot().runtime!.toolCalls[0]
    );
    assert.ok(
      observed.some((state) =>
        state.messages.some(
          (row) => row.markdown.document.content === '**Hello'
        )
      )
    );
    assert.ok(
      observed.some((state) =>
        state.messages.some(
          (row) => row.markdown.document.content === '**Hello**'
        )
      )
    );
    release();
    server.steps[3].releaseBody();
    await until(() => !app.getSnapshot().submission.active);
    assertDocuments(app);
    const finished = app
      .getSnapshot()
      .messages.find((row) => row.id === 'answer')!;
    assert.deepEqual(finished.markdown.document, {
      ...answer.markdown.document,
      phase: 'complete',
    });
    assert.notStrictEqual(finished.markdown, answer.markdown);
    assert.equal(answer.markdown.document.phase, 'streaming');
    assert.ok(
      work.updated.some((document) => document.content === '**Hello**')
    );
    const beforeLoad = app.getSnapshot();
    await session.load!();
    assertDocuments(app);
    assert.equal(app.getSnapshot().messages.length, 1);
    assert.equal(
      app.getSnapshot().messages[0].markdown.document.content,
      '> History replacement'
    );
    assert.ok(work.disposed > 0);
    assert.equal(JSON.stringify(savedSnapshot), bytes);
    assert.equal(
      beforeLoad.messages.find((row) => row.id === 'answer')!.markdown.document
        .content,
      '# Canonical'
    );
    const latest = app.getSnapshot();
    const counts = [work.created.length, work.updated.length, work.disposed];
    const reacquired = app.subscribe(() => {});
    assert.strictEqual(app.getSnapshot(), latest);
    reacquired();
    assert.deepEqual(
      [work.created.length, work.updated.length, work.disposed],
      counts
    );
    server.verify();
  }
);
