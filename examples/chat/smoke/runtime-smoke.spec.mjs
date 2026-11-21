import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';

import * as runtimeSmoke from './runtime-smoke.mjs';

const { COMPATIBILITY_PACKAGES, parseRuntimeArgs } = runtimeSmoke;

test('requires a generated consumer target', () => {
  assert.throws(() => parseRuntimeArgs([]), /--target is required/);
});

test('rejects a missing runtime option value clearly', () => {
  assert.throws(
    () => parseRuntimeArgs(['--target', '--port', '4300']),
    /--target requires a value/
  );
});

test('uses production configuration when starting the generated consumer', () => {
  assert.deepEqual(runtimeSmoke.getServerArgs(4300), [
    'run',
    'start',
    '--',
    '--configuration',
    'production',
    '--host',
    '127.0.0.1',
    '--port',
    '4300',
  ]);
});

// `chat` and `render` probe those entry points of `@threadplane/angular`.
test('defines visible compatibility probes for every public package and Angular entry point', async () => {
  assert.deepEqual(COMPATIBILITY_PACKAGES, [
    'ag-ui',
    'angular',
    'chat',
    'core',
    'langgraph',
    'render',
    'telemetry',
  ]);

  const probe = await readFile(
    new URL('./template/src/compatibility-probe.ts', import.meta.url),
    'utf8'
  );

  for (const packageName of COMPATIBILITY_PACKAGES) {
    assert.match(
      probe,
      new RegExp(`data-threadplane-compatibility=["']${packageName}["']`)
    );
  }
});

test('handles allowed API routes and reports unexpected ones through the main flow', async () => {
  const controller = runtimeSmoke.createBackendRouteController();
  const fulfilled = [];
  const aborted = [];
  const route = (method, pathname) => ({
    request: () => ({
      method: () => method,
      url: () => `http://127.0.0.1:4300${pathname}`,
    }),
    fulfill: async (response) => fulfilled.push(response),
    abort: async (reason) => aborted.push(reason),
  });

  await controller.handle(route('POST', '/api/threads/search'));
  await controller.handle(route('POST', '/api/store/items/search'));
  await controller.handle(route('POST', '/api/ingest'));
  await controller.handle(route('GET', '/api/ingest'));

  assert.deepEqual(fulfilled, [
    { status: 200, contentType: 'application/json', body: '[]' },
    { status: 200, contentType: 'application/json', body: '{"items":[]}' },
    { status: 204, body: '' },
  ]);
  assert.deepEqual(aborted, ['failed']);
  await assert.rejects(
    controller.waitForFailure(),
    /Unexpected backend request during compatibility smoke: GET \/api\/ingest/
  );
});

test('contains allowed-route fulfillment failures in the awaited route signal', async () => {
  const controller = runtimeSmoke.createBackendRouteController();
  let aborted = false;
  const route = {
    request: () => ({
      method: () => 'POST',
      url: () => 'http://127.0.0.1:4300/api/threads/search',
    }),
    fulfill: async () => {
      throw new Error('fulfillment failed');
    },
    abort: async () => {
      aborted = true;
      throw new Error('fallback abort failed');
    },
  };

  await assert.doesNotReject(controller.handle(route));
  await assert.rejects(
    controller.waitForFailure(),
    /Failed handling backend route POST \/api\/threads\/search: fulfillment failed.*fallback abort failed/s
  );
  assert.equal(aborted, true);
});

test('preserves a smoke failure when diagnostic capture and cleanup fail', async () => {
  const calls = [];

  const error = await runtimeSmoke
    .finalizeRuntimeSmoke({
      primaryError: new Error('page assertion failed'),
      serverOutput: 'consumer output',
      captureScreenshot: async () => {
        calls.push('screenshot');
        throw new Error('screenshot failed');
      },
      stopTracing: async () => {
        calls.push('trace');
        throw new Error('trace failed');
      },
      closeBrowser: async () => {
        calls.push('browser');
        throw new Error('browser close failed');
      },
      terminateServer: () => calls.push('terminate'),
    })
    .then(
      () => assert.fail('Expected runtime smoke finalization to reject'),
      (failure) => failure
    );

  assert.match(error.message, /page assertion failed/);
  assert.match(error.message, /consumer output/);
  assert.match(error.message, /screenshot failed/);
  assert.match(error.message, /trace failed/);
  assert.match(error.message, /browser close failed/);
  assert.deepEqual(calls, ['screenshot', 'trace', 'browser', 'terminate']);
});

test('terminates the server after successful-smoke cleanup failures', async () => {
  const calls = [];

  await assert.rejects(
    async () =>
      runtimeSmoke.finalizeRuntimeSmoke({
        stopTracing: async () => {
          calls.push('trace');
          throw new Error('trace failed');
        },
        closeBrowser: async () => {
          calls.push('browser');
          throw new Error('browser close failed');
        },
        terminateServer: () => calls.push('terminate'),
      }),
    AggregateError
  );

  assert.deepEqual(calls, ['trace', 'browser', 'terminate']);
});

test('escalates POSIX server process-group termination after its grace period', async () => {
  const child = new EventEmitter();
  child.pid = 2468;
  child.exitCode = null;
  child.signalCode = null;
  let groupAlive = true;
  const signals = [];

  await runtimeSmoke.terminateServer(child, {
    platform: 'linux',
    graceMs: 0,
    processRef: {
      kill(pid, signal) {
        signals.push([pid, signal]);
        if (signal === 0) {
          if (!groupAlive) {
            const error = new Error('group is gone');
            error.code = 'ESRCH';
            throw error;
          }
          return;
        }
        if (signal === 'SIGKILL') {
          groupAlive = false;
          child.exitCode = 137;
          queueMicrotask(() => child.emit('close', 137, 'SIGKILL'));
        }
      },
    },
    setTimeoutFn(callback) {
      queueMicrotask(callback);
      return 1;
    },
    clearTimeoutFn() {
      return undefined;
    },
  });

  assert.deepEqual(
    signals.filter(([, signal]) => signal !== 0),
    [
      [-2468, 'SIGTERM'],
      [-2468, 'SIGKILL'],
    ]
  );
});

