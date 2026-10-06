import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
const sdkRun = (body) => ({
  stream_mode: ['values', 'messages-tuple', 'updates', 'custom'],
  stream_subgraphs: true,
  stream_resumable: true,
  on_disconnect: 'continue',
  ...body,
});
const { createChatTimelineFixture } = await import(
  './chat-timeline-fixture.mjs'
).catch(() => ({}));

async function fixture(t, options) {
  assert.equal(
    typeof createChatTimelineFixture,
    'function',
    'Timeline fixture is available'
  );
  const handle = createChatTimelineFixture(options);
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
      ...(method !== 'GET'
        ? {
            body: JSON.stringify(
              path.endsWith('/runs/stream') ? sdkRun(body) : body ?? {}
            ),
          }
        : {}),
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
      assistant_id: 'c-timeline',
      input: { messages: [{ type: 'human', content: text, id: humanId }] },
    });
  const history = (id) => json(`/api/threads/${id}/history`, { limit: 10 });
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

for (const kind of ['history'])
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
            'cockpit/chat/timeline/python',
            'python',
            'scripts/react-cockpit/chat-timeline-wire.py',
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
    const path = `/api/threads/${id}/history`;
    const controller = new AbortController();
    const pending = f
      .request(path, { limit: 10 }, 'POST', controller.signal)
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
    assert.equal(state['activeHistory'], false);
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

