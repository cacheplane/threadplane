import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { preparationLock, root } from './configuration.mjs';
const load = async () => {
  const module = await import('./server.mjs').catch(() => null);
  assert.ok(module, 'Native Strands owner must exist');
  return module;
};
test(
  'failed lock acquisition preserves existing owner; failed spawn releases only its own lock',
  { timeout: 30000 },
  async (t) => {
    const { createNativeStrandsServer } = await load();
    await assert.rejects(
      createNativeStrandsServer({
        spawnProcess: () => {
          throw Error('synchronous spawn failure');
        },
      }),
      /synchronous spawn failure/
    );
    assert.equal(existsSync(preparationLock), false);
    await assert.rejects(
      createNativeStrandsServer({ python: '/does-not-exist-native-strands' }),
      /ENOENT/
    );
    assert.equal(existsSync(preparationLock), false);
    const owner = await createNativeStrandsServer();
    t.after(() => owner.close());
    await assert.rejects(createNativeStrandsServer(), /EEXIST/);
    assert.ok(existsSync(preparationLock));
    const observed = await owner.observe();
    assert.equal(observed.model.httpSeen, 0);
    assert.equal(observed.versions['ag-ui-strands'], '0.4.1');
    for (const name of ['agent', 'server', 'subagent_emitter']) {
      const actual = observed.modules[name];
      assert.match(
        actual.path,
        /deployments\/ag-ui-dev\/deps\/aws_strands\/src\//
      );
      assert.deepEqual(
        readFileSync(actual.path),
        readFileSync(
          root + '/cockpit/runtimes/aws-strands/python/src/' + name + '.py'
        )
      );
    }
    assert.deepEqual(observed.blocked, []);
    assert.equal(observed.entries, 0);
    await Promise.all([owner.close(), owner.close()]);
    assert.ok(Object.values(owner.stats().closure).every(Boolean));
    await assert.rejects(
      fetch(owner.url + '/ok', { signal: AbortSignal.timeout(500) })
    );
    await assert.rejects(
      fetch(`http://127.0.0.1:${observed.modelPort}/`, {
        signal: AbortSignal.timeout(500),
      })
    );
  }
);
test(
  'absolute startup deadline reaps a hanging startup and releases ownership',
  { timeout: 10000 },
  async () => {
    const { createNativeStrandsServer } = await load();
    let actual;
    const started = Date.now();
    await assert.rejects(
      createNativeStrandsServer({
        startupMs: 150,
        spawnProcess: (python, _args, options) => {
          actual = spawn(
            python,
            ['-c', 'import time; time.sleep(20)'],
            options
          );
          return actual;
        },
      }),
      /startup deadline/
    );
    assert.ok(Date.now() - started < 3000);
    assert.ok(actual.exitCode !== null || actual.signalCode !== null);
    assert.equal(existsSync(preparationLock), false);
  }
);
test(
  'closure waits for stdout after process exit before sealing final receipts',
  { timeout: 30000 },
  async (t) => {
    const { createNativeStrandsServer } = await load();
    const owner = await createNativeStrandsServer({
      spawnProcess: (...args) => {
        const actual = spawn(...args),
          proxy = new EventEmitter();
        proxy.stdout = new PassThrough();
        proxy.stderr = actual.stderr;
        Object.defineProperties(proxy, {
          exitCode: { get: () => actual.exitCode },
          signalCode: { get: () => actual.signalCode },
        });
        proxy.kill = (signal) => actual.kill(signal);
        const buffers = [];
        actual.stdout.on('data', (bytes) => buffers.push(bytes));
        actual.once('error', (error) => proxy.emit('error', error));
        actual.once('close', (...args) =>
          setTimeout(() => {
            for (const bytes of buffers) proxy.stdout.write(bytes);
            proxy.stdout.end();
            proxy.emit('close', ...args);
          }, 100)
        );
        return proxy;
      },
    });
    t.after(() => owner.close());
    await owner.close();
    assert.equal(owner.stats().final.fixtureClosed, true);
    assert.ok(Object.values(owner.stats().closure).every(Boolean));
  }
);
