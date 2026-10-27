import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { Client } from '@langchain/langgraph-sdk';

const { createDeepAgentsFilesystemFixture } = await import(
  './deep-agents-filesystem-fixture.mjs'
).catch(() => ({}));

async function fixture(t, options) {
  assert.equal(
    typeof createDeepAgentsFilesystemFixture,
    'function',
    'Filesystem compiled-graph fixture exists'
  );
  const handle = createDeepAgentsFilesystemFixture(options);
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
    await new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = new Client({
    apiUrl: base + '/api',
    callerOptions: { maxRetries: 0 },
  });
  const thread = randomUUID();
  await client.threads.create({ threadId: thread, ifExists: 'raise' });
  const control = async (body) => {
    const response = await fetch(base + '/__configure', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 200);
  };
  const stream = (
    content = 'Plan the KSFO to KASE flight.',
    id = randomUUID()
  ) =>
    client.runs.stream(thread, 'da-filesystem', {
      input: { messages: [{ type: 'human', id, content }] },
      streamMode: ['messages-tuple', 'values', 'updates', 'checkpoints'],
      streamSubgraphs: true,
      streamResumable: true,
      onDisconnect: 'continue',
    });
  const submit = async (content, id = randomUUID()) => {
    const events = [];
    for await (const event of stream(content, id)) events.push(event);
    return {
      events,
      id,
      run: events.find((e) => e.event === 'metadata').data.run_id,
    };
  };
  return { handle, base, client, thread, control, stream, submit };
}

function toolResults(state, ids) {
  return state.values.messages.filter(
    (m) => m.type === 'tool' && ids.includes(m.tool_call_id)
  );
}

test('installed SDK preserves actual pause, exact checkpoint, resume body and terminal files', async (t) => {
  const f = await fixture(t);
  const pausedRun = await f.submit();
  const paused = await f.client.threads.getState(f.thread);
  assert.equal(
    paused.values.files['/notes/kase.txt'].content,
    'KASE field elevation is 7820 ft.'
  );
  assert.equal(Object.hasOwn(paused.values.files, '/reports/kase.md'), false);
  assert.equal(paused.tasks.flatMap((t) => t.interrupts).length, 1);
  const batch = paused.tasks.flatMap((t) => t.interrupts)[0].value;
  assert.equal(batch.action_requests.length, 1);
  assert.equal(batch.review_configs.length, 1);
  assert.equal(
    (await f.client.runs.get(f.thread, pausedRun.run)).status,
    'success'
  );
  assert.deepEqual(
    await f.client.threads.getState(f.thread, paused.checkpoint),
    paused
  );
  assert.equal(
    (await f.client.threads.getHistory(f.thread, { limit: 100 }))[0].checkpoint
      .checkpoint_id,
    paused.checkpoint.checkpoint_id
  );
  const events = [];
  for await (const e of f.client.runs.stream(f.thread, 'da-filesystem', {
    command: { resume: { decisions: [{ type: 'approve' }] } },
    streamMode: ['values', 'messages-tuple', 'updates', 'checkpoints'],
  }))
    events.push(e);
  const terminal = await f.client.threads.getState(f.thread);
  assert.equal(
    terminal.values.files['/reports/kase.md'].content,
    'KASE assessment ready.'
  );
  assert.deepEqual(terminal.next, []);
  assert.deepEqual(terminal.tasks, []);
  const requests = await (await fetch(f.base + '/__requests')).json();
  assert.deepEqual(requests.find((r) => r.body.command)?.body.command, {
    resume: { decisions: [{ type: 'approve' }] },
  });
  assert.deepEqual(
    requests.find((r) => r.path.endsWith('/state/checkpoint')).body,
    { checkpoint: paused.checkpoint }
  );
  const proofs = await (await fetch(f.base + '/__graph-proof')).json();
  assert(
    proofs.every((p) => p.actualCompiledGraph && p.networkConnectAttempts === 0)
  );
});

