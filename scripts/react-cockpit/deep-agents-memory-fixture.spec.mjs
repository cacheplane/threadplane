import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@langchain/langgraph-sdk';
const { createDeepAgentsMemoryFixture } = await import(
  './deep-agents-memory-fixture.mjs'
).catch(() => ({}));
const captures = mkdtempSync(join(tmpdir(), 'threadplane-memory-task4a-sdk-'));
console.log('Memory SDK captures: ' + captures);
const FILE = '/memories/AGENTS.md';
const LITERAL = 'Fleet note\n\n  Ω literal whitespace  \n';
const UPDATED = 'Updated fleet note\n\n  Ω literal whitespace  \n';
async function fixture(t, options = {}) {
  assert.equal(
    typeof createDeepAgentsMemoryFixture,
    'function',
    'Missing actual compiled Memory fixture'
  );
  const handle = createDeepAgentsMemoryFixture(options);
  const server = createServer(async (req, res) => {
    if (
      !(await handle(req, res, new URL(req.url, 'http://localhost').pathname))
    ) {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await handle.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = new Client({
    apiUrl: base + '/api',
    apiKey: null,
    callerOptions: { maxRetries: 0 },
  });
  const control = async (body) => {
    const r = await fetch(base + '/__configure', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    assert.equal(r.status, 200);
  };
  const diagnostics = async (name) => (await fetch(base + '/__' + name)).json();
  const scope = randomUUID();
  const thread = (
    await client.threads.create({ threadId: randomUUID(), ifExists: 'raise' })
  ).thread_id;
  const stream = (
    target = thread,
    memory_scope = scope,
    id = randomUUID(),
    streamMode = [
      'values',
      'messages-tuple',
      'updates',
      'custom',
      'checkpoints',
    ]
  ) =>
    client.runs.stream(target, 'da-memory', {
      input: { messages: [{ type: 'human', id, content: 'Offline dispatch' }] },
      context: { memory_scope },
      streamMode,
      streamSubgraphs: true,
    });
  const submit = async (...args) => {
    const events = [];
    for await (const e of stream(...args)) events.push(e);
    return events;
  };
  return {
    handle,
    server,
    base,
    client,
    control,
    diagnostics,
    scope,
    thread,
    stream,
    submit,
  };
}
const observations = (events) =>
  events.filter((e) => e.event === 'custom').map((e) => e.data.data);
test('a length-shaped object cannot become an authored compiled human array', async t => {
  const f = await fixture(t);
  const response = await fetch(f.base + '/api/threads/' + f.thread + '/runs/stream', {
    method: 'POST', body: JSON.stringify({ assistant_id: 'da-memory',
      input: { messages: { 0: { type: 'human', id: randomUUID(), content: 'Malformed nonarray input' }, length: 1 } },
      context: { memory_scope: f.scope }, stream_mode: ['values', 'custom'] }),
  });
  await response.text();
  const raw = await f.diagnostics('raw-events');
  writeFileSync(join(captures, 'nonarray-rejection.json'), JSON.stringify({ status: response.status, requests: await f.diagnostics('requests'), raw, proofs: await f.diagnostics('graph-proof') }, null, 2));
  assert.equal(response.status, 400);
  assert.deepEqual(raw, []);
  assert.equal((await f.diagnostics('graph-proof')).filter(proof => proof.op === 'submit').length, 0);
});
test('actual canonical Angular SDK human wire gets one fixture-assigned message identity and genuine write', async t => {
  const f = await fixture(t);
  const human = { type: 'human', role: 'human', content: 'Angular genuine input\n\n Ω ' };
  const events = [];
  for await (const event of f.client.runs.stream(f.thread, 'da-memory', { input: { messages: [human] }, context: { memory_scope: f.scope }, streamMode: ['values', 'custom'] })) events.push(event);
  assert.deepEqual(observations(events).at(-1).memory_contents, { [FILE]: LITERAL });
  const state = await f.client.threads.getState(f.thread);
  const authored = state.values.messages.filter(m => m.type === 'human');
  assert.equal(authored.length, 1); assert.equal(authored[0].content, human.content);
  assert.match(authored[0].id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const captured = (await f.diagnostics('requests')).find(r => r.path.endsWith('/runs/stream'));
  assert.deepEqual(captured.body.input.messages, [human]); assert.equal(Object.hasOwn(captured.body.input.messages[0], 'id'), false);
  for (const bad of [{ ...human, role: 'assistant' }, { ...human, id: '' }, { ...human, extra: true }, { type: 'human', content: 'missing role' }]) {
    const response = await fetch(f.base + '/api/threads/' + f.thread + '/runs/stream', { method: 'POST', body: JSON.stringify({ assistant_id: 'da-memory', input: { messages: [bad] }, context: { memory_scope: f.scope }, stream_mode: ['values'] }) });
    assert.equal(response.status, 400);
  }
  const raw = await f.diagnostics('raw-events'); assert.equal(raw.length, 1);
  assert(raw[0].storeOperations.some(op => op.type === 'PutOp'));
  writeFileSync(join(captures, 'angular-sdk-wire.json'), JSON.stringify({ requests: await f.diagnostics('requests'), raw, state, proofs: await f.diagnostics('graph-proof') }, null, 2));
});
test(
  'real SDK two threads share actual scoped writes edits and pinned prompt recall; raw exact newest agrees',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const first = await f.submit();
    assert.deepEqual(
      observations(first).map((e) => e.phase),
      ['initial', 'model', 'model', 'terminal']
    );
    assert.deepEqual(observations(first)[0].memory_contents, {});
    assert.deepEqual(observations(first).at(-1).memory_contents, {
      [FILE]: LITERAL,
    });
    assert(
      first
        .filter((e) => e.event === 'values')
        .every(
          (e) =>
            !Object.hasOwn(e.data, 'memory_contents') &&
            !Object.hasOwn(e.data, 'memory_scope_owner')
        )
    );
    let saved = await f.client.threads.getState(f.thread);
    assert.deepEqual(saved.values.memory_contents, { [FILE]: LITERAL });
    assert.equal(saved.values.memory_scope_owner, f.scope);
    assert.deepEqual(
      first.filter((e) => e.event === 'checkpoints').at(-1).data.values
        .memory_contents,
      saved.values.memory_contents
    );
    assert.deepEqual(
      await f.client.threads.getState(f.thread, saved.checkpoint),
      saved
    );
    assert.deepEqual(
      (await f.client.threads.getHistory(f.thread, { limit: 1 }))[0],
      saved
    );
    assert.equal(
      saved.values.messages.filter((m) => m.type === 'tool')[0].status,
      'success'
    );
    await f.control({ scenario: 'edit' });
    await f.submit();
    saved = await f.client.threads.getState(f.thread);
    assert.deepEqual(saved.values.memory_contents, { [FILE]: UPDATED });
    const second = (
      await f.client.threads.create({ ifExists: 'raise', metadata: {} })
    ).thread_id;
    await f.control({ scenario: 'recall' });
    const recall = await f.submit(second);
    assert.deepEqual(observations(recall)[0].memory_contents, {
      [FILE]: UPDATED,
    });
    const third = (await f.client.threads.create()).thread_id;
    const otherScope = randomUUID();
    const isolated = await f.submit(third, otherScope);
    assert(
      observations(isolated).every(
        (e) =>
          Object.keys(e.memory_contents).length === 0 &&
          e.memory_scope_owner === otherScope
      )
    );
    const raw = await f.diagnostics('raw-events');
    assert(raw[2].modelPrompts.every((p) => p.includes('Updated fleet note')));
    assert(raw[3].modelPrompts.every((p) => !p.includes('Updated fleet note')));
    assert(raw[0].storeOperations.some((o) => o.type === 'PutOp'));
    const proof = await f.diagnostics('graph-proof');
    assert(
      proof.every(
        (p) =>
          p.actualCompiledGraph &&
          p.networkConnectAttempts === 0 &&
          p.workerSha256?.length === 64 &&
          p.sourceSha256['tests/model_support.py']
      )
    );
    writeFileSync(
      join(captures, 'scoped-sdk-proof.json'),
      JSON.stringify({ first, saved, recall, isolated, raw, proof }, null, 2),
      { mode: 0o400 }
    );
  }
);
for (const [scenario, content] of [
  ['recall', null],
  ['empty', ''],
  ['boundary', 'Ω'.repeat(32768)],
]) {
  test(
    `actual ${scenario} distinguishes missing empty and UTF8 bound`,
    { timeout: 30000 },
    async (t) => {
      const f = await fixture(t);
      await f.control({ scenario });
      const events = await f.submit();
      const expected = content === null ? {} : { [FILE]: content };
      assert.deepEqual(observations(events).at(-1).memory_contents, expected);
      assert.deepEqual(
        (await f.client.threads.getState(f.thread)).values.memory_contents,
        expected
      );
    }
  );
}
for (const [scenario, phases] of [
  ['fail-initial', []],
  ['fail-model', ['initial']],
  ['fail-terminal', ['initial', 'model', 'model']],
  ['oversize', ['initial', 'model']],
]) {
  test(
    `actual read failure ${scenario} forwards partial events without terminal confirmation`,
    { timeout: 30000 },
    async (t) => {
      const f = await fixture(t);
      await f.control({ scenario });
      const events = await f.submit();
      assert.deepEqual(
        observations(events).map((e) => e.phase),
        phases
      );
      assert.equal(events.at(-1).event, 'error');
      assert.equal(
        events.at(-1).data.message,
        'Memory graph operation failed.'
      );
      const raw = await f.diagnostics('raw-events');
      assert(raw[0].failure);
      if (scenario === 'fail-terminal') {
        const second = (await f.client.threads.create()).thread_id;
        await f.control({ scenario: 'recall' });
        assert.deepEqual(
          observations(await f.submit(second)).at(-1).memory_contents,
          { [FILE]: LITERAL }
        );
      }
    }
  );
}
test('ownership replay malformed context foreign checkpoints controls and unsupported SDK bodies fail closed', async (t) => {
  const f = await fixture(t);
  await f.submit(f.thread, f.scope, 'owned-human');
  await assert.rejects(() => f.submit(f.thread, f.scope, 'owned-human'));
  await f.control({ scenario: 'recall' });
  const mismatched = await f.submit(f.thread, randomUUID());
  assert.equal(mismatched.at(-1).event, 'error');
  const raw = await f.diagnostics('raw-events');
  assert.deepEqual(raw.at(-1).storeOperations, []);
  assert.deepEqual(raw.at(-1).modelPrompts, []);
  await assert.rejects(() => f.client.threads.getState(randomUUID()));
  const state = await f.client.threads.getState(f.thread);
  for (const cp of [
    { ...state.checkpoint, checkpoint_id: randomUUID() },
    { ...state.checkpoint, thread_id: randomUUID() },
    { ...state.checkpoint, checkpoint_ns: 'foreign' },
  ])
    await assert.rejects(() => f.client.threads.getState(f.thread, cp));
  for (const body of [
    { scenario: 'unknown' },
    { filePath: '/etc/passwd' },
    { holdStream: 'true' },
  ])
    assert.equal(
      (
        await fetch(f.base + '/__configure', {
          method: 'POST',
          body: JSON.stringify(body),
        })
      ).status,
      400
    );
  const body = {
    assistant_id: 'da-memory',
    input: {
      messages: [{ type: 'human', id: randomUUID(), content: 'offline' }],
    },
    context: { memory_scope: f.scope },
    stream_mode: ['values'],
  };
  for (const change of [
    { assistant_id: 'foreign' },
    { context: {} },
    { context: { memory_scope: f.scope, extra: true } },
    { command: { resume: true } },
    { input: { messages: body.input.messages, memory_contents: {} } },
    { stream_mode: ['unknown'] },
  ])
    assert.equal(
      (
        await fetch(f.base + `/api/threads/${f.thread}/runs/stream`, {
          method: 'POST',
          body: JSON.stringify({ ...body, ...change }),
        })
      ).status,
      400
    );
  assert.equal(
    (
      await fetch(f.base + '/__configure', {
        method: 'POST',
        body: 'x'.repeat(1024 * 1024 + 1),
      })
    ).status,
    413
  );
});
test('held stream cancellation and awaited worker shutdown preserve actual persistent write', async (t) => {
  const f = await fixture(t);
  await f.control({ holdStream: true });
  const stream = f.stream();
  const meta = await stream.next();
  await f.client.runs.cancel(
    f.thread,
    meta.value.data.run_id,
    true,
    'interrupt'
  );
  assert.equal((await stream.next()).done, true);
  assert.deepEqual(
    (await f.client.threads.getState(f.thread)).values.memory_contents,
    { [FILE]: LITERAL }
  );
  const life = await f.diagnostics('lifetime');
  await Promise.all([f.handle.close(), f.handle.close()]);
  assert.throws(() => process.kill(life.workerPid, 0), { code: 'ESRCH' });
  assert.throws(() => process.kill(life.pythonPid, 0), { code: 'ESRCH' });
});
for (const [name, script, timeout] of [
  [
    'oversized frame',
    'process.stdin.once("data",()=>process.stdout.write(Buffer.alloc(16*1024*1024+1,0x78)));setInterval(()=>{},1000)',
    6000,
  ],
  [
    'malformed frame',
    'process.stdin.once("data",()=>process.stdout.write("invalid\\n"));setInterval(()=>{},1000)',
    6000,
  ],
  [
    'unowned frame',
    'process.stdin.once("data",()=>process.stdout.write("{\\"requestId\\":9999}\\n"));setInterval(()=>{},1000)',
    6000,
  ],
  ['timeout', 'setInterval(()=>{},1000)', 100],
])
  test(
    `worker ${name} fails closed and terminates owned process`,
    { timeout: 12000 },
    async (t) => {
      assert.equal(typeof createDeepAgentsMemoryFixture, 'function');
      let child;
      const handle = createDeepAgentsMemoryFixture({
        workerTimeoutMs: timeout,
        spawnWorker: () =>
          (child = spawn(process.execPath, ['-e', script], {
            stdio: ['pipe', 'pipe', 'pipe'],
          })),
      });
      const server = createServer((req, res) =>
        handle(req, res, new URL(req.url, 'http://localhost').pathname)
      );
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      t.after(async () => {
        await handle.close();
        server.closeAllConnections();
        await new Promise((r) => server.close(r));
      });
      const sdk = new Client({
        apiUrl: `http://127.0.0.1:${server.address().port}/api`,
        callerOptions: { maxRetries: 0 },
      });
      const started = performance.now();
      await assert.rejects(() =>
        sdk.threads.create({ threadId: randomUUID(), ifExists: 'raise' })
      );
      await handle.close();
      assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
      if (timeout === 6000) assert(performance.now() - started < 3000);
    }
  );
import { test } from 'node:test';
test('actual read_file and mode filtering preserve captured payloads and tool arguments', async (t) => {
  const f = await fixture(t);
  await f.submit();
  await f.control({ scenario: 'read' });
  const events = await f.submit(f.thread, f.scope, randomUUID(), ['custom']);
  assert(events.every((e) => ['metadata', 'custom'].includes(e.event)));
  const raw = await f.diagnostics('raw-events');
  assert.deepEqual(
    events.filter((e) => e.event === 'custom').map((e) => e.data),
    raw
      .at(-1)
      .events.filter(([ns, kind]) => kind === 'custom' && !ns.length)
      .map((e) => e[2])
  );
  const state = await f.client.threads.getState(f.thread);
  const calls = state.values.messages.flatMap((m) => m.tool_calls ?? []);
  assert.deepEqual(
    calls.map((c) => [c.name, c.args]),
    [
      ['write_file', { file_path: FILE, content: LITERAL }],
      ['read_file', { file_path: FILE }],
    ]
  );
  const tools = state.values.messages.filter((m) => m.type === 'tool');
  assert(tools.every((m) => m.status === 'success'));
  assert(tools.at(-1).content.includes('Fleet note'));
});
test('close rejects pending graph requests and releases held current and exact reads', async (t) => {
  const f = await fixture(t);
  await f.submit();
  const state = await f.client.threads.getState(f.thread);
  await f.control({ holdState: true, holdCheckpoint: true });
  const current = f.client.threads.getState(f.thread);
  const exact = f.client.threads.getState(f.thread, state.checkpoint);
  // Observe both actual reads reaching the held delivery boundary.
  for (let i = 0; i < 100; i++) {
    if ((await f.diagnostics('lifetime')).held === 2) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal((await f.diagnostics('lifetime')).held, 2);
  const failures = Promise.allSettled([current, exact]);
  await f.handle.close();
  assert((await failures).every((r) => r.status === 'rejected'));
});
test(
  'close awaits worker exit while an actual request is pending',
  { timeout: 10000 },
  async (t) => {
    let child;
    const handle = createDeepAgentsMemoryFixture({
      workerTimeoutMs: 6000,
      spawnWorker: () =>
        (child = spawn(
          process.execPath,
          [
            '-e',
            'process.stdin.once("data",()=>process.stderr.write("ready"));setInterval(()=>{},1000)',
          ],
          { stdio: ['pipe', 'pipe', 'pipe'] }
        )),
    });
    const server = createServer((req, res) =>
      handle(req, res, new URL(req.url, 'http://localhost').pathname)
    );
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(async () => {
      await handle.close();
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    });
    const client = new Client({
      apiUrl: `http://127.0.0.1:${server.address().port}/api`,
      callerOptions: { maxRetries: 0 },
    });
    const pending = client.threads.create({
      threadId: randomUUID(),
      ifExists: 'raise',
    });
    const rejected = assert.rejects(() => pending);
    for (let i = 0; i < 100 && !child; i++)
      await new Promise((r) => setTimeout(r, 10));
    assert(child);
    await handle.close();
    await rejected;
    assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
  }
);
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
async function privateWorker(t) {
  const child = spawn(
    'uv',
    [
      'run',
      '--frozen',
      '--python',
      '3.12',
      '--project',
      'cockpit/deep-agents/memory/python',
      'python',
      'scripts/react-cockpit/deep-agents-memory-wire.py',
    ],
    {
      cwd: fileURLToPath(new URL('../../', import.meta.url)),
      stdio: ['pipe', 'pipe', 'pipe'],
    }
  );
  child.stderr.resume();
  const exit = once(child, 'exit');
  const lines = createInterface({ input: child.stdout });
  const iter = lines[Symbol.asyncIterator]();
  t.after(async () => {
    child.stdin.end();
    if (child.exitCode === null && child.signalCode === null)
      child.kill('SIGTERM');
    await exit;
    lines.close();
  });
  const send = async (body) => {
    child.stdin.write(JSON.stringify(body) + '\n');
    const value = await iter.next();
    assert.equal(value.done, false);
    return JSON.parse(value.value);
  };
  return { child, exit, send };
}
test(
  'private compiled worker rejects replayed request IDs unknown fields foreign roots and invalid bounded history',
  { timeout: 15000 },
  async (t) => {
    const w = await privateWorker(t),
      threadId = randomUUID();
    assert.equal(
      (await w.send({ requestId: 1, op: 'create', threadId })).proof
        .actualCompiledGraph,
      true
    );
    for (const [requestId, body] of [
      [2, { op: 'history', threadId, limit: 0 }],
      [
        3,
        {
          op: 'state',
          threadId,
          checkpoint: {
            thread_id: threadId,
            checkpoint_id: randomUUID(),
            checkpoint_ns: '',
          },
        },
      ],
      [4, { op: 'configure', scenario: 'recall', unexpected: true }],
      [
        5,
        {
          op: 'submit',
          threadId,
          messages: [{ type: 'human', id: 'x', content: 'offline' }],
          context: { memory_scope: randomUUID(), extra: true },
        },
      ],
    ])
      assert.equal(
        (await w.send({ requestId, ...body })).error,
        'Graph operation failed'
      );
    w.child.stdin.write(
      JSON.stringify({ requestId: 5, op: 'state', threadId }) + '\n'
    );
    await w.exit;
    assert.throws(() => process.kill(w.child.pid, 0), { code: 'ESRCH' });
  }
);
test(
  'private compiled worker rejects an oversized unterminated request before JSON decode',
  { timeout: 15000 },
  async (t) => {
    const w = await privateWorker(t);
    w.child.stdin.write(Buffer.alloc(1024 * 1024 + 1, 0x78));
    await w.exit;
    assert.throws(() => process.kill(w.child.pid, 0), { code: 'ESRCH' });
  }
);
test('fixture rejects spoofed host, methods, paths and controls without graph submission', async (t) => {
  const f = await fixture(t);
  const initial = (await f.diagnostics('graph-proof')).length;
  assert.equal(
    await new Promise((resolve, reject) => {
      const req = httpRequest(
        f.base + '/__requests',
        {
          headers: { host: 'foreign.example' },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        }
      );
      req.on('error', reject);
      req.end();
    }),
    400
  );
  assert.equal(
    (await fetch(f.base + '/__configure', { method: 'GET' })).status,
    405
  );
  assert.equal(
    (await fetch(f.base + '/__unknown', { method: 'POST', body: '{}' })).status,
    404
  );
  assert.equal(
    (await fetch(f.base + '/api/threads', { method: 'PUT', body: '{}' }))
      .status,
    404
  );
  assert.equal(
    (
      await fetch(f.base + '/__release', {
        method: 'POST',
        body: '{"extra":true}',
      })
    ).status,
    400
  );
  assert.equal((await f.diagnostics('graph-proof')).length, initial);
});
test(
  'timed out worker that ignores SIGTERM is forcibly terminated without fixture close',
  { timeout: 10000 },
  async (t) => {
    let child;
    const handle = createDeepAgentsMemoryFixture({
      workerTimeoutMs: 100,
      spawnWorker: () =>
        (child = spawn(
          process.execPath,
          ['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],
          { stdio: ['pipe', 'pipe', 'pipe'] }
        )),
    });
    const server = createServer((req, res) =>
      handle(req, res, new URL(req.url, 'http://localhost').pathname)
    );
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(async () => {
      await handle.close();
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    });
    const sdk = new Client({
      apiUrl: `http://127.0.0.1:${server.address().port}/api`,
      callerOptions: { maxRetries: 0 },
    });
    await assert.rejects(() =>
      sdk.threads.create({ threadId: randomUUID(), ifExists: 'raise' })
    );
    await new Promise((r) => setTimeout(r, 1800));
    assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
  }
);
test('Memory fixture exposes a real compiled worker SDK handler', () => {
  assert.equal(
    typeof createDeepAgentsMemoryFixture,
    'function',
    'Missing actual compiled Memory fixture'
  );
});
