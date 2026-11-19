/** Runs only inside the packed, installed, private candidate consumer. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createSession } from '@threadplane/langgraph';

const require = createRequire(import.meta.url);
const entry = require.resolve('@threadplane/langgraph');
const candidateRequire = createRequire(entry);
const sdkEntry = candidateRequire.resolve('@langchain/langgraph-sdk');
const { Client } = await import(sdkEntry);
// The repository that owns the backend: aimock replays the debug example's
// shared fixtures into a real `langgraph dev`, behind the recording proxy.
const rootURL = new URL(process.env.DEBUG_REPO_ROOT_URL);
assert.equal(
  process.env.DEBUG_NATIVE_RECEIPT_PATH,
  join(realpathSync(process.cwd()), 'debug-native-receipt.json')
);
assert.equal(rootURL.protocol, 'file:');
assert.ok(rootURL.pathname.endsWith('/'));
const root = fileURLToPath(rootURL);
assert.equal(realpathSync(root) + '/', root);
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
const { createAimockBackend } = await import(
  new URL('scripts/react-cockpit/aimock-backend.mjs', rootURL).href
);
const { createLanggraphProxy } = await import(
  new URL('scripts/react-cockpit/langgraph-proxy.mjs', rootURL).href
);
const { reactCockpitConfiguration } = await import(
  new URL('scripts/react-cockpit/configuration.mjs', rootURL).href
);
const { backend: backendConfig } = reactCockpitConfiguration('chat-debug');
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
/** SSE events as the real server framed them (CRLF or LF). */
const events = (text) =>
  text
    .split(/\r?\n\r?\n/)
    .filter(Boolean)
    .map((block) => {
      const lines = block.split(/\r?\n/);
      return {
        event: lines.find((line) => line.startsWith('event: '))?.slice(7),
        data: JSON.parse(
          lines.find((line) => line.startsWith('data: '))?.slice(6) ?? 'null'
        ),
      };
    });

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
  let backend,
    server,
    session,
    unsubscribe,
    unicodeSession,
    projectionSession,
    cleaning;
  const controllers = [];
  const report = { entry, sdkEntry, turns: [], cleanup: null };
  const control = async (path, body) => {
    const response = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.equal(response.status, 200, path);
    return response.json();
  };
  let base;
  const cleanup = () =>
    (cleaning ??= (async () => {
      unsubscribe?.();
      for (const controller of controllers) controller.abort();
      await session?.dispose();
      await unicodeSession?.dispose();
      await projectionSession?.dispose();
      const lifetime = base ? await control('/__lifetime').catch(() => null) : null;
      if (server)
        await new Promise((done) => {
          server.closeAllConnections();
          server.close(() => done());
        });
      const pid = backend?.pid ?? null;
      await backend?.close();
      report.cleanup = { lifetime, langgraph: { pid, absent: false } };
      if (lifetime)
        assert.deepEqual(
          {
            activeStream: lifetime.activeStream,
            activeHistory: lifetime.activeHistory,
            activeState: lifetime.activeState,
          },
          { activeStream: false, activeHistory: false, activeState: false }
        );
      if (pid) {
        assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
        report.cleanup.langgraph.absent = true;
      }
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
  backend = createAimockBackend({ root, backend: backendConfig });
  await backend.ensure();
  const proxy = createLanggraphProxy({
    upstream: `http://127.0.0.1:${backendConfig.langgraphPort}`,
  });
  server = createServer(async (request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (!(await proxy(request, response, path))) {
      response.writeHead(404);
      response.end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
  const apiUrl = base + '/api';
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
    // What the real server streamed and saved for this run.
    const capture = (await control('/__captures')).at(-1);
    const rawCallbacks = events(capture.sse).filter(
      ({ event }) => event === 'messages'
    );
    const processCallbacks = rawCallbacks.filter(
      ({ data }) => data[1].langgraph_node === 'process'
    );
    assert.equal(processCallbacks.length, 1);
    assert.equal(processCallbacks[0].data[0].id, turn[2].id);
    assert.equal(answer, capture.values.messages.at(-3).content);
    report.turns.push({
      input,
      generation,
      initialHuman,
      semantic: frozen,
      analysis,
      checkpoint: cp,
      rawExact: exact,
      rawCallbacks,
      processCallback: processCallbacks[0],
      sseSha256: sha256(capture.sse),
      historyOrder: loaded.history.map((row) => row.checkpoint),
      liveDelivery: turn.map((m) => m.delivery),
      reloadDelivery: loaded.messages.slice(-4).map((m) => m.delivery),
    });
    prefix = frozen;
    previousGeneration = generation;
  }
  const requests = await control('/__requests');
  report.requests = requests;
  assert.equal(requests.length, 12);
  assert.equal(
    requests.filter(
      (r) => r.method === 'GET' && /\/runs\/[^/]+$/.test(r.path)
    ).length,
    2,
    'Native submit confirms each exact physical run status'
  );
  assert.equal(
    requests.filter((r) => r.path.endsWith('/runs/stream')).length,
    2
  );
  assert.equal(
    requests.filter((r) => r.path.endsWith('/history')).length,
    2
  );
  // A scripted answer with astral characters (shared fixtures): the real
  // graph's process node computes analysis from it in Python code points.
  const unicodeClient = new Client({
    apiUrl,
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
    apiUrl,
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
    label: 'Scripted astral answer, real graph analysis',
    answer: unicodeAnswer,
    utf16Length: unicodeAnswer.length,
    codepoints: [...unicodeAnswer].length,
    raw: unicodeExact,
  };
  // Transport projection: the proxy drops the process node's message callback
  // from the stream the session receives; the real run still emits it.
  await control('/__stream/edit', {
    ops: [
      { event: '^messages$', dataPattern: '"langgraph_node": ?"process"', op: 'drop' },
    ],
  });
  const projectionClient = new Client({
    apiUrl,
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
    apiUrl,
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
  const projected = (await control('/__captures')).at(-1);
  const naturalCallbacks = events(projected.sse).filter(
    ({ event, data }) =>
      event === 'messages' && data[1].langgraph_node === 'process'
  );
  assert.equal(naturalCallbacks.length, 1);
  assert.equal(naturalCallbacks[0].data[0].id, processMessage.id);
  report.projectionRegression = {
    label: 'Transport omission only; natural backend callback was present',
    naturalSseSha256: sha256(projected.sse),
    omission: { id: processMessage.id, count: naturalCallbacks.length },
    semantic: neutral(projectionLive.messages),
    delivery: processMessage.delivery,
    raw: projectionRaw,
  };
});
