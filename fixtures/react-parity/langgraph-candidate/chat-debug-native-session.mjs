/** Runs only inside the packed, installed, private candidate consumer. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import {
  appendFileSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createSession } from '@threadplane/langgraph';

const require = createRequire(import.meta.url);
const entry = require.resolve('@threadplane/langgraph');
const candidateRequire = createRequire(entry);
const sdkEntry = candidateRequire.resolve('@langchain/langgraph-sdk');
const { Client } = await import(sdkEntry);
const fixtureURL = new URL(process.env.DEBUG_FIXTURE_MODULE_URL);
assert.equal(
  process.env.DEBUG_NATIVE_RECEIPT_PATH,
  join(realpathSync(process.cwd()), 'debug-native-receipt.json')
);
assert.equal(
  process.env.DEBUG_NATIVE_ACQUISITIONS_PATH,
  join(realpathSync(process.cwd()), 'debug-native-acquisitions.jsonl')
);
assert.ok(
  [undefined, 'exit-after-worker-acquired'].includes(
    process.env.DEBUG_NATIVE_PROBE_FAULT
  )
);
assert.equal(fixtureURL.protocol, 'file:');
assert.ok(
  fixtureURL.pathname.endsWith('/scripts/react-cockpit/chat-debug-fixture.mjs')
);
assert.equal(
  realpathSync(fileURLToPath(fixtureURL)),
  fileURLToPath(fixtureURL)
);
assert.ok(
  realpathSync(entry).startsWith(
    realpathSync(process.cwd()) + '/node_modules/@threadplane/langgraph/'
  )
);
assert.ok(
  realpathSync(sdkEntry).startsWith(
    realpathSync(process.cwd()) + '/node_modules/'
  )
);
const { createChatDebugFixture } = await import(fixtureURL.href);
const sourceHash = createHash('sha256')
  .update(readFileSync(fixtureURL))
  .digest('hex');
const onChild = ({ pid, pgid }) => {
  appendFileSync(
    process.env.DEBUG_NATIVE_ACQUISITIONS_PATH,
    JSON.stringify({ pid, pgid, sourceHash }) + '\n'
  );
  if (process.env.DEBUG_NATIVE_PROBE_FAULT === 'exit-after-worker-acquired')
    process.exit(7);
};

const neutral = (messages) =>
  messages.map((message) => {
    const result = {
      id: message.id,
      role: message.role ?? { human: 'user', ai: 'assistant' }[message.type],
      content: message.content,
    };
    for (const key of ['name', 'reasoning', 'citations'])
      if (message[key] !== undefined && message[key] !== null)
        result[key] = message[key];
    assert.ok(
      !message.tool_calls?.length &&
        !message.toolCallIds?.length &&
        !message.toolCallId
    );
    return result;
  });
const assertEmptyExtras = (snapshot) => {
  assert.deepEqual(snapshot.toolCalls, []);
  assert.deepEqual(snapshot.interrupts, []);
  assert.deepEqual(snapshot.subgraphs, []);
};

test('installed native session proves two real live generations and two explicit checkpoint-backed loads', async (t) => {
  let fixture,
    session,
    unsubscribe,
    unicodeFixture,
    unicodeSession,
    projectionFixture,
    projectionSession,
    cleaning;
  const controllers = [];
  const report = { entry, sdkEntry, turns: [], cleanup: null };
  const cleanup = () =>
    (cleaning ??= (async () => {
      unsubscribe?.();
      for (const controller of controllers) controller.abort();
      await session?.dispose();
      await unicodeSession?.dispose();
      await projectionSession?.dispose();
      await unicodeFixture?.close();
      await projectionFixture?.close();
      fixture?.release();
      await fixture?.close();
      report.cleanup = fixture?.receipt();
      if (report.cleanup) {
        assert.deepEqual(report.cleanup.active, {
          children: 0,
          streams: 0,
          reads: 0,
          handlers: 0,
          responses: 0,
        });
        for (const child of report.cleanup.children) {
          assert.equal(child.reaped, true);
          if (child.pid)
            for (const id of [child.pid, -child.pgid])
              assert.throws(() => process.kill(id, 0), { code: 'ESRCH' });
        }
      }
      report.unicodeCleanup = unicodeFixture?.receipt();
      if (report.unicodeCleanup)
        assert.deepEqual(report.unicodeCleanup.active, {
          children: 0,
          streams: 0,
          reads: 0,
          handlers: 0,
          responses: 0,
        });
      report.projectionCleanup = projectionFixture?.receipt();
      if (report.projectionCleanup)
        assert.deepEqual(report.projectionCleanup.active, {
          children: 0,
          streams: 0,
          reads: 0,
          handlers: 0,
          responses: 0,
        });
      writeFileSync(
        process.env.DEBUG_NATIVE_RECEIPT_PATH,
        JSON.stringify(report) + '\n',
        { flag: 'wx', mode: 0o600 }
      );
      console.log('Native Debug cleanup receipt saved to owned file.');
    })());
  const onTerminate = () => {
    void cleanup().then(
      () => process.exit(143),
      () => process.exit(1)
    );
  };
  process.once('SIGTERM', onTerminate);
  t.after(async () => {
    try {
      await cleanup();
    } finally {
      process.off('SIGTERM', onTerminate);
    }
  });
  fixture = createChatDebugFixture({ onChild });
  const apiUrl = await fixture.listen();
  const client = new Client({
    apiUrl,
    apiKey: null,
    callerOptions: { maxRetries: 0 },
    defaultHeaders: {},
  });
  const threadId = randomUUID();
  assert.equal(
    (await client.threads.create({ threadId, ifExists: 'raise' })).thread_id,
    threadId
  );
  session = createSession({
    assistantId: 'c-debug',
    threadId,
    apiUrl,
    clientOptions: { maxRetries: 0, defaultHeaders: {} },
  });
  assert.deepEqual(session.getSnapshot().messages, []);
  assertEmptyExtras(session.getSnapshot());
  const observations = [];
  let activeSubmit;
  unsubscribe = session.subscribe(() => {
    const snapshot = session.getSnapshot();
    observations.push(snapshot);
    // Inert capture only: publication may swallow listener assertions. All
    // validation happens after submit resolves, against this first observation.
    if (activeSubmit && !activeSubmit.first && snapshot.status === 'running') {
      const human = snapshot.messages[activeSubmit.prefixLength];
      if (human?.role === 'user')
        activeSubmit.first = Object.freeze({
          id: human.id,
          content: human.content,
          generation: human.delivery.generation,
          phase: human.delivery.phase,
          status: snapshot.status,
          prefixLength: activeSubmit.prefixLength,
          snapshotOrdinal: observations.length - 1,
          observedBeforeSettlement: !activeSubmit.settled,
        });
    }
  });
  let prefix = [],
    first,
    previousGeneration;
  for (const input of ['first input 🛩️', 'second input']) {
    const before = observations.length;
    const captured = {
      prefixLength: prefix.length,
      first: undefined,
      settled: false,
    };
    activeSubmit = captured;
    let outcome;
    try {
      outcome = await session.submit(input);
    } finally {
      captured.settled = true;
      activeSubmit = undefined;
    }
    assert.equal(outcome, 'success');
    const initialHuman = captured.first;
    assert.ok(
      initialHuman,
      'First owned current human must be published while submit is running'
    );
    assert.equal(initialHuman.observedBeforeSettlement, true);
    assert.equal(initialHuman.status, 'running');
    assert.equal(initialHuman.content, input);
    assert.ok(initialHuman.id && initialHuman.generation);
    assert.ok(
      observations.slice(before).every((snapshot) => Object.isFrozen(snapshot))
    );
    const live = session.getSnapshot();
    assert.equal(live.status, 'idle');
    assertEmptyExtras(live);
    assert.equal(live.messages.length, prefix.length + 4);
    assert.deepEqual(neutral(live.messages.slice(0, prefix.length)), prefix);
    const turn = live.messages.slice(-4);
    assert.deepEqual(
      turn.map((m) => m.role),
      ['user', 'assistant', 'assistant', 'assistant']
    );
    assert.equal(turn[0].content, input);
    assert.equal(
      new Set(live.messages.map((m) => m.id)).size,
      live.messages.length
    );
    assert.equal(turn[0].id, initialHuman.id);
    assert.equal(turn[0].content, initialHuman.content);
    const generation = initialHuman.generation;
    assert.ok(generation && generation !== previousGeneration);
    for (const message of turn)
      assert.deepEqual(message.delivery, {
        generation,
        phase: 'complete',
        outcome: 'success',
      });
    assert.ok(observations.slice(before).some((s) => s.status === 'running'));
    // Freeze semantic authority before calling the explicit load operation.
    const frozen = structuredClone(neutral(live.messages));
    const analysis = structuredClone(live.values.analysis);
    const answer = turn[1].content;
    assert.deepEqual(analysis, {
      characters: [...answer].length,
      words: answer.split(' ').length,
    });
    // Python codepoint semantics, explicitly distinct from JS UTF-16 length.
    assert.equal([...'🛩️'].length, 2);
    assert.equal('🛩️'.length, 3);
    const controller = new AbortController();
    controllers.push(controller);
    const current = await client.threads.getState(threadId, undefined, {
      signal: controller.signal,
    });
    const cp = structuredClone(current.checkpoint);
    assert.equal(cp.thread_id, threadId);
    assert.equal(cp.checkpoint_ns, '');
    assert.ok(cp.checkpoint_id);
    const exact = await client.threads.getState(threadId, cp, {
      signal: controller.signal,
    });
    assert.deepEqual(exact.checkpoint, cp);
    assert.deepEqual(exact.next, []);
    assert.deepEqual(exact.tasks, []);
    assert.deepEqual(neutral(exact.values.messages), frozen);
    assert.deepEqual(exact.values.analysis, analysis);
    await session.load({ signal: controller.signal });
    const loaded = session.getSnapshot();
    assertEmptyExtras(loaded);
    assert.deepEqual(neutral(loaded.messages), frozen);
    assert.deepEqual(loaded.values.analysis, analysis);
    for (const message of loaded.messages)
      assert.deepEqual(message.delivery, {
        generation: message.id,
        phase: 'complete',
        outcome: 'success',
      });
    assert.deepEqual(loaded.history[0].checkpoint, cp);
    assert.ok(
      loaded.history.every((row) => !('values' in row) && !('tasks' in row))
    );
    if (first)
      assert.deepEqual(
        await client.threads.getState(threadId, first.checkpoint),
        first
      );
    else first = structuredClone(exact);
    const capture = fixture.captures.at(-1);
    const processCallbacks = capture.events.filter(
      ([kind, value]) =>
        kind === 'messages' && value[1].langgraph_node === 'process'
    );
    assert.equal(processCallbacks.length, 1);
    assert.equal(processCallbacks[0][1][0].id, turn[2].id);
    assert.equal(answer, capture.state.values.messages.at(-3).content);
    report.turns.push({
      input,
      generation,
      initialHuman,
      semantic: frozen,
      analysis,
      checkpoint: cp,
      rawExact: exact,
      rawCallbacks: capture.events.filter(([kind]) => kind === 'messages'),
      processCallback: processCallbacks[0],
      proof: capture.proof,
      sseSha256: capture.sseSha256,
      historyOrder: loaded.history.map((row) => row.checkpoint),
      liveDelivery: turn.map((m) => m.delivery),
      reloadDelivery: loaded.messages.slice(-4).map((m) => m.delivery),
    });
    prefix = frozen;
    previousGeneration = generation;
  }
  report.requests = structuredClone(fixture.requests);
  assert.equal(fixture.requests.length, 12);
  assert.equal(
    fixture.requests.filter(
      (r) => r.method === 'GET' && /\/runs\/[^/]+$/.test(r.path)
    ).length,
    2,
    'Native submit confirms each exact physical run status'
  );
  assert.equal(
    fixture.requests.filter((r) => r.path.endsWith('/runs/stream')).length,
    2
  );
  assert.equal(
    fixture.requests.filter((r) => r.path.endsWith('/history')).length,
    2
  );
  // Separate local provider extension: the natural two-turn gate above stays
  // unchanged. Actual graph process computes analysis from generated astral A.
  unicodeFixture = createChatDebugFixture({
    providerVariant: 'unicode',
    onChild,
  });
  const unicodeUrl = await unicodeFixture.listen();
  const unicodeClient = new Client({
    apiUrl: unicodeUrl,
    apiKey: null,
    callerOptions: { maxRetries: 0 },
    defaultHeaders: {},
  });
  const unicodeThread = randomUUID();
  await unicodeClient.threads.create({
    threadId: unicodeThread,
    ifExists: 'raise',
  });
  unicodeSession = createSession({
    assistantId: 'c-debug',
    threadId: unicodeThread,
    apiUrl: unicodeUrl,
    clientOptions: { maxRetries: 0, defaultHeaders: {} },
  });
  assert.equal(
    await unicodeSession.submit('labelled generated Unicode extension'),
    'success'
  );
  const unicodeLive = unicodeSession.getSnapshot(),
    unicodeAnswer = unicodeLive.messages[1].content;
  assert.ok(unicodeAnswer.includes('🛩️'));
  assert.notEqual([...unicodeAnswer].length, unicodeAnswer.length);
  assert.deepEqual(unicodeLive.values.analysis, {
    characters: [...unicodeAnswer].length,
    words: unicodeAnswer.split(' ').length,
  });
  const unicodeRaw = await unicodeClient.threads.getState(unicodeThread);
  assert.equal(unicodeRaw.values.messages[1].content, unicodeAnswer);
  assert.deepEqual(unicodeRaw.values.analysis, unicodeLive.values.analysis);
  const unicodeExact = await unicodeClient.threads.getState(
    unicodeThread,
    unicodeRaw.checkpoint
  );
  assert.deepEqual(unicodeExact, unicodeRaw);
  await unicodeSession.load();
  assert.deepEqual(
    neutral(unicodeSession.getSnapshot().messages),
    neutral(unicodeRaw.values.messages)
  );
  assert.deepEqual(
    unicodeSession.getSnapshot().values.analysis,
    unicodeLive.values.analysis
  );
  report.unicodeExtension = {
    label: 'AuthoredModel _begin extension, real graph analysis',
    answer: unicodeAnswer,
    utf16Length: unicodeAnswer.length,
    codepoints: [...unicodeAnswer].length,
    raw: unicodeExact,
    proof: unicodeFixture.captures[0].proof,
  };
  projectionFixture = createChatDebugFixture({
    omitProcessCallback: true,
    onChild,
  });
  const projectionUrl = await projectionFixture.listen();
  const projectionClient = new Client({
    apiUrl: projectionUrl,
    apiKey: null,
    callerOptions: { maxRetries: 0 },
    defaultHeaders: {},
  });
  const projectionThread = randomUUID();
  await projectionClient.threads.create({
    threadId: projectionThread,
    ifExists: 'raise',
  });
  projectionSession = createSession({
    assistantId: 'c-debug',
    threadId: projectionThread,
    apiUrl: projectionUrl,
    clientOptions: { maxRetries: 0, defaultHeaders: {} },
  });
  assert.equal(
    await projectionSession.submit('labelled omitted B callback projection'),
    'success'
  );
  const projectionLive = projectionSession.getSnapshot(),
    processMessage = projectionLive.messages[2];
  assert.equal(projectionLive.messages.length, 4);
  for (const message of projectionLive.messages)
    assert.deepEqual(message.delivery, {
      generation: projectionLive.messages[0].delivery.generation,
      phase: 'complete',
      outcome: 'success',
    });
  const projectionRaw = await projectionClient.threads.getState(
    projectionThread
  );
  assert.deepEqual(
    neutral(projectionLive.messages),
    neutral(projectionRaw.values.messages)
  );
  const projected = projectionFixture.captures[0];
  assert.equal(projected.omission.id, processMessage.id);
  assert.equal(projected.omission.count, 1);
  assert.notEqual(projected.originalSseSha256, projected.sseSha256);
  report.projectionRegression = {
    label: 'Transport omission only; natural backend callback was present',
    originalSseSha256: projected.originalSseSha256,
    projectedSseSha256: projected.sseSha256,
    omission: projected.omission,
    semantic: neutral(projectionLive.messages),
    delivery: processMessage.delivery,
    raw: projectionRaw,
  };
});
