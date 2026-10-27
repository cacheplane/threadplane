import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { Client } from '@langchain/langgraph-sdk';
import {
  emitCandidate,
  packCandidate,
  installCandidateConsumer,
} from '../react-parity/langgraph-candidate-package.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const { createDeepAgentsSubagentsFixture } = await import(
  './deep-agents-subagents-fixture.mjs'
).catch(() => ({}));
const captureDirectory = mkdtempSync(
  join(tmpdir(), 'threadplane-subagents-fixture-captures-')
);
console.log('Subagents fixture capture directory: ' + captureDirectory);
const capture = (name, value) =>
  writeFileSync(
    join(captureDirectory, name + '.json'),
    JSON.stringify(value, null, 2) + '\n'
  );
let native;
function nativeRuntime() {
  return (native ??= (async () => {
    const directory = mkdtempSync(
      join(tmpdir(), 'threadplane-subagents-native-')
    );
    const candidate = join(directory, 'candidate');
    mkdirSync(candidate);
    const emission = emitCandidate(root, candidate);
    const packed = packCandidate(candidate, directory);
    const core = JSON.parse(
      execFileSync(
        'npm',
        [
          'pack',
          join(root, 'dist/libs/core'),
          '--pack-destination',
          directory,
          '--json',
        ],
        { encoding: 'utf8' }
      )
    )[0];
    const lock = JSON.parse(readFileSync(join(root, 'package-lock.json')));
    const consumer = join(directory, 'consumer');
    mkdirSync(consumer);
    // Reuse the package verifier's exact locked graph and tarball-byte checks.
    // A clean npm-ci cache contains tarballs but need not contain packuments.
    const installation = installCandidateConsumer(
      consumer,
      { private: true, type: 'module' },
      {
        '@threadplane/core': 'file:' + join(directory, core.filename),
        '@threadplane/langgraph': 'file:' + packed.tarball,
      },
      lock,
      'node'
    );
    const installed = join(
      consumer,
      'node_modules/@threadplane/langgraph/runtime/create-session.js'
    );
    capture('installed-runtime', {
      directory,
      installed,
      emission,
      installation,
      installedSha256: createHash('sha256')
        .update(readFileSync(installed))
        .digest('hex'),
    });
    return import(pathToFileURL(installed).href);
  })());
}
async function fixture(t, options) {
  assert.equal(
    typeof createDeepAgentsSubagentsFixture,
    'function',
    'Missing native Subagents worker fixture'
  );
  const handle = createDeepAgentsSubagentsFixture(options);
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
    callerOptions: { maxRetries: 0 },
  });
  const thread = randomUUID();
  await client.threads.create({ threadId: thread, ifExists: 'raise' });
  const control = async (body) =>
    assert.equal(
      (
        await fetch(base + '/__configure', {
          method: 'POST',
          body: JSON.stringify(body),
        })
      ).status,
      200
    );
  const stream = (id = randomUUID()) =>
    client.runs.stream(thread, 'subagents', {
      input: {
        messages: [{ type: 'human', id, content: 'Dispatch request.' }],
      },
      streamMode: ['messages-tuple', 'values', 'updates', 'checkpoints'],
      streamSubgraphs: true,
      streamResumable: true,
      onDisconnect: 'continue',
    });
  const submit = async (id) => {
    const events = [];
    for await (const e of stream(id)) events.push(e);
    return events;
  };
  return { base, client, thread, control, submit, stream, handle };
}
const rootCalls = (state) =>
  state.values.messages
    .filter((m) => m.type === 'ai')
    .flatMap((m) => m.tool_calls ?? []);
const results = (state) =>
  state.values.messages.filter((m) => m.type === 'tool');
