import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import * as runtime from './runtime-consumer.mjs';

const versions = { react: '19.2.4', 'react-dom': '19.2.4', '@types/react': '19.2.14', '@types/react-dom': '19.2.3', vite: '7.3.1', typescript: '5.9.3' };
const applicationState = { model: 'gpt-5-mini', reasoning_effort: 'minimal', gen_ui_mode: 'a2ui', itinerary: [{ id: 'paris', day: 1, place: 'Paris', note: 'Check the weather' }] };
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
  const submit = { assistant_id: 'fixture-assistant', input: { ...applicationState, messages: [{ id: 'user', type: 'human', content: 'Tool' }], client_tools: catalog }, stream_mode: ['values', 'messages-tuple', 'updates', 'custom'], stream_subgraphs: true, stream_resumable: true, on_disconnect: 'continue' };
  assert.match(runtime.runtimeResponse(submit), /call-weather/);
  const continuation = { ...submit, input: { client_tools: catalog, messages: [{ id: 'client-tool-result-call-weather', type: 'tool', role: 'tool', tool_call_id: 'call-weather', content: '{"city":"Paris","temperature":20}' }] } };
  assert.match(runtime.runtimeResponse(continuation), /20 degrees/);
  assert.throws(() => runtime.runtimeResponse({ ...continuation, input: { ...continuation.input, messages: [{ ...continuation.input.messages[0], content: 'fake result' }] } }), /result/);
  assert.throws(() => runtime.runtimeResponse({ ...submit, input: { ...submit.input, client_tools: [] } }), /catalog/);
  assert.throws(() => runtime.runtimeResponse({ ...submit, command: { resume: 'unexpected' } }), /unexpected run fields/);
  assert.throws(() => runtime.runtimeResponse({ ...submit, input: { client_tools: catalog, messages: [{ id: 'user', type: 'human', content: 'Unexpected' }] } }), /Unexpected/);
});

test('successive submitted turns receive distinct server message IDs', () => {
  const body = (id) => ({ assistant_id: 'fixture-assistant', input: { messages: [{ id, type: 'human', content: 'Send' }], client_tools: [{ name: 'weather', description: 'Current weather' }, { name: 'count', description: 'Count values' }] }, stream_mode: ['values', 'messages-tuple', 'updates', 'custom'], stream_subgraphs: true, stream_resumable: true, on_disconnect: 'continue' });
  const first = runtime.runtimeResponse(body('first'));
  const second = runtime.runtimeResponse(body('second'));
  assert.notEqual(first, second);
  assert.match(first, /Hello/);
  assert.match(second, /Hello/);
});

const heldBody = { assistant_id: 'fixture-assistant', input: { messages: [{ id: 'held-user', type: 'human', content: 'Hold' }], client_tools: [{ name: 'weather', description: 'Current weather' }, { name: 'count', description: 'Count values' }] }, stream_mode: ['values', 'messages-tuple', 'updates', 'custom'], stream_subgraphs: true, stream_resumable: true, on_disconnect: 'continue' };

for (const label of ['Tool', 'Drop']) {
  test(`${label} rejects an initial submission with no application state`, () => {
    const body = { ...heldBody, input: { ...heldBody.input, messages: [{ id: 'state-user', type: 'human', content: label }] } };
    assert.throws(() => runtime.runtimeResponse(body), /unexpected run fields/);
  });
  test(`${label} requires exact root application state only on its initial submission`, () => {
    const input = { ...applicationState, messages: [{ id: 'state-user', type: 'human', content: label }], client_tools: heldBody.input.client_tools };
    const body = { ...heldBody, input };
    assert.doesNotThrow(() => runtime.runtimeResponse(body));
    for (const key of Object.keys(applicationState)) {
      const missing = { ...input };
      delete missing[key];
      assert.throws(() => runtime.runtimeResponse({ ...body, input: missing }), /unexpected run fields/, `missing ${key}`);
      assert.throws(() => runtime.runtimeResponse({ ...body, input: { ...input, [key]: 'wrong' } }), /unexpected run fields/, `changed ${key}`);
    }
    assert.throws(() => runtime.runtimeResponse({ ...body, input: { ...input, extra: true } }), /unexpected run fields/);
    assert.throws(() => runtime.runtimeResponse({ ...body, input: { messages: input.messages, client_tools: input.client_tools, state: applicationState } }), /unexpected run fields/, 'no nested state wrapper');
    assert.throws(() => runtime.runtimeResponse({ ...body, state: applicationState }), /unexpected run fields/, 'no root state wrapper');
  });
}

