import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import * as runtime from './runtime-consumer.mjs';

const versions = { react: '19.2.4', 'react-dom': '19.2.4', '@types/react': '19.2.14', '@types/react-dom': '19.2.3', vite: '7.3.1', typescript: '5.9.3' };
test('React consumer pins framework and compiler tooling from the actual lock', () => {
  assert.equal(typeof runtime.lockedReactManifest, 'function');
  const lock = { packages: Object.fromEntries(Object.entries(versions).map(([name, version]) => [`node_modules/${name}`, { version }])) };
  const manifest = runtime.lockedReactManifest(lock);
  assert.deepEqual({ ...manifest.dependencies, ...manifest.devDependencies }, versions);
  delete lock.packages['node_modules/react-dom'];
  assert.throws(() => runtime.lockedReactManifest(lock), /react-dom/);
});
test('tool trace requires a real serialized handler result before returning the final answer', () => {
  assert.equal(typeof runtime.runtimeResponse, 'function');
  const catalog = [{ name: 'weather', description: 'Current weather' }, { name: 'count', description: 'Count values' }];
  const submit = { assistant_id: 'fixture-assistant', input: { messages: [{ id: 'user', type: 'human', content: 'Tool' }], client_tools: catalog }, stream_mode: ['values', 'messages-tuple', 'updates', 'custom'], stream_subgraphs: true };
  assert.match(runtime.runtimeResponse(submit), /call-weather/);
  const continuation = { ...submit, input: { ...submit.input, messages: [{ id: 'client-tool-result-call-weather', type: 'tool', role: 'tool', tool_call_id: 'call-weather', content: '{"city":"Paris","temperature":20}' }] } };
  assert.match(runtime.runtimeResponse(continuation), /20 degrees/);
  assert.throws(() => runtime.runtimeResponse({ ...continuation, input: { ...continuation.input, messages: [{ ...continuation.input.messages[0], content: 'fake result' }] } }), /result/);
  assert.throws(() => runtime.runtimeResponse({ ...submit, input: { ...submit.input, client_tools: [] } }), /catalog/);
  assert.throws(() => runtime.runtimeResponse({ ...submit, command: { resume: 'unexpected' } }), /unexpected run fields/);
  assert.throws(() => runtime.runtimeResponse({ ...submit, input: { ...submit.input, messages: [{ id: 'user', type: 'human', content: 'Unexpected' }] } }), /Unexpected/);
});

test('successive submitted turns receive distinct server message IDs', () => {
  const body = (id) => ({ assistant_id: 'fixture-assistant', input: { messages: [{ id, type: 'human', content: 'Send' }], client_tools: [{ name: 'weather', description: 'Current weather' }, { name: 'count', description: 'Count values' }] }, stream_mode: ['values', 'messages-tuple', 'updates', 'custom'], stream_subgraphs: true });
  const first = runtime.runtimeResponse(body('first'));
  const second = runtime.runtimeResponse(body('second'));
  assert.notEqual(first, second);
  assert.match(first, /Hello/);
  assert.match(second, /Hello/);
});

const heldBody = { assistant_id: 'fixture-assistant', input: { messages: [{ id: 'held-user', type: 'human', content: 'Hold' }], client_tools: [{ name: 'weather', description: 'Current weather' }, { name: 'count', description: 'Count values' }] }, stream_mode: ['values', 'messages-tuple', 'updates', 'custom'], stream_subgraphs: true };
for (const ending of ['native abort', 'fixture cleanup']) {
  test(`held SSE delivers real bytes and closes on ${ending}`, { timeout: 10_000 }, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'r07-server-test-'));
    writeFileSync(join(directory, 'index.html'), '<p>Built fixture</p>');
    const server = await runtime.serveRuntimeConsumer(directory);
    let closed = false;
    const controller = new AbortController();
    try {
      assert.match(await (await fetch(server.url)).text(), /Built fixture/);
      const response = await fetch(`${server.url}/api/threads/fixture-thread/runs/stream`, { method: 'POST', body: JSON.stringify(heldBody), signal: controller.signal });
      await server.holdStarted;
      const reader = response.body.getReader();
      const first = await reader.read();
      assert.match(new TextDecoder().decode(first.value), /Held partial/);
      const rejected = assert.rejects(reader.read());
      if (ending === 'native abort') controller.abort();
      else { await server.close(); closed = true; }
      await rejected;
      await server.holdAborted;
      assert.equal(server.requests.length, 1);
      assert.deepEqual(server.errors, []);
    } finally {
      controller.abort();
      if (!closed) await server.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test('unexpected fixture HTTP operations are recorded instead of silently served', async () => {
  const server = await runtime.serveRuntimeConsumer(tmpdir());
  try {
    const response = await fetch(`${server.url}/api/threads/fixture-thread/state`, { method: 'POST', body: '{}' });
    assert.equal(response.status, 500);
    assert.equal(server.errors.length, 1);
    assert.equal(server.requests.length, 0);
  } finally { await server.close(); }
});

test('history uses the exact SDK body and counts reads separately from runs', async () => {
  const server = await runtime.serveRuntimeConsumer(tmpdir());
  try {
    const read = () => fetch(`${server.url}/api/threads/fixture-thread/history`, { method: 'POST', body: JSON.stringify({ limit: 10 }) });
    const first = await read();
    assert.equal(first.status, 200);
    const saved = await first.json();
    assert.equal(saved[0].values.stage, 'saved');
    assert.deepEqual(saved[0].values.profile, { name: 'Saved user' });
    assert.deepEqual(saved[0].values.messages.at(-1).content, [{ type: 'text', text: 'Saved final answer' }]);
    assert.deepEqual(await (await read()).json(), saved);
    assert.deepEqual(await (await read()).json(), []);
    assert.deepEqual(server.historyRequests, [{ limit: 10 }, { limit: 10 }, { limit: 10 }]);
    assert.equal(server.requests.length, 0);
    assert.deepEqual(server.errors, []);
  } finally { await server.close(); }
});

test('text fixture retains root application state while exercising ignored child and control data', () => {
  const body = { ...heldBody, input: { ...heldBody.input, messages: [{ id: 'user', type: 'human', content: 'Send' }] } };
  const trace = runtime.runtimeResponse(body);
  assert.match(trace, /"stage":"complete"/);
  assert.match(trace, /event: values\|child/);
  assert.match(trace, /event: updates/);
  assert.match(trace, /event: custom/);
  assert.match(trace, /"__interrupt__":\[\]/);
});

for (const [label, route, method, body] of [
  ['wrong thread', '/api/threads/other/history', 'POST', { limit: 10 }],
  ['wrong method', '/api/threads/fixture-thread/history', 'GET', undefined],
  ['missing limit', '/api/threads/fixture-thread/history', 'POST', {}],
  ['extra fields', '/api/threads/fixture-thread/history', 'POST', { limit: 10, before: 'unexpected' }],
]) {
  test(`history rejects ${label} without recording a valid read or run`, async () => {
    const server = await runtime.serveRuntimeConsumer(tmpdir());
    try {
      const response = await fetch(`${server.url}${route}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
      assert.equal(response.status, 500);
      assert.deepEqual(server.historyRequests, []);
      assert.deepEqual(server.requests, []);
      assert.equal(server.errors.length, 1);
    } finally { await server.close(); }
  });
}
