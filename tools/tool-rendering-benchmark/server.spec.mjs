import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getScenario, hashValue } from './scenarios.mjs';

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

const events = (text) =>
  text
    .split('\n\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line.slice(6)));
async function pauseNative(server, participant = 'native') {
  const response = await submit(
    server,
    'ag-ui',
    participant,
    'native-approval'
  );
  assert.equal(response.status, 200);
  const wire = events(await response.text());
  const terminal = wire.at(-1);
  assert.equal(terminal.type, 'RUN_FINISHED');
  assert.equal(terminal.outcome.type, 'interrupt');
  assert.equal(typeof terminal.outcome.interrupts[0].toolCallId, 'string');
  assert.equal(typeof terminal.outcome.interrupts[0].message, 'string');
  assert.equal(terminal.outcome.interrupts[0].value, undefined);
  assert.equal(server.activeStreams(), 0);
  assert.equal(server.savedNotes().length, 0);
  return { terminal, interruptId: terminal.outcome.interrupts[0].id };
}
async function resumeNative(server, participant, interruptId, overrides = {}) {
  return submit(server, 'ag-ui', participant, 'native-approval', {
    body: JSON.stringify({
      ...input(participant, getScenario('native-approval').prompt),
      runId: 'resume-' + participant,
      resume: [{ interruptId, status: 'resolved', payload: true }],
      ...overrides,
    }),
  });
}
test('native approval closes a paused run, then atomically consumes a retained gate exactly once', async (t) => {
  const server = await fixture(t);
  const { interruptId } = await pauseNative(server);
  assert.equal(server.receipts()[0].status, 'paused');
  const responses = await Promise.all([
    resumeNative(server, 'native', interruptId),
    resumeNative(server, 'native', interruptId),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  const texts = await Promise.all(responses.map((r) => r.text()));
  assert.ok(texts.some((text) => text.includes('TOOL_CALL_RESULT')));
  assert.equal(server.savedNotes().length, 1);
  const receipt = server.receipts().at(-1);
  assert.equal(receipt.sourceRunId, server.receipts()[0].nativeRunId);
  assert.equal(receipt.interruptId, interruptId);
  assert.equal(receipt.tools[0].executionCount, 1);
});
test('native gate rejects unknown, wrong-thread, wrong-participant, implicit and reset decisions', async (t) => {
  const server = await fixture(t);
  const { interruptId } = await pauseNative(server);
  for (const [participant, id, changes, status] of [
    ['native', 'unknown', {}, 410],
    ['other', interruptId, {}, 409],
    ['native', interruptId, { threadId: 'wrong-thread' }, 409],
    [
      'native',
      interruptId,
      { resume: [{ interruptId, status: 'resolved' }] },
      400,
    ],
    [
      'native',
      interruptId,
      { resume: [{ interruptId, status: 'cancelled', payload: true }] },
      400,
    ],
    ['native', interruptId, { runId: 'native-native' }, 409],
  ])
    assert.equal(
      (await resumeNative(server, participant, id, changes)).status,
      status
    );
  await fetch(server.url + '/reset/native', { method: 'POST' });
  assert.equal((await resumeNative(server, 'native', interruptId)).status, 410);
  assert.equal(server.savedNotes().length, 0);
});
test('native cancellation completes without executing a write and consumes the gate', async (t) => {
  const server = await fixture(t);
  const { interruptId } = await pauseNative(server);
  const response = await resumeNative(server, 'native', interruptId, {
    resume: [{ interruptId, status: 'cancelled' }],
  });
  assert.equal(response.status, 200);
  const wire = events(await response.text());
  assert.equal(wire.at(-1).type, 'RUN_FINISHED');
  const result = wire.find((event) => event.type === 'TOOL_CALL_RESULT');
  assert.ok(result, 'Cancellation resolves the original tool observation');
  assert.equal(result.toolCallId, server.receipts()[0].tools[0].nativeId);
  assert.deepEqual(JSON.parse(result.content), {
    saved: false,
    cancelled: true,
  });
  assert.equal(
    wire.some((event) => event.type === 'TOOL_CALL_START'),
    false
  );
  assert.equal(server.receipts().at(-1).status, 'denied');
  assert.equal(server.receipts().at(-1).tools[0].executionCount, 0);
  assert.equal((await resumeNative(server, 'native', interruptId)).status, 409);
  assert.equal(server.savedNotes().length, 0);
});
test('native Angular boolean denial completes without a write', async (t) => {
  const server = await fixture(t);
  const { interruptId } = await pauseNative(server);
  const response = await resumeNative(server, 'native', interruptId, {
    resume: [{ interruptId, status: 'resolved', payload: false }],
  });
  assert.equal(response.status, 200);
  await response.text();
  assert.equal(server.receipts().at(-1).status, 'denied');
  assert.equal(server.savedNotes().length, 0);
});
test('a fresh pause supersedes the previous source-run gate', async (t) => {
  const server = await fixture(t);
  const old = await pauseNative(server);
  const current = await pauseNative(server);
  assert.notEqual(old.interruptId, current.interruptId);
  assert.equal(
    (await resumeNative(server, 'native', old.interruptId)).status,
    410
  );
  const response = await resumeNative(server, 'native', current.interruptId);
  await response.text();
  assert.equal(server.savedNotes().length, 1);
});
test('reset after native resume admission prevents a delayed write', async (t) => {
  const server = await fixture(t, { toolDelayMs: 200 });
  const { interruptId } = await pauseNative(server);
  const response = await resumeNative(server, 'native', interruptId);
  const completed = response.text();
  await fetch(server.url + '/reset/native', { method: 'POST' });
  await completed;
  assert.equal(server.savedNotes().length, 0);
  assert.equal(server.receipts().at(-1).status, 'aborted');
  assert.equal((await resumeNative(server, 'native', interruptId)).status, 410);
});
test('native resume resolves the original paused invocation without leaving an orphan call', async (t) => {
  const server = await fixture(t);
  const { interruptId } = await pauseNative(server);
  const nativeId = server.receipts()[0].tools[0].nativeId;
  const response = await resumeNative(server, 'native', interruptId);
  const wire = events(await response.text());
  assert.equal(
    wire.some((event) => event.type === 'TOOL_CALL_START'),
    false
  );
  assert.equal(
    wire.find((event) => event.type === 'TOOL_CALL_RESULT').toolCallId,
    nativeId
  );
  assert.equal(server.receipts().at(-1).tools[0].nativeId, nativeId);
});
test('read-only partial failure preserves successful prefix and explicit same-thread retry uses a new call', async (t) => {
  const server = await fixture(t);
  for (const protocol of ['ag-ui', 'ai-sdk']) {
    const first = await submit(server, protocol, protocol, 'partial-failure');
    await first.text();
    const failed = server.receipts().at(-1);
    assert.deepEqual(
      failed.tools.map((tool) => tool.status),
      ['complete', 'error']
    );
    assert.equal(failed.status, 'error');
    const retryPrompt = 'Retry the failed read explicitly.';
    const retry = await submit(server, protocol, protocol, 'partial-failure', {
      body: JSON.stringify(input(protocol, retryPrompt)),
    });
    assert.equal(retry.status, 200);
    await retry.text();
    const succeeded = server.receipts().at(-1);
    assert.equal(succeeded.threadId, failed.threadId);
    assert.equal(succeeded.retryOf, failed.id);
    assert.equal(succeeded.prompt, retryPrompt);
    assert.equal(succeeded.promptHash, hashValue(retryPrompt));
    assert.equal(succeeded.expectedPromptHash, hashValue(retryPrompt));
    assert.equal(succeeded.tools.length, 1);
    assert.equal(succeeded.tools[0].canonicalId, 'read-sorted-retry');
    assert.notEqual(succeeded.tools[0].nativeId, failed.tools[1].nativeId);
    assert.equal(succeeded.tools[0].status, 'complete');
    assert.equal(failed.tools[0].executionCount, 1);
  }
});
test('read retry requires exact explicit intent and a retained failure in the same participant and thread', async (t) => {
  const server = await fixture(t);
  const retryPrompt = 'Retry the failed read explicitly.';
  const retry = (participant, threadId, prompt = retryPrompt) =>
    submit(server, 'ag-ui', participant, 'partial-failure', {
      body: JSON.stringify({ ...input(participant, prompt), threadId }),
    });
  assert.equal((await retry('reader', 'thread-reader')).status, 400);
  await (await submit(server, 'ag-ui', 'reader', 'partial-failure')).text();
  assert.equal((await retry('reader', 'different-thread')).status, 400);
  assert.equal((await retry('other-reader', 'thread-reader')).status, 400);
  assert.equal(
    (
      await retry(
        'reader',
        'thread-reader',
        getScenario('partial-failure').prompt
      )
    ).status,
    400
  );
  assert.equal(
    (await retry('reader', 'thread-reader', retryPrompt + ' please')).status,
    400
  );
  assert.equal(server.receipts().length, 1);
  const accepted = await retry('reader', 'thread-reader');
  assert.equal(accepted.status, 200);
  await accepted.text();
  assert.equal(server.receipts().at(-1).tools.length, 1);
  await fetch(server.url + '/reset/reader', { method: 'POST' });
  assert.equal((await retry('reader', 'thread-reader')).status, 400);
});
test('long mixed read workload continues after a recoverable failure and retains honest mixed receipts', async (t) => {
  const server = await fixture(t);
  const response = await submit(server, 'ag-ui', 'long', 'long-mixed');
  const text = await response.text();
  const record = server.receipts()[0];
  assert.ok(record.tools.length >= 16);
  assert.equal(
    record.tools.filter((tool) => tool.status === 'error').length,
    1
  );
  assert.equal(record.tools.at(-1).status, 'complete');
  assert.equal(record.status, 'partial');
  assert.equal(events(text).at(-1).type, 'RUN_FINISHED');
  assert.ok(record.tools.every((tool) => tool.executionCount === 1));
});

async function deepRun(server, participant) {
  const response = await submit(server, 'ag-ui', participant, 'deep-workflow');
  assert.equal(response.status, 200);
  const wire = events(await response.text());
  return { wire, interruptId: wire.at(-1).outcome.interrupts[0].id };
}
const deepResume = (server, participant, interruptId, payload) =>
  submit(server, 'ag-ui', participant, 'deep-workflow', {
    body: JSON.stringify({
      ...input(participant, getScenario('deep-workflow').prompt),
      runId: 'resume-' + participant,
      resume: [{ interruptId, status: 'resolved', payload }],
    }),
  });
const history = async (server, participant, kind) =>
  fetch(`${server.url}/threads/${participant}/thread-${participant}/${kind}`);

test('deep workflow plans, delegates attributed child reads, reads, then pauses before the only write', async (t) => {
  const server = await fixture(t);
  const { wire } = await deepRun(server, 'deep');
  const receipt = server.receipts()[0];
  assert.equal(receipt.status, 'paused');
  assert.deepEqual(
    receipt.tools.map((tool) => [
      tool.canonicalId,
      tool.status,
      tool.executionCount,
      tool.parent,
    ]),
    [
      ['plan', 'complete', 1, undefined],
      ['delegate-reading', 'complete', 1, undefined],
      ['child-read-angular', 'complete', 1, 'delegate-reading'],
      ['child-read-sorted', 'complete', 1, 'delegate-reading'],
      ['check-sorted', 'complete', 1, undefined],
      ['save-comparison', 'waiting', 0, undefined],
    ]
  );
  assert.deepEqual(
    receipt.subagents.map(({ name, parent, status }) => [name, parent, status]),
    [['reference-reader', 'delegate-reading', 'complete']]
  );
  assert.equal(server.savedNotes().length, 0);
  // Child events carry the subagent run; the parent's delegate result follows them.
  const started = wire.findIndex((event) => event.type === 'SUBAGENT_STARTED');
  const finished = wire.findIndex(
    (event) => event.type === 'SUBAGENT_FINISHED'
  );
  const delegate = receipt.tools[1].nativeId;
  assert.equal(wire[started].parentToolCallId, delegate);
  const childEvents = wire.slice(started + 1, finished);
  assert.ok(childEvents.length > 0);
  assert.ok(
    childEvents.every(
      (event) => event.subagentRunId === wire[started].subagentRunId
    )
  );
  const delegateResult = wire.findIndex(
    (event) =>
      event.type === 'TOOL_CALL_RESULT' && event.toolCallId === delegate
  );
  assert.ok(delegateResult > finished);
  assert.deepEqual(JSON.parse(wire[delegateResult].content), {
    delegated: true,
    references: ['angular-signals', 'array-to-sorted'],
  });
  assert.deepEqual(
    JSON.parse(
      wire.find(
        (event) =>
          event.type === 'TOOL_CALL_RESULT' &&
          event.toolCallId === receipt.tools[0].nativeId
      ).content
    ).steps.map((step) => step.id),
    ['step-1', 'step-2', 'step-3']
  );
});

test('deep workflow approval saves once and its history restores the whole thread without running anything', async (t) => {
  const server = await fixture(t);
  const { wire, interruptId } = await deepRun(server, 'deep');
  const resumed = await deepResume(server, 'deep', interruptId, true);
  assert.equal(resumed.status, 200);
  const resumedWire = events(await resumed.text());
  assert.equal(server.savedNotes().length, 1);
  const receipt = server.receipts().at(-1);
  assert.equal(receipt.status, 'complete');
  // Only the gated call runs again; earlier work is not repeated.
  assert.deepEqual(
    receipt.tools.map((tool) => [tool.canonicalId, tool.executionCount]),
    [['save-comparison', 1]]
  );
  assert.equal(server.receipts().length, 2);

  const replay = await history(server, 'deep', 'events');
  assert.equal(replay.status, 200);
  const { events: stored } = await replay.json();
  assert.deepEqual(
    stored.map((event) => event.type),
    [...wire, ...resumedWire].map((event) => event.type)
  );
  const runs = stored.filter((event) => event.type === 'RUN_STARTED');
  assert.deepEqual(
    runs.map((event) => event.input.messages.map((row) => row.content)),
    [[getScenario('deep-workflow').prompt], []]
  );
  assert.equal(runs[0].input.messages[0].id, 'user-deep');

  const { messages } = await (await history(server, 'deep', 'messages')).json();
  assert.deepEqual(
    messages.map((message) => message.role),
    ['user', 'assistant', 'tool', 'tool', 'tool', 'tool', 'assistant']
  );
  // Parent transcript only: the child reads stay with the subagent.
  assert.deepEqual(
    messages[1].toolCalls.map((call) => call.function.name),
    ['plan_workflow', 'delegate_research', 'read_reference', 'save_note']
  );
  assert.deepEqual(JSON.parse(messages[1].toolCalls[3].function.arguments), {
    text: getScenario('deep-workflow').calls[3].args.text,
  });
  assert.deepEqual(JSON.parse(messages[5].content), {
    saved: true,
    id: 'note-1',
  });
  assert.equal(messages[6].content, getScenario('deep-workflow').conclusion);
  // Reading history is not a run and writes nothing.
  assert.equal(server.receipts().length, 2);
  assert.equal(server.savedNotes().length, 1);
  assert.deepEqual(
    server.restores().map(({ kind, found }) => [kind, found]),
    [
      ['events', true],
      ['messages', true],
    ]
  );
});

test('deep workflow denial writes nothing, and reset removes the thread history', async (t) => {
  const server = await fixture(t);
  const { interruptId } = await deepRun(server, 'deep');
  const denied = await deepResume(server, 'deep', interruptId, false);
  assert.equal(denied.status, 200);
  await denied.text();
  assert.equal(server.savedNotes().length, 0);
  const receipt = server.receipts().at(-1);
  assert.equal(receipt.status, 'denied');
  assert.deepEqual(
    receipt.tools.map((tool) => [tool.canonicalId, tool.executionCount]),
    [['save-comparison', 0]]
  );
  const { messages } = await (await history(server, 'deep', 'messages')).json();
  assert.deepEqual(JSON.parse(messages.at(-2).content), {
    saved: false,
    cancelled: true,
  });
  assert.equal(messages.at(-1).content, 'Saving the note was cancelled.');
  assert.equal(
    (await history(server, 'other', 'events')).status,
    404,
    'another participant has no history'
  );
  await fetch(server.url + '/reset/deep', { method: 'POST' });
  assert.equal((await history(server, 'deep', 'events')).status, 404);
  assert.equal(
    (await fetch(server.url + '/threads/deep/thread-deep/other')).status,
    400
  );
});
