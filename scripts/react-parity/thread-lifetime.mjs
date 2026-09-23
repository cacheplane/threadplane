import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

const sse = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const gate = () => {
  let resolve;
  return { promise: new Promise((done) => { resolve = done; }), resolve: () => resolve() };
};

/** Independent, bounded wire oracle for two fixed thread identities. */
export function createThreadRoutes() {
  const requests = [];
  const streamStarted = gate();
  const streamAborted = gate();
  const historyStarted = gate();
  const historyAborted = gate();
  const held = new Set();
  const hold = (response, started, aborted) => {
    held.add(response);
    response.once('close', () => { held.delete(response); aborted.resolve(); });
    started.resolve();
  };
  return {
    requests,
    streamStarted: streamStarted.promise, streamAborted: streamAborted.promise,
    historyStarted: historyStarted.promise, historyAborted: historyAborted.promise,
    async handle(request, response, pathname) {
      const match = /^\/api\/threads\/(thread-[ab])\/(history|runs\/stream)$/.exec(pathname);
      if (!match) return false;
      assert.equal(request.method, 'POST');
      const [, thread, operation] = match;
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      if (operation === 'history') {
        assert.deepEqual(body, { limit: 10 });
        const previous = requests.filter((r) => r.thread === thread && r.operation === operation).length;
        assert.ok(previous < 2, 'two explicit history loads per thread');
        requests.push({ thread, operation, body });
        if (thread === 'thread-a' && previous === 1) {
          hold(response, historyStarted, historyAborted);
          return true;
        }
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify([{
          values: { selected: thread, messages: [{ id: `${thread}-saved`, type: 'ai', content: thread === 'thread-a' ? 'Saved A' : 'Saved B' }] },
          next: [], tasks: [], metadata: {}, parent_checkpoint: null,
          checkpoint: { thread_id: thread, checkpoint_ns: '', checkpoint_id: `${thread}-checkpoint`, checkpoint_map: {} },
          created_at: '2026-09-22T00:00:00Z',
        }]));
        return true;
      }
      const message = body.input?.messages?.[0];
      assert.equal(typeof message?.id, 'string');
      assert.ok(message.id.length > 0);
      assert.deepEqual(body, {
        assistant_id: 'fixture-assistant',
        input: {
          messages: [{ id: message.id, type: 'human', content: thread === 'thread-a' ? 'Hold A' : 'Send B' }],
          client_tools: [{ name: 'weather', description: 'Current weather' }, { name: 'count', description: 'Count values' }],
        },
        stream_mode: ['values', 'messages-tuple', 'updates', 'custom'],
        stream_subgraphs: true, stream_resumable: true, on_disconnect: 'continue',
      });
      assert.ok(!requests.some((r) => r.thread === thread && r.operation === operation), 'one run per thread');
      requests.push({ thread, operation, body });
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      if (thread === 'thread-a') {
        hold(response, streamStarted, streamAborted);
        response.write(sse('values', { selected: thread, transient: true })
          + sse('messages', [{ type: 'AIMessageChunk', id: 'a-answer', content: 'A partial' }, { langgraph_node: 'assistant' }]));
      } else {
        response.end(sse('values', { selected: thread, messages: [{ id: 'b-answer', type: 'ai', content: 'B complete' }] }));
      }
      return true;
    },
    close() { for (const response of held) response.destroy(); },
  };
}

async function handshake(promise, label) {
  let timeout;
  try {
    await Promise.race([promise, new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`Timed out awaiting ${label}`)), 10000);
    })]);
  } finally { clearTimeout(timeout); }
}

/** Run on an already monitored page; every selected identity starts inert. */
export async function runThreadScenarios(page, server) {
  await page.goto(`${server.url}/?threads`);
  const click = (name) => page.getByRole('button', { name, exact: true }).click();
  const field = (id) => page.getByTestId(`thread-${id}`);
  const fresh = async (id, generation) => {
    await expect(field('id')).toHaveText(id);
    await expect(field('generation')).toHaveText(String(generation));
    await expect(field('status')).toHaveText('idle');
    await expect(field('text')).toHaveText('');
    await expect(field('values')).toHaveText('unobserved');
    await expect(field('history')).toHaveText('unobserved');
    await expect(field('load')).toHaveText('unobserved');
  };
  await fresh('thread-a', 1);
  assert.equal(server.threads.requests.length, 0, 'selection/mount performs no I/O');
  await click('Load selected');
  await expect(field('text')).toHaveText('Saved A');
  await expect(field('load')).toHaveText('loaded');
  await click('Run selected');
  await expect(field('status')).toHaveText('running');
  await expect(field('text')).toContainText('A partial');
  await click('Select B');
  await fresh('thread-b', 2);
  await handshake(server.threads.streamAborted, 'outgoing stream abort');
  assert.equal(server.threads.requests.length, 2, 'switching performs no load or submit');
  await click('Load selected');
  await expect(field('text')).toHaveText('Saved B');
  await click('Run selected');
  await expect(field('text')).toContainText('B complete');
  await expect(field('status')).toHaveText('idle');
  await expect(field('outcome')).toHaveText('success');
  const before = await field('text').textContent();
  await click('Select B');
  await expect(field('generation')).toHaveText('2');
  await expect(field('text')).toHaveText(before);
  assert.equal(server.threads.requests.length, 4, 'same thread is a no-op');
  await click('Select A');
  await fresh('thread-a', 3);
  await click('Load selected');
  await expect(field('load')).toHaveText('loading');
  await handshake(server.threads.historyStarted, 'pending history request');
  await click('Select B');
  await fresh('thread-b', 4);
  await handshake(server.threads.historyAborted, 'outgoing history abort');
  assert.equal(server.threads.requests.length, 5);
  await click('Load selected');
  await expect(field('text')).toHaveText('Saved B');
  await expect(field('load')).toHaveText('loaded');
  await click('Dispose selected');
  await expect(field('owner')).toHaveText('disposed');
  await click('Run selected');
  await expect(field('outcome')).toHaveText('aborted');
  await click('Select A');
  await expect(field('id')).toHaveText('thread-b');
  await expect(field('generation')).toHaveText('4');
  assert.deepEqual(server.threads.requests.map(({ thread, operation }) => [thread, operation]), [
    ['thread-a', 'history'], ['thread-a', 'runs/stream'],
    ['thread-b', 'history'], ['thread-b', 'runs/stream'],
    ['thread-a', 'history'], ['thread-b', 'history'],
  ]);
  assert.deepEqual(server.errors, []);
  return ['fixed-thread selection and explicit loading', 'switch during streaming', 'same-thread identity', 'fresh session on return', 'switch during history read', 'permanent owner disposal'];
}
