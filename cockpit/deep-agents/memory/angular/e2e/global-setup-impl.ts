import { createServer, get } from 'node:http';
import { createServer as probe } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, openSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { createOwnedProcessGroup, settleOwnedCleanup } from './owned-lifecycle.mjs';
// Capability-local transport: production proxy strips /api before forwarding.
// Fixture controls remain direct loopback endpoints and never enter public Code.
export default async function setup() {
  const root = resolve(__dirname, '../../../../..');
  for (const port of [4313, 5313]) {
    const listener = probe(); listener.listen(port);
    await once(listener, 'listening'); await new Promise<void>(r => listener.close(() => r()));
  }
  const { createDeepAgentsMemoryFixture } = await import('../../../../../scripts/react-cockpit/deep-agents-memory-fixture.mjs');
  const fixture = createDeepAgentsMemoryFixture();
  const backend = createServer(async (req, res) => {
    const path = new URL(req.url!, 'http://localhost:5313').pathname;
    try {
      if (!await fixture(req, res, path.startsWith('/threads') ? '/api' + path : path)) { res.writeHead(404); res.end(); }
    } catch { res.writeHead(500); res.end(); }
  });
  let child: ReturnType<typeof spawn> | undefined;
  let group: ReturnType<typeof createOwnedProcessGroup> | undefined;
  let log: number | undefined;
  let closing: Promise<void> | undefined;
  const cleanup = () => closing ??= settleOwnedCleanup([
    () => fixture.close(),
    () => new Promise<void>((done, reject) => { backend.closeAllConnections(); backend.close(error => error ? reject(error) : done()); }),
    async () => { const result = await group?.close(); if (result) console.log('Memory owned group closed: ' + JSON.stringify(result)); },
    () => { if (log !== undefined) { closeSync(log); log = undefined; } },
  ]);
  try {
    backend.listen(5313); await once(backend, 'listening');
    mkdirSync('/tmp/threadplane-memory-task4b-angular', { recursive: true });
    log = openSync('/tmp/threadplane-memory-task4b-angular/serve.log', 'a', 0o600);
    child = spawn(process.execPath, [resolve(root, 'node_modules/nx/bin/nx.js'), 'serve', 'cockpit-deep-agents-memory-angular', '--configuration=cockpit', '--port=4313', '--host=localhost'], { cwd: root, detached: true, stdio: ['ignore', log, log], env: { ...process.env, NX_DAEMON: 'false' } });
    group = createOwnedProcessGroup(child);
    for (let n = 0; n < 360; n++) {
      if (child.exitCode !== null) throw Error('Owned Angular serve failed; see private serve.log');
      const ready = await Promise.all(['http://[::1]:4313/', 'http://127.0.0.1:4313/'].map(url => new Promise<boolean>(resolveReady => {
        const req = get(url, response => { response.resume(); resolveReady(response.statusCode === 200); });
        req.setTimeout(2000, () => req.destroy()); req.on('error', () => resolveReady(false));
      })));
      if (ready.some(Boolean)) { console.log('Memory Angular and compiled backend ready.'); return cleanup; }
      await new Promise(r => setTimeout(r, 500));
    }
    throw Error('Owned Angular serve readiness timed out');
  } catch (error) {
    try { await cleanup(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Memory startup and cleanup failed'); }
    throw error;
  }
}
