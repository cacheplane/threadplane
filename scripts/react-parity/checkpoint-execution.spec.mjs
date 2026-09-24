import assert from 'node:assert/strict';
import test from 'node:test';
import { serveRuntimeConsumer } from './runtime-consumer.mjs';

const ref = (id) => ({ thread_id: 'checkpoint-thread', checkpoint_ns: '', checkpoint_id: id, checkpoint_map: { '': id } });
const modes = ['values', 'messages-tuple', 'updates', 'custom', 'checkpoints'];
const body = (id, content) => ({
  assistant_id: 'fixture-assistant', checkpoint: ref(id),
  input: { messages: [{ id: `user-${content}`, type: 'human', content }], client_tools: [{ name: 'weather', description: 'Current weather' }, { name: 'count', description: 'Count values' }] },
  stream_mode: modes, stream_subgraphs: true, stream_resumable: true, on_disconnect: 'continue',
});
const send = (server, path, method = 'GET', value, headers) => fetch(`${server.url}/api/threads/checkpoint-thread/${path}`, { method, headers, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
const steps = [
  ['history', 'POST', { limit: 10 }],
  ['state/checkpoint', 'POST', { checkpoint: ref('A') }],
  ['runs/stream', 'POST', body('A', 'Fork A')],
  ['runs/run-A1'],
  ['state/checkpoint', 'POST', { checkpoint: ref('A1') }],
  ['runs/stream', 'POST', body('A1', 'Continue branch')],
  ['runs/run-A2'],
  ['state/checkpoint', 'POST', { checkpoint: ref('A2') }],
  ['state/checkpoint', 'POST', { checkpoint: ref('A2') }],
  ['state/checkpoint', 'POST', { checkpoint: ref('P') }],
  ['runs/stream', 'POST', body('A2', 'Drop branch')],
  ['runs/run-A3'],
  [`runs/run-A3/stream?cancel_on_disconnect=0&stream_mode=${encodeURIComponent(JSON.stringify(modes))}`, 'GET', undefined, { 'Last-Event-ID': 'drop-cursor' }],
  ['runs/run-A3'],
  ['state/checkpoint', 'POST', { checkpoint: ref('A3') }],
];
async function advance(server, count) {
  const responses = [];
  for (const step of steps.slice(0, count)) {
    const response = await send(server, ...step);
    const text = await response.text();
    assert.equal(response.status, 200, `${step[0]}: ${server.errors.map(String).join('; ')}`);
    responses.push(text);
  }
  return responses;
}

test('checkpoint wire fixture independently bounds complete fork, continuation, rejection and reconnect sequence', async () => {
  const server = await serveRuntimeConsumer('/unused');
  try {
    const responses = await advance(server, steps.length);
    assert.deepEqual(JSON.parse(responses[0]).map(state => state.checkpoint.checkpoint_id), ['B', 'A', 'P']);
    assert.equal(JSON.parse(responses[0])[0].values.messages[0].content, 'Global B');
    assert.match(responses[2], /event: checkpoints/);
    assert.equal(JSON.parse(responses[4]).values.stage, 'A1');
    assert.equal(JSON.parse(responses[7]).values.stage, 'A2');
    assert.deepEqual(JSON.parse(responses[9]).next, ['approval']);
    assert.equal(JSON.parse(responses[11]).status, 'running');
    assert.equal(JSON.parse(responses[13]).status, 'success');
    assert.equal(JSON.parse(responses[14]).values.stage, 'A3');
    server.checkpoints.assertComplete();
    assert.deepEqual(server.errors, []);
    assert.deepEqual(server.requests, []);
    assert.deepEqual(server.historyRequests, []);
    assert.equal((await send(server, 'runs/stream', 'POST', body('A3', 'Continue branch'))).status, 500);
    assert.equal(server.errors.length, 1);
  } finally { await server.close(); }
});

for (const [label, prefix, request] of [
  ['wrong source read', 1, ['state/checkpoint', 'POST', { checkpoint: ref('B') }]],
  ['missing routing', 2, ['runs/stream', 'POST', { ...body('A', 'Fork A'), checkpoint: undefined }]],
  ['wrong root map', 2, ['runs/stream', 'POST', { ...body('A', 'Fork A'), checkpoint: { ...ref('A'), checkpoint_map: {} } }]],
  ['missing checkpoint mode', 2, ['runs/stream', 'POST', { ...body('A', 'Fork A'), stream_mode: modes.slice(0, -1) }]],
  ['wrong catalog', 2, ['runs/stream', 'POST', { ...body('A', 'Fork A'), input: { ...body('A', 'Fork A').input, client_tools: [] } }]],
  ['continue routed to original A', 5, ['runs/stream', 'POST', body('A', 'Continue branch')]],
  ['continue routed to selected B', 5, ['runs/stream', 'POST', body('B', 'Continue branch')]],
  ['extra creation POST', 3, ['runs/stream', 'POST', body('A', 'Fork A')]],
  ['wrong join cursor', 12, [steps[12][0], 'GET', undefined, { 'Last-Event-ID': 'wrong' }]],
  ['missing join modes', 12, ['runs/run-A3/stream?cancel_on_disconnect=0', 'GET', undefined, { 'Last-Event-ID': 'drop-cursor' }]],
  ['wrong join modes', 12, [`runs/run-A3/stream?cancel_on_disconnect=0&stream_mode=${encodeURIComponent(JSON.stringify(modes.slice(0, -1)))}`, 'GET', undefined, { 'Last-Event-ID': 'drop-cursor' }]],
  ['wrong method', 0, ['history']],
]) {
  test(`checkpoint oracle rejects ${label} without advancing`, async () => {
    const server = await serveRuntimeConsumer('/unused');
    try {
      await advance(server, prefix);
      const response = await send(server, ...request);
      await response.text();
      assert.equal(response.status, 500);
      assert.equal(server.errors.length, 1);
      assert.equal(server.checkpoints.requests.length, prefix);
    } finally { await server.close(); }
  });
}
