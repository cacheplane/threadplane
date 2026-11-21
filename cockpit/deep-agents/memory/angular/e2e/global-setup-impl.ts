import { createServer } from 'node:http';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { portsFor } from '../../../../../cockpit/ports.mjs';
import { createGlobalSetup } from '@threadplane-internal/e2e-harness';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Local e2e proxy, never bundled.
import { createLanggraphProxy } from '../../../../../scripts/react-cockpit/langgraph-proxy.mjs';

const ports = portsFor('cockpit-deep-agents-memory-angular');
// aimock replays the fixtures shared with the React example into a real
// `langgraph dev` (with a real store) on an upstream port. The recording proxy
// sits where the Angular dev server's /api proxy points (proxy.conf.mjs), so
// specs can read /__requests and /__captures and arm one-shot faults.
const upstreamPort = ports.langgraph + 1000;
const harness = createGlobalSetup({
  langgraphCwd: 'cockpit/deep-agents/memory/python',
  langgraphPort: upstreamPort,
  angularProject: 'cockpit-deep-agents-memory-angular',
  angularPort: ports.angular,
  fixturesDir: resolve(__dirname, 'fixtures'),
});

export default async function setup() {
  const proxy = createLanggraphProxy({ upstream: `http://127.0.0.1:${upstreamPort}` });
  // The Angular dev proxy strips /api; the recording proxy expects it.
  const server = createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    try {
      if (!(await proxy(req, res, path.startsWith('/__') ? path : '/api' + path))) {
        res.writeHead(404);
        res.end();
      }
    } catch {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  server.listen(ports.langgraph);
  await once(server, 'listening');
  await harness();
  return () =>
    new Promise<void>((done) => {
      server.closeAllConnections();
      server.close(() => done());
    });
}
