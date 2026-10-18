import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createServer, connect } from 'node:net';
import { preparationLock, root } from './configuration.mjs';
const load = async () => {
  const module = await import('./server.mjs').catch(() => null);
  assert.ok(module, 'Native Strands owner must exist');
  return module;
};
test(
  'retains atomic listener ownership while a foreign listener occupies a released candidate',
  { timeout: 30000 },
  async (t) => {
    const { createNativeStrandsServer } = await load();
    const foreign = createServer((socket) => socket.end('foreign-listener\n'));
    t.after(async () => {
      if (foreign.listening)
        await new Promise((resolve, reject) =>
          foreign.close((error) => (error ? reject(error) : resolve()))
        );
    });
    let actual;
    const owner = await createNativeStrandsServer({
      spawnProcess: (...args) => {
        const proxy = new EventEmitter();
        proxy.stdout = new PassThrough();
        proxy.stderr = new PassThrough();
        Object.defineProperties(proxy, {
          pid: { get: () => actual?.pid },
          exitCode: { get: () => actual?.exitCode ?? null },
          signalCode: { get: () => actual?.signalCode ?? null },
        });
        let pendingSignal;
        proxy.kill = (signal) => {
          if (actual) return actual.kill(signal);
          pendingSignal = signal;
          return true;
        };
        foreign.once('error', (error) => {
          proxy.emit('error', error);
          proxy.stdout.end();
          proxy.stderr.end();
          proxy.emit('close', 1, null);
        });
        // Before the fix this is the exact port Node released for Python.
        // Bind it before spawning the real service, making the race deterministic.
        // After the fix Python selects its own retained socket, independently.
        const candidate = args[2].env.STRANDS_FIXTURE_PORT;
        foreign.listen(
          candidate === undefined ? 0 : Number(candidate),
          '127.0.0.1',
          () => {
            actual = spawn(...args);
            actual.stdout.pipe(proxy.stdout);
            actual.stderr.pipe(proxy.stderr);
            actual.once('error', (error) => proxy.emit('error', error));
            actual.once('close', (...closed) => proxy.emit('close', ...closed));
            if (pendingSignal) actual.kill(pendingSignal);
          }
        );
        return proxy;
      },
    });
    t.after(() => owner.close());
    const observed = await owner.observe();
    assert.equal(observed.pid, actual.pid);
    assert.notEqual(Number(new URL(owner.url).port), foreign.address().port);
    assert.notEqual(observed.modelPort, foreign.address().port);
    assert.equal(observed.model.httpSeen, 0);
    assert.deepEqual(observed.blocked, []);
    await owner.close();
    assert.ok(Object.values(owner.stats().closure).every(Boolean));
    assert.ok(foreign.listening, 'closing the fixture preserves the foreign owner');
    const greeting = await new Promise((resolve, reject) => {
      const socket = connect(foreign.address().port, '127.0.0.1');
      const chunks = [];
      socket.setTimeout(1000, () => socket.destroy(Error('Foreign listener deadline')));
      socket.on('data', (bytes) => chunks.push(bytes));
      socket.once('error', reject);
      socket.once('end', () => resolve(Buffer.concat(chunks).toString()));
    });
    assert.equal(greeting, 'foreign-listener\n');
  }
);
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
          pid: { get: () => actual.pid },
          exitCode: { get: () => actual.exitCode },
          signalCode: { get: () => actual.signalCode },
        });
        proxy.kill = (signal) => actual.kill(signal);
        const buffers = [];
        let pending = '';
        actual.stdout.on('data', (bytes) => {
          pending += bytes;
          let newline;
          while ((newline = pending.indexOf('\n')) !== -1) {
            const line = pending.slice(0, newline + 1);
            pending = pending.slice(newline + 1);
            if (line.startsWith('STRANDS_FIXTURE_READY '))
              proxy.stdout.write(line);
            else buffers.push(line);
          }
        });
        actual.once('error', (error) => proxy.emit('error', error));
        actual.once('close', (...args) =>
          setTimeout(() => {
            for (const bytes of buffers) proxy.stdout.write(bytes);
            proxy.stdout.write(pending);
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
test(
  'invalid or conflicting readiness records reap the actual child and release ownership',
  { timeout: 15000 },
  async () => {
    const { createNativeStrandsServer } = await load();
    const records = [
      "'{'",
      "json.dumps({'host': 'localhost', 'port': 1234, 'pid': os.getpid()})",
      "json.dumps({'host': '127.0.0.1', 'port': 0, 'pid': os.getpid()})",
      "json.dumps({'host': '127.0.0.1', 'port': 65536, 'pid': os.getpid()})",
      "json.dumps({'host': '127.0.0.1', 'port': '1234', 'pid': os.getpid()})",
      "json.dumps({'host': '127.0.0.1', 'port': 1234, 'pid': os.getpid() + 1})",
      "json.dumps({'host': '127.0.0.1', 'port': 1234, 'pid': os.getpid(), 'extra': True})",
      "json.dumps({'host': '127.0.0.1', 'port': 1, 'pid': os.getpid()}) + '\\nSTRANDS_FIXTURE_READY ' + json.dumps({'host': '127.0.0.1', 'port': 2, 'pid': os.getpid()})",
    ];
    for (const record of records) {
      let actual;
      await assert.rejects(
        createNativeStrandsServer({
          startupMs: 1000,
          spawnProcess: (python, _args, options) => {
            actual = spawn(
              python,
              [
                '-c',
                `import json,os,time; print('STRANDS_FIXTURE_READY ' + ${record}, flush=True); time.sleep(20)`,
              ],
              options
            );
            return actual;
          },
        }),
        /Invalid native service readiness record/
      );
      assert.ok(actual.exitCode !== null || actual.signalCode !== null);
      assert.equal(existsSync(preparationLock), false);
    }
  }
);
