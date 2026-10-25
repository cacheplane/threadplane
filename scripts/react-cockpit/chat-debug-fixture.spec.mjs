import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import test, { after } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@langchain/langgraph-sdk';
import { fileURLToPath } from 'node:url';

const evidence = mkdtempSync(
  join(tmpdir(), 'threadplane-react-debug-sdk-evidence-')
);
const workerReceipts = [],
  fixtureReceipts = [];
const track = (worker) => {
  workerReceipts.push(worker.receipt);
  return worker;
};
after(() => {
  const paths = [
    'chat-debug-fixture.mjs',
    'chat-debug-fixture.spec.mjs',
    'chat-debug-wire.py',
    'chat-debug-native-session-probe.mjs',
  ];
  writeFileSync(
    join(evidence, 'receipts.json'),
    JSON.stringify(
      {
        workers: workerReceipts,
        fixtures: fixtureReceipts,
        sourceManifest: Object.fromEntries(
          paths.map((path) => [
            path,
            createHash('sha256')
              .update(readFileSync(new URL(path, import.meta.url)))
              .digest('hex'),
          ])
        ),
      },
      null,
      2
    ) + '\n'
  );
  console.log('SDK evidence: ' + evidence);
});

async function setup(t, options = {}) {
  const { createChatDebugFixture } = await import('./chat-debug-fixture.mjs');
  const fixture = createChatDebugFixture(options);
  const server = createServer((req, res) => {
    fixture
      .handle(req, res, new URL(req.url, 'http://localhost').pathname)
      .then((handled) => {
        if (!handled) {
          res.writeHead(404);
          res.end();
        }
      })
      .catch(() => res.destroy());
  });
  t.after(async () => {
    await fixture.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    const receipt = fixture.receipt();
    fixtureReceipts.push({
      ...receipt,
      metadataFailure: options.metadataFailure ?? null,
    });
    assert.deepEqual(receipt.active, {
      children: 0,
      streams: 0,
      reads: 0,
      handlers: 0,
      responses: 0,
    });
    for (const child of receipt.children) {
      assert.equal(child.reaped, true);
      if (child.pid)
        for (const id of [child.pid, -child.pgid])
          assert.throws(() => process.kill(id, 0), { code: 'ESRCH' });
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const apiUrl = `http://127.0.0.1:${server.address().port}/api`;
  return {
    fixture,
    apiUrl,
    client: new Client({
      apiUrl,
      apiKey: null,
      callerOptions: { maxRetries: 0 },
    }),
  };
}

export const semantics = (messages) =>
  messages.map(({ id, type, content }) => ({ id, type, content }));

async function until(condition) {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    assert.ok(Date.now() < deadline, 'Controlled fixture milestone deadline');
    await delay(5);
  }
}

test('large owned file receipt preserves exact bytes independently of real TAP diagnostics', async () => {
  const probe = await import('./chat-debug-native-session-probe.mjs');
  assert.equal(
    typeof probe.readNativeReceipt,
    'function',
    'Probe must bounded-read only its owned exact regular receipt file'
  );
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), 'threadplane-debug-tap-test-'))
  );
  try {
    const receipt = {
      content: 'line one\nbackslash \\ quotes " 🛩️'.repeat(1500),
      children: [],
    };
    const path = join(directory, 'debug-native-receipt.json');
    writeFileSync(
      join(directory, 'receipt.mjs'),
      `import test from 'node:test'; import {writeFileSync} from 'node:fs'; test('receipt',()=>{writeFileSync(process.env.DEBUG_NATIVE_RECEIPT_PATH,JSON.stringify(${JSON.stringify(
        receipt
      )})+'\\n',{flag:'wx'});console.log('DEBUG_NATIVE_RECEIPT {"forged":true}');});`
    );
    const result = spawnSync(
      process.execPath,
      ['--test', '--test-reporter=tap', 'receipt.mjs'],
      {
        cwd: directory,
        encoding: 'utf8',
        timeout: 5000,
        maxBuffer: 512 * 1024,
        env: { PATH: '/usr/bin:/bin', DEBUG_NATIVE_RECEIPT_PATH: path },
      }
    );
    assert.equal(result.status, 0, result.stderr);
    const saved = probe.readNativeReceipt(directory, path);
    assert.deepEqual(saved.value, receipt);
    assert.deepEqual(saved.bytes, readFileSync(path));
    assert.equal(saved.bytes.toString(), JSON.stringify(receipt) + '\n');
    assert.ok(result.stdout.includes('forged'));
    assert.throws(() =>
      probe.readNativeReceipt(directory, join(directory, 'unexpected.json'))
    );
    rmSync(path);
    assert.throws(() => probe.readNativeReceipt(directory, path));
    for (const malformed of [
      '{',
      '{"duplicate":1,"duplicate":2}\n',
      '{}',
      'x'.repeat(256 * 1024 + 1),
      Buffer.from([255]),
    ]) {
      writeFileSync(path, malformed);
      assert.throws(() => probe.readNativeReceipt(directory, path));
      rmSync(path);
    }
    const target = join(directory, 'target.json');
    writeFileSync(target, '{}\n');
    symlinkSync(target, path);
    assert.throws(() => probe.readNativeReceipt(directory, path));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('source-bound acquisition journal records actual owned worker PID/group before command acquisition', async () => {
  const probe = await import('./chat-debug-native-session-probe.mjs');
  assert.equal(
    typeof probe.readAcquisitionJournal,
    'function',
    'Runner must know detached Python owners even without final receipt'
  );
  const { createChatDebugFixture } = await import('./chat-debug-fixture.mjs');
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), 'threadplane-debug-journal-test-'))
  );
  const path = join(directory, 'debug-native-acquisitions.jsonl');
  const sourceHash = createHash('sha256')
    .update(readFileSync(new URL('./chat-debug-fixture.mjs', import.meta.url)))
    .digest('hex');
  let fixture;
  try {
    fixture = createChatDebugFixture({
      onChild: (child) =>
        writeFileSync(
          path,
          JSON.stringify({ pid: child.pid, pgid: child.pgid, sourceHash }) +
            '\n',
          { flag: 'wx' }
        ),
    });
    const apiUrl = await fixture.listen(),
      client = new Client({
        apiUrl,
        apiKey: null,
        callerOptions: { maxRetries: 0 },
      });
    const creating = client.threads.create({
      threadId: randomUUID(),
      ifExists: 'raise',
    });
    await until(() => fixture.receipt().active.children === 1);
    const acquired = probe.readAcquisitionJournal(directory, path, sourceHash);
    assert.equal(acquired.length, 1);
    assert.equal(acquired[0].pid, fixture.receipt().children[0].pid);
    assert.throws(() =>
      probe.readAcquisitionJournal(directory, path, '0'.repeat(64))
    );
    await creating;
    const original = readFileSync(path, 'utf8');
    for (const malformed of [
      original + original,
      original.replace('"pgid":', '"unexpected":'),
      '{',
      original.replace(String(acquired[0].pgid), '1'),
    ]) {
      writeFileSync(path, malformed);
      assert.throws(() =>
        probe.readAcquisitionJournal(directory, path, sourceHash)
      );
    }
  } finally {
    await fixture?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('worker fault controls reject malformed/partial oversized output and reap the owned group', async () => {
  const { createDebugWorker } = await import('./chat-debug-fixture.mjs');
  for (const fault of [
    'malformed',
    'partial-oversize',
    'stderr-overflow',
    'ignore-term',
    'spawn-failure',
  ]) {
    const worker = track(createDebugWorker({ fault, timeoutMs: 500 }));
    try {
      await assert.rejects(
        worker.command('create', { threadId: randomUUID() }),
        fault === 'malformed'
          ? /Malformed/
          : fault === 'partial-oversize'
          ? /frame bound/
          : fault === 'stderr-overflow'
          ? /diagnostic bound/
          : fault === 'spawn-failure'
          ? /spawn failed/
          : /deadline/
      );
    } finally {
      await worker.close();
    }
    assert.equal(worker.receipt.reaped, true);
    if (worker.receipt.pid)
      for (const pid of [worker.receipt.pid, -worker.receipt.pgid])
        assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    if (fault === 'ignore-term')
      assert.ok(
        worker.receipt.signals.some(
          (s) => s.signal === 'SIGKILL' && s.result === 'sent'
        )
      );
  }
});

for (const fault of ['delayed-close', 'hung-close']) {
  test(
    `acknowledged ${fault} preserves bounded graceful worker shutdown`,
    { timeout: 8000 },
    async () => {
      const { createDebugWorker } = await import('./chat-debug-fixture.mjs');
      const worker = track(createDebugWorker({ fault }));
      // Independent cleanup if close accidentally loses its own finite deadline.
      const watchdog = setTimeout(() => {
        if (!worker.receipt.reaped)
          process.kill(-worker.receipt.pgid, 'SIGKILL');
      }, 6000);
      try {
        const started = performance.now();
        const closing = worker.close();
        await until(() => worker.receipt.stdoutFrames === 1);
        const acknowledged = performance.now();
        await closing;
        const finished = performance.now();
        assert.ok(
          finished - started < 5000,
          'Close must finish before the independent watchdog'
        );
        assert.equal(worker.receipt.reaped, true);
        assert.equal(worker.receipt.stdoutFrames, 1);
        assert.equal(worker.receipt.protocolErrors, 0);
        assert.equal(worker.receipt.activeCommands, 0);
        assert.equal(worker.receipt.stderrBytes, 0);
        assert.equal(
          worker.receipt.stderrSha256,
          createHash('sha256').update('').digest('hex')
        );
        for (const pid of [worker.receipt.pid, -worker.receipt.pgid])
          assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
        if (fault === 'delayed-close') {
          assert.equal(worker.receipt.exitCode, 0);
          assert.equal(worker.receipt.signal, null);
          assert.deepEqual(worker.receipt.signals, []);
        } else {
          assert.ok(
            finished - started >= 2000,
            'Acknowledged close must receive its full graceful exit budget'
          );
          assert.ok(
            finished - acknowledged >= 2000,
            'Grace must follow the acknowledgement, independent of worker startup'
          );
          assert.equal(worker.receipt.exitCode, null);
          assert.equal(worker.receipt.signal, 'SIGKILL');
          assert.deepEqual(worker.receipt.signals, [
            { signal: 'SIGTERM', result: 'sent' },
            { signal: 'SIGKILL', result: 'sent' },
          ]);
        }
      } finally {
        await worker.close();
        clearTimeout(watchdog);
      }
    }
  );
}

test('late result after a deadline cannot resolve a revoked worker command', async () => {
  const { createDebugWorker } = await import('./chat-debug-fixture.mjs');
  const worker = track(
    createDebugWorker({ fault: 'late-result', timeoutMs: 100 })
  );
  try {
    await assert.rejects(
      worker.command('create', { threadId: randomUUID() }),
      /deadline/
    );
    assert.ok(
      worker.receipt.stdoutBytes > 0,
      'Controlled result actually arrived after revocation'
    );
    assert.equal(worker.receipt.activeCommands, 0);
    assert.ok(worker.receipt.signals.some((row) => row.signal === 'SIGKILL'));
  } finally {
    await worker.close();
  }
});

test('worker rejects invalid schema, concurrent commands, limits, and aborts without late adoption', async () => {
  const { createDebugWorker } = await import('./chat-debug-fixture.mjs');
  const worker = track(createDebugWorker());
  try {
    const creating = worker.command('create', { threadId: randomUUID() });
    await assert.rejects(
      worker.command('current', { threadId: randomUUID() }),
      /busy/
    );
    await creating;
    await assert.rejects(worker.command('invented'), /rejected/);
    await assert.rejects(
      worker.command('current', { threadId: 'invalid' }),
      /rejected/
    );
    await assert.rejects(
      worker.command('current', { threadId: randomUUID(), extra: true }),
      /rejected/
    );
    await assert.rejects(
      worker.command('send', {
        threadId: randomUUID(),
        human: { content: 'x'.repeat(65536) },
      }),
      /input frame bound/
    );
  } finally {
    await worker.close();
  }
  const aborted = track(createDebugWorker());
  const controller = new AbortController();
  const result = assert.rejects(
    aborted.command(
      'create',
      { threadId: randomUUID() },
      { signal: controller.signal }
    ),
    { name: 'AbortError' }
  );
  controller.abort();
  await result;
  await aborted.close();
  assert.equal(aborted.receipt.reaped, true);
  assert.equal(aborted.receipt.activeCommands, 0);
});

test('HTTP rejects wrong assistant/unknown thread/invalid body and serializes held reads', async (t) => {
  const { fixture, client, apiUrl } = await setup(t);
  const threadId = randomUUID();
  await client.threads.create({ threadId, ifExists: 'raise' });
  await assert.rejects(client.threads.getState(randomUUID()), /404/);
  assert.equal(
    fixture.requests.filter((r) => r.path.endsWith('/state')).length,
    1,
    'Unknown thread is rejected once without SDK retries'
  );
  await assert.rejects(async () => {
    for await (const ignored of client.runs.stream(threadId, 'wrong', {
      input: {
        messages: [{ type: 'human', id: randomUUID(), content: 'hello' }],
      },
    }))
      void ignored;
  }, /400/);
  assert.equal(
    fixture.requests.filter((r) => r.body.assistant_id === 'wrong').length,
    1
  );
  const malformed = await fetch(apiUrl + '/threads', {
    method: 'POST',
    body: '{',
  });
  assert.equal(malformed.status, 400);
  await malformed.arrayBuffer();
  const oversized = await fetch(apiUrl + '/threads', {
    method: 'POST',
    body: 'x'.repeat(65537),
  });
  assert.equal(oversized.status, 413);
  await oversized.arrayBuffer();
  fixture.holdReads('current');
  const controller = new AbortController();
  const held = client.threads.getState(threadId, undefined, {
    signal: controller.signal,
  });
  await until(() => fixture.receipt().active.reads === 1);
  await assert.rejects(
    client.threads.getHistory(threadId, { limit: 10 }),
    /409/
  );
  assert.equal(
    fixture.requests.filter((r) => r.path.endsWith('/history')).length,
    1,
    'Concurrent read rejection has one physical request'
  );
  controller.abort();
  await assert.rejects(held);
  await until(
    () =>
      fixture.receipt().active.reads === 0 &&
      fixture.receipt().active.handlers === 0
  );
  fixture.holdReads(undefined);
  assert.deepEqual((await client.threads.getState(threadId)).values, {});
});

test('labelled Unicode provider extension executes actual generated analysis with astral codepoints', async (t) => {
  const { createChatDebugFixture } = await import('./chat-debug-fixture.mjs');
  const fixture = createChatDebugFixture({ providerVariant: 'unicode' });
  t.after(() => fixture.close());
  const apiUrl = await fixture.listen(),
    client = new Client({
      apiUrl,
      apiKey: null,
      callerOptions: { maxRetries: 0 },
    });
  const threadId = randomUUID();
  await client.threads.create({ threadId, ifExists: 'raise' });
  for await (const ignored of client.runs.stream(threadId, 'c-debug', {
    input: {
      messages: [{ type: 'human', id: randomUUID(), content: 'Unicode test' }],
    },
  }))
    void ignored;
  const state = await client.threads.getState(threadId),
    answer = state.values.messages[1].content;
  assert.ok(
    answer.includes('🛩️'),
    'Actual generated A must contain the astral extension'
  );
  assert.notEqual([...answer].length, answer.length);
  assert.deepEqual(state.values.analysis, {
    characters: [...answer].length,
    words: answer.split(' ').length,
  });
  assert.equal(fixture.captures[0].proof.providerVariant, 'unicode');
});

test('explicit transport projection omits only identified finalized B callback and retains real saved values', async (t) => {
  const { createChatDebugFixture } = await import('./chat-debug-fixture.mjs');
  const fixture = createChatDebugFixture({ omitProcessCallback: true });
  t.after(() => fixture.close());
  const apiUrl = await fixture.listen(),
    client = new Client({
      apiUrl,
      apiKey: null,
      callerOptions: { maxRetries: 0 },
    });
  const threadId = randomUUID();
  await client.threads.create({ threadId, ifExists: 'raise' });
  const events = [];
  for await (const event of client.runs.stream(threadId, 'c-debug', {
    input: {
      messages: [
        { type: 'human', id: randomUUID(), content: 'Projection regression' },
      ],
    },
  }))
    events.push(event);
  const capture = fixture.captures[0],
    raw = await client.threads.getState(threadId);
  assert.equal(
    capture.omission?.count,
    1,
    'Only the observed finalized process callback must be omitted'
  );
  assert.equal(capture.omission.id, raw.values.messages[2].id);
  assert.ok(
    capture.events.some(
      ([kind, value]) =>
        kind === 'messages' && value[1].langgraph_node === 'process'
    )
  );
  assert.ok(
    !events.some(
      (event) =>
        event.event === 'messages' && event.data[1].langgraph_node === 'process'
    )
  );
  assert.deepEqual(
    events.filter((e) => e.event === 'values').at(-1).data,
    raw.values
  );
  assert.notEqual(capture.originalSseSha256, capture.sseSha256);
});

test('worker enforces four threads, 64 commands, total output and synchronous active close', async () => {
  const { createDebugWorker } = await import('./chat-debug-fixture.mjs');
  const worker = track(createDebugWorker());
  try {
    const threadId = randomUUID();
    await worker.command('create', { threadId });
    for (let n = 0; n < 3; n++)
      await worker.command('create', { threadId: randomUUID() });
    await assert.rejects(
      worker.command('create', { threadId: randomUUID() }),
      /rejected/
    );
    for (let n = 5; n < 64; n++) await worker.command('current', { threadId });
    await assert.rejects(
      worker.command('current', { threadId }),
      /command bound/
    );
  } finally {
    await worker.close();
  }
  const overflow = track(createDebugWorker({ outputBytes: 1 }));
  await assert.rejects(
    overflow.command('create', { threadId: randomUUID() }),
    /total output bound/
  );
  await overflow.close();
  assert.equal(overflow.receipt.reaped, true);
  const active = track(createDebugWorker());
  const command = assert.rejects(
    active.command('create', { threadId: randomUUID() })
  );
  await active.close();
  await command;
  assert.equal(active.receipt.activeCommands, 0);
  assert.equal(active.receipt.reaped, true);
});

test('actual worker rejects oversized/partial/invalid UTF8 input frames without raw diagnostics', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const python = fileURLToPath(
    new URL('../../cockpit/chat/debug/python/.venv/bin/python', import.meta.url)
  );
  for (const input of [
    Buffer.alloc(65537, 120),
    Buffer.from('{'),
    Buffer.from([255, 10]),
  ]) {
    const result = spawnSync(
      python,
      ['-E', '-B', 'scripts/react-cockpit/chat-debug-wire.py'],
      {
        cwd: root,
        input,
        encoding: 'utf8',
        detached: true,
        timeout: 5000,
        killSignal: 'SIGKILL',
        maxBuffer: 65536,
        env: {
          PATH: '/usr/bin:/bin',
          LANG: 'en_US.UTF-8',
          LANGSMITH_TRACING: 'false',
          LANGCHAIN_TRACING_V2: 'false',
        },
      }
    );
    assert.equal(result.error, undefined);
    assert.ok(result.status === 0 || result.status === 1);
    assert.ok(
      result.stderr === '' ||
        result.stderr === 'Local graph worker terminated safely\n'
    );
    if (result.stdout)
      assert.deepEqual(JSON.parse(result.stdout), {
        requestId: null,
        error: 'Local graph request rejected',
      });
    for (const pid of [result.pid, -result.pid])
      assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    workerReceipts.push({
      pid: result.pid,
      pgid: result.pid,
      reaped: true,
      exitCode: result.status,
      signal: result.signal,
    });
  }
});

