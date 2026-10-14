import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createNativeMafServer } from './server.mjs';
test(
  'shutdown waits for delayed stdout pipe closure after actual process exit',
  { timeout: 30000 },
  async (t) => {
    let owner;
    t.after(async () => owner?.close());
    owner = await createNativeMafServer({
      spawnProcess: (...args) => {
        const actual = spawn(...args),
          observed = new EventEmitter();
        observed.stdout = new PassThrough();
        observed.stderr = actual.stderr;
        Object.defineProperties(observed, {
          exitCode: { get: () => actual.exitCode },
          signalCode: { get: () => actual.signalCode },
        });
        observed.kill = (signal) => actual.kill(signal);
        actual.once('error', (error) => observed.emit('error', error));
        const buffered = [];
        actual.once('exit', (...args) => {
          observed.emit('exit', ...args);
          setTimeout(() => {
            for (const bytes of buffered) observed.stdout.write(bytes);
          }, 100);
        });
        actual.stdout.on('data', (bytes) => buffered.push(bytes));
        actual.once('close', (...args) =>
          setTimeout(() => {
            observed.stdout.end();
            observed.emit('close', ...args);
          }, 200)
        );
        return observed;
      },
    });
    await owner.close();
    assert.equal(owner.stats().final?.fixtureClosed, true);
    assert.ok(Object.values(owner.stats().closure).every(Boolean));
  }
);
test(
  'failed process startup releases ownership for the next real acquisition',
  { timeout: 30000 },
  async (t) => {
    await assert.rejects(
      createNativeMafServer({ python: '/does-not-exist-native-maf-fixture' }),
      /ENOENT/
    );
    let owner;
    t.after(async () => owner?.close());
    owner = await createNativeMafServer();
    await owner.close();
    assert.ok(Object.values(owner.stats().closure).every(Boolean));
  }
);
test(
  'installed generated service is directly mounted, pinned, isolated and exactly closed',
  { timeout: 30000 },
  async (t) => {
    let owner;
    t.after(async () => {
      await owner?.close();
    });
    owner = await createNativeMafServer();
    const stats = await owner.observe();
    assert.equal(stats.entries, 0);
    assert.equal(stats.model.httpSeen, 0);
    assert.equal(stats.versions['agent-framework-ag-ui'], '1.2.1');
    assert.equal(stats.versions['agent-framework-core'], '1.16.0');
    assert.equal(stats.versions['agent-framework-openai'], '1.14.1');
    assert.equal(stats.versions.openai, '2.54.0');
    assert.match(
      stats.modules.generated_server.path,
      /deployments\/ag-ui-maf\/server.py$/
    );
    await assert.rejects(createNativeMafServer(), /EEXIST/);
    await Promise.all([owner.close(), owner.close()]);
    assert.ok(Object.values(owner.stats().closure).every(Boolean));
  }
);
