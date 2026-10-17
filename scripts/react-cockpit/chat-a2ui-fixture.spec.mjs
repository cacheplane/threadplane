import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as probe from './chat-a2ui-native-probe.mjs';
import { Client } from '@langchain/langgraph-sdk';
import { createChatA2uiFixture } from './chat-a2ui-fixture.mjs';

export async function openFixture(t) {
  const handle = createChatA2uiFixture();
  const evidence = mkdtempSync(join(tmpdir(), 'threadplane-a2ui-sdk-'));
  const server = createServer(async (req, res) => {
    if (
      !(await handle(req, res, new URL(req.url, 'http://localhost').pathname))
    ) {
      res.writeHead(404);
      res.end();
    }
  });
  const cleanup = {};
  t.after(() =>
    probe.withOwnedResources(
      async (own) => {
        own('listener', async () => {
          server.closeAllConnections();
          await new Promise((r) => server.close(r));
        });
        own('fixture', () => handle.close());
      },
      cleanup,
      () => {
        writeFileSync(
          join(evidence, 'receipt.json'),
          JSON.stringify({ fixture: handle.receipt(), cleanup }, null, 2) +
            '\n',
          { mode: 0o600 }
        );
        console.log('Private c-a2ui SDK evidence: ' + evidence);
      }
    )
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const apiUrl = `http://127.0.0.1:${server.address().port}/api`;
  const client = new Client({
    apiUrl,
    apiKey: null,
    callerOptions: { maxRetries: 0 },
  });
  const thread = randomUUID();
  await client.threads.create({ threadId: thread, ifExists: 'raise' });
  return { handle, apiUrl, client, thread };
}
export const action = (name, context) =>
  JSON.stringify({
    version: 'v0.9',
    action: {
      name,
      surfaceId:
        name === 'bookingSubmit'
          ? 'booking'
          : name === 'flightSelect'
          ? 'results'
          : 'confirmation',
      sourceComponentId: 'button',
      timestamp: '2026-10-16T00:00:00Z',
      context,
    },
  });
export const inputs = [
  'I want to fly LAX to JFK',
  action('bookingSubmit', {
    formId: 'booking',
    origin: ['LAX'],
    dest: ['JFK'],
    date: '2026-11-03',
    passengers: 2,
    fare_class: ['Business'],
  }),
  action('flightSelect', { flightId: 'UA123' }),
  action('modifySearch', { formId: 'booking' }),
];
const envelopes = (state) =>
  state.values.messages
    .at(-1)
    .content.split('\n')
    .slice(1)
    .filter(Boolean)
    .map(JSON.parse);

test(
  'exported native probe preserves caller environment on failure',
  { timeout: 180000 },
  async () => {
    const identity = process.env;
    const before = { ...process.env };
    try {
      await probe.runNativeProbe({ workerScenario: 'fail-setup' });
    } catch {
      /* Expected controlled failure. */
    }
    assert.equal(
      process.env,
      identity,
      'Probe must never replace the caller environment'
    );
    assert.deepEqual({ ...process.env }, before);
  }
);

for (const phase of ['emit', 'pack', 'install', 'compiler'])
  test(
    `deadline interrupts synchronous ${phase} in owned worker group`,
    { timeout: 10000 },
    async () => {
      const evidence = mkdtempSync(join(tmpdir(), 'a2ui-deadline-'));
      const started = Date.now();
      await assert.rejects(
        probe.runNativeProbe({
          evidence,
          deadlineMs: 1500,
          workerScenario: `sync-${phase}`,
        }),
        /deadline/
      );
      assert.ok(Date.now() - started < 5000);
      const report = JSON.parse(
        readFileSync(join(evidence, 'report.json'), 'utf8')
      );
      assert.equal(report.child.reaped, true);
      assert.equal(report.closure.processAbsent, true);
      assert.equal(report.closure.groupAbsent, true);
      assert.equal(report.closure.controlledChild.absent, true);
      assert.equal(
        JSON.parse(readFileSync(join(evidence, 'phase.json'), 'utf8')).phase,
        phase
      );
    }
  );

test('setup failure closes acquired listener and worker before writing receipt', async () => {
  const calls = [],
    receipt = {};
  await assert.rejects(
    probe.withOwnedResources(
      async (own) => {
        const server = createServer();
        own('listener', async () => {
          server.closeAllConnections();
          await new Promise((r) => server.close(r));
          calls.push('listener');
        });
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const { spawn } = await import('node:child_process');
        const child = spawn(process.execPath, [
          '-e',
          'setInterval(()=>{},1000)',
        ]);
        const ended = once(child, 'close');
        own('worker', async () => {
          child.kill();
          await ended;
          calls.push('worker');
        });
        throw Error('setup failed');
      },
      receipt,
      () => calls.push('receipt')
    ),
    /setup failed/
  );
  assert.deepEqual(calls, ['worker', 'listener', 'receipt']);
  assert.deepEqual(
    receipt.cleanup.map((x) => x.name),
    ['worker', 'listener']
  );
});

test('rejected dispose and worker close preserve primary failure and run remaining cleanup and receipt', async () => {
  const calls = [],
    receipt = {};
  await assert.rejects(
    probe.withOwnedResources(
      async (own) => {
        own('listener', () => calls.push('listener'));
        own('worker', () => {
          calls.push('worker');
          throw Error('worker close failed');
        });
        own('session', () => {
          calls.push('session');
          throw Error('dispose failed');
        });
        throw Error('original failure');
      },
      receipt,
      () => calls.push('receipt')
    ),
    /original failure/
  );
  assert.deepEqual(calls, ['session', 'worker', 'listener', 'receipt']);
  assert.deepEqual(
    receipt.cleanup.filter((x) => x.error).map((x) => x.name),
    ['session', 'worker']
  );
});

test(
  'real SDK four-turn c-a2ui graph saves only canonical suffix and restores prior arrays',
  { timeout: 120000 },
  async (t) => {
    const f = await openFixture(t);
    let prior = [];
    const allEvents = [];
    for (const [index, content] of inputs.entries()) {
      const id = randomUUID(),
        events = [];
      for await (const e of f.client.runs.stream(f.thread, 'c-a2ui', {
        input: { messages: [{ type: 'human', id, content }] },
        streamMode: ['messages-tuple', 'values', 'updates', 'checkpoints'],
        streamSubgraphs: true,
        streamResumable: true,
        onDisconnect: 'continue',
      }))
        events.push(e);
      allEvents.push(...events);
      const saved = await f.client.threads.getState(f.thread);
      assert.deepEqual(saved.values.messages.slice(0, prior.length), prior);
      assert.equal(saved.values.messages.length, prior.length + 2);
      assert.equal(saved.values.messages.at(-2).id, id);
      assert.equal(saved.values.messages.at(-2).content, content);
      assert.equal(saved.values.messages.at(-1).type, 'ai');
      assert.equal(saved.checkpoint.thread_id, f.thread);
      assert.equal(saved.checkpoint.checkpoint_ns, '');
      assert.ok(saved.checkpoint.checkpoint_id);
      assert.deepEqual(saved.tasks, []);
      assert.deepEqual(saved.next, []);
      assert.deepEqual(
        await f.client.threads.getState(f.thread, saved.checkpoint),
        saved
      );
      assert.deepEqual(
        (await f.client.threads.getHistory(f.thread, { limit: 100 }))[0],
        saved
      );
      assert.deepEqual(Object.keys(saved.values), ['messages']);
      const data = envelopes(saved).find((e) => e.updateDataModel)
        ?.updateDataModel.value;
      if (index === 0)
        assert.deepEqual(data, {
          origin: ['LAX'],
          dest: ['JFK'],
          date: '',
          passengers: 1,
          fare_class: ['Economy'],
        });
      if (index === 3)
        assert.deepEqual(data, {
          origin: ['LAX'],
          dest: ['JFK'],
          date: '2026-11-03',
          passengers: 2,
          fare_class: ['Business'],
        });
      if (index === 1)
        assert.match(saved.values.messages.at(-1).content, /UA123/);
      if (index === 2)
        assert.match(
          saved.values.messages.at(-1).content,
          /2 passengers.*Business/
        );
      const run = events.find((e) => e.event === 'metadata').data.run_id;
      assert.equal((await f.client.runs.get(f.thread, run)).status, 'success');
      prior = saved.values.messages;
    }
    assert.ok(
      allEvents.some(
        (e) =>
          e.event === 'messages' &&
          e.data[1].langgraph_node === 'generate_title'
      )
    );
    assert.ok(
      allEvents.some(
        (e) => e.event === 'messages' && e.data[0].tool_call_chunks?.length
      )
    );
    const receipt = f.handle.receipt();
    assert.deepEqual(
      receipt.runReads.map((row) => row.run.status),
      ['success', 'success', 'success', 'success']
    );
    assert.ok(
      receipt.proofs.every(
        (p) => p.actualCompiledGraph && p.networkConnectAttempts === 0
      )
    );
    assert.ok(
      receipt.proofs.every(
        (p) =>
          p.pythonPid > 0 &&
          /^3\.12\./.test(p.pythonVersion) &&
          p.pythonExecutable.startsWith('/')
      )
    );
    assert.deepEqual(
      receipt.proofs.find((p) => p.tools?.length)?.tools[0].output[0]
        .flight_number,
      'UA123'
    );
    assert.ok(
      receipt.proofs.some((p) =>
        p.tools?.some(
          (tool) =>
            tool.name === '_lookup_flight_impl' &&
            tool.output.flight_number === 'UA123'
        )
      )
    );
  }
);

for (const [name, options, attempts] of [
  ['swallowed title failure', { failTitle: true, invalidAttempts: 0 }, 1],
  [
    'one structured validation retry',
    { failTitle: false, invalidAttempts: 1 },
    2,
  ],
  [
    'actual sentinel after three invalid attempts',
    { failTitle: false, invalidAttempts: 3 },
    3,
  ],
])
  test(
    `real compiled c-a2ui preserves ${name}`,
    { timeout: 120000 },
    async (t) => {
      const f = await openFixture(t);
      await f.handle.configure(options);
      const content = inputs[0],
        id = randomUUID(),
        events = [];
      for await (const event of f.client.runs.stream(f.thread, 'c-a2ui', {
        input: { messages: [{ type: 'human', id, content }] },
        streamMode: ['messages-tuple', 'values', 'updates', 'checkpoints'],
        streamSubgraphs: true,
        streamResumable: true,
        onDisconnect: 'continue',
      }))
        events.push(event);
      const run = await f.client.runs.get(
        f.thread,
        events.find((e) => e.event === 'metadata').data.run_id
      );
      assert.equal(run.status, 'success');
      const state = await f.client.threads.getState(f.thread);
      assert.deepEqual(
        await f.client.threads.getState(f.thread, state.checkpoint),
        state
      );
      assert.deepEqual(state.tasks, []);
      assert.deepEqual(state.next, []);
      assert.equal(state.values.messages.length, 2);
      assert.equal(state.values.messages[0].id, id);
      assert.equal(state.values.messages[0].content, content);
      assert.match(state.values.messages[1].content, /^---a2ui_JSON---\n/);
      const proof = f.handle.receipt().proofs.find((p) => p.op === 'submit');
      assert.equal(proof.models.filter((m) => !m.title).length, attempts);
      assert.ok(proof.models.some((m) => m.title));
      assert.ok(proof.actualCompiledGraph);
      assert.equal(proof.networkConnectAttempts, 0);
      if (attempts > 1)
        assert.ok(
          proof.models
            .filter((m) => !m.title)
            .slice(1)
            .every((m) => m.retry)
        );
      if (attempts === 3)
        assert.match(
          state.values.messages[1].content,
          /Book a flight \(fallback\)/
        );
      else
        assert.doesNotMatch(
          state.values.messages[1].content,
          /Book a flight \(fallback\)/
        );
      if (!options.failTitle)
        assert.ok(
          events.some(
            (e) =>
              e.event === 'messages' &&
              e.data[1].langgraph_node === 'generate_title'
          )
        );
    }
  );

test(
  'installed native createSession settles actual unsuppressed c-a2ui callbacks before exact canonical load',
  { timeout: 180000 },
  async () => {
    const env = process.env,
      before = { ...process.env };
    const { runNativeProbe } = await import('./chat-a2ui-native-probe.mjs');
    const report = await runNativeProbe();
    assert.equal(process.env, env);
    assert.deepEqual({ ...process.env }, before);
    assert.equal(report.receipt.turns.length, 4);
    assert.ok(report.receipt.turns.every((turn) => turn.outcome === 'success'));
    assert.equal(report.compiler.exit, 0);
    assert.equal(report.compiler.claim, 'small public API scaffold only');
    assert.deepEqual(report.compiler.files, ['contract.ts']);
    assert.equal(report.application, undefined);
    assert.equal(report.consumerChild.reaped, true);
    assert.equal(report.receipt.fixture.worker.reaped, true);
    assert.equal(report.receipt.fixture.worker.pythonAbsent, true);
    assert.ok(report.receipt.cleanup.every((row) => row.closed));
    assert.equal(report.closure.processAbsent, true);
    assert.equal(report.closure.groupAbsent, true);
  }
);

test('native probe rejects unknown admission modes and mixed controls before setup', async () => {
  for (const mode of ['unknown', '', true, {}, ['application-admission']])
    await assert.rejects(
      probe.runNativeProbe({ mode, workerScenario: 'fail-setup' }),
      /Unknown native probe mode/
    );
  await assert.rejects(
    probe.runNativeProbe({
      mode: 'application-admission',
      workerScenario: 'fail-setup',
    }),
    /Cannot combine admission mode/
  );
});

test('native probe rejects malformed option records and worker CLI combinations', async () => {
  const { spawnSync } = await import('node:child_process');
  for (const options of [
    null,
    [],
    Object.assign(Object.create({ mode: 'application-admission' }), {
      workerScenario: 'fail-setup',
    }),
    { source: '/tmp/foreign.ts' },
  ])
    await assert.rejects(
      probe.runNativeProbe(options),
      /Unknown native probe options/
    );
  let reads = 0;
  await assert.rejects(
    probe.runNativeProbe(
      Object.defineProperty({}, 'mode', {
        get() {
          reads++;
          return 'application-admission';
        },
      })
    ),
    /Unknown native probe options/
  );
  assert.equal(reads, 0);
  for (const args of [
    ['--worker', '/tmp', '--mode', 'unknown'],
    [
      '--worker',
      '/tmp',
      '--mode',
      'application-admission',
      '--scenario',
      'fail-setup',
    ],
    ['--worker', '/tmp', '--mode', 'settlement', '--scenario', 'unknown'],
    ['--worker', '/tmp', '--mode', 'settlement', 'extra'],
  ]) {
    const result = spawnSync(
      process.execPath,
      ['scripts/react-cockpit/chat-a2ui-native-probe.mjs', ...args],
      { encoding: 'utf8' }
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown native probe options/);
  }
});