test('application state cannot replay on tool continuation, a later Send, or resume', () => {
  const toolMessage = { id: 'client-tool-result-call-weather', type: 'tool', role: 'tool', tool_call_id: 'call-weather', content: '{"city":"Paris","temperature":20}' };
  for (const message of [toolMessage, { id: 'later-user', type: 'human', content: 'Send' }]) {
    const body = { ...heldBody, input: { client_tools: heldBody.input.client_tools, messages: [message] } };
    assert.doesNotThrow(() => runtime.runtimeResponse(body));
    assert.throws(() => runtime.runtimeResponse({ ...body, input: { ...applicationState, ...body.input } }), /unexpected run fields/);
  }
  const resume = { ...heldBody, input: null, command: { resume: { 'final-approval': true } } };
  assert.doesNotThrow(() => runtime.runtimeResponse(resume));
  assert.throws(() => runtime.runtimeResponse({ ...resume, state: applicationState }), /exact resume run fields/);
  assert.throws(() => runtime.runtimeResponse({ ...resume, input: applicationState }));
});

test('Drop reconnect joins the exact run and cursor, then confirms status without another POST', async () => {
  const server = await runtime.serveRuntimeConsumer(tmpdir());
  try {
    const body = { ...heldBody, stream_resumable: true, on_disconnect: 'continue', input: { ...applicationState, ...heldBody.input, messages: [{ id: 'drop-user', type: 'human', content: 'Drop' }] } };
    const created = await fetch(`${server.url}/api/threads/fixture-thread/runs/stream`, { method: 'POST', body: JSON.stringify(body) });
    assert.equal(created.status, 200);
    assert.equal(created.headers.get('content-location'), '/threads/fixture-thread/runs/drop-run');
    const initial = await created.text();
    assert.match(initial, /id: 2\n/);
    assert.match(initial, /Dropped partial/);
    assert.match(initial, /event: values/);
    const runUrl = `${server.url}/api/threads/fixture-thread/runs/drop-run`;
    assert.deepEqual(await (await fetch(runUrl)).json(), { run_id: 'drop-run', thread_id: 'fixture-thread', status: 'running' });
    const joined = await fetch(`${runUrl}/stream?cancel_on_disconnect=0`, { headers: { 'Last-Event-ID': '2' } });
    assert.equal(joined.status, 200);
    const suffix = await joined.text();
    assert.match(suffix, /id: 3\n/);
    assert.match(suffix, /Dropped partial recovered/);
    assert.deepEqual(await (await fetch(runUrl)).json(), { run_id: 'drop-run', thread_id: 'fixture-thread', status: 'success' });
    assert.equal(server.requests.length, 1);
    assert.equal(server.historyRequests.length, 0);
    assert.deepEqual(server.joinRequests, [{ runId: 'drop-run', lastEventId: '2' }]);
    assert.deepEqual(server.statusRequests, ['running', 'success']);
    assert.deepEqual(server.errors, []);
  } finally { await server.close(); }
});

test('reconnect fixture rejects a wrong cursor and cannot invent a known run before Drop', async () => {
  const server = await runtime.serveRuntimeConsumer(tmpdir());
  try {
    const runUrl = `${server.url}/api/threads/fixture-thread/runs/drop-run`;
    assert.equal((await fetch(runUrl)).status, 500);
    const body = { ...heldBody, stream_resumable: true, on_disconnect: 'continue', input: { ...applicationState, ...heldBody.input, messages: [{ id: 'drop-user', type: 'human', content: 'Drop' }] } };
    const created = await fetch(`${server.url}/api/threads/fixture-thread/runs/stream`, { method: 'POST', body: JSON.stringify(body) });
    assert.equal(created.status, 200);
    await created.text();
    assert.equal((await fetch(`${runUrl}/stream?cancel_on_disconnect=0`, { headers: { 'Last-Event-ID': '1' } })).status, 500);
    assert.deepEqual(server.joinRequests, []);
    assert.deepEqual(server.statusRequests, []);
    assert.equal(server.errors.length, 2);
  } finally { await server.close(); }
});

