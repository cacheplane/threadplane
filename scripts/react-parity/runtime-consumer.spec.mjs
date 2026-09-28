import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import * as runtime from './runtime-consumer.mjs';

test('shared view preparation copies the complete views without composing a private backend or declaration', (t) => {
  const consumer = mkdtempSync(join(tmpdir(), 'candidate-view-copy-'));
  t.after(() => rmSync(consumer, { recursive: true, force: true }));
  runtime.prepareRuntimeViews(process.cwd(), consumer, 'react');
  for (const name of ['main.tsx', 'react-app.tsx', 'react-threads.tsx', 'react-checkpoints.tsx', 'scenarios.ts', 'thread-owner.ts', 'tools.ts', 'review.css', 'vite.config.mts'])
    assert.equal(existsSync(join(consumer, name)), true, `shared ${name}`);
  assert.equal(existsSync(join(consumer, 'runtime-entry.js')), false, 'no private bundle');
  assert.equal(existsSync(join(consumer, 'runtime-entry.d.ts')), false, 'no surrogate declarations');
  assert.match(readFileSync(join(consumer, 'main.tsx'), 'utf8'), /checkpoints/);
  assert.match(readFileSync(join(consumer, 'main.tsx'), 'utf8'), /threads/);
});

const versions = { react: '19.2.4', 'react-dom': '19.2.4', '@types/react': '19.2.14', '@types/react-dom': '19.2.3', vite: '7.3.1', typescript: '5.9.3' };
const applicationState = { model: 'gpt-5-mini', reasoning_effort: 'minimal', gen_ui_mode: 'a2ui', itinerary: [{ id: 'paris', day: 1, place: 'Paris', note: 'Check the weather' }] };
const runSettings = { config: { tags: ['runtime-review'], recursion_limit: 50, configurable: { user_id: 'review-user' } }, context: { locale: 'en', features: ['memory'] }, metadata: { source: 'runtime-review' } };
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
  const submit = { ...runSettings, assistant_id: 'fixture-assistant', input: { ...applicationState, messages: [{ id: 'user', type: 'human', content: 'Tool' }], client_tools: catalog }, stream_mode: ['values', 'messages-tuple', 'updates', 'custom'], stream_subgraphs: true, stream_resumable: true, on_disconnect: 'continue' };
  assert.match(runtime.runtimeResponse(submit), /call-weather/);
  const continuation = { ...submit, input: { client_tools: catalog, messages: [{ id: 'client-tool-result-call-weather', type: 'tool', role: 'tool', tool_call_id: 'call-weather', content: '{"city":"Paris","temperature":20}' }] } };
  assert.match(runtime.runtimeResponse(continuation), /20 degrees/);
  assert.throws(() => runtime.runtimeResponse({ ...continuation, input: { ...continuation.input, messages: [{ ...continuation.input.messages[0], content: 'fake result' }] } }), /result/);
  assert.throws(() => runtime.runtimeResponse({ ...submit, input: { ...submit.input, client_tools: [] } }), /catalog/);
  assert.throws(() => runtime.runtimeResponse({ ...submit, command: { resume: 'unexpected' } }), /unexpected run fields/);
  const unexpected = { ...submit, input: { client_tools: catalog, messages: [{ id: 'user', type: 'human', content: 'Unexpected' }] } };
  for (const key of Object.keys(runSettings)) delete unexpected[key];
  assert.throws(() => runtime.runtimeResponse(unexpected), /Unexpected/);
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

test('execution settings are required for configured submits, tool continuations and explicit resumes only', () => {
  const messages = [
    { id: 'tool-user', type: 'human', content: 'Tool' },
    { id: 'drop-user', type: 'human', content: 'Drop' },
    { id: 'client-tool-result-call-weather', type: 'tool', role: 'tool', tool_call_id: 'call-weather', content: '{"city":"Paris","temperature":20}' },
  ];
  for (const message of messages) {
    const input = { ...heldBody.input, ...(message.type === 'human' ? applicationState : {}), messages: [message] };
    const body = { ...heldBody, ...runSettings, input };
    assert.doesNotThrow(() => runtime.runtimeResponse(body));
    for (const key of Object.keys(runSettings)) {
      const missing = { ...body }; delete missing[key];
      assert.throws(() => runtime.runtimeResponse(missing), /unexpected run fields/);
    }
  }
  const resume = { ...heldBody, ...runSettings, input: null, command: { resume: { 'final-approval': true } } };
  assert.doesNotThrow(() => runtime.runtimeResponse(resume));
  for (const key of Object.keys(runSettings)) {
    const missing = { ...resume }; delete missing[key];
    assert.throws(() => runtime.runtimeResponse(missing), /exact resume run fields/);
  }
  assert.throws(() => runtime.runtimeResponse({ ...heldBody, ...runSettings }), /unexpected run fields/);
});

