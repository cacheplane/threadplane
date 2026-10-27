import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

for (const mode of ['withheld-id', 'seed-failure', 'delete-failure'] as const)
  test('backup consumer cleanup: ' + mode, { timeout: 15000 }, async (t) => {
    const directory = dirname(fileURLToPath(import.meta.url));
    const temporary = mkdtempSync(join(directory, 'backup-cleanup-'));
    const acknowledgement = join(temporary, 'cleanup.json');
    const requests: string[] = [];
    let accepted!: () => void;
    const created = new Promise<void>((resolve) => {
      accepted = resolve;
    });
    const server = createServer(async (request, response) => {
      for await (const _ of request) {
        /* drain the owned request */
      }
      requests.push(request.method + ' ' + request.url);
      response.setHeader('content-type', 'application/json');
      if (request.url === '/__aimock/journal') response.end('[]');
      else if (request.method === 'POST' && request.url === '/threads') {
        accepted();
        if (mode !== 'withheld-id') response.end('{"thread_id":"owned"}');
      } else if (
        request.method === 'DELETE' &&
        request.url === '/threads/owned'
      ) {
        response.writeHead(mode === 'delete-failure' ? 503 : 204);
        response.end();
      } else {
        response.writeHead(503);
        response.end('{"detail":"owned seed failure"}');
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve)
    );
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const origin = 'http://127.0.0.1:' + address.port;
    const child = spawn(
      process.execPath,
      [
        join(directory, 'backup-provider-consumer.js'),
        origin,
        origin,
        join(temporary, 'result.json'),
        acknowledgement,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    );
    let diagnostics = '';
    child.stderr.on('data', (bytes) => {
      diagnostics += String(bytes);
    });
    const closed = new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    t.after(async () => {
      child.kill('SIGKILL');
      await closed;
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(temporary, { recursive: true, force: true });
    });
    await Promise.race([
      created,
      closed.then(() => {
        throw new Error('Exited before create: ' + diagnostics);
      }),
    ]);
    if (mode === 'withheld-id') child.kill('SIGTERM');
    assert.notEqual(await closed, 0, diagnostics);
    assert.deepEqual(
      requests.filter((entry) => entry !== 'GET /__aimock/journal'),
      [
        'POST /threads',
        ...(mode === 'withheld-id'
          ? []
          : ['POST /threads/owned/state', 'DELETE /threads/owned']),
      ]
    );
    assert.equal(existsSync(acknowledgement), mode === 'seed-failure');
    if (mode === 'seed-failure')
      assert.deepEqual(JSON.parse(readFileSync(acknowledgement, 'utf8')), {
        ownersDisposed: true,
        threadsDeleted: true,
      });
    else
      assert.match(
        diagnostics,
        mode === 'withheld-id'
          ? /Thread creation outcome was not confirmed/
          : /All known applications retired/
      );
  });