test('actual compiled graph retains separate canonical histories and unique answers', async (t) => {
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
  assert.equal(proofs.length, 6);
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
          .update(readFileSync('cockpit/chat/timeline/python/' + path))
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
    [
      `/api/threads/${id}/runs/stream`,
      'POST',
      { assistant_id: 'wrong', input: { messages: [] } },
    ],
    [
      `/api/threads/${id}/runs/stream`,
      'POST',
      { assistant_id: 'c-timeline', command: { resume: true } },
    ],
    [
      `/api/threads/${id}/runs/stream`,
      'POST',
      {
        assistant_id: 'c-timeline',
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
  for (const kind of ['history']) {
    await f.json('/__hold-' + kind);
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt === 1) await f.json(`/__${kind}/hold`);
      // One-shot plus persistent hold must still record a single applied hold.
      if (attempt === 2) await f.json('/__hold-' + kind);
      const pending = f.history(id);
      await f.wait('activeHistory');
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

test('held stream, history release and disconnect without retaining responses', async (t) => {
  const f = await fixture(t),
    id = await f.create();
  await f.json('/__hold-stream');
  const streamed = f.submit(id).then((r) => r.text());
  await f.wait('activeStream');
  await f.json('/__release');
  assert.match(await streamed, /Answer/);
  for (const kind of ['history']) {
    await f.json('/__hold-' + kind);
    const pending = f.history(id);
    await f.wait('activeHistory');
    await f.json('/__release-' + kind);
    await pending;
    await f.json('/__hold-' + kind);
    const controller = new AbortController();
    const request = f
      .request(
        `/api/threads/${id}/history`,
        { limit: 10 },
        'POST',
        controller.signal
      )
      .catch(() => null);
    await f.wait('activeHistory');
    controller.abort();
    await request;
    for (
      let i = 0;
      i < 100 && (await f.json('/__lifetime'))['activeHistory'];
      i++
    )
      await new Promise((r) => setTimeout(r, 10));
    assert.equal((await f.json('/__lifetime'))['activeHistory'], false);
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
              'cockpit/chat/timeline/python',
              'python',
              'scripts/react-cockpit/chat-timeline-wire.py',
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

test('closed chat-timeline selection has its own build and server dispatch', async () => {
  const { reactCockpitConfiguration } = await import('./configuration.mjs');
  assert.deepEqual(reactCockpitConfiguration('chat-timeline'), {
    topic: 'timeline',
    library: 'chat',
    adapter: 'langgraph',
    appPath: 'cockpit/chat/timeline/react',
    base: '/chat/timeline/react/',
    port: 4626,
    project: 'cockpit-chat-timeline-react',
  });
  assert.throws(() => reactCockpitConfiguration('../chat-timeline'));
  const server = readFileSync('scripts/react-cockpit/serve.mjs', 'utf8');
  assert.match(server, /createChatTimelineFixture/);
  assert.match(
    server,
    /await chatTimelineFixture\(request, response, pathname\)/
  );
  assert.match(
    server,
    /await\s*\(\s*(?:\w+\s*\?\?\s*)*chatTimelineFixture(?:\s*\?\?\s*\w+)*\s*\)\.close\(\)/
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
  assert.match(await (await f.submit(id)).text(), /Answer/);
});

test('read-only full checkpoint selection forks actual A+D and keeps later tip immutable', async (t) => {
  const f = await fixture(t),
    id = await f.create();
  await (await f.submit(id, 'A', 'human-a')).text();
  const a = (await f.history(id))[0];
  await (await f.submit(id, 'B', 'human-b')).text();
  const b = (await f.history(id))[0];
  const source = a.checkpoint;
  const before = (await f.json('/__graph-proof')).filter(
    (p) => p.op === 'submit'
  ).length;
  const selected = await f.json(`/api/threads/${id}/state/checkpoint`, {
    checkpoint: source,
  });
  assert.deepEqual(selected.values, a.values);
  assert.deepEqual((await f.history(id))[0].values, b.values);
  assert.equal(
    (await f.json('/__graph-proof')).filter((p) => p.op === 'submit').length,
    before
  );
  await (
    await f.request(`/api/threads/${id}/runs/stream`, {
      assistant_id: 'c-timeline',
      checkpoint: source,
      input: { messages: [{ type: 'human', id: 'human-d', content: 'D' }] },
    })
  ).text();
  const d = (await f.history(id))[0];
  assert.equal(Object.hasOwn(d.metadata, 'run_id'), false);
  const runEvents = frames(
    await (
      await f.request(`/api/threads/${id}/runs/stream`, {
        assistant_id: 'c-timeline',
        checkpoint: d.checkpoint,
        input: {
          messages: [
            { type: 'human', id: 'checkpoint-probe', content: 'Probe' },
          ],
        },
        stream_mode: ['values', 'messages-tuple', 'updates', 'checkpoints'],
      })
    ).text()
  );
  const checkpoints = runEvents.filter(([kind]) => kind === 'checkpoints');
  assert(
    checkpoints.length > 0,
    'actual compiled checkpoint events are streamed'
  );
  assert.equal(
    checkpoints.at(-1)[1].config.configurable.run_id,
    runEvents[0][1].run_id
  );

  assert.deepEqual(
    d.values.messages.map((m) => m.id),
    ['human-a', 'answer-human-a', 'human-d', 'answer-human-d']
  );
  assert.deepEqual(d.values.messages.slice(0, 2), a.values.messages);
  assert.deepEqual(
    d.values.completed_message_ids,
    d.values.messages.map((m) => m.id)
  );
  assert.deepEqual(
    (
      await f.json(`/api/threads/${id}/state/checkpoint`, {
        checkpoint: b.checkpoint,
      })
    ).values,
    b.values
  );
  await (
    await f.request(`/api/threads/${id}/runs/stream`, {
      assistant_id: 'c-timeline',
      checkpoint: d.checkpoint,
      input: { messages: [{ type: 'human', id: 'human-e', content: 'E' }] },
    })
  ).text();
  assert.deepEqual(
    (await f.history(id))[0].values.messages
      .filter((m) => m.type === 'human')
      .map((m) => m.content),
    ['A', 'D', 'E']
  );
  for (const checkpoint of [
    { ...source, thread_id: randomUUID() },
    { ...source, checkpoint_id: randomUUID() },
    { ...source, checkpoint_ns: 'foreign' },
    { ...source, checkpoint_map: { '': randomUUID() } },
  ]) {
    assert.equal(
      (await f.request(`/api/threads/${id}/state/checkpoint`, { checkpoint }))
        .status,
      400
    );
  }
});

test('worker fork result names its actual terminal checkpoint rather than the original source', async (t) => {
  const { createInterface } = await import('node:readline');
  const child = spawn(
    'uv',
    [
      'run',
      '--frozen',
      '--python',
      '3.12',
      '--project',
      'cockpit/chat/timeline/python',
      'python',
      'scripts/react-cockpit/chat-timeline-wire.py',
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] }
  );
  child.stderr.resume();
  const lines = createInterface({ input: child.stdout });
  const replies = lines[Symbol.asyncIterator]();
  t.after(() => {
    lines.close();
    child.stdin.end();
    child.kill();
  });
  let requestId = 0;
  async function call(value) {
    child.stdin.write(
      JSON.stringify({ ...value, requestId: ++requestId }) + '\n'
    );
    return JSON.parse((await replies.next()).value);
  }
  const threadId = randomUUID();
  const a = await call({
    op: 'submit',
    threadId,
    runId: randomUUID(),
    messages: [{ type: 'human', id: 'a', content: 'A' }],
  });
  const b = await call({
    op: 'submit',
    threadId,
    runId: randomUUID(),
    messages: [{ type: 'human', id: 'b', content: 'B' }],
  });
  const d = await call({
    op: 'submit',
    threadId,
    runId: randomUUID(),
    checkpoint: a.state.checkpoint,
    messages: [{ type: 'human', id: 'd', content: 'D' }],
  });
  assert.notEqual(
    d.state.checkpoint.checkpoint_id,
    a.state.checkpoint.checkpoint_id
  );
  assert.notEqual(
    d.state.checkpoint.checkpoint_id,
    b.state.checkpoint.checkpoint_id
  );
  assert.deepEqual(
    d.state.values.messages.map((m) => m.id),
    ['a', 'answer-a', 'd', 'answer-d']
  );
  assert.equal(
    d.state.checkpoint.checkpoint_id,
    d.events.filter(([kind]) => kind === 'checkpoints').at(-1)[1].config
      .configurable.checkpoint_id
  );
});

test('mapped HTTP representation preserves genuine checkpoint IDs and rejects map mutation', async (t) => {
  const f = await fixture(t),
    id = await f.create();
  await f.json('/__mapped-checkpoints');
  await (await f.submit(id, 'A', 'a')).text();
  const a = (await f.history(id))[0],
    source = a.checkpoint;
  assert.deepEqual(source.checkpoint_map, { '': source.checkpoint_id });
  assert.deepEqual(
    (
      await f.json(`/api/threads/${id}/state/checkpoint`, {
        checkpoint: source,
      })
    ).checkpoint,
    source
  );
  for (const checkpoint of [
    { ...source, checkpoint_map: undefined },
    { ...source, checkpoint_map: {} },
    { ...source, checkpoint_map: { '': 'wrong' } },
    {
      ...source,
      checkpoint_map: { '': source.checkpoint_id, child: 'unexpected' },
    },
  ]) {
    assert.equal(
      (await f.request(`/api/threads/${id}/state/checkpoint`, { checkpoint }))
        .status,
      400
    );
    assert.equal(
      (
        await f.request(`/api/threads/${id}/runs/stream`, {
          assistant_id: 'c-timeline',
          checkpoint,
          input: { messages: [{ type: 'human', id: 'bad', content: 'Bad' }] },
        })
      ).status,
      400
    );
  }
  const events = frames(
    await (
      await f.request(`/api/threads/${id}/runs/stream`, {
        assistant_id: 'c-timeline',
        checkpoint: source,
        input: { messages: [{ type: 'human', id: 'd', content: 'D' }] },
        stream_mode: [
          'values',
          'messages-tuple',
          'updates',
          'custom',
          'checkpoints',
        ],
      })
    ).text()
  );
  const terminal = events.filter(([kind]) => kind === 'checkpoints').at(-1)[1]
    .config.configurable;
  assert.deepEqual(terminal.checkpoint_map, { '': terminal.checkpoint_id });
  const state = await f.json(`/api/threads/${id}/state/checkpoint`, {
    checkpoint: {
      thread_id: id,
      checkpoint_ns: '',
      checkpoint_id: terminal.checkpoint_id,
      checkpoint_map: terminal.checkpoint_map,
    },
  });
  assert.deepEqual(
    state.values.messages.map((m) => m.id),
    ['a', 'answer-a', 'd', 'answer-d']
  );
  assert.equal(
    (await f.json('/__graph-proof')).filter((p) => p.op === 'submit').length,
    2
  );
});

for (const field of ['sourceSha256', 'lockSha256'])
  test(`worker proof with wrong ${field} fails closed`, async (t) => {
    const expected = Object.fromEntries(
      [
        ['sourceSha256', 'src/graph.py'],
        ['lockSha256', 'uv.lock'],
      ].map(([key, path]) => [
        key,
        createHash('sha256')
          .update(readFileSync('cockpit/chat/timeline/python/' + path))
          .digest('hex'),
      ])
    );
    expected[field] = 'wrong';
    const f = await fixture(t, {
      spawnWorker: () =>
        spawn(
          process.execPath,
          [
            '-e',
            `process.stdin.on('data',line=>{const q=JSON.parse(line);process.stdout.write(JSON.stringify({requestId:q.requestId,history:[],proof:{actualCompiledGraph:true,...${JSON.stringify(
              expected
            )},op:q.op,threadId:q.threadId,networkConnectAttempts:0,titleMessageCallbacks:0}})+String.fromCharCode(10))})`,
          ],
          { stdio: ['pipe', 'pipe', 'pipe'] }
        ),
    });
    const id = await f.create();
    assert.equal(
      (await f.request(`/api/threads/${id}/history`, { limit: 10 })).status,
      500
    );
    assert.deepEqual(await f.json('/__graph-proof'), []);
  });

test('fixture instances isolate fault controls, workers, and checkpoint ownership', async (t) => {
  const a = await fixture(t),
    b = await fixture(t),
    id = await a.create();
  await b.create(id);
  await a.json('/__history/failure');
  await Promise.all([
    (async () => {
      await (await a.submit(id, 'A', 'a')).text();
    })(),
    (async () => {
      await (await b.submit(id, 'B', 'b')).text();
    })(),
  ]);
  assert.equal(
    (await a.request(`/api/threads/${id}/history`, { limit: 10 })).status,
    500
  );
  assert.deepEqual(
    (await b.history(id))[0].values.messages.map((m) => m.id),
    ['b', 'answer-b']
  );
  assert.notEqual(
    (await a.json('/__lifetime')).workerPid,
    (await b.json('/__lifetime')).workerPid
  );
  await a.handle.close();
  await (await b.submit(id, 'C', 'c')).text();
  assert.deepEqual(
    (await b.history(id))[0].values.messages.map((m) => m.id),
    ['b', 'answer-b', 'c', 'answer-c']
  );
});

test('history honors bounded limits and rejects unimplemented routing fields', async (t) => {
  const f = await fixture(t),
    id = await f.create();
  await (await f.submit(id, 'A')).text();
  await (await f.submit(id, 'B')).text();
  const all = await f.history(id);
  assert(all.length > 1);
  assert.equal(
    (await f.json(`/api/threads/${id}/history`, { limit: 1 })).length,
    1
  );
  for (const body of [
    {},
    { limit: 0 },
    { limit: -1 },
    { limit: 101 },
    { limit: 1.5 },
    { limit: '10' },
    { limit: 10, filter: {} },
    { limit: 10, before: {} },
    { limit: 10, checkpoint: {} },
  ])
    assert.equal(
      (await f.request(`/api/threads/${id}/history`, body)).status,
      400,
      JSON.stringify(body)
    );
});

test('checkpoint reads reject extra top-level state mutation and routing fields', async (t) => {
  const f = await fixture(t),
    id = await f.create();
  await (await f.submit(id)).text();
  const checkpoint = (await f.history(id))[0].checkpoint;
  for (const extra of [
    { values: {} },
    { checkpoint_id: checkpoint.checkpoint_id },
    { subgraphs: true },
    { unknown: true },
  ])
    assert.equal(
      (
        await f.request(`/api/threads/${id}/state/checkpoint`, {
          checkpoint,
          ...extra,
        })
      ).status,
      400
    );
});

test('run admission rejects unsupported SDK fields, malformed inputs, and mode controls before execution', async (t) => {
  const f = await fixture(t),
    id = await f.create();
  const input = {
      messages: [{ type: 'human', id: 'authored', content: 'Hello' }],
    },
    base = { assistant_id: 'c-timeline', input };
  const bad = [
    { config: {} },
    { interrupt_before: ['generate'] },
    { interrupt_after: [] },
    { metadata: {} },
    { stream_subgraphs: false },
    { stream_subgraphs: undefined },
    { stream_resumable: false },
    { stream_resumable: undefined },
    { on_disconnect: 'cancel' },
    { on_disconnect: undefined },
    { stream_mode: undefined },
    { stream_mode: [] },
    { stream_mode: ['messages'] },
    { stream_mode: ['values', 'values'] },
    { stream_mode: 'values' },
    { stream_mode: ['debug'] },
    { input: { ...input, other: 1 } },
    { input: { messages: [{ ...input.messages[0], id: ' ' }] } },
    { input: { messages: [{ ...input.messages[0], name: 'extra' }] } },
    { input: { messages: [{ ...input.messages[0], content: 3 }] } },
  ];
  for (const delta of bad)
    assert.equal(
      (await f.request(`/api/threads/${id}/runs/stream`, { ...base, ...delta }))
        .status,
      400,
      JSON.stringify(delta)
    );
  assert.equal(
    (await f.json('/__graph-proof')).filter((p) => p.op === 'submit').length,
    0
  );
});

test('SSE emits only requested modes while real internal checkpoints still determine terminal state', async (t) => {
  const f = await fixture(t),
    id = await f.create();
  const ordinary = frames(await (await f.submit(id, 'A', 'a')).text());
  assert(!ordinary.some(([kind]) => kind === 'checkpoints'));
  assert(ordinary.some(([kind]) => kind === 'messages'));
  const a = (await f.history(id))[0];
  const branch = frames(
    await (
      await f.request(`/api/threads/${id}/runs/stream`, {
        assistant_id: 'c-timeline',
        checkpoint: a.checkpoint,
        input: { messages: [{ type: 'human', id: 'd', content: 'D' }] },
        stream_mode: ['values', 'checkpoints'],
      })
    ).text()
  );
  assert(branch.some(([kind]) => kind === 'checkpoints'));
  assert(
    !branch.some(([kind]) => ['messages', 'updates', 'custom'].includes(kind))
  );
  assert.deepEqual(
    (await f.history(id))[0].values.messages.map((m) => m.id),
    ['a', 'answer-a', 'd', 'answer-d']
  );
  const failed = frames(
    await (
      await f.request(`/api/threads/${id}/runs/stream`, {
        assistant_id: 'c-timeline',
        input: {
          messages: [{ type: 'human', id: 'failure', content: 'fail-stream' }],
        },
        stream_mode: ['values'],
      })
    ).text()
  );
  assert(failed.some(([kind]) => kind === 'error'));
  assert(
    !failed.some(([kind]) => kind === 'messages' || kind === 'checkpoints')
  );
});