test('Tool observes same-ID siblings and a protected child failure without another root tool', () => {
  const trace = runtime.runtimeResponse({ ...heldBody, ...runSettings, input: { ...applicationState, ...heldBody.input, messages: [{ id: 'tool-user', type: 'human', content: 'Tool' }] } });
  assert.match(trace, /event: values\|research:one\n/);
  assert.match(trace, /event: values\|research:two\|writer:nested\n/);
  assert.equal(trace.match(/"id":"child-answer"/g)?.length, 2);
  assert.match(trace, /"id":"child-only-call"/);
  assert.match(trace, /event: error\|research:failed\n/);
});

for (const label of ['Tool', 'Drop']) {
  test(`${label} rejects an initial submission with no application state`, () => {
    const body = { ...heldBody, ...runSettings, input: { ...heldBody.input, messages: [{ id: 'state-user', type: 'human', content: label }] } };
    assert.throws(() => runtime.runtimeResponse(body), /unexpected run fields/);
  });
  test(`${label} requires exact root application state only on its initial submission`, () => {
    const input = { ...applicationState, messages: [{ id: 'state-user', type: 'human', content: label }], client_tools: heldBody.input.client_tools };
    const body = { ...heldBody, ...runSettings, input };
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
    const body = { ...heldBody, ...(message.type === 'tool' ? runSettings : {}), input: { client_tools: heldBody.input.client_tools, messages: [message] } };
    assert.doesNotThrow(() => runtime.runtimeResponse(body));
    assert.throws(() => runtime.runtimeResponse({ ...body, input: { ...applicationState, ...body.input } }), /unexpected run fields/);
  }
  const resume = { ...heldBody, ...runSettings, input: null, command: { resume: { 'final-approval': true } } };
  assert.doesNotThrow(() => runtime.runtimeResponse(resume));
  assert.throws(() => runtime.runtimeResponse({ ...resume, state: applicationState }), /exact resume run fields/);
  assert.throws(() => runtime.runtimeResponse({ ...resume, input: applicationState }));
});

