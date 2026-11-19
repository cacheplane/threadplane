import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as probe from './chat-a2ui-native-probe.mjs';

// The installed-package probe's own harness: option checks, owned cleanup,
// deadlines, and a settlement run against the real backend (aimock +
// `langgraph dev`, behind the recording proxy).
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
    assert.equal(report.receipt.backend.kind, 'aimock-langgraph');
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
