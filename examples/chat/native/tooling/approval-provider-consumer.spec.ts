import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

test(
  'accepted creation with a withheld ID cannot acknowledge cleanup after abort',
  { timeout: 15_000 },
  async (t) => {
    const directory = dirname(fileURLToPath(import.meta.url));
    const temporary = mkdtempSync(join(directory, 'creation-cleanup-'));
    const acknowledgement = join(temporary, 'cleanup.json');
    const requests: string[] = [];
    let accepted!: () => void;
    const creationAccepted = new Promise<void>((yes) => {
      accepted = yes;
    });
    const server = createServer((request, response) => {
      requests.push(`${request.method} ${request.url}`);
      if (request.url === '/__aimock/journal') {
        response.setHeader('content-type', 'application/json');
        response.end('[]');
      } else if (request.method === 'POST' && request.url === '/threads') {
        // The provider has accepted creation. Withhold its response/ID, so the
        // consumer cannot know whether there is a remote resource to delete.
        request.resume();
        request.once('end', accepted);
      } else {
        response.writeHead(500);
        response.end();
      }
    });
    await new Promise<void>((yes, no) => {
      server.once('error', no);
      server.listen(0, '127.0.0.1', yes);
    });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const origin = `http://127.0.0.1:${address.port}`;
    // This child stays in the parent runner's tracked process group.
    const child = spawn(
      process.execPath,
      [
        join(directory, 'approval-provider-consumer.js'),
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
    const closed = new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((yes, no) => {
      child.once('error', no);
      child.once('close', (code, signal) => yes({ code, signal }));
    });
    t.after(async () => {
      child.kill('SIGKILL');
      await closed;
      server.closeAllConnections();
      await new Promise<void>((yes) => server.close(() => yes()));
      rmSync(temporary, { recursive: true, force: true });
    });
    await Promise.race([
      creationAccepted,
      closed.then(() => {
        throw new Error('Consumer exited before creation: ' + diagnostics);
      }),
    ]);
    child.kill('SIGTERM');
    const exit = await closed;
    assert.notEqual(exit.code, 0, diagnostics);
    assert.deepEqual(requests, ['GET /__aimock/journal', 'POST /threads']);
    assert.equal(
      existsSync(acknowledgement),
      false,
      'An unconfirmed create must not publish positive cleanup evidence'
    );
  }
);