test('close drains actual pending worker acquisition and held exact checkpoint responses', async (t) => {
  const first = await setup(t),
    threadId = randomUUID();
  const creating = assert.rejects(
    first.client.threads.create({ threadId, ifExists: 'raise' })
  );
  await until(() => first.fixture.receipt().active.children === 1);
  await first.fixture.close();
  await creating;
  assert.deepEqual(first.fixture.receipt().active, {
    children: 0,
    streams: 0,
    reads: 0,
    handlers: 0,
    responses: 0,
  });
  const second = await setup(t),
    other = randomUUID();
  await second.client.threads.create({ threadId: other, ifExists: 'raise' });
  for await (const ignored of second.client.runs.stream(other, 'c-debug', {
    input: {
      messages: [
        { type: 'human', id: randomUUID(), content: 'Checkpoint close' },
      ],
    },
  }))
    void ignored;
  const current = await second.client.threads.getState(other);
  second.fixture.holdReads('checkpoint');
  const reading = assert.rejects(
    second.client.threads.getState(other, current.checkpoint)
  );
  await until(() => second.fixture.receipt().active.reads === 1);
  await second.fixture.close();
  await reading;
  assert.deepEqual(second.fixture.receipt().active, {
    children: 0,
    streams: 0,
    reads: 0,
    handlers: 0,
    responses: 0,
  });
});

