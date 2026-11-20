/**
 * The real services the live session suite talks to, and the two pieces of
 * application infrastructure a durable session assumes: a model the backends
 * can call without a network, and a server in front of the backend that keeps
 * each thread's events.
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LLMock } from 'aimock';
import { environment, mastra, pythonProject } from './configuration.mjs';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Rejects when `promise` has not settled in time, naming what was awaited. */
export async function bounded(promise, label = 'operation', ms = 30000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Timed out waiting for ${label}`)),
          ms
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function freePort() {
  const probe = createNetServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address();
  probe.close();
  await once(probe, 'close');
  return port;
}

/**
 * The recorded model: aimock replaying fixture files, as the cockpit e2e
 * setups run it. `mock` is the instance, for a test that adds a fixture or
 * makes the next model call fail.
 */
export async function startModel(fixtureFiles = [], options = {}) {
  const mock = new LLMock({ port: 0, chunkSize: 4096, ...options });
  for (const file of fixtureFiles)
    mock.addFixturesFromJSON(JSON.parse(readFileSync(file, 'utf8')).fixtures);
  await mock.start();
  let stopped = false;
  return {
    mock,
    baseUrl: `${mock.url}/v1`,
    async stop() {
      if (stopped) return;
      stopped = true;
      await mock.stop();
    },
  };
}

/** The variables a backend process gets: no credential of the caller's. */
function backendEnvironment(extra) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/(?:API_KEY|TOKEN|SECRET|LANGSMITH|LANGCHAIN)/i.test(key)
    )
  );
  return Object.assign(env, {
    UV_PROJECT_ENVIRONMENT: environment,
    UV_PYTHON: '3.12',
    PYTHONDONTWRITEBYTECODE: '1',
    LANGSMITH_TRACING: 'false',
    LANGCHAIN_TRACING_V2: 'false',
    NO_PROXY: '127.0.0.1,localhost',
    ...extra,
  });
}

/**
 * Starts a Python AG-UI backend with uvicorn in the prepared environment, the
 * way the cockpit e2e setups start one, pointed at `model`. `cwd` is the
 * backend's project directory and `app` its ASGI application.
 */
export async function startPythonBackend({
  cwd,
  app = 'src.server:app',
  appDir,
  model,
}) {
  const port = await freePort();
  const output = [];
  const child = spawn(
    'uv',
    [
      'run',
      '--frozen',
      '--no-sync',
      '--project',
      pythonProject,
      'python',
      '-m',
      'uvicorn',
      app,
      ...(appDir ? ['--app-dir', appDir] : []),
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--log-level',
      'warning',
    ],
    {
      cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: backendEnvironment({
        OPENAI_BASE_URL: model.baseUrl,
        OPENAI_API_KEY: 'test-not-used',
      }),
    }
  );
  child.stdout.on('data', (chunk) => output.push(String(chunk)));
  child.stderr.on('data', (chunk) => output.push(String(chunk)));
  let exited = false;
  child.once('exit', () => {
    exited = true;
  });
  const url = `http://127.0.0.1:${port}`;
  const stop = async () => {
    if (exited) return;
    const gone = once(child, 'exit');
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* Already gone. */
    }
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* Already gone. */
      }
    }, 5000);
    await gone;
    clearTimeout(timer);
  };
  const deadline = Date.now() + 90000;
  for (;;) {
    if (exited)
      throw new Error(`The backend exited while starting:\n${output.join('')}`);
    try {
      const response = await fetch(`${url}/ok`);
      if (response.ok) break;
    } catch {
      /* Not listening yet. */
    }
    if (Date.now() > deadline) {
      await stop();
      throw new Error(`The backend did not start:\n${output.join('')}`);
    }
    await pause(200);
  }
  return { url, stop, output: () => output.join('') };
}

/**
 * Starts the Mastra hosting service with its scripted model, both owned by
 * this process, exactly as the service's own tests start them. `agent(topic)`
 * builds the in-process AG-UI client agent the service itself wraps, for a
 * session that runs over an agent and not over HTTP.
 */
