import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { test } from 'node:test';
const { createChatToolCallsFixture } = await import(
  './chat-tool-calls-fixture.mjs'
).catch(() => ({}));

async function fixture(t, options) {
  assert.equal(
    typeof createChatToolCallsFixture,
    'function',
    'Tool Calls fixture is available'
  );
  const handle = createChatToolCallsFixture(options);
  const server = createServer(async (request, response) => {
    if (
      !(await handle(
        request,
        response,
        new URL(request.url, 'http://localhost').pathname
      ))
    ) {
      response.writeHead(404);
      response.end();
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
  const post = (path, body = {}) =>
    fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
  const json = async (path, body) => {
    const response = await post(path, body);
    assert.equal(response.status, 200);
    return response.json();
  };
  const stream = async (thread, body) => {
    const response = await post(`/api/threads/${thread}/runs/stream`, {
      assistant_id: 'c-tool-calls',
      ...body,
    });
    assert.equal(response.status, 200);
    return response.text();
  };
  const create = (thread) =>
    json('/api/threads', { thread_id: thread, if_exists: 'raise' });
  const history = (thread) =>
    json(`/api/threads/${thread}/history`, { limit: 10 });
  const submit = (thread, content, id = 'human-' + thread) =>
    stream(thread, { input: { messages: [{ type: 'human', content, id }] } });
  return { handle, post, json, stream, create, history, submit };
}

test(
  'real worker keeps single, parallel and sequential tool calls causal across isolated threads',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    for (const [thread, text, expected] of [
      ['single', 'Status UA123', 1],
      ['parallel', 'Compare airports', 2],
      ['sequential', 'Sequential lookup', 2],
      ['routes', 'Routes tomorrow', 1],
      ['domain', 'Unknown flight', 1],
      ['invalid', 'Malformed flight', 1],
      ['text', 'No tools', 0],
    ]) {
      await f.create(thread);
      const events = await f.submit(thread, text);
      assert.doesNotMatch(events, /generate_title|authored-title/);
      const [saved] = await f.history(thread);
      assert.deepEqual(saved.next, []);
      assert.equal(saved.checkpoint.thread_id, thread);
      const messages = saved.values.messages;
      const calls = new Map(
        messages.flatMap((message, index) =>
          (message.tool_calls ?? []).map((call) => [call.id, { call, index }])
        )
      );
      const results = messages.filter((message) => message.type === 'tool');
      assert.equal(calls.size, expected);
      assert.equal(results.length, expected);
      for (const result of results) {
        const owner = calls.get(result.tool_call_id);
        assert(owner.index < messages.indexOf(result));
        assert.equal(owner.call.name, result.name);
      }
      if (thread === 'parallel')
        assert.deepEqual(
          new Set(results.map((result) => JSON.parse(result.content).code)),
          new Set(['LAX', 'JFK'])
        );
      if (thread === 'domain') assert.equal(results[0].status, 'success');
      if (thread === 'invalid') assert.equal(results[0].status, 'error');
      assert.equal(messages.at(-1).type, 'ai');
    }
    await f.submit('single', 'Compare airports', 'followup');
    assert.equal((await f.history('single'))[0].values.messages.length, 9);
    const proofs = await f.json('/__graph-proof');
    assert.equal(proofs.length, 8);
    assert(
      proofs.every(
        (proof) =>
          proof.actualCompiledGraph &&
          proof.networkConnectAttempts === 0 &&
          proof.titleMessageCallbacks === 0
      )
    );
    const lifetime = await f.json('/__lifetime');
    assert.equal(lifetime.workers, 1);
    await f.handle.close();
    assert.throws(() => process.kill(lifetime.workerPid, 0), { code: 'ESRCH' });
  }
);

test(
  'caught title metadata diagnostics cannot corrupt protocol or canonical success',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    await f.json('/__metadata-failure');
    await f.create('metadata');
    const events = await f.submit('metadata', 'No tools');
    assert.doesNotMatch(
      events,
      /generate_title|Authored metadata read failure/
    );
    const [saved] = await f.history('metadata');
    assert.deepEqual(saved.next, []);
    assert.equal(saved.values.messages.length, 2);
    assert.match(saved.values.messages[1].content, /authored plain answer/);
  }
);

test(
  'reset fences held responses and replaces the real worker without leaking old checkpoints',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    await f.create('old');
    await f.json('/__hold-stream');
    const pending = f.submit('old', 'Book UA123.');
    while (!(await f.json('/__lifetime')).activeStream)
      await new Promise((resolve) => setTimeout(resolve, 10));
    const oldPid = (await f.json('/__lifetime')).workerPid;
    await f.json('/__reset');
    await pending;
    assert.throws(() => process.kill(oldPid, 0), { code: 'ESRCH' });
    await f.create('new');
    await f.submit('new', 'Book AA404.');
    const [pause] = await f.history('new');
    assert.equal(pause.checkpoint.thread_id, 'new');
    assert.equal(pause.values.messages.length, 4);
    assert.equal(
      JSON.parse(pause.values.messages[2].content).flight_number,
      'UA123'
    );
    assert.notEqual((await f.json('/__lifetime')).workerPid, oldPid);
  }
);