for (const scenario of [
  'single',
  'parallel',
  'duplicates',
  'no-task',
  'general-purpose',
  'default-tool',
  'tool-error',
  'root-tool-error',
]) {
  test(
    `installed SDK real graph ${scenario} keeps native owner, namespace and saved checkpoints`,
    { timeout: 30000 },
    async (t) => {
      const f = await fixture(t);
      await f.control({ scenario });
      const events = await f.submit('human-' + scenario);
      const saved = await f.client.threads.getState(f.thread);
      assert.deepEqual(
        await f.client.threads.getState(f.thread, saved.checkpoint),
        saved
      );
      assert.deepEqual(
        (await f.client.threads.getHistory(f.thread, { limit: 100 }))[0],
        saved
      );
      assert.deepEqual(saved.next, []);
      assert.deepEqual(saved.tasks, []);
      const run = events.find((e) => e.event === 'metadata').data.run_id;
      assert.equal((await f.client.runs.get(f.thread, run)).status, 'success');
      const children = events.filter((e) => e.event.includes('|'));
      const paths = new Set(
        children.map((e) => e.event.split('|').slice(1).join('|'))
      );
      assert.equal(
        paths.size,
        ['parallel', 'duplicates'].includes(scenario)
          ? 4
          : ['no-task', 'default-tool', 'root-tool-error'].includes(scenario)
          ? 0
          : 1
      );
      assert.equal(
        rootCalls(saved).length,
        ['parallel', 'duplicates'].includes(scenario)
          ? 4
          : scenario === 'no-task'
          ? 0
          : 1
      );
      assert.equal(results(saved).length, rootCalls(saved).length);
      for (const c of rootCalls(saved))
        assert(results(saved).some((m) => m.tool_call_id === c.id));
      if (scenario === 'duplicates')
        assert.equal(
          new Set(rootCalls(saved).map((c) => c.args.description)).size,
          1
        );
      if (scenario === 'default-tool')
        assert.equal(rootCalls(saved)[0].name, 'ls');
      if (scenario === 'tool-error')
        assert(
          children.some(
            (e) =>
              e.event.startsWith('values|') &&
              e.data.messages.some(
                (m) => m.type === 'tool' && m.status === 'error'
              )
          )
        );
      const raw = await (await fetch(f.base + '/__raw-events')).json();
      if (scenario === 'parallel') {
        const spans = [...paths].map((path) => {
          const indices = raw[0].events.flatMap(([ns], i) =>
            ns.join('|') === path ? [i] : []
          );
          return [Math.min(...indices), Math.max(...indices)];
        });
        assert(
          spans.some(([a, b], i) =>
            spans.some(([c, d], j) => i !== j && a < c && c < b && b < d)
          ),
          'actual parallel child namespace events interleave'
        );
      }
      const proofs = await (await fetch(f.base + '/__graph-proof')).json();
      assert(
        proofs.every(
          (p) => p.actualCompiledGraph && p.networkConnectAttempts === 0
        )
      );
      capture('sdk-' + scenario, { events, raw, saved, proofs });
      if (scenario === 'duplicates') {
        await f.submit('second-human');
        const second = await f.client.threads.getState(f.thread);
        assert.equal(
          second.values.messages.filter((m) => m.type === 'human').length,
          2
        );
        assert.equal(rootCalls(second).length, 8);
      }
    }
  );
}
test(
  'installed neutral createSession captures child human/tool/assistant and extra values before load',
  { timeout: 60000 },
  async (t) => {
    const { createSession } = await nativeRuntime();
    const f = await fixture(t);
    await f.control({ scenario: 'parallel' });
    const session = createSession({
      apiUrl: f.base + '/api',
      threadId: f.thread,
      assistantId: 'subagents',
    });
    t.after(() => session.dispose());
    const during = [];
    const unsub = session.subscribe(() => {
      const snap = session.getSnapshot();
      if (snap.subgraphs.length) during.push(structuredClone(snap));
    });
    const outcome = await session.submit('Dispatch request.');
    unsub();
    const before = structuredClone(session.getSnapshot());
    const saved = await f.client.threads.getState(f.thread);
    const raw = await (await fetch(f.base + '/__raw-events')).json();
    capture('native-before-load', { outcome, before, during, saved, raw });
    assert.equal(outcome, 'success');
    assert.equal(before.subgraphs.length, 4);
    for (const child of before.subgraphs) {
      assert(Array.isArray(child.namespace));
      assert(child.namespace.length);
      assert(child.messages.some((m) => m.role === 'user'));
      assert(child.messages.some((m) => m.role === 'tool'));
      assert(child.messages.some((m) => m.role === 'assistant'));
      assert(child.values && Object.hasOwn(child.values, 'files'));
      assert.equal(child.interrupts.length, 0);
    }
    await session.load();
    const after = structuredClone(session.getSnapshot());
    capture('native-after-load', { afterLoad: after });
    assert.equal(
      after.subgraphs.length,
      0,
      'explicit root history load does not restore ephemeral child namespace streams'
    );
  }
);
test(
  'native duplicate descriptions remain unlinked namespaces and reset each current session turn',
  { timeout: 30000 },
  async (t) => {
    const { createSession } = await nativeRuntime();
    const f = await fixture(t);
    await f.control({ scenario: 'duplicates' });
    const session = createSession({
      apiUrl: f.base + '/api',
      threadId: f.thread,
      assistantId: 'subagents',
    });
    t.after(() => session.dispose());
    assert.equal(await session.submit('First dispatch.'), 'success');
    const first = structuredClone(session.getSnapshot());
    assert.equal(first.subgraphs.length, 4);
    assert.equal(
      new Set(
        first.subgraphs.map(
          (c) => c.messages.find((m) => m.role === 'user').content
        )
      ).size,
      1
    );
    assert.equal(
      new Set(first.subgraphs.map((c) => JSON.stringify(c.namespace))).size,
      4
    );
    assert.equal(await session.submit('Second dispatch.'), 'success');
    const second = structuredClone(session.getSnapshot());
    assert.equal(second.subgraphs.length, 4);
    assert(
      second.subgraphs.every(
        (c) =>
          !first.subgraphs.some(
            (previous) =>
              JSON.stringify(c.namespace) === JSON.stringify(previous.namespace)
          )
      )
    );
    const saved = await f.client.threads.getState(f.thread);
    assert.equal(rootCalls(saved).length, 8);
    await f.control({ scenario: 'no-task' });
    assert.equal(await session.submit('No delegation now.'), 'success');
    const noTask = structuredClone(session.getSnapshot());
    assert.equal(noTask.subgraphs.length, 0);
    capture('native-duplicates', {
      first,
      second,
      saved,
      noTask,
      raw: await (await fetch(f.base + '/__raw-events')).json(),
    });
  }
);

