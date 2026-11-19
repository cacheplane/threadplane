/**
 * Local e2e only: aimock + a real `langgraph dev` for one aimock-backed React
 * cockpit example, owned by `serve.mjs --backend`.
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
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { LLMock } from 'aimock';

export function createAimockBackend({ root, backend }) {
  let starting;
  let mock;
  let child;
  let stderr = '';

  async function start() {
    const dir = resolve(root, backend.fixtures);
    const fixtures = readdirSync(dir)
      .filter((file) => file.endsWith('.json'))
      .sort()
      .flatMap((file) => JSON.parse(readFileSync(join(dir, file), 'utf8')).fixtures);
    // Same replay defaults as libs/e2e-harness/src/aimock-runner.ts.
    mock = new LLMock({ port: 0, chunkSize: 4096 });
    mock.addFixturesFromJSON(fixtures);
    await mock.start();
    child = spawn(
      'uv',
      ['run', 'langgraph', 'dev', '--port', String(backend.langgraphPort), '--no-browser'],
      {
        cwd: resolve(root, backend.python),
        env: {
          ...process.env,
          OPENAI_BASE_URL: `${mock.url}/v1`,
          OPENAI_API_KEY: 'test-not-used',
          LANGSMITH_TRACING: 'false',
        },
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
        if ((await fetch(`http://127.0.0.1:${backend.langgraphPort}/ok`)).ok) return;
      } catch {
        // not listening yet
      }
      await delay(500);
    }
    process.stderr.write(stderr);
    throw new Error(`langgraph dev for ${backend.python} did not become ready`);
  }

  return {
    /** Start once; every caller awaits the same readiness. */
    ensure() {
      starting ??= start();
      return starting;
    },
    async close() {
      // `uv run` does not forward signals to the server it started: stop the
      // server processes under it first, then uv itself.
      if (child?.pid && child.exitCode === null) {
        try {
          execFileSync('pkill', ['-TERM', '-P', String(child.pid)]);
        } catch {
          // no children left
        }
        child.kill('SIGTERM');
      }
      await mock?.stop();
    },
  };
}