export async function startMastra() {
  const { startScriptedService } = await import(
    pathToFileURL(join(mastra, 'test/scripted-service.mjs')).href
  );
  const service = await startScriptedService({ startupTimeoutMs: 60000 });
  let local;
  return {
    url: `${service.baseUrl}/agent/mastra`,
    headers: { 'x-internal-token': service.token },
    stats: service.stats,
    /** A fresh in-process `MastraAgent` over the same agents and model. */
    async agent(threadId, topic = 'mastra') {
      const [{ MastraAgent }, { createMastra }] = await Promise.all([
        import(
          pathToFileURL(
            join(mastra, 'node_modules/@ag-ui/mastra/dist/index.mjs')
          ).href
        ),
        import(pathToFileURL(join(mastra, 'agents.mjs')).href),
      ]);
      local ??= createMastra(
        `file:${process.env.AG_UI_MASTRA_DB_PATH}.in-process`
      );
      return new MastraAgent({
        agentId: topic,
        agent: local.getAgent(topic),
        resourceId: threadId,
      });
    },
    stop: () => service.close(),
  };
}

/**
 * The application's own server in front of a backend. It forwards each run
 * and keeps the events the backend produced, by thread, which is what a
 * session's `replay` and `persistence.reconcile` ask a server for.
 *
 * It can also stand in for two things that happen to a deployed server:
 * `refuseNext()` makes it turn the next request away before any run starts,
 * and `dropTerminalNext()` makes the connection drop before the client reads
 * the next run's `RUN_FINISHED`, which the backend still produced.
 */
export async function startRecordingServer({ target, headers = {} }) {
  /** @type {Map<string, object[]>} */
  const logs = new Map();
  const requests = [];
  let refuse = false;
  let dropTerminal = false;
  const server = http.createServer(async (request, response) => {
    // What `httpReplay` reads: the thread's events, or 404 for none.
    if (request.method === 'GET') {
      const threadId = decodeURIComponent(
        (request.url ?? '').replace(/^\/events\//, '')
      );
      const events = logs.get(threadId);
      response.writeHead(events ? 200 : 404, {
        'content-type': 'application/json',
      });
      response.end(JSON.stringify(events ? { events } : { detail: 'none' }));
      return;
    }
    let body = '';
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
    requests.push(input);
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
    });
    if (refuse) {
      refuse = false;
      response.end(
        `data: ${JSON.stringify({
          type: 'RUN_ERROR',
          message: 'The server is restarting. Try again.',
          code: 'unavailable',
        })}\n\n`
      );
      return;
    }
    const drop = dropTerminal;
    dropTerminal = false;
    const upstream = await fetch(target + (request.url ?? '').slice(1), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        ...headers,
      },
      body,
    });
    const log = logs.get(input.threadId) ?? [];
    logs.set(input.threadId, log);
    const decoder = new TextDecoder();
    let pending = '';
    let dropped = false;
    try {
      for await (const chunk of upstream.body) {
        pending += decoder.decode(chunk, { stream: true });
        let end;
        while ((end = pending.indexOf('\n\n')) !== -1) {
          const frame = pending.slice(0, end);
          pending = pending.slice(end + 2);
          const data = frame
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n');
          if (!data) continue;
          const event = JSON.parse(data);
          // The server keeps what the backend produced, whoever read it.
          log.push(event);
          if (drop && event.type === 'RUN_FINISHED') {
            dropped = true;
            continue;
          }
          if (!dropped && !response.destroyed)
            response.write(`data: ${data}\n\n`);
        }
      }
    } catch {
      // The backend closed the connection without ending the stream, as the
      // bridge does after it reports a failed run. The client sees the same.
      response.destroy();
      return;
    }
    response.end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    /** Every `RunAgentInput` received, oldest first. */
    requests,
    /** The events the backend produced for a thread, in order. */
    events: (threadId) => structuredClone(logs.get(threadId) ?? []),
    /** Where `httpReplay` finds a thread's events. */
    eventsUrl: (threadId) =>
      `http://127.0.0.1:${server.address().port}/events/${encodeURIComponent(
        threadId
      )}`,
    refuseNext() {
      refuse = true;
    },
    dropTerminalNext() {
      dropTerminal = true;
    },
    async stop() {
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    },
  };
}
