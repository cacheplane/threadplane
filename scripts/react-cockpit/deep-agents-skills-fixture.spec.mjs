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
const { createDeepAgentsSkillsFixture } = await import(
  './deep-agents-skills-fixture.mjs'
).catch(() => ({}));
const captureDirectory = mkdtempSync(
  join(tmpdir(), 'threadplane-skills-fixture-captures-')
);
console.log('Skills fixture capture directory: ' + captureDirectory);
const capture = (name, value) =>
  writeFileSync(
    join(captureDirectory, name + '.json'),
    JSON.stringify(value, null, 2) + '\n'
  );
let native;
function nativeRuntime() {
  return (native ??= (async () => {
    const directory = mkdtempSync(join(tmpdir(), 'threadplane-skills-native-'));
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
    typeof createDeepAgentsSkillsFixture,
    'function',
    'Missing native Skills worker fixture'
  );
  const handle = createDeepAgentsSkillsFixture(options);
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
    client.runs.stream(thread, 'da-skills', {
      input: {
        messages: [{ type: 'human', id, content: 'Dispatch request.' }],
      },
      streamMode: [
        'messages-tuple',
        'values',
        'updates',
        'checkpoints',
        'custom',
      ],
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
const results = (state) =>
  state.values.messages.filter((m) => m.type === 'tool');
for (const [scenario, count, status] of [
  ['reads', 2, 'success'],
  ['no-read', 0, 'success'],
  ['partial', 1, 'success'],
  ['error', 1, 'error'],
  ['alternate', 1, 'success'],
]) {
  test(
    `installed SDK actual Skills graph ${scenario} preserves root metadata and exact checkpoints`,
    { timeout: 30000 },
    async (t) => {
      const f = await fixture(t);
      await f.control({ scenario });
      const events = await f.submit();
      const saved = await f.client.threads.getState(f.thread);
      assert.deepEqual(
        await f.client.threads.getState(f.thread, saved.checkpoint),
        saved
      );
      assert.deepEqual(
        (await f.client.threads.getHistory(f.thread, { limit: 100 }))[0],
        saved
      );
      assert(
        saved.values.skills_metadata.some((s) => s.name === 'runway-analysis')
      );
      assert(
        saved.values.skills_metadata.some((s) => s.name === 'weather-brief')
      );
      assert.deepEqual(
        events.filter((e) => e.event === 'values').at(-1).data.skills_metadata,
        saved.values.skills_metadata
      );
      assert.deepEqual(
        events.filter((e) => e.event === 'checkpoints').at(-1).data.values
          .skills_metadata,
        saved.values.skills_metadata
      );
      assert.deepEqual(
        events.filter((e) => e.event === 'custom').at(-1).data.data
          .skills_metadata,
        saved.values.skills_metadata
      );
      assert.equal(results(saved).length, count);
      assert(results(saved).every((m) => m.status === status));
      if (scenario === 'reads') {
        assert.match(results(saved)[0].content, /reference\/margins/);
        assert.match(results(saved)[1].content, /4,800/);
      }
      const proof = await (await fetch(f.base + '/__graph-proof')).json();
      assert(
        proof.every(
          (p) => p.actualCompiledGraph && p.networkConnectAttempts === 0
        )
      );
      for (const p of proof)
        assert(Object.keys(p.sourceSha256).includes('src/skills_readonly.py'));
      capture('sdk-' + scenario, {
        events,
        saved,
        proof,
        raw: await (await fetch(f.base + '/__raw-events')).json(),
      });
    }
  );
}
test(
  'installed native root Skills values survive canonical load and followup',
  { timeout: 60000 },
  async (t) => {
    const { createSession } = await nativeRuntime();
    const f = await fixture(t);
    await f.control({ scenario: 'reads' });
    const session = createSession({
      apiUrl: f.base + '/api',
      threadId: f.thread,
      assistantId: 'da-skills',
    });
    t.after(() => session.dispose());
    assert.equal(await session.submit('First assessment'), 'success');
    const before = structuredClone(session.getSnapshot());
    const saved = await f.client.threads.getState(f.thread);
    assert.deepEqual(
      before.values.skills_metadata,
      saved.values.skills_metadata
    );
    await session.load();
    assert.deepEqual(
      session.getSnapshot().values.skills_metadata,
      saved.values.skills_metadata
    );
    assert.equal(await session.submit('Followup assessment'), 'success');
    const second = await f.client.threads.getState(f.thread);
    assert.equal(
      second.values.messages.filter((m) => m.type === 'human').length,
      2
    );
    assert.equal(results(second).length, 4);
    capture('native-root-followup', {
      before,
      saved,
      second,
      after: session.getSnapshot(),
    });
  }
);
test('replay resume unknown owner and checkpoint fail closed', async (t) => {
  const f = await fixture(t);
  await f.control({ scenario: 'reads' });
  await f.submit('owned-human');
  await assert.rejects(() => f.submit('owned-human'));
  await assert.rejects(() => f.client.threads.getState(randomUUID()));
  const saved = await f.client.threads.getState(f.thread);
  await assert.rejects(() =>
    f.client.threads.getState(f.thread, {
      ...saved.checkpoint,
      checkpoint_id: randomUUID(),
    })
  );
  const response = await fetch(
    f.base + `/api/threads/${f.thread}/runs/stream`,
    {
      method: 'POST',
      body: JSON.stringify({
        assistant_id: 'da-skills',
        command: { resume: 'yes' },
        stream_mode: ['values'],
      }),
    }
  );
  assert.equal(response.status, 400);
});
test('canceled buffered delivery preserves actual graph and closes worker', async (t) => {
  const f = await fixture(t);
  await f.control({ scenario: 'reads', holdStream: true });
  const stream = f.stream();
  const metadata = await stream.next();
  await f.client.runs.cancel(
    f.thread,
    metadata.value.data.run_id,
    true,
    'interrupt'
  );
  assert.equal((await stream.next()).done, true);
  assert.equal(results(await f.client.threads.getState(f.thread)).length, 2);
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
    const handle = createDeepAgentsSkillsFixture({
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