test('explicit resume maps use null input, re-pause, and complete the same assistant message', () => {
  const base = { ...heldBody, input: null };
  const first = runtime.runtimeResponse({ ...base, command: { resume: { 'live-approval': 'yes', 'live-confirmation': false } } });
  assert.match(first, /"id":"final-approval"/);
  assert.match(first, /"content":"One final approval"/);
  const second = runtime.runtimeResponse({ ...base, command: { resume: { 'final-approval': true } } });
  assert.match(second, /"content":"Approvals complete"/);
  assert.match(second, /"stage":"approved"/);
  const parse = (trace) => trace.trim().split('\n\n').map((event) => JSON.parse(event.match(/^data: (.*)/m)[1]));
  const firstMessages = parse(first).flatMap((event) => event.messages ?? []);
  const secondMessages = parse(second).flatMap((event) => event.messages ?? []);
  assert.equal(firstMessages.at(-1).id, secondMessages.at(-1).id);
  assert.ok([...firstMessages, ...secondMessages].every((message) => message.type === 'ai'), 'resume creates no synthetic human message');
  for (const body of [
    { ...base, command: { resume: { 'live-approval': 'yes' } } },
    { ...base, command: { resume: { 'final-approval': false } } },
    { ...base, command: { resume: { 'final-approval': true }, update: {} } },
    { ...base, input: { messages: [] }, command: { resume: { 'final-approval': true } } },
  ]) assert.throws(() => runtime.runtimeResponse(body));
});

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
    assert.deepEqual(saved[0].tasks.flatMap((task) => task.interrupts), [
      { id: 'saved-approval', value: { question: 'Approve saved request?', choices: ['yes', 'no'] }, namespace: ['review', 'task-1'], when: 'during', resumable: true, ns: ['legacy-review'] },
      { id: 'saved-confirmation', value: 0, namespace: [], when: 'during', resumable: false, ns: [] },
    ]);
    assert.deepEqual(saved[0].values.messages.at(-1).content, [{ type: 'text', text: 'Saved final answer' }]);
    assert.deepEqual(await (await read()).json(), saved);
    assert.deepEqual(await (await read()).json(), []);
    assert.deepEqual(server.historyRequests, [{ limit: 10 }, { limit: 10 }, { limit: 10 }]);
    assert.equal(server.requests.length, 0);
    assert.deepEqual(server.errors, []);
  } finally { await server.close(); }
});

test('text fixture retains root application state while exercising only ignored interrupt lookalikes', () => {
  const body = { ...heldBody, input: { ...heldBody.input, messages: [{ id: 'user', type: 'human', content: 'Send' }] } };
  const trace = runtime.runtimeResponse(body);
  assert.match(trace, /"stage":"complete"/);
  assert.match(trace, /event: values\|child/);
  assert.match(trace, /event: updates/);
  assert.match(trace, /event: custom/);
  assert.match(trace, /"__interrupt__":\[\]/);
  const events = trace.trim().split('\n\n').map((event) => ({ type: event.match(/^event: (.*)/m)?.[1], data: JSON.parse(event.match(/^data: (.*)/m)?.[1] ?? '{}') }));
  assert.ok(events.every((event) => event.type !== 'values' || !Object.hasOwn(event.data, '__interrupt__')));
});

test('Pause contains separate values and updates controls with full SDK payloads and retained application values', () => {
  const body = { ...heldBody, input: { ...heldBody.input, messages: [{ id: 'pause-user', type: 'human', content: 'Pause' }] } };
  const trace = runtime.runtimeResponse(body);
  const events = trace.trim().split('\n\n').map((event) => ({ type: event.match(/^event: (.*)/m)?.[1], data: JSON.parse(event.match(/^data: (.*)/m)?.[1] ?? '{}') }));
  assert.deepEqual(events.map((event) => event.type), ['values', 'values', 'updates']);
  assert.equal(events[0].data.stage, 'approval');
  assert.equal(events[0].data.messages.at(-1).content, 'Waiting for approvals');
  assert.deepEqual(events.slice(1).flatMap((event) => event.data.__interrupt__), [
    { id: 'live-approval', value: { question: 'Approve action?', choices: ['yes', 'no'] }, namespace: ['review', 'live'], when: 'during', resumable: true, ns: ['legacy-live'] },
    { id: 'live-confirmation', value: false, namespace: [], when: 'during', resumable: false, ns: [] },
  ]);
  assert.equal(events[1].data.stage, 'control-envelope');
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
