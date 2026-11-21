import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';
import { startAimock, type AimockHandle } from './aimock-runner';
import { resolveAimockLaunch } from './aimock-mode';

export interface CreateAgUiGlobalSetupOpts {
  /** Repo-relative path to the python ag-ui-langgraph project (contains src/server.py). */
  pythonCwd: string;
  /** Port the uvicorn AG-UI server binds. */
  backendPort: number;
  /** Nx project name of the Angular dev server. */
  angularProject: string;
  /** Port the Angular dev server should bind. */
  angularPort: number;
  /** Absolute path to the per-example fixtures dir. */
  fixturesDir: string;
  /** Default 90_000. */
  backendReadyTimeoutMs?: number;
  /** Default 120_000. */
  angularReadyTimeoutMs?: number;
}

interface SharedState {
  aimock: AimockHandle;
  /** Present when the backend is a langgraph dev server. */
  langgraph?: ChildProcess;
  langgraphPort?: number;
  /** Present when the backend is a uvicorn AG-UI server. */
  backend?: ChildProcess;
  backendPort?: number;
  /** Absent for backend-only setups (React cockpit serves its own build). */
  angular?: ChildProcess;
  angularPort?: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __AIMOCK_HARNESS_STATE__: Map<string, SharedState> | undefined;
}

async function waitForPort(url: string, timeoutMs: number, label: string): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) return;
    } catch {
      // server not up yet
    }
    await delay(500);
  }
  throw new Error(`[${label}] not ready at ${url} within ${timeoutMs}ms`);
}

function repoRoot(opts: CreateAgUiGlobalSetupOpts): string {
  // The factory is called from per-example playwright configs that themselves
  // live many levels deep. We compute REPO_ROOT relative to the fixturesDir
  // (which the consumer passes as an absolute path) so the consumer doesn't
  // need to pass it explicitly. The repo root is the nearest ancestor that
  // contains a `cockpit/` directory; for our layout, walking up from any
  // per-example fixturesDir hits the repo root in 5 levels.
  let dir = opts.fixturesDir;
  for (let i = 0; i < 10; i++) {
    if (require('node:fs').existsSync(require('node:path').join(dir, 'cockpit'))) {
      return dir;
    }
    dir = require('node:path').dirname(dir);
  }
  throw new Error('repo root not found from fixturesDir; passed: ' + opts.fixturesDir);
}

interface AgUiBackend {
  aimock: AimockHandle;
  backend: ChildProcess;
  backendPort: number;
}

/** aimock + the example's uvicorn AG-UI server (src/server.py), ready on /ok. */
async function startAgUiBackend(opts: {
  root: string;
  pythonCwd: string;
  backendPort: number;
  fixturesDir: string;
  backendReadyTimeoutMs?: number;
  aimockPort?: number;
}): Promise<AgUiBackend> {
  const launch = resolveAimockLaunch(opts.fixturesDir);
  const aimock = await startAimock(
    opts.aimockPort && launch.startOptions.mode === 'replay'
      ? { ...launch.startOptions, port: opts.aimockPort }
      : launch.startOptions,
  );
  // eslint-disable-next-line no-console
  console.log(`[ag-ui-harness] aimock listening at ${aimock.baseUrl}`);

  const backend = spawn(
    'uv',
    ['run', 'uvicorn', 'src.server:app', '--port', String(opts.backendPort)],
    {
      cwd: resolve(opts.root, opts.pythonCwd),
      env: {
        ...process.env,
        OPENAI_BASE_URL: aimock.baseUrl,
        OPENAI_API_KEY: launch.openaiApiKey,
      },
      stdio: 'pipe',
      // detached:true puts the process in its own group so teardown can
      // kill the whole tree (uv → python → uvicorn) via process.kill(-pid).
      // Without this, SIGTERM to `uv` doesn't propagate to the Python child
      // and the uvicorn server keeps holding the port through teardown.
      detached: true,
    },
  );
  backend.stdout?.on('data', (b) => process.stdout.write(`[ag-ui-backend] ${b}`));
  backend.stderr?.on('data', (b) => process.stderr.write(`[ag-ui-backend] ${b}`));

  await waitForPort(
    `http://localhost:${opts.backendPort}/ok`,
    opts.backendReadyTimeoutMs ?? 90_000,
    'ag-ui-backend',
  );
  // eslint-disable-next-line no-console
  console.log(`[ag-ui-harness] backend ready on :${opts.backendPort}`);
  return { aimock, backend, backendPort: opts.backendPort };
}

function registerState(key: string, state: SharedState): void {
  if (!globalThis.__AIMOCK_HARNESS_STATE__) {
    globalThis.__AIMOCK_HARNESS_STATE__ = new Map();
  }
  globalThis.__AIMOCK_HARNESS_STATE__.set(key, state);
}

export interface CreateAgUiBackendGlobalSetupOpts {
  /** Teardown state key, e.g. the React project name. */
  stateKey: string;
  pythonCwd: string;
  backendPort: number;
  fixturesDir: string;
  backendReadyTimeoutMs?: number;
  /** A fixed aimock port, for specs that read its request journal. */
  aimockPort?: number;
}

/** Backend only: the React cockpit serves its own build and proxies to it. */
export function createAgUiBackendGlobalSetup(
  opts: CreateAgUiBackendGlobalSetupOpts,
): () => Promise<void> {
  return async function globalSetup(): Promise<void> {
    const backend = await startAgUiBackend({
      root: repoRoot({ fixturesDir: opts.fixturesDir } as CreateAgUiGlobalSetupOpts),
      pythonCwd: opts.pythonCwd,
      backendPort: opts.backendPort,
      fixturesDir: opts.fixturesDir,
      backendReadyTimeoutMs: opts.backendReadyTimeoutMs,
      aimockPort: opts.aimockPort,
    });
    registerState(opts.stateKey, backend);
  };
}

export function createAgUiGlobalSetup(opts: CreateAgUiGlobalSetupOpts): () => Promise<void> {
  const angularTimeout = opts.angularReadyTimeoutMs ?? 120_000;

  return async function globalSetup(): Promise<void> {
    const root = repoRoot(opts);
    const backend = await startAgUiBackend({
      root,
      pythonCwd: opts.pythonCwd,
      backendPort: opts.backendPort,
      fixturesDir: opts.fixturesDir,
      backendReadyTimeoutMs: opts.backendReadyTimeoutMs,
    });

    const angular = spawn(
      'npx',
      ['nx', 'serve', opts.angularProject, '--port', String(opts.angularPort)],
      {
        cwd: root,
        env: { ...process.env },
        stdio: 'pipe',
        // Same rationale as backend: npx → nx → angular dev server is a
        // process tree; detached so teardown can kill the whole group.
        detached: true,
      },
    );
    angular.stdout?.on('data', (b) => process.stdout.write(`[angular] ${b}`));
    angular.stderr?.on('data', (b) => process.stderr.write(`[angular] ${b}`));

    await waitForPort(`http://localhost:${opts.angularPort}/`, angularTimeout, 'angular');
    // eslint-disable-next-line no-console
    console.log(`[ag-ui-harness] angular ready on :${opts.angularPort} (${opts.angularProject})`);

    registerState(opts.angularProject, {
      ...backend,
      angular,
      angularPort: opts.angularPort,
    });
  };
}