test('reject, replay and mismatched decisions cannot optimistically write', async (t) => {
  const f = await fixture(t);
  await f.submit();
  const resume = async (decisions) => {
    for await (const e of f.client.runs.stream(f.thread, 'da-filesystem', {
      command: { resume: { decisions } },
      streamMode: ['values'],
    })) {
    }
  };
  await assert.rejects(resume([]));
  await resume([{ type: 'reject' }]);
  assert.equal(
    Object.hasOwn(
      (await f.client.threads.getState(f.thread)).values.files,
      '/reports/kase.md'
    ),
    false
  );
  await assert.rejects(resume([{ type: 'approve' }]));
  await assert.rejects(f.client.threads.getState(randomUUID()));
});

async function decide(f, types) {
  const events = [];
  for await (const e of f.client.runs.stream(f.thread, 'da-filesystem', {
    command: { resume: { decisions: types.map((type) => ({ type })) } },
    streamMode: ['values', 'messages-tuple', 'updates', 'checkpoints'],
  }))
    events.push(e);
  return events;
}
for (const scenario of [
  'batch',
  'duplicates',
  'reject-reproposal',
  'delete',
  'overwrite',
  'edit',
  'write-error',
  'empty',
  'no-files',
  'read-only',
  'unchanged',
]) {
  test(`actual SDK scenario ${scenario}`, async (t) => {
    const f = await fixture(t);
    await f.control({ scenario });
    await f.submit();
    let saved = await f.client.threads.getState(f.thread);
    if (['batch', 'duplicates'].includes(scenario)) {
      const b = saved.tasks.flatMap((t) => t.interrupts)[0].value;
      assert.equal(b.action_requests.length, 2);
      assert.equal(b.review_configs.length, 2);
      if (scenario === 'duplicates')
        assert.equal(
          b.action_requests[0].args.file_path,
          b.action_requests[1].args.file_path
        );
      await assert.rejects(decide(f, ['approve']));
      await decide(f, ['approve', 'approve']);
      saved = await f.client.threads.getState(f.thread);
      assert(Object.hasOwn(saved.values.files, '/reports/kase.md'));
    } else if (scenario === 'reject-reproposal') {
      await decide(f, ['reject']);
      saved = await f.client.threads.getState(f.thread);
      assert.equal(
        Object.hasOwn(saved.values.files, '/reports/kase.md'),
        false
      );
      assert.equal(
        saved.tasks.flatMap((t) => t.interrupts)[0].value.action_requests[0]
          .args.content,
        'Revised assessment'
      );
      await decide(f, ['approve']);
      saved = await f.client.threads.getState(f.thread);
      assert.equal(
        saved.values.files['/reports/kase.md'].content,
        'Revised assessment'
      );
    } else if (scenario === 'delete') {
      await decide(f, ['approve']);
      saved = await f.client.threads.getState(f.thread);
      assert.equal(
        saved.tasks.flatMap((t) => t.interrupts)[0].value.action_requests[0]
          .name,
        'delete'
      );
      await decide(f, ['approve']);
      saved = await f.client.threads.getState(f.thread);
      assert.deepEqual(saved.values.files, {});
    } else if (scenario === 'overwrite')
      assert.equal(
        saved.values.files['/notes/kase.txt'].content,
        'Replacement'
      );
    else if (scenario === 'edit')
      assert.equal(
        saved.values.files['/notes/kase.txt'].content,
        'Aspen field elevation is 7820 ft.'
      );
    else if (scenario === 'empty')
      assert.equal(saved.values.files['/notes/empty.txt'].content, '');
    else if (scenario === 'write-error') {
      assert.deepEqual(saved.values.files, {});
      assert(
        saved.values.messages.some(
          (m) => m.type === 'tool' && m.status === 'error'
        )
      );
    } else assert.deepEqual(saved.values.files ?? {}, {});
    assert.deepEqual(saved.next, []);
    assert.deepEqual(saved.tasks, []);
  });
}