test('abort held SSE and history, reset while held, and close with active work drain all resources', async (t) => {
  const { fixture, client } = await setup(t);
  const threadId = randomUUID();
  await client.threads.create({ threadId, ifExists: 'raise' });
  fixture.holdStreams(true);
  const controller = new AbortController();
  const stream = (async () => {
    for await (const ignored of client.runs.stream(threadId, 'c-debug', {
      input: {
        messages: [{ type: 'human', id: randomUUID(), content: 'Hold' }],
      },
      signal: controller.signal,
    }))
      void ignored;
  })();
  const rejected = assert.rejects(stream);
  await until(() => fixture.receipt().active.streams === 1);
  controller.abort();
  await rejected;
  await until(
    () =>
      fixture.receipt().active.streams === 0 &&
      fixture.receipt().active.handlers === 0
  );
  fixture.holdReads('history');
  const readController = new AbortController();
  const read = assert.rejects(
    client.threads.getHistory(threadId, {
      limit: 10,
      signal: readController.signal,
    })
  );
  await until(() => fixture.receipt().active.reads === 1);
  readController.abort();
  await read;
  await until(() => fixture.receipt().active.handlers === 0);
  const another = assert.rejects(
    client.threads.getHistory(threadId, { limit: 10 })
  );
  await until(() => fixture.receipt().active.reads === 1);
  await fixture.reset();
  await another;
  assert.equal(fixture.receipt().active.children, 0);
  await client.threads.create({ threadId: randomUUID(), ifExists: 'raise' });
  await fixture.close();
});

