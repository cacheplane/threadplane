import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
const { createChatThreadsFixture } = await import(
  './chat-threads-fixture.mjs'
).catch(() => ({}));

async function fixture(t, options) {
  assert.equal(
    typeof createChatThreadsFixture,
    'function',
    'Threads fixture is available'
  );
  const handle = createChatThreadsFixture(options);
  const closedResponses = [];
  const server = createServer(async (req, res) => {
    res.on('close', () => closedResponses.push(req.url));
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
  const request = (
    path,
    body,
    method = 'POST',
    signal = AbortSignal.timeout(15000)
  ) =>
    fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      ...(method !== 'GET' ? { body: JSON.stringify(body ?? {}) } : {}),
      headers: { 'content-type': 'application/json' },
      signal,
    });
  const json = async (path, body, method) => {
    const res = await request(path, body, method);
    assert.equal(res.status, 200);
    return res.json();
  };
  const create = async (id = randomUUID()) => {
    await json('/api/threads', {
      metadata: {},
      thread_id: id,
      if_exists: 'raise',
    });
    return id;
  };
  const submit = (id, text = 'Hello', humanId = randomUUID()) =>
    request(`/api/threads/${id}/runs/stream`, {
      assistant_id: 'c-threads',
      input: { messages: [{ type: 'human', content: text, id: humanId }] },
    });
  const history = (id) => json(`/api/threads/${id}/history`, { limit: 10 });
  const title = (id) => json(`/api/threads/${id}`, undefined, 'GET');
  const wait = async (key) => {
    for (let n = 0; n < 500; n++) {
      const state = await json('/__lifetime');
      if (state[key]) return state;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.fail('Timed out waiting for ' + key);
  };
  return {
    handle,
    request,
    json,
    create,
    submit,
    history,
    title,
    wait,
    closedResponses,
  };
}
function frames(text) {
  return text
    .trim()
    .split('\n\n')
    .map((frame) => {
      const [kind, data] = frame.split('\n');
      return [kind.slice(7), JSON.parse(data.slice(6))];
    });
}

for (const kind of ['history', 'title'])
  test(`aborted ${kind} before worker completion does not install a hold`, async (t) => {
    let release;
    let ready;
    const workerReady = new Promise((resolve) => {
      ready = resolve;
    });
    const f = await fixture(t, {
      spawnWorker: () => {
        const child = spawn(
          'uv',
          [
            'run',
            '--frozen',
            '--python',
            '3.12',
            '--project',
            'cockpit/chat/threads/python',
            'python',
            'scripts/react-cockpit/chat-threads-wire.py',
          ],
          { stdio: ['pipe', 'pipe', 'pipe'] }
        );
        const output = child.stdout,
          delayed = new PassThrough(),
          buffered = [];
        child.stdout = delayed;
        output.on('data', (chunk) => {
          buffered.push(chunk);
          if (Buffer.concat(buffered).includes(10)) ready();
        });
        output.on('end', () => delayed.end());
        release = () => {
          for (const chunk of buffered) delayed.write(chunk);
        };
        return child;
      },
    });
    const id = await f.create();
    await f.json('/__hold-' + kind);
    const path = `/api/threads/${id}${kind === 'history' ? '/history' : ''}`;
    const controller = new AbortController();
    const pending = f
      .request(path, {}, kind === 'history' ? 'POST' : 'GET', controller.signal)
      .catch(() => null);
    await workerReady;
    controller.abort();
    await pending;
    for (let i = 0; i < 100 && !f.closedResponses.includes(path); i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert(
      f.closedResponses.includes(path),
      'Server observed disconnect before graph response'
    );
    release();
    for (
      let i = 0;
      i < 100 && (await f.json('/__lifetime')).pendingOperations;
      i++
    )
      await new Promise((resolve) => setTimeout(resolve, 10));
    const state = await f.json('/__lifetime');
    assert.equal(state.pendingOperations, 0);
    assert.equal(
      state[kind === 'history' ? 'activeHistory' : 'activeTitle'],
      false
    );
    assert.deepEqual(await f.json('/__injections'), []);
    assert.equal((await f.json('/__graph-proof')).length, 1);
  });

test('replacing a held stream interrupts its exact run and lets the replacement succeed', async (t) => {
  const f = await fixture(t),
    a = await f.create(),
    b = await f.create();
  await f.json('/__hold-stream');
  const first = await f.submit(a),
    firstText = first.text();
  const firstRun = first.headers.get('content-location').split('/').at(-1);
  await f.wait('activeStream');
  await f.json('/__hold-stream');
  const second = await f.submit(b),
    secondText = second.text();
  const secondRun = second.headers.get('content-location').split('/').at(-1);
  await firstText;
  assert.equal(
    (await f.json(`/api/threads/${a}/runs/${firstRun}`, undefined, 'GET'))
      .status,
    'interrupted'
  );
  assert.equal(
    (await f.json(`/api/threads/${b}/runs/${secondRun}`, undefined, 'GET'))
      .status,
    'running'
  );
  await f.json('/__release');
  await secondText;
  assert.equal(
    (await f.json(`/api/threads/${b}/runs/${secondRun}`, undefined, 'GET'))
      .status,
    'success'
  );
});

test('actual compiled graph retains separate canonical histories, title metadata and unique answers', async (t) => {
  const f = await fixture(t),
    a = await f.create(),
    b = await f.create();
  const first = frames(await (await f.submit(a, 'Same')).text());
  assert(first.some(([kind]) => kind === 'messages'));
  assert(first.some(([kind]) => kind === 'values'));
  assert(first.some(([kind]) => kind === 'updates'));
  assert(
    !first.some(
      ([kind, data]) =>
        kind === 'messages' && data[1].langgraph_node === 'generate_title'
    )
  );
  const [before] = await f.history(a);
  await (await f.submit(b, 'Same')).text();
  await (await f.submit(a, 'Follow up')).text();
  const [after] = await f.history(a),
    [other] = await f.history(b);
  assert.deepEqual(after.values.messages.slice(0, 2), before.values.messages);
  assert.equal(after.values.messages.length, 4);
  assert.equal(other.values.messages.length, 2);
  assert.notEqual(before.values.messages[1].id, other.values.messages[1].id);
  assert.deepEqual(after.next, []);
  assert.deepEqual(after.tasks, []);
  assert.equal(after.checkpoint.thread_id, a);
  assert.equal(
    (await f.title(a)).metadata.title,
    'Authored conversation title'
  );
  const run = first.find(([kind]) => kind === 'metadata')[1].run_id;
  assert.equal(
    (await f.json(`/api/threads/${a}/runs/${run}`, undefined, 'GET')).status,
    'success'
  );
  assert.equal(
    (await f.request(`/api/threads/${b}/runs/${run}`, undefined, 'GET')).status,
    404
  );
  const proofs = await f.json('/__graph-proof');
  assert(proofs.length >= 7);
  for (const proof of proofs) {
    assert.equal(proof.actualCompiledGraph, true);
    assert.equal(proof.networkConnectAttempts, 0);
    assert.equal(proof.titleMessageCallbacks, 0);
    for (const [key, path] of [
      ['sourceSha256', 'src/graph.py'],
      ['lockSha256', 'uv.lock'],
    ])
      assert.equal(
        proof[key],
        createHash('sha256')
          .update(readFileSync('cockpit/chat/threads/python/' + path))
          .digest('hex')
      );
  }
  assert.deepEqual(await f.json('/__injections'), []);
});

test('installed SDK creation accepts only empty plain metadata and rejects unknown fields', async (t) => {
  const f = await fixture(t),
    id = randomUUID();
  const response = await f.request('/api/threads', {
    metadata: {},
    thread_id: id,
    if_exists: 'raise',
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { thread_id: id });
  for (const metadata of [null, [], '', false, { title: 'Unsupported' }]) {
    assert.equal(
      (
        await f.request('/api/threads', {
          metadata,
          thread_id: randomUUID(),
          if_exists: 'raise',
        })
      ).status,
      400
    );
  }
  assert.equal(
    (
      await f.request('/api/threads', {
        metadata: {},
        thread_id: randomUUID(),
        if_exists: 'raise',
        unknown: true,
      })
    ).status,
    400
  );
});

test('only confirmed UUID creation and exact supported routes are admitted', async (t) => {
  const f = await fixture(t),
    id = await f.create();
  assert.equal(
    (await f.request('/api/threads', { thread_id: 'not-uuid' })).status,
    400
  );
  assert.equal(
    (await f.request('/api/threads', { thread_id: id })).status,
    400
  );
  for (const [path, method, body] of [
    ['/api/threads/search', 'POST', {}],
    ['/api/threads', 'GET'],
    [`/api/threads/${id}`, 'DELETE'],
    [`/api/threads/${id}`, 'PATCH', {}],
    [`/api/threads/${id}/runs/x/cancel`, 'POST', {}],
    [`/api/threads/${id}/runs/x/stream`, 'GET'],
    [`/api/threads/${id}/state`, 'GET'],
    [
      `/api/threads/${id}/runs/stream`,
      'POST',
      { assistant_id: 'wrong', input: { messages: [] } },
    ],
    [
      `/api/threads/${id}/runs/stream`,
      'POST',
      { assistant_id: 'c-threads', command: { resume: true } },
    ],
    [
      `/api/threads/${id}/runs/stream`,
      'POST',
      {
        assistant_id: 'c-threads',
        checkpoint_id: 'replay',
        input: { messages: [{ type: 'human', content: 'Hi', id: 'h' }] },
      },
    ],
  ])
    assert((await f.request(path, body, method)).status >= 400, path);
  assert((await f.json('/__requests')).length >= 12);
});

test('history injections preserve separate actual proof and restore real saved data', async (t) => {
  const f = await fixture(t),
    id = await f.create();
  await (await f.submit(id)).text();
  const original = await f.history(id);
  for (const mode of ['changed', 'missing', 'pending', 'foreign', 'failure']) {
    await f.json('/__history/' + mode);
    const response = await f.request(`/api/threads/${id}/history`, {
      limit: 10,
    });
    if (mode === 'failure') {
      assert.equal(response.status, 500);
      continue;
    }
    const data = await response.json();
    assert.notDeepEqual(data, original);
    if (mode === 'foreign') assert.notEqual(data[0].checkpoint.thread_id, id);
  }
  await f.json('/__history/safe');
  assert.deepEqual(await f.history(id), original);
  assert.equal(
    (await f.json('/__injections')).filter((i) => i.kind === 'history').length,
    5
  );
  assert(
    (await f.json('/__graph-proof')).every(
      (p) => !('injectedHistoryFault' in p)
    )
  );
});

test('title modes exercise optional metadata independently of canonical messages', async (t) => {
  const f = await fixture(t),
    id = await f.create();
  await (await f.submit(id)).text();
  for (const mode of [
    'missing',
    'wrong-thread',
    'invalid',
    'titlefailure',
    'literal',
    'long',
  ]) {
    await f.json('/__title/' + mode);
    const response = await f.request(`/api/threads/${id}`, undefined, 'GET');
    if (mode === 'titlefailure') {
      assert.equal(response.status, 500);
      continue;
    }
    const data = await response.json();
    if (mode === 'missing') assert.equal(data.metadata.title, undefined);
    if (mode === 'wrong-thread') assert.notEqual(data.thread_id, id);
    if (mode === 'invalid')
      assert.notEqual(typeof data.metadata.title, 'string');
    if (mode === 'literal')
      assert.equal(data.metadata.title, '<script>alert("title")</script>');
    if (mode === 'long') assert(data.metadata.title.length > 80);
  }
  assert.equal((await f.history(id))[0].values.messages.length, 2);
  assert.equal(
    (await f.json('/__injections')).filter((i) => i.kind === 'title').length,
    6
  );
});

test('applied one-shot and persistent holds are recorded once beside actual graph proof', async (t) => {
  const f = await fixture(t),
    id = await f.create(),
    expected = [];
  await f.json('/__hold-stream');
  assert.deepEqual(await f.json('/__injections'), []);
  const stream = f.submit(id).then((response) => response.text());
  await f.wait('activeStream');
  expected.push({ kind: 'stream', mode: 'hold', threadId: id });
  assert.deepEqual(await f.json('/__injections'), expected);
  const streamProof = await f.json('/__graph-proof');
  await f.json('/__release');
  await stream;
  assert.deepEqual(await f.json('/__graph-proof'), streamProof);
  for (const kind of ['history', 'title']) {
    await f.json('/__hold-' + kind);
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt === 1) await f.json(`/__${kind}/hold`);
      // One-shot plus persistent hold must still record a single applied hold.
      if (attempt === 2) await f.json('/__hold-' + kind);
      const pending = kind === 'history' ? f.history(id) : f.title(id);
      await f.wait(kind === 'history' ? 'activeHistory' : 'activeTitle');
      expected.push({ kind, mode: 'hold', threadId: id });
      assert.deepEqual(await f.json('/__injections'), expected);
      const proof = await f.json('/__graph-proof');
      assert(
        proof.every((item) => !('mode' in item) && !('injections' in item))
      );
      await f.json('/__release-' + kind);
      await pending;
      assert.deepEqual(await f.json('/__graph-proof'), proof);
      assert.deepEqual(await f.json('/__injections'), expected);
    }
    await f.json(`/__${kind}/safe`);
  }
});

test('held stream, history and title release and disconnect without retaining responses', async (t) => {
  const f = await fixture(t),
    id = await f.create();
  await f.json('/__hold-stream');
  const streamed = f.submit(id).then((r) => r.text());
  await f.wait('activeStream');
  await f.json('/__release');
  assert.match(await streamed, /Authored/);
  for (const kind of ['history', 'title']) {
    await f.json('/__hold-' + kind);
    const pending = kind === 'history' ? f.history(id) : f.title(id);
    await f.wait(kind === 'history' ? 'activeHistory' : 'activeTitle');
    await f.json('/__release-' + kind);
    await pending;
    await f.json('/__hold-' + kind);
    const controller = new AbortController();
    const request = f
      .request(
        `/api/threads/${id}${kind === 'history' ? '/history' : ''}`,
        {},
        kind === 'history' ? 'POST' : 'GET',
        controller.signal
      )
      .catch(() => null);
    await f.wait(kind === 'history' ? 'activeHistory' : 'activeTitle');
    controller.abort();
    await request;
    for (
      let i = 0;
      i < 100 &&
      (await f.json('/__lifetime'))[
        kind === 'history' ? 'activeHistory' : 'activeTitle'
      ];
      i++
    )
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(
      (await f.json('/__lifetime'))[
        kind === 'history' ? 'activeHistory' : 'activeTitle'
      ],
      false
    );
  }
});

test('reset fences held responses and closes the real process; disposal is idempotent', async (t) => {
  const f = await fixture(t),
    id = await f.create();
  await f.json('/__hold-stream');
  const pending = f.submit(id).then((r) => r.text());
  const { workerPid } = await f.wait('activeStream');
  await f.json('/__reset');
  await pending;
  assert.throws(() => process.kill(workerPid, 0), { code: 'ESRCH' });
  const fresh = await f.create();
  assert.deepEqual(await f.history(fresh), []);
  assert.equal(
    (await f.request(`/api/threads/${id}`, undefined, 'GET')).status,
    404
  );
  const pid = (await f.json('/__lifetime')).workerPid;
  await Promise.all([f.handle.close(), f.handle.close()]);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

for (const [name, program] of [
  [
    'malformed',
    'process.stdin.once("data",()=>process.stdout.write("PRIVATE broken\\n"));',
  ],
  [
    'unowned',
    'process.stdin.once("data",()=>process.stdout.write(JSON.stringify({requestId:99})+"\\n"));',
  ],
  [
    'eof',
    'process.stdin.once("data",()=>process.stdout.end()); setInterval(()=>{},1000);',
  ],
  ['stall', 'process.stdin.resume(); setInterval(()=>{},1000);'],
])
  test(
    name + ' worker fails closed without exposing diagnostics',
    async (t) => {
      const f = await fixture(t, {
          workerTimeoutMs: 150,
          spawnWorker: () =>
            spawn(process.execPath, ['-e', program], {
              stdio: ['pipe', 'pipe', 'pipe'],
            }),
        }),
        id = await f.create();
      const response = await f.submit(id);
      assert.equal(response.status, 500);
      assert.doesNotMatch(await response.text(), /PRIVATE|broken/);
    }
  );

test('close rejects queued worker operations and reset admits a fresh epoch', async (t) => {
  let child,
    calls = 0;
  const f = await fixture(t, {
    spawnWorker: () =>
      ++calls === 1
        ? (child = spawn(
            process.execPath,
            ['-e', 'process.stdin.resume(); setInterval(()=>{},1000);'],
            { stdio: ['pipe', 'pipe', 'pipe'] }
          ))
        : spawn(
            'uv',
            [
              'run',
              '--frozen',
              '--python',
              '3.12',
              '--project',
              'cockpit/chat/threads/python',
              'python',
              'scripts/react-cockpit/chat-threads-wire.py',
            ],
            { stdio: ['pipe', 'pipe', 'pipe'] }
          ),
  });
  const a = await f.create(),
    b = await f.create(),
    first = f.submit(a),
    second = f.submit(b);
  await f.wait('pendingOperations');
  await f.json('/__reset');
  assert.equal((await first).status, 500);
  assert.equal((await second).status, 500);
  assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
  const fresh = await f.create();
  await (await f.submit(fresh)).text();
  assert.equal((await f.history(fresh))[0].values.messages.length, 2);
  await f.handle.close();
  assert.equal((await f.submit(fresh)).status, 500);
});

test('actual graph failure streams partial evidence, records failed run and retains pending checkpoint', async (t) => {
  const f = await fixture(t),
    id = await f.create();
  const events = frames(await (await f.submit(id, 'fail-stream')).text());
  assert(events.some(([kind, data]) => kind === 'messages' && data[0].content));
  assert(events.some(([kind]) => kind === 'error'));
  const run = events.find(([kind]) => kind === 'metadata')[1].run_id;
  assert.equal(
    (await f.json(`/api/threads/${id}/runs/${run}`, undefined, 'GET')).status,
    'error'
  );
  assert((await f.history(id))[0].next.length > 0);
  assert.deepEqual(await f.json('/__injections'), []);
});

test('closed chat-threads selection has its own build and server dispatch', async () => {
  const { reactCockpitConfiguration } = await import('./configuration.mjs');
  assert.deepEqual(reactCockpitConfiguration('chat-threads'), {
    topic: 'threads',
    library: 'chat',
    adapter: 'langgraph',
    appPath: 'cockpit/chat/threads/react',
    base: '/chat/threads/react/',
    port: 4625,
    project: 'cockpit-chat-threads-react',
  });
  assert.throws(() => reactCockpitConfiguration('../chat-threads'));
  const server = readFileSync('scripts/react-cockpit/serve.mjs', 'utf8');
  assert.match(server, /createChatThreadsFixture/);
  assert.match(
    server,
    /await chatThreadsFixture\(request, response, pathname\)/
  );
  assert.match(
    server,
    /await\s*\(\s*(?:\w+\s*\?\?\s*)*chatThreadsFixture(?:\s*\?\?\s*\w+)*\s*\)\.close\(\)/
  );
});

test('dispose rejects active and queued stalled work and kills its owned child', async (t) => {
  let child;
  const f = await fixture(t, {
    spawnWorker: () =>
      (child = spawn(
        process.execPath,
        ['-e', 'process.stdin.resume(); setInterval(()=>{},1000);'],
        { stdio: ['pipe', 'pipe', 'pipe'] }
      )),
  });
  const a = await f.create(),
    b = await f.create();
  const first = f.submit(a),
    second = f.submit(b);
  await f.wait('pendingOperations');
  await f.handle.close();
  assert.equal((await first).status, 500);
  assert.equal((await second).status, 500);
  assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
});

test('creation and worker failure controls fail privately and reset permits recovery', async (t) => {
  const f = await fixture(t),
    id = randomUUID();
  await f.json('/__fail-create');
  const failed = await f.request('/api/threads', {
    thread_id: id,
    if_exists: 'raise',
  });
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), { error: 'Graph fixture failed.' });
  assert.equal(
    (await f.request(`/api/threads/${id}`, undefined, 'GET')).status,
    404
  );
  await f.create(id);
  await f.json('/__worker-failure');
  assert.equal((await f.submit(id)).status, 500);
  await f.json('/__reset');
  await f.create(id);
  assert.match(await (await f.submit(id)).text(), /Authored/);
});
