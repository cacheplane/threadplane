import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { serveRuntimeConsumer } from './runtime-consumer.mjs';

const runBody = (message) => ({
  assistant_id: 'fixture-assistant',
  input: {
    messages: [{ id: 'new-user', type: 'human', content: message }],
    client_tools: [
      { name: 'weather', description: 'Current weather' },
      { name: 'count', description: 'Count values' },
    ],
  },
  stream_mode: ['values', 'messages-tuple', 'updates', 'custom'],
  stream_subgraphs: true, stream_resumable: true, on_disconnect: 'continue',
});
const post = (server, path, body, signal) => fetch(`${server.url}/api/threads/${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal,
});

test('example owner replaces locally, preserves same-thread identity and closes permanently', async () => {
  const source = readFileSync(new URL('../../fixtures/react-parity/runtime/thread-owner.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  const { createThreadOwner } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
  const created = [];
  const disposed = [];
  const owner = createThreadOwner((id) => {
    created.push(id);
    return { dispose: async () => { disposed.push(id); } };
  });
  const a = owner.selected;
  assert.equal(Object.isFrozen(a), true);
  assert.equal(owner.select('thread-a'), a);
  assert.deepEqual(created, ['thread-a']);
  assert.deepEqual(disposed, []);
  const b = owner.select('thread-b');
  assert.equal(owner.selected, b);
  assert.equal(b.generation, 2);
  assert.deepEqual(disposed, ['thread-a']);
  assert.equal(a.id, 'thread-a');
  const restored = owner.select('thread-a');
  assert.notEqual(restored.session, a.session);
  assert.equal(restored.generation, 3);
  await owner.dispose();
  assert.equal(owner.select('thread-b'), restored);
  assert.deepEqual(created, ['thread-a', 'thread-b', 'thread-a']);
  assert.deepEqual(disposed, ['thread-a', 'thread-b', 'thread-a']);
});

test('thread review isolates exact history/run routes and observes aborts of pending work', { timeout: 10000 }, async () => {
  const server = await serveRuntimeConsumer('/unused');
  try {
    const saved = await post(server, 'thread-a/history', { limit: 10 });
    assert.equal(saved.status, 200);
    const history = await saved.json();
    assert.equal(history[0].checkpoint.thread_id, 'thread-a');
    assert.deepEqual(history[0].values, {
      selected: 'thread-a', messages: [{ id: 'thread-a-saved', type: 'ai', content: 'Saved A' }],
    });
    const streamAbort = new AbortController();
    const stream = await post(server, 'thread-a/runs/stream', runBody('Hold A'), streamAbort.signal);
    assert.equal(stream.status, 200);
    const reader = stream.body.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value), /A partial/);
    streamAbort.abort();
    await server.threads.streamAborted;
    const pendingAbort = new AbortController();
    const pending = post(server, 'thread-a/history', { limit: 10 }, pendingAbort.signal).catch(() => undefined);
    await server.threads.historyStarted;
    pendingAbort.abort();
    await server.threads.historyAborted;
    await pending;
    const b = await post(server, 'thread-b/history', { limit: 10 });
    assert.equal((await b.json())[0].values.messages[0].content, 'Saved B');
    const run = await post(server, 'thread-b/runs/stream', runBody('Send B'));
    assert.match(await run.text(), /B complete/);
    assert.deepEqual(server.threads.requests.map(({ thread, operation }) => [thread, operation]), [
      ['thread-a', 'history'], ['thread-a', 'runs/stream'], ['thread-a', 'history'],
      ['thread-b', 'history'], ['thread-b', 'runs/stream'],
    ]);
    assert.deepEqual(server.requests, []);
    assert.deepEqual(server.historyRequests, []);
    assert.deepEqual(server.errors, []);
  } finally { await server.close(); }
});

test('thread review rejects extra run fields and misrouted prompts', async () => {
  const server = await serveRuntimeConsumer('/unused');
  try {
    for (const body of [{ ...runBody('Send B'), config: {} }, runBody('Hold A')]) {
      const response = await post(server, 'thread-b/runs/stream', body);
      assert.equal(response.status, 500);
      await response.text();
    }
    assert.equal(server.errors.length, 2);
    assert.deepEqual(server.threads.requests, []);
  } finally { await server.close(); }
});
