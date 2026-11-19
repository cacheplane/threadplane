/** Local browser proof server. Never assembled into a public deployment. */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reactCockpitConfiguration } from './configuration.mjs';
import { createChatA2uiFixture, fixtureConfiguration } from './chat-a2ui-fixture.mjs';
import { createAgUiA2uiFixture } from './ag-ui-a2ui-fixture.mjs';
import { createNativeMastraFixture } from './native-mastra-fixture.mjs';
import { createNativeStrandsFixture } from './native-strands-fixture.mjs';
import { createNativeMafFixture } from './native-maf-fixture.mjs';
import { createAgUiClientToolsFixture } from './ag-ui-client-tools-fixture.mjs';
import { createLanggraphProxy } from './langgraph-proxy.mjs';
import { createAgUiProxy } from './ag-ui-proxy.mjs';
import { createAimockBackend } from './aimock-backend.mjs';
import { createChatGenerativeUiFixture } from './chat-generative-ui-fixture.mjs';
import { createAgUiToolViewsFixture } from './ag-ui-tool-views-fixture.mjs';
import { createAgUiJsonRenderFixture } from './ag-ui-json-render-fixture.mjs';
import { createAgUiSubagentsFixture } from './ag-ui-subagents-fixture.mjs';


const configuration = reactCockpitConfiguration(process.argv[2]);
const agUiA2uiFixture = configuration.library === 'ag-ui' && configuration.adapter === 'ag-ui' && configuration.topic === 'a2ui'
  ? createAgUiA2uiFixture({ ...JSON.parse(process.env.THREADPLANE_AGUI_A2UI_BROWSER_RUNTIME ?? '{}'), retain: process.env.THREADPLANE_AGUI_A2UI_BROWSER_RETAIN }) : null;
const isChatA2ui = configuration.library === 'chat' && configuration.topic === 'a2ui';
let chatA2uiFixture = null;
let chatA2uiConfiguration;
// Local failure controls own only these responses; production builds never import this server.
let holdA2uiStreams = false;
const heldA2uiStreams = new Map();
const a2uiStreamCloses = [];
const a2uiClosedWorkers = [];
const a2uiReceipt = () => ({ ...chatA2uiFixture.receipt(), closedWorkers: [...a2uiClosedWorkers], heldStreams: heldA2uiStreams.size, heldCompleted: [...heldA2uiStreams.values()].filter(held => held.finished !== null).length, streamCloses: [...a2uiStreamCloses] });
const releaseA2uiStreams = (cancel = false) => {
  holdA2uiStreams = false;
  for (const [response, held] of heldA2uiStreams) {
    if (cancel) response.destroy();
    else {
      heldA2uiStreams.delete(response);
      response.write = held.write;
      response.end = held.end;
      for (const chunk of held.chunks) response.write(...chunk);
      if (held.finished) response.end(...held.finished);
    }
  }
};
const nativeStrandsFixture = configuration.library === 'runtimes' && configuration.topic === 'aws-strands' ? createNativeStrandsFixture() : null;
const nativeMafFixture = configuration.library === 'runtimes' && configuration.topic === 'microsoft-agent-framework' ? createNativeMafFixture() : null;
const nativeMastraFixture = configuration.library === 'runtimes' && configuration.topic === 'mastra' ? createNativeMastraFixture() : null;
let chatGenerativeUiFixture = configuration.library === 'chat' && configuration.topic === 'generative-ui' ? createChatGenerativeUiFixture() : null;
// aimock-backed examples: the real graph runs under `langgraph dev` or, for
// AG-UI examples, the example's uvicorn server (started by the Playwright
// global setup); this server proxies the API or agent endpoint to it.
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
const agUiProxy = configuration.backend?.kind === 'aimock-ag-ui'
  ? createAgUiProxy({
      upstream: `http://127.0.0.1:${configuration.backend.backendPort}`,
      agentPaths: [`/ag-ui/${configuration.topic}${configuration.backend.agentPath}`, '/developer-agent'],
      agentPath: configuration.backend.agentPath,
      ready: aimockBackend ? () => aimockBackend.ensure() : undefined,
    })
  : null;
const agUiSubagentsFixture =
  configuration.adapter === 'ag-ui' && configuration.topic === 'subagents'
    ? createAgUiSubagentsFixture()
    : null;
const agUiJsonRenderFixture =
  configuration.adapter === 'ag-ui' && configuration.topic === 'json-render'
    ? createAgUiJsonRenderFixture()
    : null;
const agUiToolViewsFixture =
  configuration.adapter === 'ag-ui' && configuration.topic === 'tool-views'
    ? createAgUiToolViewsFixture()
    : null;
