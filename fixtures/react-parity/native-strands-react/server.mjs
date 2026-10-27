/** Owns one isolated installed generated-service process and its loopback model. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { environment, fixtureEnvironment, root } from './configuration.mjs';
export const token = 'local-fictional-meeting-fixture';
const ownershipLock = environment + '.owner';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const readinessPrefix = 'STRANDS_FIXTURE_READY ';
export async function createNativeStrandsServer({
  mode = 'approval',
  python = resolve(environment, 'bin/python'),
  spawnProcess = spawn,
  startupMs = 20000,
} = {}) {
  assert.ok(['approval', 'batch', 'cancel'].includes(mode));
  assert.ok(Number.isFinite(startupMs) && startupMs > 0);
  const deadline = performance.now() + startupMs;
  let child,
    exiting,
    childClosed = false,
    closing,
    ownsLock = false,
    observed,
    stdout = '',
    pendingStdout = '',
    stderr = '',
    final,
    startupError,
    serviceUrl;
  const closure = { process: false, model: false, held: false, lock: false };
  const stats = () =>
    structuredClone({ serviceUrl, observed, closure, final, stderr });
  // Defined before any resource acquisition; repeated and failed-start closes share one settlement.
  const close = () =>
    (closing ??= (async () => {
      try {
        if (child) {
          child.kill('SIGTERM');
          let timer;
          try {
            await Promise.race([
              exiting,
              new Promise((_, reject) => {
                timer = setTimeout(
                  () => reject(Error('Service shutdown exceeded bound')),
                  8000
                );
              }),
            ]);
          } catch (error) {
            child.kill('SIGKILL');
            let killTimer;
            try {
              await Promise.race([
                exiting,
                new Promise((_, reject) => {
                  killTimer = setTimeout(
                    () => reject(Error('Service kill exceeded bound')),
                    3000
                  );
                }),
              ]);
            } finally {
              clearTimeout(killTimer);
            }
            throw error;
          } finally {
            clearTimeout(timer);
            closure.process =
              child.exitCode !== null || child.signalCode !== null;
          }
          for (const line of stdout.trim().split('\n')) {
            try {
              const value = JSON.parse(line);
              if (value.fixtureClosed) final = value;
            } catch {}
          }
          closure.model = Boolean(
            final?.modelThreadClosed &&
              final.model.active === 0 &&
              final.model.connections === 0
          );
          closure.held = final?.model.heldActive === 0;
        }
      } finally {
        // Never hand ownership to a replacement until actual child stdio close.
        if (ownsLock && (!child || childClosed)) {
          rmSync(ownershipLock, { recursive: true });
          ownsLock = false;
          closure.lock = true;
        }
      }
    })());
  try {
    mkdirSync(ownershipLock);
    ownsLock = true;
    child = spawnProcess(
      python,
      [resolve(root, 'fixtures/react-parity/native-strands-react/service.py')],
      {
        cwd: root,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...fixtureEnvironment(),
          PYTHONDONTWRITEBYTECODE: '1',
          STRANDS_FIXTURE_ROOT: root,
          STRANDS_FIXTURE_MODE: mode,
          AG_UI_INTERNAL_TOKEN: token,
          OPENAI_API_KEY: 'fictional-local-only',
          OPENAI_CHAT_MODEL: 'fixture-loopback',
          NO_PROXY: '127.0.0.1,localhost',
        },
      }
    );
    exiting = new Promise((resolve) => {
      // 'exit' can precede the last stdout bytes. Seal receipts only after
      // all child stdio is closed, including failed-spawn error settlement.
      child.once('close', (...args) => {
        childClosed = true;
        resolve(...args);
      });
      child.once('error', (error) => {
        startupError = error;
      });
    });
    // Keep startup failure observed even if the readiness request has not completed.
    void exiting.catch(() => undefined);
    child.stdout.on('data', (bytes) => {
      stdout += bytes;
      pendingStdout += bytes;
      let newline;
      while ((newline = pendingStdout.indexOf('\n')) !== -1) {
        const line = pendingStdout.slice(0, newline);
        pendingStdout = pendingStdout.slice(newline + 1);
        if (!line.startsWith(readinessPrefix)) continue;
        try {
          assert.equal(serviceUrl, undefined, 'Duplicate readiness record');
          const ready = JSON.parse(line.slice(readinessPrefix.length));
          assert.deepEqual(Object.keys(ready).sort(), ['host', 'pid', 'port']);
          assert.equal(ready.host, '127.0.0.1');
          assert.ok(
            Number.isSafeInteger(ready.port) &&
              ready.port > 0 &&
              ready.port <= 65535
          );
          assert.ok(Number.isSafeInteger(ready.pid) && ready.pid > 0);
          // Test proxies may defer spawn; require the actual child PID at receipt.
          assert.equal(ready.pid, child.pid);
          serviceUrl = `http://127.0.0.1:${ready.port}`;
        } catch (cause) {
          startupError ??= Error('Invalid native service readiness record', {
            cause,
          });
        }
      }
    });
    child.stderr.on('data', (bytes) => {
      stderr += bytes;
    });
    const observe = async (timeoutMs = 2000) => {
      const response = await fetch(serviceUrl + '/fixture-stats', {
        headers: { 'x-internal-token': token },
        signal: AbortSignal.timeout(Math.max(1, timeoutMs)),
      });
      assert.equal(response.status, 200);
      observed = await response.json();
      if (observed.pid !== child.pid) {
        startupError ??= Error('Native service stats PID mismatch');
        throw startupError;
      }
      return structuredClone(observed);
    };

    while (true) {
      if (startupError) throw startupError;
      if (childClosed || child.exitCode !== null || child.signalCode !== null)
        throw Error('Generated service exited during startup: ' + stderr);
      const remaining = deadline - performance.now();
      if (remaining <= 0)
        throw Error('Native service startup deadline exceeded');
      if (!serviceUrl) {
        await delay(Math.min(50, Math.ceil(remaining)));
        continue;
      }
      try {
        await observe(Math.min(2000, Math.ceil(remaining)));
        if (startupError) throw startupError;
        if (performance.now() > deadline)
          throw Error('Native service startup deadline exceeded');
        break;
      } catch (error) {
        if (startupError) throw startupError;
        if (performance.now() >= deadline)
          throw Error('Native service startup deadline exceeded', {
            cause: error,
          });
        await delay(Math.min(50, Math.max(0, deadline - performance.now())));
      }
    }
    return { url: serviceUrl, observe, stats, close };
  } catch (error) {
    try {
      await close();
    } catch (cleanupError) {
      error.cleanupError = cleanupError;
    }
    throw error;
  }
}