test('cancellation stops held delivery without rollback; cleanup closes owned child', async (t) => {
  const f = await fixture(t);
  await f.control({ holdStream: true });
  const stream = f.stream();
  const metadata = await stream.next();
  const run = metadata.value.data.run_id;
  await f.client.runs.cancel(f.thread, run, true, 'interrupt');
  assert.equal((await stream.next()).done, true);
  assert.equal((await f.client.runs.get(f.thread, run)).status, 'interrupted');
  assert.equal(
    (await f.client.threads.getState(f.thread)).values.files['/notes/kase.txt']
      .content,
    'KASE field elevation is 7820 ft.'
  );
  const life = await (await fetch(f.base + '/__lifetime')).json();
  assert.equal(life.held, 0);
  await f.handle.close();
  assert.throws(() => process.kill(life.workerPid, 0), { code: 'ESRCH' });
});

test('owned exact checkpoint and stream bodies reject foreign and unsupported inputs', async (t) => {
  const f = await fixture(t);
  await f.submit();
  const saved = await f.client.threads.getState(f.thread);
  await assert.rejects(
    f.client.threads.getState(f.thread, {
      ...saved.checkpoint,
      thread_id: randomUUID(),
    })
  );
  await assert.rejects(
    f.client.threads.getState(f.thread, {
      ...saved.checkpoint,
      checkpoint_id: randomUUID(),
    })
  );
  await assert.rejects(async () => {
    for await (const e of f.client.runs.stream(f.thread, 'da-filesystem', {
      input: {
        messages: [{ type: 'human', id: randomUUID(), content: 'Override' }],
        files: {},
      },
      streamMode: ['values'],
    })) {
    }
  });
  assert.deepEqual(
    (await f.client.threads.getState(f.thread)).values,
    saved.values
  );
});
test('current-state GET rejects foreign checkpoint bodies between owned threads', async (t) => {
  const f = await fixture(t);
  const other = randomUUID();
  await f.client.threads.create({ threadId: other, ifExists: 'raise' });
  await f.submit();
  for await (const unused of f.client.runs.stream(other, 'da-filesystem', {
    input: {
      messages: [
        { type: 'human', id: 'other-human', content: 'Other thread.' },
      ],
    },
    streamMode: ['values'],
  })) {
    /* Consume the actual other thread graph. */
  }
  const foreign = await f.client.threads.getState(other);
  const current = await f.client.threads.getState(f.thread);
  const body = JSON.stringify({ checkpoint: foreign.checkpoint });
  const status = await new Promise((resolve, reject) => {
    const req = request(
      f.base + `/api/threads/${f.thread}/state`,
      {
        method: 'GET',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      },
      (res) => {
        res.resume();
        res.once('end', () => resolve(res.statusCode));
      }
    );
    req.once('error', reject);
    req.end(body);
  });
  assert.equal(
    status,
    400,
    'current-state GET must reject a checkpoint request body'
  );
  assert.deepEqual(
    (await f.client.threads.getState(f.thread)).values,
    current.values
  );
});

test('two paused owners retain independent deterministic responses across resumes', async (t) => {
  const f = await fixture(t);
  await f.control({ scenario: 'reject-reproposal' });
  const a = await f.submit('A', 'human-a');
  await f.control({ scenario: 'normal' });
  const b = randomUUID();
  await f.client.threads.create({ threadId: b, ifExists: 'raise' });
  for await (const e of f.client.runs.stream(b, 'da-filesystem', {
    input: { messages: [{ type: 'human', id: 'human-b', content: 'B' }] },
    streamMode: ['values'],
  })) {
  }
  await decide(f, ['reject']);
  let state = await f.client.threads.getState(f.thread);
  assert.equal(
    state.tasks.flatMap((t) => t.interrupts)[0].value.action_requests[0].args
      .content,
    'Revised assessment'
  );
  assert.equal(state.values.messages.at(-1).id, 'human-a-model-2');
  await decide(f, ['approve']);
  state = await f.client.threads.getState(f.thread);
  assert.equal(state.values.messages.at(-1).id, 'human-a-answer');
  assert.equal(
    (await f.client.threads.getState(b)).values.messages.at(-1).id,
    'human-b-model-1'
  );
  const proofs = await (await fetch(f.base + '/__graph-proof')).json();
  assert(
    proofs
      .filter((p) => p.op === 'resume' && p.threadId === f.thread)
      .every((p) => p.scenario === 'reject-reproposal')
  );
});