test('Drop reconnect joins the exact run and cursor, then confirms status without another POST', async () => {
  const server = await runtime.serveRuntimeConsumer(tmpdir());
  try {
    const body = { ...heldBody, ...runSettings, stream_resumable: true, on_disconnect: 'continue', input: { ...applicationState, ...heldBody.input, messages: [{ id: 'drop-user', type: 'human', content: 'Drop' }] } };
    const created = await fetch(`${server.url}/api/threads/fixture-thread/runs/stream`, { method: 'POST', body: JSON.stringify(body) });
    assert.equal(created.status, 200);
    assert.equal(created.headers.get('content-location'), '/threads/fixture-thread/runs/drop-run');
    const initial = await created.text();
    assert.match(initial, /id: 2\n/);
    assert.match(initial, /Dropped partial/);
    assert.match(initial, /event: messages\|research:drop\n/);
    assert.match(initial, /Child partial/);
    assert.match(initial, /event: values/);
    const runUrl = `${server.url}/api/threads/fixture-thread/runs/drop-run`;
    assert.deepEqual(await (await fetch(runUrl)).json(), { run_id: 'drop-run', thread_id: 'fixture-thread', status: 'running' });
    const joined = await fetch(`${runUrl}/stream?cancel_on_disconnect=0`, { headers: { 'Last-Event-ID': '2' } });
    assert.equal(joined.status, 200);
    const suffix = await joined.text();
    assert.match(suffix, /id: 3\n/);
    assert.match(suffix, /Dropped partial recovered/);
    assert.match(suffix, /event: values\|research:drop\n/);
    assert.match(suffix, /Child partial recovered/);
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
    const body = { ...heldBody, ...runSettings, stream_resumable: true, on_disconnect: 'continue', input: { ...applicationState, ...heldBody.input, messages: [{ id: 'drop-user', type: 'human', content: 'Drop' }] } };
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
  const base = { ...heldBody, ...runSettings, input: null };
  const first = runtime.runtimeResponse({ ...base, command: { resume: { 'live-approval': 'yes', 'live-confirmation': false } } });
  assert.match(first, /"id":"final-approval"/);
  assert.match(first, /"content":"One final approval"/);
  assert.match(first, /"content":"Child final approval"/);
  const second = runtime.runtimeResponse({ ...base, command: { resume: { 'final-approval': true } } });
  assert.match(second, /"content":"Approvals complete"/);
  assert.match(second, /"stage":"approved"/);
  assert.match(second, /"content":"Child approved"/);
  assert.doesNotMatch(second, /__interrupt__/);
  const parse = (trace) => trace.trim().split('\n\n').filter((event) => !event.match(/^event: (.*)/m)[1].includes('|')).map((event) => JSON.parse(event.match(/^data: (.*)/m)[1]));
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
      assert.match(new TextDecoder().decode(first.value), /Child held partial/);
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
    assert.equal(saved.length, 3);
    assert.deepEqual(saved.map(entry => entry.checkpoint.checkpoint_id), ['saved-checkpoint', 'saved-parent', 'saved-sibling']);
    assert.equal(saved[0].parent_checkpoint.checkpoint_id, 'saved-parent');
    assert.equal(saved[2].parent_checkpoint.checkpoint_id, 'saved-parent');
    assert.equal(saved[1].values.messages[0].content, 'Older transcript must stay out of the current state');
    assert.equal(saved[0].values.stage, 'saved');
    assert.deepEqual(saved[0].values.profile, { name: 'Saved user' });
    assert.deepEqual(saved[0].tasks.flatMap((task) => task.interrupts), [
      { id: 'saved-approval', value: { question: 'Approve saved request?', choices: ['yes', 'no'] }, namespace: ['review', 'task-1'], when: 'during', resumable: true, ns: ['legacy-review'] },
      { id: 'saved-confirmation', value: 0, namespace: [], when: 'during', resumable: false, ns: [] },
    ]);
    const final = saved[0].values.messages.at(-1);
    assert.deepEqual(final.content, [
      'Saved ',
      { type: 'output_text', text: 'final' },
      { text: ' answer' },
      { type: 'text', text: '' },
      { type: 'reasoning', text: 'Hidden block reasoning' },
      { type: 'image', text: 'Hidden image caption', url: 'https://example.test/image.png' },
      { type: 'tool_use', id: 'ignored-block-call', name: 'savedTool', input: {}, text: 'Hidden tool request' },
      { type: 'tool_result', tool_use_id: 'ignored-block-call', text: 'Hidden tool result' },
    ]);
    assert.equal(final.id, 'saved-final');
    assert.equal(final.type, 'ai');
    assert.equal(final.reasoning, 'Saved reasoning');
    assert.deepEqual(final.additional_kwargs.sources, [{ refId: 'saved-source', name: 'Saved reference', publishedAt: '2026-09-24', extra: { provider: { labels: ['history'] } } }]);
    assert.equal(final.tool_calls, undefined);
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
  const root = events.filter((event) => !event.type.includes('|'));
  assert.deepEqual(root.map((event) => event.type), ['values', 'values', 'updates']);
  assert.ok(events.some((event) => event.type === 'messages|review:child'));
  assert.ok(events.some((event) => event.type === 'values|review:child' && event.data.messages?.[0]?.content === 'Child draft'));
  assert.ok(events.some((event) => event.type === 'updates|review:child' && event.data.__interrupt__?.[0]?.id === 'child-approval'));
  assert.equal(events[0].data.stage, 'approval');
  assert.equal(events[0].data.messages.at(-1).content, 'Waiting for approvals');
  assert.deepEqual(root.slice(1).flatMap((event) => event.data.__interrupt__), [
    { id: 'live-approval', value: { question: 'Approve action?', choices: ['yes', 'no'] }, namespace: ['review', 'live'], when: 'during', resumable: true, ns: ['legacy-live'] },
    { id: 'live-confirmation', value: false, namespace: [], when: 'during', resumable: false, ns: [] },
  ]);
  assert.equal(root[1].data.stage, 'control-envelope');
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