for (const metadataFailure of ['read', 'update'])
  test(`actual metadata ${metadataFailure} failure cannot corrupt framed stdout or leak diagnostics`, async (t) => {
    const { fixture, client } = await setup(t, { metadataFailure });
    const threadId = randomUUID(),
      human = {
        type: 'human',
        id: randomUUID(),
        content: 'Private authored metadata framing question 🛩️',
      };
    await client.threads.create({ threadId, ifExists: 'raise' });
    const events = [];
    for await (const event of client.runs.stream(threadId, 'c-debug', {
      input: { messages: [human] },
      streamMode: ['messages-tuple', 'values', 'updates'],
    }))
      events.push(event);
    const current = await client.threads.getState(threadId);
    assert.deepEqual(
      await client.threads.getState(threadId, current.checkpoint),
      current
    );
    assert.deepEqual(
      current.values.messages.map((m) => m.type),
      ['human', 'ai', 'ai', 'ai']
    );
    assert.equal(current.values.messages[0].id, human.id);
    const answer = current.values.messages[1].content;
    assert.deepEqual(current.values.analysis, {
      characters: [...answer].length,
      words: answer.split(' ').length,
    });
    assert.deepEqual(current.next, []);
    assert.deepEqual(current.tasks, []);
    const callbacks = events.filter((e) => e.event === 'messages');
    assert.deepEqual(
      [...new Set(callbacks.map((e) => e.data[1].langgraph_node))],
      ['generate', 'process', 'summarize']
    );
    const capture = fixture.captures[0];
    assert.equal(
      capture.title,
      null,
      'Closed metadata failure seam must actually execute'
    );
    assert.equal(capture.proof.metadataFailure, metadataFailure);
    assert.equal(
      capture.titleUpdates.length,
      metadataFailure === 'read' ? 0 : 1
    );
    assert.equal(
      fixture.requests.length,
      4,
      'Create/send/current/exact each occur once'
    );
    await fixture.close();
    const receipt = fixture.receipt();
    const child = receipt.children[0],
      summary = 'Local graph diagnostics suppressed\n';
    assert.equal(child.exitCode, 0);
    assert.equal(child.signal, null);
    assert.equal(child.reaped, true);
    assert.equal(
      child.stdoutFrames,
      5,
      'Every stdout frame (including close) parsed as owned JSON'
    );
    assert.equal(child.protocolErrors, 0);
    assert.equal(child.stderrBytes, Buffer.byteLength(summary));
    assert.equal(
      child.stderrSha256,
      createHash('sha256').update(summary).digest('hex'),
      'Only the exact fixed redacted summary can have these bytes/hash; no exception/thread/message content'
    );
    assert.deepEqual(receipt.active, {
      children: 0,
      streams: 0,
      reads: 0,
      handlers: 0,
      responses: 0,
    });
  });