test('private controls validate bodies, release held state and fail creation/stream/checkpoint once', async (t) => {
  const f = await fixture(t);
  assert.equal(
    (
      await fetch(f.base + '/__configure', {
        method: 'POST',
        body: JSON.stringify({ scenario: 'synthetic-malformed' }),
      })
    ).status,
    400
  );
  await f.control({ failCreation: true });
  await assert.rejects(
    f.client.threads.create({ threadId: randomUUID(), ifExists: 'raise' })
  );
  await f.control({ failStream: true });
  await assert.rejects(f.submit());
  await f.submit();
  const state = await f.client.threads.getState(f.thread);
  await f.control({ failCheckpoint: true });
  await assert.rejects(f.client.threads.getState(f.thread, state.checkpoint));
  assert.deepEqual(
    await f.client.threads.getState(f.thread, state.checkpoint),
    state
  );
  await f.control({ holdState: true });
  const held = f.client.threads.getState(f.thread);
  // Poll private owned lifetime, bounded by wall time, without relying on arbitrary sleep.
  const deadline = Date.now() + 1000;
  let life;
  do {
    life = await (await fetch(f.base + '/__lifetime')).json();
  } while (life.held === 0 && Date.now() < deadline);
  assert.equal(life.held, 1);
  await fetch(f.base + '/__release', { method: 'POST' });
  assert.deepEqual(await held, state);
});
for (const [name, source] of [
  ['timeout', 'process.stdin.resume(); setInterval(() => {}, 1000);'],
  [
    'malformed output',
    'process.stdin.once("data", () => { process.stdout.write("not-json\\n"); }); setInterval(() => {}, 1000);',
  ],
  [
    'unowned response',
    'process.stdin.once("data", () => { process.stdout.write(JSON.stringify({requestId: 999}) + "\\n"); }); setInterval(() => {}, 1000);',
  ],
  [
    'invalid graph proof',
    'process.stdin.once("data", data => { const {requestId} = JSON.parse(data); process.stdout.write(JSON.stringify({requestId, proof: {actualCompiledGraph: false}}) + "\\n"); }); setInterval(() => {}, 1000);',
  ],
]) {
  test(`worker ${name} fails closed and cleanup reaps the child`, async (t) => {
    let child;
    const handle = createDeepAgentsFilesystemFixture({
      workerTimeoutMs: 1000,
      spawnWorker: () =>
        (child = spawn(process.execPath, ['-e', source], {
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
      await new Promise((resolve) => server.close(resolve));
    });
    const client = new Client({
      apiUrl: `http://127.0.0.1:${server.address().port}/api`,
      callerOptions: { maxRetries: 0 },
    });
    await assert.rejects(
      client.threads.create({ threadId: randomUUID(), ifExists: 'raise' })
    );
    await handle.close();
    assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
  });
}

test(
  'stdio worker independently rejects unknown owners, replay, foreign checkpoint and invalid resume',
  { timeout: 30000 },
  async (t) => {
    const child = spawn(
      'uv',
      [
        'run',
        '--frozen',
        '--python',
        '3.12',
        '--project',
        'cockpit/deep-agents/filesystem/python',
        'python',
        'scripts/react-cockpit/deep-agents-filesystem-wire.py',
      ],
      {
        cwd: fileURLToPath(new URL('../../', import.meta.url)),
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    child.stderr.resume();
    const lines = createInterface({ input: child.stdout });
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) {
        const ended = once(child, 'close');
        child.kill('SIGKILL');
        await ended;
      }
      lines.close();
    });
    let sequence = 0;
    const send = async (value) => {
      const line = once(lines, 'line');
      child.stdin.write(
        JSON.stringify({ ...value, requestId: ++sequence }) + '\n'
      );
      return JSON.parse((await line)[0]);
    };
    assert.equal(
      (await send({ op: 'state', threadId: 'unknown' })).error,
      'Graph operation failed'
    );
    await send({ op: 'create', threadId: 'a' });
    await send({ op: 'create', threadId: 'b' });
    const input = {
      op: 'submit',
      threadId: 'a',
      messages: [{ type: 'human', id: 'human-a', content: 'A' }],
    };
    const paused = await send(input);
    assert.equal(paused.state.tasks.flatMap((t) => t.interrupts).length, 1);
    assert.equal(
      (
        await send({
          ...input,
          messages: [
            { type: 'human', id: 'override', content: 'Override pause' },
          ],
        })
      ).error,
      'Graph operation failed'
    );
    assert.equal(
      (
        await send({
          op: 'state',
          threadId: 'b',
          checkpoint: paused.state.checkpoint,
        })
      ).error,
      'Graph operation failed'
    );
    assert.equal(
      (
        await send({
          op: 'state',
          threadId: 'a',
          checkpoint: { thread_id: 'a' },
        })
      ).error,
      'Graph operation failed'
    );
    assert.equal(
      (
        await send({
          op: 'resume',
          threadId: 'a',
          checkpoint: paused.state.checkpoint,
          command: { resume: { decisions: [{ type: 'approve' }] } },
        })
      ).error,
      'Graph operation failed'
    );
    for (const checkpoint of [
      { ...paused.state.checkpoint, checkpoint_map: { foreign: 'unknown' } },
      { ...paused.state.checkpoint, checkpoint_map: [] },
      { thread_id: 'a', checkpoint_id: paused.state.checkpoint.checkpoint_id },
    ]) {
      assert.equal(
        (await send({ op: 'state', threadId: 'a', checkpoint })).error,
        'Graph operation failed'
      );
    }
    const invalidIdLine = once(lines, 'line');
    child.stdin.write(
      JSON.stringify({ op: 'state', threadId: 'a', requestId: true }) + '\n'
    );
    assert.equal(
      JSON.parse((await invalidIdLine)[0]).error,
      'Graph operation failed'
    );
    for (const decisions of [
      [],
      [{ type: 'edit' }],
      [{ type: 'approve' }, { type: 'approve' }],
    ])
      assert.equal(
        (
          await send({
            op: 'resume',
            threadId: 'a',
            command: { resume: { decisions } },
          })
        ).error,
        'Graph operation failed'
      );
    const terminal = await send({
      op: 'resume',
      threadId: 'a',
      command: { resume: { decisions: [{ type: 'reject' }] } },
    });
    assert.deepEqual(terminal.state.next, []);
    assert.equal((await send(input)).error, 'Graph operation failed');
    assert.equal(
      (
        await send({
          op: 'resume',
          threadId: 'a',
          command: { resume: { decisions: [{ type: 'approve' }] } },
        })
      ).error,
      'Graph operation failed'
    );
    assert.equal(
      (
        await send({
          op: 'submit',
          threadId: 'b',
          messages: [
            { type: 'human', id: 'wrong-type', content: 'B', extra: 'no' },
          ],
        })
      ).error,
      'Graph operation failed'
    );
  }
);

for (const choice of ['approve', 'reject']) {
  test(`protected overwrite ${choice} binds current proposal and old saved text`, async (t) => {
    const f = await fixture(t);
    await f.control({ scenario: 'report-overwrite' });
    await f.submit();
    await decide(f, ['approve']);
    const paused = await f.client.threads.getState(f.thread);
    assert.equal(
      paused.values.files['/reports/existing.md'].content,
      'Prior report'
    );
    assert.deepEqual(
      await f.client.threads.getState(f.thread, paused.checkpoint),
      paused
    );
    const batch = paused.tasks.flatMap((t) => t.interrupts)[0].value;
    assert.equal(batch.action_requests.length, 1);
    assert.equal(batch.action_requests[0].name, 'write_file');
    assert.deepEqual(batch.action_requests[0].args, {
      file_path: '/reports/existing.md',
      content: 'Replacement report',
    });
    await decide(f, [choice]);
    const terminal = await f.client.threads.getState(f.thread);
    assert.equal(
      terminal.values.files['/reports/existing.md'].content,
      choice === 'approve' ? 'Replacement report' : 'Prior report'
    );
    const result = terminal.values.messages.find(
      (m) => m.type === 'tool' && m.tool_call_id.endsWith('-replacement')
    );
    assert.equal(result.status, choice === 'approve' ? 'success' : 'error');
    assert.deepEqual(terminal.next, []);
    assert.deepEqual(terminal.tasks, []);
  });
}

async function fragmentedHandle(f, pathname, bytes, chunkSize = 1) {
  const req = {
    socket: { remoteAddress: '127.0.0.1' },
    method: 'POST',
    url: pathname,
    async *[Symbol.asyncIterator]() {
      let i = 0;
      for (; i < Math.min(32, bytes.length); i++)
        yield bytes.subarray(i, i + 1);
      for (; i < bytes.length; i += chunkSize)
        yield bytes.subarray(i, i + chunkSize);
    },
  };
  let status,
    output = '';
  const res = {
    destroyed: false,
    writableEnded: false,
    writeHead(value) {
      status = value;
    },
    write(value) {
      output += value;
    },
    end(value = '') {
      output += value;
      this.writableEnded = true;
    },
  };
  assert.equal(await f.handle(req, res, pathname), true);
  return { status, output };
}

test('actual handler preserves UTF8 JSON and human text across arbitrary buffer boundaries', async (t) => {
  const f = await fixture(t);
  await f.control({ scenario: 'no-files' });
  const human = { type: 'human', id: 'split-utf8-human', content: 'Café ✈️' };
  await f.submit(human.content, 'ordinary-utf8-human');
  assert.equal(
    (await f.client.threads.getState(f.thread)).values.messages[0].content,
    human.content
  );
  const body = {
    assistant_id: 'da-filesystem',
    input: { messages: [human] },
    stream_mode: ['values'],
  };
  const result = await fragmentedHandle(
    f,
    `/api/threads/${f.thread}/runs/stream`,
    Buffer.from(JSON.stringify(body))
  );
  assert.equal(result.status, 200);
  const requests = await (await fetch(f.base + '/__requests')).json();
  assert.deepEqual(requests.at(-1).body, body);
  const saved = await f.client.threads.getState(f.thread);
  assert.equal(
    saved.values.messages.find((m) => m.id === human.id).content,
    human.content
  );
});

test('raw request byte limit accepts exactly1MiB and rejects one additional byte before decoding', async (t) => {
  const f = await fixture(t);
  // JSON whitespace remains valid while testing exact byte counting with a split multibyte key.
  const prefix = Buffer.from('{"é":true}');
  const exact = Buffer.concat([
    prefix,
    Buffer.alloc(1024 * 1024 - prefix.length, 0x20),
  ]);
  const pathname = '/api/threads';
  const accepted = await fragmentedHandle(f, pathname, exact, 65536);
  assert.equal(
    accepted.status,
    400,
    'valid exact-limit body reaches route validation'
  );
  const requests = await (await fetch(f.base + '/__requests')).json();
  assert.deepEqual(requests.at(-1).body, { é: true });
  const rejected = await fragmentedHandle(
    f,
    pathname,
    Buffer.concat([exact, Buffer.from(' ')]),
    65536
  );
  assert.equal(rejected.status, 413);
  assert.deepEqual(
    await (await fetch(f.base + '/__requests')).json(),
    requests,
    'oversized body never reaches route dispatch'
  );
});

test('native resume accepts the installed SDK null input with a command and no new human', async (t) => {
  const f = await fixture(t);
  await f.submit('Native null resume');
  const before = await f.client.threads.getState(f.thread);
  const events = [];
  for await (const item of f.client.runs.stream(f.thread, 'da-filesystem', {
    input: null,
    command: { resume: { decisions: [{ type: 'approve' }] } },
    streamMode: ['values', 'updates'],
  })) events.push(item);
  const after = await f.client.threads.getState(f.thread);
  assert.equal(after.next.length, 0);
  assert.equal(after.values.files['/reports/kase.md'].content, 'KASE assessment ready.');
  assert.deepEqual(after.values.messages.filter(m => m.type === 'human'), before.values.messages.filter(m => m.type === 'human'));
  assert.ok(events.length);
});