test(
  'root-tool-error is a real resolved task schema error on successful native run',
  { timeout: 30000 },
  async (t) => {
    const { createSession } = await nativeRuntime();
    const f = await fixture(t);
    await f.control({ scenario: 'root-tool-error' });
    const session = createSession({
      apiUrl: f.base + '/api',
      threadId: f.thread,
      assistantId: 'subagents',
    });
    t.after(() => session.dispose());
    assert.equal(
      await session.submit('Invalid root task arguments.'),
      'success'
    );
    const beforeLoad = structuredClone(session.getSnapshot());
    const saved = await f.client.threads.getState(f.thread);
    const calls = rootCalls(saved);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'task');
    assert.deepEqual(calls[0].args, { subagent_type: 'field-researcher' });
    const reports = results(saved);
    assert.equal(reports.length, 1);
    assert.equal(reports[0].status, 'error');
    assert.equal(reports[0].tool_call_id, calls[0].id);
    assert.match(reports[0].content, /description/);
    assert.equal(beforeLoad.subgraphs.length, 0);
    assert(
      beforeLoad.messages.some(
        (m) => m.role === 'tool' && m.toolCallId === calls[0].id
      )
    );
    await session.load();
    const afterLoad = structuredClone(session.getSnapshot());
    assert.deepEqual(
      await f.client.threads.getState(f.thread, saved.checkpoint),
      saved
    );
    capture('native-root-tool-error', {
      beforeLoad,
      afterLoad,
      saved,
      raw: await (await fetch(f.base + '/__raw-events')).json(),
    });
  }
);

