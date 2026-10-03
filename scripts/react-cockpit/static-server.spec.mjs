import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

test('the local rendering server has no runtime or fixture execution endpoints', async (t) => {
  const child = spawn(
    process.execPath,
    ['scripts/react-cockpit/serve.mjs', 'render-spec-rendering', '--no-parent'],
    {
      stdio: ['ignore', 'ignore', 'pipe'],
    }
  );
  let diagnostic = '';
  child.stderr.on('data', (bytes) => {
    diagnostic += bytes.toString();
  });
  t.after(async () => {
    child.kill();
    if (child.exitCode === null)
      await new Promise((resolve) => child.once('exit', resolve));
  });
  const origin = 'http://127.0.0.1:4614';
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(origin, {
        redirect: 'manual',
        signal: AbortSignal.timeout(1000),
      });
      if (response.status === 302) {
        ready = true;
        break;
      }
    } catch {
      /* Wait only for this owned server's listener. */
    }
    if (child.exitCode !== null) throw Error(diagnostic);
    await delay(20);
  }
  assert.ok(ready, diagnostic || 'Owned static listener did not start');
  for (const path of [
    '/api/native/threads',
    '/developer-api/native/threads',
    '/__reset',
    '/__release',
    '/__requests',
    '/__lifetime',
    '/__fail-create',
  ]) {
    const response = await fetch(origin + path, {
      signal: AbortSignal.timeout(1000),
    });
    assert.equal(response.status, 404, 'No static runtime endpoint: ' + path);
  }
  for (const path of [
    '/api/native/threads',
    '/developer-api/native/threads',
    '/render/spec-rendering/react/',
  ]) {
    const response = await fetch(origin + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ thread_id: 'must-not-create' }),
      signal: AbortSignal.timeout(1000),
    });
    assert.equal(
      response.status,
      405,
      'Static endpoints reject execution methods: ' + path
    );
    assert.equal(response.headers.get('allow'), 'GET, HEAD');
  }
});