test('kills a live POSIX process group even after the npm parent has closed', async () => {
  const child = new EventEmitter();
  child.pid = 2468;
  child.exitCode = 0;
  child.signalCode = null;
  let groupAlive = true;
  const calls = [];

  await runtimeSmoke.terminateServer(child, {
    platform: 'linux',
    graceMs: 0,
    processRef: {
      kill(pid, signal) {
        calls.push([pid, signal]);
        if (signal === 0) {
          if (!groupAlive) {
            const error = new Error('group is gone');
            error.code = 'ESRCH';
            throw error;
          }
          return;
        }
        if (signal === 'SIGKILL') groupAlive = false;
      },
    },
    setTimeoutFn(callback) {
      queueMicrotask(callback);
      return 1;
    },
    clearTimeoutFn() {
      return undefined;
    },
  });

  assert.deepEqual(
    calls.filter(([, signal]) => signal !== 0),
    [
      [-2468, 'SIGTERM'],
      [-2468, 'SIGKILL'],
    ]
  );
  assert.ok(calls.filter(([, signal]) => signal === 0).length >= 3);
});

test('uses taskkill and waits for a Windows server process tree to close', async () => {
  const child = new EventEmitter();
  child.pid = 1357;
  child.exitCode = null;
  child.signalCode = null;
  const spawned = [];

  await runtimeSmoke.terminateServer(child, {
    platform: 'win32',
    graceMs: 0,
    spawnFn(command, args, options) {
      spawned.push([command, args, options]);
      const taskkill = new EventEmitter();
      queueMicrotask(() => taskkill.emit('close', 0));
      queueMicrotask(() => {
        child.exitCode = 0;
        child.emit('close', 0, null);
      });
      return taskkill;
    },
    setTimeoutFn() {
      throw new Error('child should already be closed after taskkill');
    },
    clearTimeoutFn() {
      return undefined;
    },
  });

  assert.deepEqual(spawned, [
    ['taskkill', ['/PID', '1357', '/T', '/F'], { stdio: 'ignore' }],
  ]);
});

test('bounds a hung readiness fetch with an abort signal', async () => {
  let aborted = false;

  await assert.rejects(
    runtimeSmoke.waitForServer(
      'http://127.0.0.1:4300/embed',
      { getError: () => undefined },
      {
        timeoutMs: 5,
        requestTimeoutMs: 1,
        fetchImpl: (_url, { signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              aborted = true;
              reject(signal.reason);
            });
          }),
        async sleep() {
          return undefined;
        },
      }
    ),
    /Timed out waiting 0.005s/
  );

  assert.equal(aborted, true);
});

test('rejects a port already occupied before starting the consumer server', async () => {
  const listener = createServer();
  await new Promise((resolveListen) =>
    listener.listen(0, '127.0.0.1', resolveListen)
  );
  const { port } = listener.address();

  try {
    await assert.rejects(
      runtimeSmoke.assertPortAvailable(port),
      new RegExp(
        `Port ${port} is already in use; free port ${port} before retrying`
      )
    );
  } finally {
    await new Promise((resolveClose, rejectClose) =>
      listener.close((error) => (error ? rejectClose(error) : resolveClose()))
    );
  }
});

test('reports an early server exit before attempting readiness fetches', async () => {
  let fetched = false;

  await assert.rejects(
    runtimeSmoke.waitForServer(
      'http://127.0.0.1:4300/embed',
      { getError: () => new Error('Consumer server exited early') },
      {
        fetchImpl: async () => {
          fetched = true;
          throw new Error('fetch should not run');
        },
      }
    ),
    /Consumer server exited early/
  );

  assert.equal(fetched, false);
});

test('does not accept readiness when the child exits during the fetch', async () => {
  let checks = 0;

  await assert.rejects(
    runtimeSmoke.waitForServer(
      'http://127.0.0.1:4300/embed',
      {
        getError: () => {
          checks += 1;
          return checks === 1
            ? undefined
            : new Error('Consumer server exited during readiness');
        },
      },
      { fetchImpl: async () => ({ ok: true }) }
    ),
    /Consumer server exited during readiness/
  );
});

test('fails the smoke when the server exits after browser assertions', () => {
  assert.throws(
    () =>
      runtimeSmoke.throwIfServerExited({
        getError: () => new Error('Consumer server exited after assertions'),
      }),
    /Consumer server exited after assertions/
  );
});

test('requires every visible compatibility marker to report exact readiness', async () => {
  const markerText = new Map(
    COMPATIBILITY_PACKAGES.map((packageName) => [
      packageName,
      packageName === 'ag-ui' ? 'AG-UI ready' : `${packageName} ready`,
    ])
  );
  markerText.set('telemetry', 'telemetry unavailable');
  const waits = [];
  const page = {
    locator(selector) {
      const packageName = selector.match(/="([^"]+)"/)?.[1];
      return {
        waitFor: async () => waits.push(packageName),
        innerText: async () => markerText.get(packageName),
      };
    },
  };

  await assert.rejects(
    runtimeSmoke.assertCompatibilityMarkers(page),
    /telemetry compatibility probe reported "telemetry unavailable"/
  );
  assert.deepEqual(waits, COMPATIBILITY_PACKAGES);
});
