/** Local browser proof server. Never assembled into a public deployment. */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reactCockpitConfiguration } from './configuration.mjs';
import { createLanggraphProxy } from './langgraph-proxy.mjs';
import { createAgUiProxy } from './ag-ui-proxy.mjs';
import { createAimockBackend } from './aimock-backend.mjs';

const configuration = reactCockpitConfiguration(process.argv[2]);
// aimock-backed examples: the real graph runs under `langgraph dev`, the
// example's uvicorn AG-UI server, or (Mastra) the deployments/ag-ui-mastra
// service, started by the Playwright global setup; this server proxies the
// API or agent endpoint to it.
// `--backend` (Website previews) starts that backend here, lazily on the first
// API or control request; cockpit e2e starts it from global setup.
const aimockBackend = configuration.backend && process.argv.includes('--backend')
  ? createAimockBackend({
      root: resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
      backend: configuration.backend,
    })
  : null;
const langgraphProxy = configuration.backend?.kind === 'aimock-langgraph'
  ? createLanggraphProxy({
      upstream: `http://127.0.0.1:${configuration.backend.langgraphPort}`,
      ready: aimockBackend ? () => aimockBackend.ensure() : undefined,
    })
  : null;
const agUiProxy = ['aimock-ag-ui', 'aimock-mastra'].includes(configuration.backend?.kind)
  ? createAgUiProxy({
      upstream: `http://127.0.0.1:${configuration.backend.backendPort}`,
      agentPaths: [
        // e.g. /ag-ui/interrupts/agent/native, /runtimes/mastra/agent
        configuration.base.replace(/\/react\/$/, '') + (configuration.backend.publicAgentPath ?? configuration.backend.agentPath),
        '/developer-agent',
      ],
      agentPath: configuration.backend.agentPath,
      headers: configuration.backend.headers,
      modelJournal: `http://127.0.0.1:${configuration.backend.aimockPort}/__aimock/journal`,
      ready: aimockBackend ? () => aimockBackend.ensure() : undefined,
    })
  : null;

const root = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../dist/' + configuration.appPath
);
const json = (response, value, status = 200) => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
};
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (langgraphProxy && (await langgraphProxy(request, response, pathname))) return;
  if (agUiProxy && (await agUiProxy(request, response, pathname))) return;
  if (configuration.adapter === 'none') {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { allow: 'GET, HEAD' });
      return response.end();
    }
    if (
      pathname.startsWith('/api/') ||
      pathname.startsWith('/developer-api/') ||
      pathname.startsWith('/__')
    ) {
      response.writeHead(404);
      return response.end();
    }
  }
  if (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/developer-api/') ||
    pathname.startsWith('/__')
  ) {
    // Every runtime-backed example owns these paths through its fixture or the
    // aimock proxy above; anything left is not served.
    response.writeHead(404);
    return response.end();
  }
  if (pathname === '/') {
    if (request.headers.host?.endsWith(':' + configuration.port)) {
      response.writeHead(302, { location: configuration.base });
      return response.end();
    }
    response.writeHead(200);
    return response.end('React cockpit proof server');
  }
  const prefix = configuration.base;
  if (!pathname.startsWith(prefix)) {
    response.writeHead(404);
    return response.end();
  }
  const file = resolve(
    root,
    decodeURIComponent(pathname.slice(prefix.length)) || 'index.html'
  );
  if (file !== root && !file.startsWith(root + sep)) {
    response.writeHead(404);
    return response.end();
  }
  let content;
  try {
    // Read before answering: a missing build output is a 404, not a crash.
    content = readFileSync(file);
  } catch {
    response.writeHead(404);
    return response.end();
  }
  response.writeHead(200, {
    'content-type':
      { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[
        extname(file)
      ] ?? 'application/octet-stream',
  });
  response.end(content);
});
const parentServer = !process.argv.includes('--no-parent')
  ? createServer(server.listeners('request')[0]) : null;

if (aimockBackend) {
  const stop = () => { void aimockBackend.close().finally(() => process.exit(0)); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

server.listen(configuration.port, '127.0.0.1');
parentServer?.listen(3000, '127.0.0.1');