const agUiClientToolsFixture = configuration.adapter === 'ag-ui' && configuration.topic === 'client-tools' ? createAgUiClientToolsFixture() : null;

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
  if (agUiA2uiFixture && (await agUiA2uiFixture(request, response, pathname))) return;
  if (chatA2uiFixture) {
    if (pathname.startsWith('/__')) {
      const controls = {
        '/__requests': ['GET', () => chatA2uiFixture.receipt().requests],
        '/__captures': ['GET', () => chatA2uiFixture.receipt().proofs],
        '/__lifetime': ['GET', a2uiReceipt],
        '/__hold/stream': ['POST', () => { holdA2uiStreams = true; return {}; }],
        '/__release': ['POST', () => { releaseA2uiStreams(); return {}; }],
        '/__reset': ['POST', async () => {
          releaseA2uiStreams(true);
          await chatA2uiFixture.close();
          a2uiClosedWorkers.push(chatA2uiFixture.receipt());
          chatA2uiFixture = createChatA2uiFixture({ configuration: chatA2uiConfiguration });
          return {};
        }],
      };
      const control = Object.hasOwn(controls, pathname) ? controls[pathname] : undefined;
      if (!control) return json(response, {}, 404);
      if (request.method !== control[0]) return json(response, {}, 405);
      try { return json(response, await control[1]()); }
      catch { return json(response, { error: 'Local fixture control failed' }, 500); }
    }
    if (holdA2uiStreams && request.method === 'POST' && /^\/api\/threads\/[^/]+\/runs\/stream$/.test(pathname)) {
      const held = { write: response.write, end: response.end, chunks: [], finished: null, bytes: 0 };
      heldA2uiStreams.set(response, held);
      response.write = (...args) => {
        held.bytes += Buffer.byteLength(args[0]);
        if (held.bytes > 32 * 1024 * 1024) { response.destroy(); return false; }
        if (response.destroyed) return false;
        response.flushHeaders();
        held.chunks.push(args);
        return true;
      };
      response.end = (...args) => { held.finished = args; return response; };
      response.once('close', () => {
        const wasHeld = heldA2uiStreams.delete(response);
        a2uiStreamCloses.push({ path: pathname, held: wasHeld, destroyed: response.destroyed });
      });
    }
    if (await chatA2uiFixture(request, response, pathname)) return;
    if (pathname.startsWith('/developer-api/')) return json(response, {}, 404);
  }
  if (nativeStrandsFixture && (await nativeStrandsFixture(request, response, pathname))) return;
  if (nativeMafFixture && (await nativeMafFixture(request, response, pathname))) return;
  if (nativeMastraFixture && (await nativeMastraFixture(request, response, pathname))) return;
  if (agUiClientToolsFixture && (await agUiClientToolsFixture(request, response, pathname))) return;
  if (chatGenerativeUiFixture && pathname === '/__reset') {
    if (request.method !== 'POST') return json(response, {}, 405);
    try {
      await chatGenerativeUiFixture.close();
      chatGenerativeUiFixture = createChatGenerativeUiFixture();
      return json(response, {});
    } catch {
      return json(response, { error: 'Fixture reset failed.' }, 500);
    }
  }
  if (chatGenerativeUiFixture && (await chatGenerativeUiFixture(request, response, pathname))) return;
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
    agUiSubagentsFixture &&
    (await agUiSubagentsFixture(request, response, pathname))
  )
    return;
  if (
    agUiJsonRenderFixture &&
    (await agUiJsonRenderFixture(request, response, pathname))
  )
    return;
  if (
    agUiToolViewsFixture &&
    (await agUiToolViewsFixture(request, response, pathname))
  )
    return;
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
let closing;
let shutdown;
if (agUiA2uiFixture || isChatA2ui || nativeStrandsFixture || nativeMafFixture || nativeMastraFixture || agUiClientToolsFixture || chatGenerativeUiFixture) {
  shutdown = (code = 0) => {
    closing ??= (async () => {
      let a2uiFailure;
      if (agUiA2uiFixture) {
        try { await agUiA2uiFixture.close(); }
        catch (error) { a2uiFailure = error; }
      }
      else if (isChatA2ui) {
        releaseA2uiStreams(true);
        try { await chatA2uiFixture?.close(); }
        catch (error) { a2uiFailure = error; }
      }
      else await (nativeStrandsFixture ?? nativeMafFixture ?? nativeMastraFixture ?? agUiClientToolsFixture ?? chatGenerativeUiFixture).close();
      await Promise.all([server, parentServer].filter(Boolean).map((owned) => new Promise((resolve) => {
        owned.close(resolve);
        owned.closeAllConnections();
      })));
      if (chatA2uiFixture) console.log(JSON.stringify({ serverPid: process.pid, parentServerOwned: Boolean(parentServer), chatA2uiFixtureClosed: a2uiReceipt(), listenersClosed: true }));
      if (agUiA2uiFixture) console.log(JSON.stringify({ serverPid: process.pid, parentServerOwned: Boolean(parentServer), agUiA2uiFixtureClosed: agUiA2uiFixture.receipt(), bufferedCanonicalWire: true, listenersClosed: true }));
      if (a2uiFailure) throw a2uiFailure;
    })();
    if (agUiA2uiFixture || isChatA2ui) void closing.then(() => process.exit(code), () => process.exit(1));
    else void closing.finally(() => process.exit(code));
  };
  process.once('SIGINT', () => shutdown());
  process.once('SIGTERM', () => shutdown());
  server.once('error', () => shutdown(1));
  parentServer?.once('error', () => shutdown(1));
}

if (aimockBackend && !shutdown) {
  const stop = () => { void aimockBackend.close().finally(() => process.exit(0)); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

// Own signals, errors, workers and both listeners before tooling discovery or proof.
// Only dependency tooling is reused; each reset still owns a fresh graph process.
try {
  if (isChatA2ui) {
    chatA2uiConfiguration = Object.freeze(fixtureConfiguration());
    if (!closing) {
      chatA2uiFixture = createChatA2uiFixture({ configuration: chatA2uiConfiguration });
      await chatA2uiFixture.configure({});
    }
  }
  if (!closing) {
    server.listen(configuration.port, '127.0.0.1');
    parentServer?.listen(3000, '127.0.0.1');
  }
} catch (error) {
  if (!closing) {
    console.error('Local browser fixture preparation failed:', error.message);
    shutdown?.(1);
  }
}
