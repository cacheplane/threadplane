/** Test-only owned process; service imports occur after all local configuration. */
import assert from 'node:assert/strict';
import { fork, execFileSync } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import dns from 'node:dns';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createMockOpenAi } from './model.mjs';
const source = fileURLToPath(import.meta.url);
const defaultRoot = resolve(dirname(source), '../../..');
const MAX = 2_000_000;
export async function bounded(promise, label, timeout = 15000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(label + ' timed out')),
          timeout
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function listen(server, port = 0) {
  await bounded(
    new Promise((yes, no) => {
      server.once('error', no);
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', no);
        yes();
      });
    }),
    'listen'
  );
  return server.address().port;
}
async function closeServer(server) {
  if (!server) return;
  await bounded(
    new Promise((yes) => {
      server.close(yes);
      server.closeAllConnections();
    }),
    'server close'
  );
}
async function portAbsent(port) {
  return new Promise((yes) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.setTimeout(1000, () => {
      socket.destroy();
      yes(false);
    });
    socket.once('connect', () => {
      socket.destroy();
      yes(false);
    });
    socket.once('error', (error) => {
      socket.destroy();
      yes(error.code === 'ECONNREFUSED');
    });
  });
}
function processAbsent(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    if (error.code === 'ESRCH') return true;
    throw error;
  }
}
function identity(pid) {
  return execFileSync('ps', ['-o', 'lstart=,args=', '-p', String(pid)], {
    encoding: 'utf8',
    timeout: 1000,
  }).trim();
}
export async function createNativeMastraServer({
  root = defaultRoot,
  mode = 'normal',
  failStartup = false,
  port = 0,
} = {}) {
  assert.ok(Number.isInteger(port) && port >= 0 && port <= 65535);
  assert.ok(['normal', 'lost-terminal', 'notice-only', 'held'].includes(mode));
  const database = mkdtempSync(join(tmpdir(), 'threadplane-native-mastra-'));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/(?:KEY|TOKEN|SECRET|LANGSMITH|LANGCHAIN|OPENAI|MASTRA|FIXTURE|LIBRARY)/i.test(
          key
        )
    )
  );
  Object.assign(env, {
    AG_UI_MASTRA_DB_PATH: join(database, 'mastra.db'),
    AG_UI_INTERNAL_TOKEN: 'offline-native-mastra',
    OPENAI_API_KEY: 'sk-offline-unused',
    LANGSMITH_TRACING: 'false',
    LANGCHAIN_TRACING_V2: 'false',
  });
  const child = fork(
    source,
    [
      '--worker',
      root,
      mode,
      String(port),
      ...(failStartup ? ['--fail-startup'] : []),
    ],
    { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] }
  );
  let state = { requests: [], modelRequests: [], faults: [] },
    stderr = '',
    exited = false,
    closing,
    ownedIdentity;
  const closure = {
    childAbsent: false,
    databaseAbsent: false,
    responsesClosed: false,
    socketsClosed: false,
    serversClosed: false,
    portsAbsent: false,
  };
  let readyResolve, readyReject;
  const ready = new Promise((yes, no) => {
    readyResolve = yes;
    readyReject = no;
  });
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-MAX);
  });
  child.stdout.on('data', () => undefined);
  child.on('error', readyReject);
  child.on('exit', (code, signal) => {
    exited = true;
    readyReject(new Error(`worker exited ${code}/${signal}: ${stderr}`));
  });
  child.on('message', (message) => {
    if (message.stats) state = message.stats;
    if (message.ready) readyResolve(message.ready);
    if (message.error) readyReject(new Error(message.error));
  });
  const stats = () =>
    structuredClone({
      ...state,
      stderr,
      closure,
      ownership: { pid: child.pid, identity: ownedIdentity, database, source },
    });
  async function close() {
    return (closing ??= (async () => {
      if (!exited && child.connected) child.send({ close: true });
      const until = Date.now() + 5000;
      while (!exited && Date.now() < until) await delay(20);
      if (!exited) {
        assert.equal(
          identity(child.pid),
          ownedIdentity,
          'exact owned process identity'
        );
        child.kill('SIGTERM');
      }
      const final = Date.now() + 5000;
      while (!exited && Date.now() < final) await delay(20);
      if (!exited) {
        assert.equal(identity(child.pid), ownedIdentity);
        child.kill('SIGKILL');
        await bounded(
          new Promise((yes) => child.once('exit', yes)),
          'owned child kill'
        );
      }
      rmSync(database, { recursive: true, force: true });
      closure.childAbsent = exited && processAbsent(child.pid);
      closure.databaseAbsent = !existsSync(database);
      closure.responsesClosed =
        state.closed?.responsesClosed ?? state.requests.every((r) => r.closed);
      closure.socketsClosed = state.closed?.socketsClosed ?? exited;
      closure.serversClosed = state.closed?.serversClosed ?? exited;
      closure.portsAbsent = (
        await Promise.all((state.ownedPorts ?? []).map(portAbsent))
      ).every(Boolean);
      assert.ok(
        Object.values(closure).every(Boolean),
        'owned resource closure'
      );
    })());
  }
  try {
    ownedIdentity = identity(child.pid);
    assert.ok(ownedIdentity.includes(source), 'exact launched worker command');
    const endpoint = await bounded(ready, 'worker ready');
    return { url: endpoint.url, pid: child.pid, stats, close };
  } catch (error) {
    await close();
    error.fixtureClosure = stats();
    throw error;
  }
}
async function worker() {
  const root = process.argv[3],
    mode = process.argv[4],
    requestedPort = Number(process.argv[5]);
  const state = {
    requests: [],
    serviceRequests: [],
    ownedPorts: [],
    modelRequests: [],
    faults: [],
    networkDenials: [],
    closed: null,
  };
  const responses = new Set(),
    sockets = new Set();
  let mock, service, proxy, closing;
  const publish = () => {
    if (process.connected) process.send({ stats: state });
  };
  // Defense in depth: configuration is loopback; deny outbound sockets, DNS and fetch.
  const local = (host) =>
    host === '127.0.0.1' || host === 'localhost' || host === '::1';
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    const options =
      typeof first === 'object'
        ? first
        : { host: typeof args[1] === 'string' ? args[1] : 'localhost' };
    if (options.path || !local(options.host ?? 'localhost')) {
      state.networkDenials.push(String(options.host ?? options.path));
      throw new Error('Offline fixture denies foreign connection');
    }
    return connect.apply(this, args);
  };
  const lookup = dns.lookup;
  dns.lookup = function (host, ...args) {
    if (!local(host)) {
      state.networkDenials.push(host);
      throw new Error('Offline fixture denies DNS');
    }
    return lookup.call(this, host, ...args);
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, options) => {
    const url = new URL(
      typeof input === 'string' || input instanceof URL ? input : input.url
    );
    if (!local(url.hostname)) throw new Error('Offline fixture denies fetch');
    return originalFetch(input, options);
  };
  function track(server) {
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });
    server.on('request', (_, response) => {
      responses.add(response);
      response.once('close', () => responses.delete(response));
    });
  }
  async function close() {
    return (closing ??= (async () => {
      for (const response of responses) response.destroy();
      for (const socket of sockets) socket.destroy();
      await closeServer(proxy);
      await closeServer(service);
      await closeServer(mock);
      await delay(20);
      state.closed = {
        responsesClosed: responses.size === 0,
        socketsClosed: sockets.size === 0,
        serversClosed: true,
      };
      publish();
      process.disconnect();
    })());
  }
  process.once('SIGTERM', () => void close().then(() => process.exit(0)));
  process.once('SIGINT', () => void close().then(() => process.exit(0)));
  process.on('message', (message) => {
    if (message.close) void close().then(() => process.exit(0));
  });
  try {
    mock = createMockOpenAi(state.modelRequests, { hold: mode === 'held' });
    track(mock);
    const modelPort = await listen(mock);
    state.ownedPorts.push(modelPort);
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${modelPort}/v1`;
    state.configuration = {
      modelUrl: process.env.OPENAI_BASE_URL,
      database: process.env.AG_UI_MASTRA_DB_PATH,
      offline: true,
      mode,
    };
    state.codePins = Object.fromEntries(
      ['server.mjs', 'agents.mjs', 'package-lock.json'].map((name) => [
        name,
        createHash('sha256')
          .update(readFileSync(resolve(root, 'deployments/ag-ui-mastra', name)))
          .digest('hex'),
      ])
    );
    if (process.argv.includes('--fail-startup'))
      throw new Error('deliberate startup failure');
    const { createAgUiServer } = await import(
      resolve(root, 'deployments/ag-ui-mastra/server.mjs')
    );
    service = createAgUiServer();
    service.prependListener('request', (request, response) => {
      if (request.method === 'POST') {
        const record = { path: request.url, closed: false };
        state.serviceRequests.push(record);
        response.once('close', () => {
          record.closed = true;
          publish();
        });
      }
    });
    track(service);
    const servicePort = await listen(service);
    state.ownedPorts.push(servicePort);
    proxy = http.createServer(async (request, response) => {
      request.setTimeout(15000, () => request.destroy());
      response.setTimeout(25000, () => response.destroy());
      if (request.url === '/stats') {
        response
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify(state));
        return;
      }
      if (request.url !== '/agent' || request.method !== 'POST') {
        response.writeHead(404).end();
        return;
      }
      if (state.requests.length >= 12) {
        response.writeHead(429).end();
        return;
      }
      const record = {
        body: null,
        bytes: '',
        upstreamBytes: '',
        sentBytes: '',
        events: [],
        closed: false,
        upstreamClosed: false,
        faults: [],
      };
      state.requests.push(record);
      let incoming;
      const upstream = http.request(
        {
          host: '127.0.0.1',
          port: servicePort,
          path: '/agent/mastra',
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-internal-token': process.env.AG_UI_INTERNAL_TOKEN,
          },
        },
        (actual) => {
          incoming = actual;
          response.writeHead(actual.statusCode, {
            'content-type':
              actual.headers['content-type'] ?? 'application/json',
            'cache-control': 'no-store',
          });
          let buffer = '';
          actual.on('data', (chunk) => {
            record.upstreamBytes += chunk;
            if (record.upstreamBytes.length > MAX) {
              actual.destroy();
              response.destroy();
              return;
            }
            buffer += chunk;
            while (buffer.includes('\n\n')) {
              const at = buffer.indexOf('\n\n'),
                frame = buffer.slice(0, at + 2);
              buffer = buffer.slice(at + 2);
              let event;
              try {
                event = JSON.parse(frame.replace(/^data: /, ''));
              } catch {
                response.destroy();
                return;
              }
              record.events.push(event);
              const terminal =
                event.type === 'RUN_FINISHED' &&
                event.runId === record.body.runId &&
                event.threadId === record.body.threadId;
              const drop =
                (mode === 'lost-terminal' && record.body.resume && terminal) ||
                (mode === 'notice-only' &&
                  terminal &&
                  event.outcome?.type === 'interrupt');
              if (drop) {
                const fault = {
                  type: 'removed-real-root-terminal',
                  event,
                  bytes: frame,
                };
                record.faults.push(fault);
                state.faults.push(fault);
              } else if (!response.destroyed) {
                response.write(frame);
                record.sentBytes += frame;
              }
              if (mode === 'held' && event.type === 'RUN_STARTED') {
                actual.pause();
                record.held = true;
                state.faults.push({
                  type: 'held-real-root-start',
                  event,
                  bytes: frame,
                });
                publish();
                return;
              }
            }
            publish();
          });
          actual.once('end', () => {
            record.upstreamEnded = true;
            if (!record.held) response.end();
            publish();
          });
          actual.once('close', () => {
            record.upstreamClosed = true;
            record.upstreamAborted = !record.upstreamEnded;
            publish();
          });
          actual.on('error', () => response.destroy());
        }
      );
      response.once('close', () => {
        record.closed = true;
        incoming?.destroy();
        upstream.destroy();
        publish();
      });
      upstream.on('error', () => {
        if (!response.headersSent) response.writeHead(502).end();
        else response.destroy();
      });
      try {
        for await (const chunk of request) {
          record.bytes += chunk;
          assert.ok(record.bytes.length <= MAX);
        }
        record.body = JSON.parse(record.bytes);
        upstream.end(record.bytes);
        publish();
      } catch {
        upstream.destroy();
        response.writeHead(400).end();
      }
    });
    track(proxy);
    const port = await listen(proxy, requestedPort);
    state.ownedPorts.push(port);
    publish();
    process.send({ ready: { url: `http://127.0.0.1:${port}` } });
  } catch (error) {
    if (process.connected) process.send({ error: String(error) });
    await close();
    process.exit(1);
  }
}
if (process.argv.includes('--worker')) await worker();
