import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getScenario } from './scenarios.mjs';

const api = await import('./server.mjs').catch(() => ({}));
async function fixture(t, options = {}) {
  assert.equal(
    typeof api.createBenchmarkServer,
    'function',
    'live benchmark server is required'
  );
  const server = await api.createBenchmarkServer({
    port: 0,
    fragmentDelayMs: 0,
    toolDelayMs: 0,
    ...options,
  });
  t.after(() => server.close());
  return server;
}
const input = (id, prompt = getScenario('references').prompt) => ({
  threadId: 'thread-' + id,
  runId: 'native-' + id,
  messages: [{ id: 'user-' + id, role: 'user', content: prompt }],
  tools: [],
  context: [],
  state: {},
  forwardedProps: {},
});
async function submit(
  server,
  protocol,
  participant,
  scenario = 'references',
  options = {}
) {
  return fetch(
    `${server.url}/${protocol}?participant=${participant}&scenario=${scenario}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input(participant, getScenario(scenario)?.prompt)),
      ...options,
    }
  );
}
async function until(read, predicate) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('Expected benchmark lifecycle condition was not observed');
}

test('both native wire adapters execute the same four-tool workload and preserve native IDs beside canonical IDs', async (t) => {
  const server = await fixture(t);
  const streams = [];
  for (const protocol of ['ag-ui', 'ai-sdk']) {
    const response = await submit(server, protocol, protocol);
    assert.equal(response.status, 200);
    streams.push(await response.text());
  }
  assert.match(streams[0], /"type":"TOOL_CALL_ARGS"/);
  assert.match(streams[0], /"type":"RUN_FINISHED"/);
  assert.match(streams[1], /"type":"tool-input-delta"/);
  assert.match(streams[1], /"type":"tool-output-available"/);
  const [a, b] = server.receipts();
  assert.equal(a.status, 'complete');
  assert.equal(b.status, 'complete');
  assert.equal(a.tools.length, 4);
  assert.equal(a.nativeRunId, 'native-ag-ui');
  assert.equal(b.nativeRunId, 'native-ai-sdk');
  assert.notEqual(a.tools[0].nativeId, b.tools[0].nativeId);
  assert.deepEqual(
    a.tools.map(({ canonicalId, name, argsHash, resultHash, status }) => ({
      canonicalId,
      name,
      argsHash,
      resultHash,
      status,
    })),
    b.tools.map(({ canonicalId, name, argsHash, resultHash, status }) => ({
      canonicalId,
      name,
      argsHash,
      resultHash,
      status,
    }))
  );
});

test('argument completion and tool result are separate observable boundaries', async (t) => {
  const server = await fixture(t, { toolDelayMs: 60 });
  await (await submit(server, 'ag-ui', 'angular')).text();
  const run = server.receipts()[0];
  const first = run.tools[0];
  assert.ok(first.argsCompletedAt < first.executedAt);
  assert.ok(first.executedAt <= first.resultPublishedAt);
  assert.equal(first.executionCount, 1);
});

test('aborting after argument completion prevents tool execution and late output', async (t) => {
  const server = await fixture(t, { toolDelayMs: 300 });
  const controller = new AbortController();
  const response = await submit(server, 'ag-ui', 'stopped', 'references', {
    signal: controller.signal,
  });
  const reader = response.body.getReader();
  let text = '';
  while (!text.includes('TOOL_CALL_END'))
    text += new TextDecoder().decode((await reader.read()).value);
  controller.abort();
  await until(
    () => server.receipts(),
    (runs) => runs[0]?.status === 'aborted'
  );
  const run = server.receipts()[0];
  assert.equal(run.tools[0].executionCount, 0);
  assert.equal(run.tools[0].resultPublishedAt, undefined);
  assert.equal(server.activeStreams(), 0);
});

test('tool-only failure publishes an explicit failure without a fabricated successful result', async (t) => {
  const server = await fixture(t);
  const response = await submit(server, 'ai-sdk', 'failed', 'tool-error');
  const text = await response.text();
  assert.match(text, /tool-output-error/);
  assert.doesNotMatch(text, /tool-output-available/);
  const run = server.receipts()[0];
  assert.equal(run.status, 'error');
  assert.equal(run.tools[0].status, 'error');
  assert.equal(run.tools[0].resultHash, undefined);
});

test('approval gates local writes and duplicate decisions cannot execute again', async (t) => {
  const server = await fixture(t);
  const response = await submit(server, 'ai-sdk', 'approval', 'approval');
  const completed = response.text();
  const runs = await until(
    () => server.receipts(),
    (items) => items[0]?.status === 'waiting'
  );
  assert.equal(server.savedNotes().length, 0);
  const decision = () =>
    fetch(server.url + '/approve/' + runs[0].id, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"approved":true}',
    });
  assert.equal((await decision()).status, 200);
  assert.match(await completed, /tool-output-available/);
  assert.equal((await decision()).status, 409);
  assert.equal(server.savedNotes().length, 1);
  assert.equal(server.receipts()[0].tools[0].executionCount, 1);
});

test('reset revokes old approval authority and closes its delivery', async (t) => {
  const server = await fixture(t);
  const response = await submit(server, 'ai-sdk', 'reset', 'approval');
  const completed = response.text();
  const runs = await until(
    () => server.receipts(),
    (items) => items[0]?.status === 'waiting'
  );
  await fetch(server.url + '/reset/reset', { method: 'POST' });
  await completed;
  assert.equal(
    (
      await fetch(server.url + '/approve/' + runs[0].id, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"approved":true}',
      })
    ).status,
    410
  );
  assert.equal(server.savedNotes().length, 0);
  assert.equal(server.activeStreams(), 0);
});

test('invalid scenarios and non-local origins fail closed before opening a stream', async (t) => {
  const server = await fixture(t);
  assert.equal(
    (
      await fetch(server.url + '/ag-ui?participant=invalid&scenario=unknown', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input('invalid')),
      })
    ).status,
    400
  );
  assert.equal(
    (
      await submit(server, 'ag-ui', 'origin', 'references', {
        headers: {
          'content-type': 'application/json',
          origin: 'https://not-a-local-benchmark.example',
        },
      })
    ).status,
    403
  );
  assert.equal(server.receipts().length, 0);
});

test('a different live user prompt cannot silently receive a matched-workload receipt', async (t) => {
  const server = await fixture(t);
  const response = await submit(
    server,
    'ai-sdk',
    'wrong-prompt',
    'references',
    { body: JSON.stringify(input('wrong-prompt', 'A different request')) }
  );
  assert.equal(response.status, 400);
  assert.equal(server.receipts().length, 0);
});

test('native AI SDK text parts preserve the actual submitted prompt hash', async (t) => {
  const server = await fixture(t);
  const body = {
    messages: [
      {
        id: 'ai-user',
        role: 'user',
        parts: [{ type: 'text', text: getScenario('references').prompt }],
      },
    ],
  };
  await (
    await submit(server, 'ai-sdk', 'parts', 'references', {
      body: JSON.stringify(body),
    })
  ).text();
  const run = server.receipts()[0];
  assert.equal(run.promptHash, run.expectedPromptHash);
  assert.equal(typeof run.prompt, 'string');
  assert.equal(run.prompt, getScenario('references').prompt);
});
