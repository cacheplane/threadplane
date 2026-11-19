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

export function createAgUiGlobalSetup(opts: CreateAgUiGlobalSetupOpts): () => Promise<void> {
  const backendTimeout = opts.backendReadyTimeoutMs ?? 90_000;
  const angularTimeout = opts.angularReadyTimeoutMs ?? 120_000;

  return async function globalSetup(): Promise<void> {
    const root = repoRoot(opts);
    const launch = resolveAimockLaunch(opts.fixturesDir);
    const aimock = await startAimock(launch.startOptions);
    // eslint-disable-next-line no-console
    console.log(`[ag-ui-harness] aimock listening at ${aimock.baseUrl}`);

    const backend = spawn(
      'uv',
      ['run', 'uvicorn', 'src.server:app', '--port', String(opts.backendPort)],
      {
        cwd: resolve(root, opts.pythonCwd),
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

    await waitForPort(`http://localhost:${opts.backendPort}/ok`, backendTimeout, 'ag-ui-backend');
    // eslint-disable-next-line no-console
    console.log(`[ag-ui-harness] backend ready on :${opts.backendPort}`);

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

    if (!globalThis.__AIMOCK_HARNESS_STATE__) {
      globalThis.__AIMOCK_HARNESS_STATE__ = new Map();
    }
    globalThis.__AIMOCK_HARNESS_STATE__.set(opts.angularProject, {
      aimock,
      backend,
      backendPort: opts.backendPort,
      angular,
      angularPort: opts.angularPort,
    });
  };
}