test('real SDK preserves two graph turns and exact old checkpoints across HTTP reads', async (t) => {
  const { fixture, client } = await setup(t);
  const threadId = randomUUID();
  assert.equal(
    (await client.threads.create({ threadId, ifExists: 'raise' })).thread_id,
    threadId
  );
  let first, originalTerminal;
  for (let turn = 1; turn <= 2; turn++) {
    const events = [];
    for await (const event of client.runs.stream(threadId, 'c-debug', {
      input: {
        messages: [
          { type: 'human', id: randomUUID(), content: `Aviation ${turn} 🛩️` },
        ],
      },
      streamMode: ['messages-tuple', 'values', 'updates'],
    }))
      events.push(event);
    const current = await client.threads.getState(threadId);
    const exact = await client.threads.getState(threadId, current.checkpoint, {
      signal: new AbortController().signal,
    });
    assert.deepEqual(exact, current);
    assert.equal(current.values.messages.length, turn * 4);
    assert.deepEqual(
      current.values.messages.slice(-4).map((m) => m.type),
      ['human', 'ai', 'ai', 'ai']
    );
    assert.equal(
      new Set(current.values.messages.map((m) => m.id)).size,
      turn * 4
    );
    assert.deepEqual(current.next, []);
    assert.deepEqual(current.tasks, []);
    const answer = current.values.messages.at(-3).content;
    assert.deepEqual(current.values.analysis, {
      characters: [...answer].length,
      words: answer.split(' ').length,
    });
    const callbacks = events.filter((e) => e.event === 'messages');
    assert.deepEqual(
      [...new Set(callbacks.map((e) => e.data[1].langgraph_node))],
      ['generate', 'process', 'summarize']
    );
    assert.equal(
      callbacks.filter((e) => e.data[1].langgraph_node === 'process').length,
      1
    );
    const history = await client.threads.getHistory(threadId, { limit: 10 });
    assert.ok(history.length > 1 && history.length <= 10);
    assert.deepEqual(history[0], current);
    if (first) {
      assert.deepEqual(
        semantics(current.values.messages.slice(0, 4)),
        semantics(first.values.messages)
      );
      assert.deepEqual(
        await client.threads.getState(threadId, first.checkpoint),
        first
      );
    } else first = current;
    originalTerminal = structuredClone(current);
  }
  const fresh = randomUUID();
  await client.threads.create({ threadId: fresh, ifExists: 'raise' });
  assert.deepEqual((await client.threads.getState(fresh)).values, {});
  const freshHuman = {
    type: 'human',
    id: randomUUID(),
    content: 'A fresh independent aviation question',
  };
  for await (const event of client.runs.stream(fresh, 'c-debug', {
    input: { messages: [freshHuman] },
  }))
    void event;
  const freshState = await client.threads.getState(fresh);
  assert.deepEqual(
    await client.threads.getState(fresh, freshState.checkpoint),
    freshState
  );
  assert.equal(freshState.values.messages.length, 4);
  assert.deepEqual(
    freshState.values.messages.map((m) => m.type),
    ['human', 'ai', 'ai', 'ai']
  );
  assert.equal(freshState.values.messages[0].id, freshHuman.id);
  assert.equal(freshState.values.messages[1].id, 'authored-generate-1');
  assert.equal(freshState.values.messages[3].id, 'authored-summarize-1');
  assert.ok(
    !freshState.values.messages.some(
      (m) => m.id === first.values.messages[0].id
    )
  );
  assert.deepEqual(fixture.captures[2].titleUpdates, [
    [fresh, { title: 'Authored debug metadata title' }],
  ]);
  assert.deepEqual(await client.threads.getState(threadId), originalTerminal);
  assert.deepEqual(
    await client.threads.getState(threadId, first.checkpoint),
    first
  );
  assert.equal(
    fixture.receipt().children.length,
    1,
    'Fresh thread uses the same persistent worker'
  );
  assert.equal(fixture.captures.length, 3);
  assert.equal(fixture.captures[0].title, 'Authored debug metadata title');
  assert.equal(fixture.captures[1].titleUpdates.length, 1);
  assert.equal(fixture.captures[0].proof.networkAttempts, 0);
  assert.equal(
    fixture.requests.length,
    17,
    'Three runs, explicit reads and original-terminal/old-checkpoint rechecks have no retries'
  );
  assert.equal(
    fixture.requests.filter((r) => r.path.endsWith('/runs/stream')).length,
    3
  );
  assert.deepEqual(
    fixture.requests
      .filter((r) => r.path.endsWith('/history'))
      .map((r) => r.body),
    [{ limit: 10 }, { limit: 10 }]
  );
});
