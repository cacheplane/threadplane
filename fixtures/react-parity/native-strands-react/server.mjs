/** Owns one isolated installed generated-service process and its loopback model. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { environment, fixtureEnvironment, root } from './configuration.mjs';
export const token = 'local-fictional-meeting-fixture';
const ownershipLock = environment + '.owner';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function freePort() {
  const socket = createServer();
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', resolve);
  });
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}
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
    const port = await freePort();
    const url = `http://127.0.0.1:${port}`;
    serviceUrl = url;
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
          STRANDS_FIXTURE_PORT: String(port),
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
    });
    child.stderr.on('data', (bytes) => {
      stderr += bytes;
    });
    const observe = async (timeoutMs = 2000) => {
      const response = await fetch(url + '/fixture-stats', {
        headers: { 'x-internal-token': token },
        signal: AbortSignal.timeout(Math.max(1, timeoutMs)),
      });
      assert.equal(response.status, 200);
      observed = await response.json();
      return structuredClone(observed);
    };

    while (true) {
      if (startupError) throw startupError;
      if (childClosed || child.exitCode !== null || child.signalCode !== null)
        throw Error('Generated service exited during startup: ' + stderr);
      const remaining = deadline - performance.now();
      if (remaining <= 0)
        throw Error('Native service startup deadline exceeded');
      try {
        await observe(Math.min(2000, Math.ceil(remaining)));
        if (performance.now() > deadline)
          throw Error('Native service startup deadline exceeded');
        break;
      } catch (error) {
        if (performance.now() >= deadline)
          throw Error('Native service startup deadline exceeded', {
            cause: error,
          });
        await delay(Math.min(50, Math.max(0, deadline - performance.now())));
      }
    }
    return { url, observe, stats, close };
  } catch (error) {
    try {
      await close();
    } catch (cleanupError) {
      error.cleanupError = cleanupError;
    }
    throw error;
  }
}
