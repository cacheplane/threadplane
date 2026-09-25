import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import {
  startScriptedService,
  waitUntil,
} from '../../deployments/ag-ui-mastra/test/scripted-service.mjs';

const names = [
  'AG_UI_INTERNAL_TOKEN',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'AG_UI_MASTRA_DB_PATH',
];
const snapshot = () =>
  Object.fromEntries(names.map((key) => [key, process.env[key]]));
function assertRestored(before) {
  // Assertion failures must never print a prior credential value.
  for (const name of names)
    assert.equal(process.env[name] === before[name], true, `${name} restored`);
}

test(
  'test-only setup imports after local configuration, restores environment and closes only its owned resources',
  { timeout: 5000 },
  async () => {
    const before = snapshot();
    let configured;
    let service;
    try {
      service = await startScriptedService({
        loadService: async () => {
          configured = snapshot();
          assert.match(
            configured.OPENAI_BASE_URL,
            /^http:\/\/127\.0\.0\.1:\d+\/v1$/
          );
          assert.equal(configured.OPENAI_API_KEY, 'sk-test-not-used');
          assert.ok(existsSync(dirname(configured.AG_UI_MASTRA_DB_PATH)));
          return {
            createAgUiServer: () =>
              createServer((_request, response) => response.end('local')),
          };
        },
      });
      const response = await fetch(service.baseUrl, {
        method: 'POST',
        signal: AbortSignal.timeout(1000),
      });
      await assert.rejects(startScriptedService(), /already owned/);
      assert.equal(await response.text(), 'local');
      assert.deepEqual(service.stats(), [
        { method: 'POST', path: '/', closed: true },
      ]);
      await service.close();
      await service.close();
      assert.equal(existsSync(dirname(configured.AG_UI_MASTRA_DB_PATH)), false);
      await assert.rejects(
        fetch(service.baseUrl, { signal: AbortSignal.timeout(1000) })
      );
      await assert.rejects(
        fetch(configured.OPENAI_BASE_URL, { signal: AbortSignal.timeout(1000) })
      );
      assertRestored(before);
    } finally {
      await service?.close();
      for (const [key, value] of Object.entries(before)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }
);

test(
  'a timed out physical-close wait leaves no detached predicate polling',
  { timeout: 1000 },
  async () => {
    let calls = 0;
    await assert.rejects(
      waitUntil(
        () => {
          calls++;
          return false;
        },
        'deliberate never-closed response',
        15
      ),
      /never-closed response timed out/
    );
    const stopped = calls;
    await delay(30);
    assert.equal(calls, stopped);
  }
);

test(
  'an owned server listen failure cleans up the model and restores environment',
  { timeout: 5000 },
  async () => {
    const before = snapshot();
    let configured;
    await assert.rejects(
      startScriptedService({
        loadService: async () => {
          configured = snapshot();
          return {
            createAgUiServer: () => {
              const server = createServer();
              server.listen = () => {
                throw new Error('deliberate listen failure');
              };
              return server;
            },
          };
        },
      }),
      /deliberate listen failure/
    );
    assert.equal(existsSync(dirname(configured.AG_UI_MASTRA_DB_PATH)), false);
    await assert.rejects(
      fetch(configured.OPENAI_BASE_URL, { signal: AbortSignal.timeout(1000) })
    );
    assertRestored(before);
  }
);

test(
  'a timed out loader cannot construct a service later through the setup continuation',
  { timeout: 5000 },
  async () => {
    const before = snapshot();
    let configured, complete;
    let constructed = false;
    await assert.rejects(
      startScriptedService({
        startupTimeoutMs: 30,
        loadService: () => {
          configured = snapshot();
          return new Promise((resolve) => {
            complete = resolve;
          });
        },
      }),
      /service import timed out/
    );
    complete({
      createAgUiServer: () => {
        constructed = true;
        return createServer();
      },
    });
    await delay(20);
    assert.equal(constructed, false);
    assert.equal(existsSync(dirname(configured.AG_UI_MASTRA_DB_PATH)), false);
    await assert.rejects(
      fetch(configured.OPENAI_BASE_URL, { signal: AbortSignal.timeout(1000) })
    );
    assertRestored(before);
  }
);

test(
  'failed service setup removes its database and model server and restores selected environment',
  { timeout: 5000 },
  async () => {
    const before = snapshot();
    let configured;
    try {
      await assert.rejects(
        startScriptedService({
          loadService: async () => {
            configured = snapshot();
            throw new Error('deliberate import failure');
          },
        }),
        /deliberate import failure/
      );
      assert.equal(existsSync(dirname(configured.AG_UI_MASTRA_DB_PATH)), false);
      await assert.rejects(
        fetch(configured.OPENAI_BASE_URL, { signal: AbortSignal.timeout(1000) })
      );
      assertRestored(before);
    } finally {
      for (const [key, value] of Object.entries(before)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }
);
