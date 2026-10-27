import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Client } from '@langchain/langgraph-sdk';
import { HttpAgent } from '@ag-ui/client';

// Synthetic wire fixtures only. Production adapter/conformance suites remain
// authoritative for reduction, execution ownership, interrupts, and recovery.
async function response(name) {
  const bytes = new Uint8Array(await readFile(new URL(`./traces/${name}`, import.meta.url)));
  let offset = 0;
  return new Response(new ReadableStream({
    pull(controller) {
      if (offset === bytes.length) return controller.close();
      const end = Math.min(offset + 3, bytes.length);
      controller.enqueue(bytes.slice(offset, end));
      offset = end;
    },
  }), { headers: { 'content-type': 'text/event-stream' } });
}

test('LangGraph SDK decodes the synthetic delta/canonical trace across split UTF-8 chunks', async () => {
  const requests = [];
  const client = new Client({
    apiUrl: 'https://parity.invalid',
    callerOptions: {
      maxRetries: 0,
      fetch: async (url, init) => {
        requests.push({ url: String(url), body: JSON.parse(init.body) });
        return response('langgraph-text-state.sse');
      },
    },
  });
  const events = [];
  for await (const event of client.runs.stream('thread-parity', 'parity', {
    input: { messages: [{ role: 'user', content: 'Say hello.' }] },
    streamMode: ['messages', 'values'],
  })) events.push(event);
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/threads\/thread-parity\/runs\/stream$/);
  assert.deepEqual(requests[0].body.input.messages, [{ role: 'user', content: 'Say hello.' }]);
  const deltas = events.filter(event => event.event === 'messages');
  assert.equal(deltas.map(event => event.data[0].content).join(''), 'Hello 🌍.');
  const final = events.findLast(event => event.event === 'values');
  assert.equal(final.data.messages[0].content, 'Hello 🌍.');
  assert.equal(final.data.messages[0].id, 'message-parity');
  assert.equal(final.data.stage, 'complete');
});

test('AG-UI client completes the synthetic text/state trace without duplicate messages', async () => {
  const requests = [];
  const source = new HttpAgent({
    url: 'https://parity.invalid/agent',
    threadId: 'thread-parity',
    fetch: async (url, init) => {
      requests.push({ url: String(url), body: JSON.parse(init.body) });
      return response('ag-ui-text-state.sse');
    },
  });
  await source.runAgent({ runId: 'run-parity' });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.threadId, 'thread-parity');
  assert.equal(source.isRunning, false);
  assert.deepEqual(source.messages, [{ id: 'message-parity', role: 'assistant', content: 'Hello 🌍.' }]);
  assert.deepEqual(source.state, { stage: 'complete' });
});
