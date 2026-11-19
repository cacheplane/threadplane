/**
 * Local e2e only: aimock + the real server for one aimock-backed React cockpit
 * example, owned by `serve.mjs --backend`: `langgraph dev` for LangGraph
 * examples (`aimock-langgraph`), the example's uvicorn `src/server.py` for
 * AG-UI examples (`aimock-ag-ui`), and the deployments/ag-ui-mastra Node
 * service for the Mastra runtime (`aimock-mastra`).
 *
 * Cockpit e2e starts the same backend from its Playwright global setup
 * (libs/e2e-harness). Website e2e reuses the React examples as previews and
 * has no per-example setup, so the static server starts the backend itself,
 * lazily on the first API or control request (the proxy awaits it): loading a
 * preview page boots nothing, so only specs that drive a preview pay for it,
 * and a suite's page loads don't compete with a Python boot for CPU. The child stays in this process's
 * group, so Playwright's webServer teardown stops it with the server.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { LLMock } from 'aimock';

/** Every process below `pid`, deepest first. */
function descendants(pid) {
  let children = [];
  try {
    children = execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .map(Number);
  } catch {
    // no children
  }
  return children.flatMap((child) => [...descendants(child), child]);
}

function signal(pids, name) {
  for (const pid of pids) {
    try {
      process.kill(pid, name);
    } catch {
      // already gone
    }
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

export function createAimockBackend({ root, backend }) {
  let starting;
  let mock;
  let child;
  let stderr = '';

  let database;
  const port = backend.kind === 'aimock-langgraph' ? backend.langgraphPort : backend.backendPort;
  const label = { 'aimock-langgraph': 'langgraph dev', 'aimock-ag-ui': 'uvicorn', 'aimock-mastra': 'ag-ui-mastra' }[backend.kind];
  async function start() {
    const dir = resolve(root, backend.fixtures);
    const fixtures = readdirSync(dir)
      .filter((file) => file.endsWith('.json'))
      .sort()
      .flatMap((file) => JSON.parse(readFileSync(join(dir, file), 'utf8')).fixtures);
    // Same replay defaults as libs/e2e-harness/src/aimock-runner.ts.
    // A leftover server on the port would answer /ok with a dead aimock behind it.
    const stale = await fetch(`http://127.0.0.1:${port}/ok`).then(() => true, () => false);
    if (stale) throw new Error(`Port ${port} is already serving; stop the leftover server first`);
    mock = new LLMock({ port: backend.aimockPort ?? 0, chunkSize: 4096 });
    mock.addFixturesFromJSON(fixtures);
    await mock.start();
    const model = {
      OPENAI_BASE_URL: `${mock.url}/v1`,
      OPENAI_API_KEY: 'test-not-used',
      LANGSMITH_TRACING: 'false',
    };
    if (backend.kind === 'aimock-mastra') {
      // The service is self-contained (its own package.json and lockfile).
      const service = resolve(root, backend.service);
      if (!existsSync(join(service, 'node_modules')))
        execFileSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: service, stdio: 'ignore' });
      // A fresh LibSQL file per backend: no suspended runs or memory leak in.
      database = mkdtempSync(join(tmpdir(), 'ag-ui-mastra-e2e-'));
      child = spawn(process.execPath, ['server.mjs'], {
        cwd: service,
        env: {
          ...process.env,
          ...model,
          PORT: String(port),
          AG_UI_INTERNAL_TOKEN: backend.headers['x-internal-token'],
          AG_UI_MASTRA_DB_PATH: join(database, 'mastra.db'),
        },
        stdio: ['ignore', 'ignore', 'pipe'],
      });
    } else
      child = spawn(
        'uv',
        backend.kind === 'aimock-ag-ui'
          ? ['run', 'uvicorn', 'src.server:app', '--port', String(port)]
          : ['run', 'langgraph', 'dev', '--port', String(port), '--no-browser'],
        {
          cwd: resolve(root, backend.python),
          env: { ...process.env, ...model },
          stdio: ['ignore', 'ignore', 'pipe'],
        },
      );
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-8192);
    });
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) break;
      try {
        if ((await fetch(`http://127.0.0.1:${port}/ok`)).ok) return;
      } catch {
        // not listening yet
      }
      await delay(500);
    }
    process.stderr.write(stderr);
    throw new Error(`${label} for ${backend.python ?? backend.service} did not become ready`);
  }

  return {
    /** Start once; every caller awaits the same readiness. */
    ensure() {
      starting ??= start();
      return starting;
    },
    /** The backend process (`uv run …` or the Mastra service), once started. */
    get pid() {
      return child?.pid ?? null;
    },
    async close() {
      // `uv run` does not forward signals to the server it started, and the
      // server starts workers of its own: stop every process under uv, then
      // uv itself, and wait until all of them are gone.
      if (child?.pid && child.exitCode === null && child.signalCode === null) {
        const exited = new Promise((done) => child.once('exit', done));
        const tree = descendants(child.pid);
        signal(tree, 'SIGTERM');
        child.kill('SIGTERM');
        const timeout = setTimeout(() => {
          signal(tree, 'SIGKILL');
          child.kill('SIGKILL');
        }, 10_000);
        await exited;
        while (tree.some(alive)) await delay(25);
        clearTimeout(timeout);
      }
      await mock?.stop();
      if (database) rmSync(database, { recursive: true, force: true });
    },
  };
}
