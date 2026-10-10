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

const { createDeepAgentsPlanningFixture } = await import(
  './deep-agents-planning-fixture.mjs'
).catch(() => ({}));

async function fixture(t, options) {
  assert.equal(
    typeof createDeepAgentsPlanningFixture,
    'function',
    'Planning compiled-graph fixture exists'
  );
  const handle = createDeepAgentsPlanningFixture(options);
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
    client.runs.stream(thread, 'da-planning', {
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

test('installed SDK streams actual replacement checkpoints and exact canonical saved state', async (t) => {
  const f = await fixture(t);
  const { events, run, id } = await f.submit();
  const saved = await f.client.threads.getState(f.thread);
  const terminal = events.filter((e) => e.event === 'checkpoints').at(-1).data;
  assert.deepEqual(
    events.filter((e) => e.event === 'values').at(-1).data,
    saved.values
  );
  assert.equal(
    terminal.config.configurable.checkpoint_id,
    saved.checkpoint.checkpoint_id
  );
  assert.equal(terminal.config.configurable.thread_id, f.thread);
  assert.deepEqual(terminal.values, saved.values);
  assert.deepEqual(saved.next, []);
  assert.deepEqual(saved.tasks, []);
  assert.equal(saved.values.messages[0].id, id);
  assert.equal(saved.values.messages.at(-1).type, 'ai');
  assert.equal(saved.values.todos.at(-1).status, 'in_progress');
  assert.equal(
    saved.values.todos.filter((todo) => todo.status === 'completed').length,
    3
  );
  assert.equal(Object.hasOwn(saved.metadata, 'run_id'), false);
  assert.equal(Object.hasOwn(terminal.metadata, 'run_id'), false);
  assert.equal(Object.hasOwn(saved.values, 'completed_turn_id'), false);
  assert.equal(Object.hasOwn(saved.values, 'operation_receipt'), false);
  const exact = await f.client.threads.getState(f.thread, saved.checkpoint);
  assert.deepEqual(exact, saved);
  const history = await f.client.threads.getHistory(f.thread, { limit: 100 });
  assert.equal(
    history[0].checkpoint.checkpoint_id,
    saved.checkpoint.checkpoint_id
  );
  assert(history.some((s) => s.next.length));
  assert(history.some((s) => s.tasks.length));
  assert(
    history.every((s) => s.tasks.every((task) => task.interrupts.length === 0))
  );
  assert.equal((await f.client.runs.get(f.thread, run)).status, 'success');
  const writes = saved.values.messages.filter(
    (m) => m.type === 'tool' && m.content.startsWith('Updated todo list to')
  );
  assert.equal(writes.length, 2);
  assert(
    writes.every((m) => m.name === 'write_todos' && m.status === 'success')
  );
  const lookup = saved.values.messages.find(
    (m) => m.type === 'tool' && m.name === 'lookup_field_elevation'
  );
  assert.equal(lookup.content, 'KASE field elevation is 7820 ft.');
  const proofs = await (await fetch(f.base + '/__graph-proof')).json();
  for (const proof of proofs) {
    assert.equal(proof.actualCompiledGraph, true);
    assert.equal(proof.networkConnectAttempts, 0);
    for (const source of ['src/graph.py', 'prompts/planning.md', 'uv.lock']) {
      const expected = createHash('sha256')
        .update(
          readFileSync(
            new URL(
              '../../cockpit/deep-agents/planning/python/' + source,
              import.meta.url
            )
          )
        )
        .digest('hex');
      assert.equal(proof.sourceSha256[source], expected);
    }
  }
});

test('SDK preserves duplicates/order, replaces the whole list, and accepts explicit empty clearing', async (t) => {
  const f = await fixture(t);
  await f.control({ scenario: 'duplicates' });
  await f.submit();
  const saved = await f.client.threads.getState(f.thread);
  assert.deepEqual(saved.values.todos, [
    { content: 'Duplicate', status: 'completed' },
    { content: 'Duplicate', status: 'in_progress' },
    { content: 'First', status: 'pending' },
  ]);
  await f.control({ scenario: 'empty' });
  await f.submit('Clear plan.');
  assert.deepEqual(
    (await f.client.threads.getState(f.thread)).values.todos,
    []
  );
});

test('SDK exposes middleware rejection, schema errors, and subsequent valid recovery truthfully', async (t) => {
  const f = await fixture(t);
  await f.submit();
  const prior = (await f.client.threads.getState(f.thread)).values.todos;
  await f.control({ scenario: 'parallel' });
  const rejected = await f.submit('Parallel write.');
  let saved = await f.client.threads.getState(f.thread);
  assert.deepEqual(saved.values.todos, prior);
  const errors = toolResults(saved, [
    rejected.id + '-parallel-a',
    rejected.id + '-parallel-b',
  ]);
  assert.equal(errors.length, 2);
  assert(errors.every((m) => m.status === 'error' && m.name === null));
  assert(errors.every((m) => m.content.includes('multiple times in parallel')));
  await f.control({ scenario: 'schema' });
  const invalid = await f.submit('Invalid write.');
  saved = await f.client.threads.getState(f.thread);
  assert.deepEqual(saved.values.todos, prior);
  const invalidResult = toolResults(saved, [invalid.id + '-invalid'])[0];
  assert.equal(invalidResult.name, 'write_todos');
  assert.equal(invalidResult.status, 'error');
  await f.control({ scenario: 'recovery' });
  const recovered = await f.submit('Recover.');
  saved = await f.client.threads.getState(f.thread);
  assert.deepEqual(saved.values.todos, [
    { content: 'Recovered', status: 'in_progress' },
  ]);
  assert.equal(
    toolResults(saved, [recovered.id + '-recover'])[0].status,
    'success'
  );
});

test('SDK cancellation stops held delivery without forging rollback and cleanup reaps worker', async (t) => {
  const f = await fixture(t);
  await f.control({ holdStream: true });
  const stream = f.stream();
  const metadata = await stream.next();
  const run = metadata.value.data.run_id;
  assert.equal((await f.client.runs.get(f.thread, run)).status, 'running');
  await f.client.runs.cancel(f.thread, run, true, 'interrupt');
  assert.equal((await f.client.runs.get(f.thread, run)).status, 'interrupted');
  assert.equal((await stream.next()).done, true);
  // The graph executes before buffered delivery: transport cancellation is not rollback.
  const saved = await f.client.threads.getState(f.thread);
  assert.equal(saved.values.todos.length, 4);
  const lifetime = await (await fetch(f.base + '/__lifetime')).json();
  assert.equal(lifetime.held, 0);
  assert.equal(lifetime.workers, 1);
  await f.handle.close();
  assert.throws(() => process.kill(lifetime.workerPid, 0), { code: 'ESRCH' });
});

test('checkpoint ownership and graph-owned input cannot be overridden through SDK', async (t) => {
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
    for await (const unused of f.client.runs.stream(f.thread, 'da-planning', {
      input: {
        messages: [{ type: 'human', id: randomUUID(), content: 'Override.' }],
        todos: [],
      },
      streamMode: ['values'],
    }))
      assert.fail('Invalid graph-owned input streamed');
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
  for await (const unused of f.client.runs.stream(other, 'da-planning', {
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

test(
  'worker rejects checkpoint thread overrides independently of HTTP validation',
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
        'cockpit/deep-agents/planning/python',
        'python',
        'scripts/react-cockpit/deep-agents-planning-wire.py',
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
    const send = async (value) => {
      const line = once(lines, 'line');
      child.stdin.write(JSON.stringify(value) + '\n');
      return JSON.parse((await line)[0]);
    };
    const foreign = await send({
      op: 'submit',
      threadId: 'worker-other',
      requestId: 1,
      messages: [
        { type: 'human', id: 'worker-other-human', content: 'Other owner.' },
      ],
    });
    assert.equal(foreign.state.values.messages[0].id, 'worker-other-human');
    const response = await send({
      op: 'state',
      threadId: 'worker-current',
      requestId: 2,
      checkpoint: foreign.state.checkpoint,
    });
    assert.equal(
      response.error,
      'Graph operation failed',
      'worker must reject foreign checkpoint owner'
    );
    assert.equal(response.requestId, 2);
  }
);

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
    const f = await fixture(t, {
      workerTimeoutMs: 1000,
      spawnWorker: () =>
        (child = spawn(process.execPath, ['-e', source], {
          stdio: ['pipe', 'pipe', 'pipe'],
        })),
    });
    await assert.rejects(f.client.threads.getState(f.thread));
    await f.handle.close();
    assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
  });
}