test('unknown owner, selector, route, body and checkpoint fail closed', async (t) => {
  const f = await fixture(t);
  await f.submit();
  const saved = await f.client.threads.getState(f.thread);
  await assert.rejects(f.client.threads.getState(randomUUID()));
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
    for await (const e of f.client.runs.stream(f.thread, 'da-subagents', {
      input: { messages: [{ type: 'human', id: 'bad', content: 'bad' }] },
      streamMode: ['values'],
    })) {
    }
  });
  assert.equal(
    (await fetch(f.base + `/api/threads/${f.thread}/unknown`)).status,
    404
  );
  assert.equal(
    (
      await fetch(f.base + '/__configure', {
        method: 'POST',
        body: JSON.stringify({ scenario: 'injected' }),
      })
    ).status,
    400
  );
  assert.equal(
    (
      await fetch(f.base + '/api/threads', {
        method: 'POST',
        body: JSON.stringify({ thread_id: randomUUID() }),
      })
    ).status,
    400
  );
  assert.deepEqual(
    (await f.client.threads.getState(f.thread)).values,
    saved.values
  );
});
test('buffered delivery cancellation preserves actual saved graph and closes child', async (t) => {
  const f = await fixture(t);
  await f.control({ scenario: 'parallel', holdStream: true });
  const stream = f.stream();
  const metadata = await stream.next();
  const run = metadata.value.data.run_id;
  await f.client.runs.cancel(f.thread, run, true, 'interrupt');
  assert.equal((await stream.next()).done, true);
  assert.equal((await f.client.runs.get(f.thread, run)).status, 'interrupted');
  assert.equal(rootCalls(await f.client.threads.getState(f.thread)).length, 4);
  const life = await (await fetch(f.base + '/__lifetime')).json();
  await f.handle.close();
  assert.throws(() => process.kill(life.workerPid, 0), { code: 'ESRCH' });
});
test(
  'worker unterminated oversized frame rejects before the long operation timeout',
  { timeout: 12000 },
  async (t) => {
    let child;
    const timeout = 6000;
    const handle = createDeepAgentsSubagentsFixture({
      workerTimeoutMs: timeout,
      spawnWorker: () =>
        (child = spawn(
          process.execPath,
          [
            '-e',
            'process.stdin.once("data",()=>process.stdout.write(Buffer.alloc(16*1024*1024+1,0x78)));setInterval(()=>{},1000);',
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
      await new Promise((resolve) => server.close(resolve));
    });
    const client = new Client({
      apiUrl: `http://127.0.0.1:${server.address().port}/api`,
      callerOptions: { maxRetries: 0 },
    });
    const started = performance.now();
    await assert.rejects(
      client.threads.create({ threadId: randomUUID(), ifExists: 'raise' })
    );
    const elapsed = performance.now() - started;
    await handle.close();
    assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
    assert(
      elapsed < timeout / 2,
      `Oversized unterminated frame waited ${elapsed}ms toward ${timeout}ms operation timeout`
    );
  }
);

test(
  'worker parser accepts fragmented UTF8 exact-limit frames and resets bytes per response',
  { timeout: 15000 },
  async (t) => {
    // Injected responses test framing only; all graph-authority tests use the real worker.
    const sourceSha256 = Object.fromEntries(
      ['src/graph.py', 'prompts/subagents.md', 'uv.lock'].map((path) => [
        path,
        createHash('sha256')
          .update(
            readFileSync(
              join(root, 'cockpit/deep-agents/subagents/python', path)
            )
          )
          .digest('hex'),
      ])
    );
    const source = `
    const {createInterface}=require('node:readline');
    const lines=createInterface({input:process.stdin});
    lines.on('line',async line=>{
      const r=JSON.parse(line);
      const response={requestId:r.requestId,proof:{actualCompiledGraph:true,op:r.op,threadId:r.threadId??null,networkConnectAttempts:0,sourceSha256:${JSON.stringify(
        sourceSha256
      )}},padding:'é✈️'};
      response.padding+=' '.repeat(16*1024*1024-Buffer.byteLength(JSON.stringify(response)));
      const bytes=Buffer.from(JSON.stringify(response)+'\\n');
      const split=bytes.indexOf(Buffer.from('é'))+1;
      process.stdout.write(bytes.subarray(0,split));
      await new Promise(resolve=>setImmediate(resolve));
      for(let start=split;start<bytes.length;start+=65521){
        if(!process.stdout.write(bytes.subarray(start,start+65521)))await new Promise(resolve=>process.stdout.once('drain',resolve));
      }
    });`;
    let child;
    const f = await fixture(t, {
      spawnWorker: () =>
        (child = spawn(process.execPath, ['-e', source], {
          stdio: ['pipe', 'pipe', 'pipe'],
        })),
    });
    const other = randomUUID();
    assert.equal(
      (await f.client.threads.create({ threadId: other, ifExists: 'raise' }))
        .thread_id,
      other
    );
    await f.handle.close();
    assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
  }
);

test('worker parser processes each coalesced frame and rejects the unowned second response', async (t) => {
  // The second response is deliberately not pending, even when both frames share a chunk.
  const sourceSha256 = Object.fromEntries(
    ['src/graph.py', 'prompts/subagents.md', 'uv.lock'].map((path) => [
      path,
      createHash('sha256')
        .update(
          readFileSync(join(root, 'cockpit/deep-agents/subagents/python', path))
        )
        .digest('hex'),
    ])
  );
  const source = `process.stdin.once('data',data=>{const r=JSON.parse(data);process.stdout.write(JSON.stringify({requestId:r.requestId,proof:{actualCompiledGraph:true,op:r.op,threadId:r.threadId,networkConnectAttempts:0,sourceSha256:${JSON.stringify(
    sourceSha256
  )}}})+'\\n'+JSON.stringify({requestId:999})+'\\n');});setInterval(()=>{},1000);`;
  let child;
  const f = await fixture(t, {
    spawnWorker: () =>
      (child = spawn(process.execPath, ['-e', source], {
        stdio: ['pipe', 'pipe', 'pipe'],
      })),
  });
  await assert.rejects(
    f.client.threads.create({ threadId: randomUUID(), ifExists: 'raise' })
  );
  await f.handle.close();
  assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
});

for (const [name, source] of [
  ['timeout', 'process.stdin.resume();setInterval(()=>{},1000);'],
  [
    'malformed',
    'process.stdin.once("data",()=>process.stdout.write("bad\\n"));setInterval(()=>{},1000);',
  ],
  [
    'oversized response',
    'process.stdin.once("data",()=>process.stdout.write("x".repeat(16*1024*1024+1)+"\\n"));setInterval(()=>{},1000);',
  ],
  [
    'foreign response',
    'process.stdin.once("data",()=>process.stdout.write(JSON.stringify({requestId:999})+"\\n"));setInterval(()=>{},1000);',
  ],
  [
    'invalid proof',
    'process.stdin.once("data",d=>process.stdout.write(JSON.stringify({requestId:JSON.parse(d).requestId,proof:{actualCompiledGraph:false}})+"\\n"));setInterval(()=>{},1000);',
  ],
]) {
  test(`worker ${name} closes owned process`, async (t) => {
    let child;
    const handle = createDeepAgentsSubagentsFixture({
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
      await new Promise((r) => server.close(r));
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
  'stdio worker independently rejects malformed wire, replay and foreign checkpoint',
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
        'cockpit/deep-agents/subagents/python',
        'python',
        'scripts/react-cockpit/deep-agents-subagents-wire.py',
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          UV_CACHE_DIR:
            process.env.UV_CACHE_DIR ?? '/tmp/threadplane-genui-uv-cache',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    child.stderr.resume();
    const lines = createInterface({ input: child.stdout });
    t.after(async () => {
      const end = once(child, 'close');
      child.stdin.end();
      await end;
      lines.close();
    });
    let n = 0;
    const send = async (v) => {
      const line = once(lines, 'line');
      child.stdin.write(JSON.stringify({ ...v, requestId: ++n }) + '\n');
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
      messages: [{ type: 'human', id: 'a-human', content: 'Dispatch' }],
    };
    const wire = await send(input);
    assert(wire.events.some(([ns]) => ns.length));
    assert.equal((await send(input)).error, 'Graph operation failed');
    assert.equal(
      (
        await send({
          op: 'state',
          threadId: 'b',
          checkpoint: wire.state.checkpoint,
        })
      ).error,
      'Graph operation failed'
    );
    assert.equal(
      (await send({ op: 'configure', scenario: 'remote' })).error,
      'Graph operation failed'
    );
    assert.equal(
      (await send({ op: 'state', threadId: 'a', extra: true })).error,
      'Graph operation failed'
    );
    const bad = once(lines, 'line');
    child.stdin.write('{invalid}\n');
    assert.equal(JSON.parse((await bad)[0]).error, 'Graph operation failed');
  }
);
