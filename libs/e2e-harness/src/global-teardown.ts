import type { ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:net';
import type { AimockHandle } from './aimock-runner';

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

/**
 * Returns true when the port can be BOUND (not merely connected to —
 * TIME_WAIT sockets refuse connections but still block fresh `bind()`
 * without SO_REUSEADDR, which is the check langgraph dev does on
 * startup). We mirror that check by trying a real bind+listen here.
 */
async function portBindable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => {
      server.close();
      resolve(false);
    });
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
}

async function waitForPortFree(port: number, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await portBindable(port)) return;
    await delay(500);
  }
  // Don't throw — teardown should be best-effort. The next run's
  // globalSetup will report a clearer error if the port is genuinely stuck.
}

/**
 * Default Playwright globalTeardown. Walks every state slot the factory
 * registered (one per Angular project), kills processes in reverse order
 * (Angular → langgraph → aimock), awaits aimock stop, then waits for the
 * langgraph and Angular ports to actually release. Idempotent.
 *
 * Port-release wait matters under `nx run-many --parallel=1` where the
 * NEXT per-example e2e starts moments after this teardown returns. Without
 * the wait, sequential runs race the OS's TCP TIME_WAIT cleanup and the
 * next setup hits EADDRINUSE.
 */
function killGroup(proc: ChildProcess): void {
  // The processes are spawned with detached: true, so each has its own
  // process group with pgid === pid. Signaling -pid hits the whole group
  // (parent + all descendants), which is needed because uv/npx wrap
  // actual long-lived servers (python/node) and don't forward signals
  // to children on their own.
  if (!proc.pid) return;
  try {
    process.kill(-proc.pid, 'SIGKILL');
  } catch {
    // Process group may already be gone; fall back to direct kill.
    try {
      proc.kill('SIGKILL');
    } catch {
      // already dead
    }
  }
}

export default async function globalTeardown(): Promise<void> {
  const states = globalThis.__AIMOCK_HARNESS_STATE__;
  if (!states) return;
  for (const state of states.values()) {
    if (state.angular) killGroup(state.angular);
    // Kill whichever backend variant is present (langgraph dev or uvicorn AG-UI).
    if (state.langgraph) killGroup(state.langgraph);
    if (state.backend) killGroup(state.backend);
    await state.aimock.stop();
    const portWaits: Promise<void>[] = [];
    if (state.angularPort != null) portWaits.push(waitForPortFree(state.angularPort));
    if (state.langgraphPort != null) portWaits.push(waitForPortFree(state.langgraphPort));
    if (state.backendPort != null) portWaits.push(waitForPortFree(state.backendPort));
    await Promise.all(portWaits);
  }
  globalThis.__AIMOCK_HARNESS_STATE__ = undefined;
}