test(
  'closing rejects queued operations and terminates an owned stalled worker',
  { timeout: 30000 },
  async (t) => {
    let child;
    const f = await fixture(t, {
      spawnWorker: () =>
        (child = spawn(
          process.execPath,
          ['-e', 'process.stdin.resume(); setInterval(() => {}, 1000)'],
          { stdio: ['pipe', 'pipe', 'pipe'] }
        )),
    });
    await f.create('one');
    await f.create('two');
    const first = f.post('/api/threads/one/runs/stream', {
      assistant_id: 'c-tool-calls',
      input: { messages: [{ type: 'human', content: 'Hello', id: 'one' }] },
    });
    const second = f.post('/api/threads/two/runs/stream', {
      assistant_id: 'c-tool-calls',
      input: { messages: [{ type: 'human', content: 'Hello', id: 'two' }] },
    });
    while (!child?.pid) await new Promise((resolve) => setTimeout(resolve, 10));
    const pid = child.pid;
    await f.handle.close();
    assert.equal((await first).status, 500);
    assert.equal((await second).status, 500);
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  }
);

test(
  'malformed worker output fails closed with no private diagnostic in HTTP',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t, {
      spawnWorker: () =>
        spawn(
          process.execPath,
          [
            '-e',
            'process.stdin.once("data", () => process.stdout.write("PRIVATE bad protocol\\n"));',
          ],
          { stdio: ['pipe', 'pipe', 'pipe'] }
        ),
    });
    await f.create('bad');
    const response = await f.post('/api/threads/bad/runs/stream', {
      assistant_id: 'c-tool-calls',
      input: { messages: [{ type: 'human', content: 'Hello', id: 'bad' }] },
    });
    assert.equal(response.status, 500);
    assert.doesNotMatch(await response.text(), /PRIVATE/);
  }
);

test(
  'stdout EOF rejects pending work promptly even when the worker stays alive',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t, {
      spawnWorker: () =>
        spawn(
          process.execPath,
          [
            '-e',
            'process.stdin.once("data", () => process.stdout.end()); setInterval(() => {}, 1000);',
          ],
          { stdio: ['pipe', 'pipe', 'pipe'] }
        ),
    });
    await f.create('eof');
    const pending = f.post('/api/threads/eof/runs/stream', {
      assistant_id: 'c-tool-calls',
      input: { messages: [{ type: 'human', content: 'Hello', id: 'eof' }] },
    });
    let timer;
    const result = await Promise.race([
      pending.then((response) => response.status),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve('still pending'), 1000);
      }),
    ]);
    clearTimeout(timer);
    assert.equal(result, 500);
  }
);

test(
  'reset rejects pending worker work and admits only a fresh real graph epoch',
  { timeout: 30000 },
  async (t) => {
    let first,
      calls = 0;
    const f = await fixture(t, {
      spawnWorker: () => {
        if (++calls === 1)
          return (first = spawn(
            process.execPath,
            ['-e', 'process.stdin.resume(); setInterval(() => {}, 1000)'],
            { stdio: ['pipe', 'pipe', 'pipe'] }
          ));
        return spawn(
          'uv',
          [
            'run',
            '--frozen',
            '--python',
            '3.12',
            '--project',
            'cockpit/chat/tool-calls/python',
            'python',
            'scripts/react-cockpit/chat-tool-calls-wire.py',
          ],
          { stdio: ['pipe', 'pipe', 'pipe'] }
        );
      },
    });
    await f.create('old-pending');
    const pending = f.post('/api/threads/old-pending/runs/stream', {
      assistant_id: 'c-tool-calls',
      input: {
        messages: [{ type: 'human', content: 'Book UA123.', id: 'old' }],
      },
    });
    while (!first?.pid) await new Promise((resolve) => setTimeout(resolve, 10));
    const oldPid = first.pid;
    await f.json('/__reset');
    assert.equal((await pending).status, 500);
    assert.throws(() => process.kill(oldPid, 0), { code: 'ESRCH' });
    await f.create('fresh');
    await f.submit('fresh', 'Book AA404.');
    const [pause] = await f.history('fresh');
    assert.equal(pause.values.messages.length, 4);
    assert.equal(
      JSON.parse(pause.values.messages[2].content).flight_number,
      'UA123'
    );
    const requests = await f.json('/__requests');
    assert.equal(requests.length, 3);
    assert(requests.every((item) => !item.path.includes('old-pending')));
    assert.equal((await f.json('/__lifetime')).pendingOperations, 0);
  }
);
