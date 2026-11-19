#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const DEFAULT_PORT = 4300;
const SERVER_READY_TIMEOUT_MS = 60_000;
const COMPATIBILITY_PACKAGES = [
  'ag-ui',
  'chat',
  'langgraph',
  'render',
  'telemetry',
];

function parseRuntimeArgs(argv) {
  const options = { port: DEFAULT_PORT, target: undefined };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const readValue = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${arg} requires a value`);
      }
      index += 1;
      return value;
    };

    if (arg === '--target') options.target = resolve(readValue());
    else if (arg === '--port') {
      const port = Number(readValue());
      if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new Error('--port must be an integer between 1 and 65535');
      }
      options.port = port;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.target) throw new Error('--target is required');
  return options;
}

function getServerArgs(port) {
  return [
    'run',
    'start',
    '--',
    '--configuration',
    'production',
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
  ];
}

function startServer(target, port) {
  const child = spawn('npm', getServerArgs(port), {
    cwd: target,
    detached: process.platform !== 'win32',
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let exitError;
  const append = (chunk) => {
    output += chunk.toString();
  };

  child.stdout.on('data', append);
  child.stderr.on('data', append);
  child.on('error', (error) => {
    exitError = error;
  });
  child.on('close', (code, signal) => {
    exitError ??= new Error(
      `Consumer server exited before runtime smoke completed (code ${code}, signal ${
        signal ?? 'none'
      }).`
    );
  });

  return {
    child,
    getError: () => exitError,
    getOutput: () => output,
  };
}

function assertPortAvailable(port, { createServerFn = createServer } = {}) {
  return new Promise((resolvePort, rejectPort) => {
    const probe = createServerFn();
    probe.once('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        rejectPort(
          new Error(
            `Port ${port} is already in use; free port ${port} before retrying runtime smoke.`,
            { cause: error }
          )
        );
      } else {
        rejectPort(error);
      }
    });
    probe.listen(port, '127.0.0.1', () => {
      probe.close((error) => {
        if (error) rejectPort(error);
        else resolvePort();
      });
    });
  });
}

async function waitForServer(
  url,
  server,
  {
    fetchImpl = fetch,
    timeoutMs = SERVER_READY_TIMEOUT_MS,
    requestTimeoutMs = 1_000,
    sleep = (delay) =>
      new Promise((resolveDelay) => setTimeout(resolveDelay, delay)),
  } = {}
) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    if (server.getError()) throw server.getError();
    const controller = new AbortController();
    const remainingMs = deadline - Date.now();
    const abortTimer = setTimeout(
      () => controller.abort(),
      Math.min(requestTimeoutMs, remainingMs)
    );
    let response;
    try {
      response = await fetchImpl(url, { signal: controller.signal });
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(abortTimer);
    }
    if (server.getError()) throw server.getError();
    if (response?.ok) return;
    if (response)
      lastError = new Error(`Server responded with ${response.status}`);
    await sleep(Math.min(250, Math.max(0, deadline - Date.now())));
  }

  throw new Error(
    `Timed out waiting ${timeoutMs / 1000}s for ${url}${
      lastError ? `: ${lastError.message}` : ''
    }`
  );
}

function throwIfServerExited(server) {
  const error = server.getError();
  if (error) throw error;
}

function hasExited(child) {
  return child.exitCode != null || child.signalCode != null;
}

function waitForChildClose(child, { graceMs, setTimeoutFn, clearTimeoutFn }) {
  if (hasExited(child)) return Promise.resolve(true);

  return new Promise((resolveClose) => {
    const finish = (closed) => {
      clearTimeoutFn(timer);
      child.removeListener?.('close', onClose);
      resolveClose(closed);
    };
    const onClose = () => finish(true);

    child.once('close', onClose);
    const timer = setTimeoutFn(() => finish(false), graceMs);
  });
}

function signalProcessGroup(processRef, pid, signal) {
  try {
    processRef.kill(-pid, signal);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

function isProcessGroupAlive(processRef, pid) {
  try {
    processRef.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

async function waitForProcessGroupGone(
  pid,
  { processRef, graceMs, setTimeoutFn, now = Date.now }
) {
  const deadline = now() + graceMs;

  while (isProcessGroupAlive(processRef, pid)) {
    const remainingMs = deadline - now();
    if (remainingMs <= 0) return false;
    await new Promise((resolvePoll) =>
      setTimeoutFn(resolvePoll, Math.min(100, remainingMs))
    );
  }

  return true;
}

function taskkill(pid, spawnFn) {
  return new Promise((resolveTaskkill, rejectTaskkill) => {
    let child;
    try {
      child = spawnFn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
      });
    } catch (error) {
      rejectTaskkill(error);
      return;
    }
    child.once('error', rejectTaskkill);
    child.once('close', (code) => {
      if (code === 0) resolveTaskkill();
      else rejectTaskkill(new Error(`taskkill exited ${code}`));
    });
  });
}

async function terminateServer(
  child,
  {
    platform = process.platform,
    processRef = process,
    spawnFn = spawn,
    graceMs = 5_000,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  } = {}
) {
  if (!child?.pid) return;
  const timing = { graceMs, setTimeoutFn, clearTimeoutFn };

  if (platform === 'win32') {
    if (hasExited(child)) return;
    await taskkill(child.pid, spawnFn);
    if (!(await waitForChildClose(child, timing))) {
      throw new Error(
        `Server process ${child.pid} did not close after taskkill`
      );
    }
    return;
  }

  const groupTiming = { processRef, graceMs, setTimeoutFn };
  if (!isProcessGroupAlive(processRef, child.pid)) return;
  if (!signalProcessGroup(processRef, child.pid, 'SIGTERM')) return;
  if (await waitForProcessGroupGone(child.pid, groupTiming)) return;
  if (!signalProcessGroup(processRef, child.pid, 'SIGKILL')) return;
  if (!(await waitForProcessGroupGone(child.pid, groupTiming))) {
    throw new Error(
      `Server process group ${child.pid} did not close after SIGKILL`
    );
  }
}

function createBackendRouteController() {
  let unexpectedError;
  let resolveFailure;
  const failure = new Promise((resolveFailurePromise) => {
    resolveFailure = resolveFailurePromise;
  });
  const recordFailure = (error) => {
    unexpectedError ??= error;
    resolveFailure(unexpectedError);
  };
  const errorMessage = (error) =>
    error instanceof Error ? error.message : String(error);
  const abortSafely = async (route, error) => {
    try {
      await route.abort('failed');
    } catch (abortError) {
      error.message += `\nFallback route abort failed: ${errorMessage(
        abortError
      )}`;
    }
  };

  return {
    async handle(route) {
      let method = 'unknown';
      let pathname = 'unknown';
      try {
        const request = route.request();
        method = request.method();
        pathname = new URL(request.url()).pathname;
        if (method === 'POST' && pathname.endsWith('/threads/search')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: '[]',
          });
          return;
        }
        if (method === 'POST' && pathname.endsWith('/store/items/search')) {
          // LangGraphThreadsAdapter loads project names after the thread list.
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: '{"items":[]}',
          });
          return;
        }
        if (method === 'POST' && pathname.endsWith('/ingest')) {
          await route.fulfill({ status: 204, body: '' });
          return;
        }

        const error = new Error(
          `Unexpected backend request during compatibility smoke: ${method} ${pathname}`
        );
        await abortSafely(route, error);
        recordFailure(error);
      } catch (error) {
        const routeError = new Error(
          `Failed handling backend route ${method} ${pathname}: ${errorMessage(
            error
          )}`,
          { cause: error }
        );
        await abortSafely(route, routeError);
        recordFailure(routeError);
      }
    },
    throwIfRecorded() {
      if (unexpectedError) throw unexpectedError;
    },
    waitForFailure() {
      return failure.then((error) => Promise.reject(error));
    },
  };
}

async function assertCompatibilityMarkers(
  page,
  packages = COMPATIBILITY_PACKAGES
) {
  for (const packageName of packages) {
    const marker = page.locator(
      `[data-threadplane-compatibility="${packageName}"]`
    );
    await marker.waitFor();
    const markerText = await marker.innerText();
    const expectedText =
      packageName === 'ag-ui' ? 'AG-UI ready' : `${packageName} ready`;
    if (markerText !== expectedText) {
      throw new Error(
        `${packageName} compatibility probe reported "${markerText}"`
      );
    }
  }
}

async function finalizeRuntimeSmoke({
  primaryError,
  serverOutput = '',
  captureScreenshot,
  stopTracing,
  closeBrowser,
  terminateServer: stopServer,
}) {
  const cleanupErrors = [];
  const attempt = async (cleanup) => {
    if (!cleanup) return;
    try {
      await cleanup();
    } catch (error) {
      cleanupErrors.push(error);
    }
  };

  if (primaryError) await attempt(captureScreenshot);
  await attempt(stopTracing);
  await attempt(closeBrowser);
  await attempt(stopServer);

  if (primaryError) {
    const cleanupDetails = cleanupErrors.length
      ? `\n\nRuntime smoke cleanup errors:\n${cleanupErrors
          .map((error) => `- ${error.message}`)
          .join('\n')}`
      : '';
    throw new Error(
      `${primaryError.message}\n\nConsumer server output:\n${serverOutput}${cleanupDetails}`,
      { cause: primaryError }
    );
  }

  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, 'Runtime smoke cleanup failed.');
  }
}

async function runRuntimeSmoke(options) {
  const baseUrl = `http://127.0.0.1:${options.port}`;
  const artifactPath = (filename) => join(options.target, filename);
  await assertPortAvailable(options.port);
  const server = startServer(options.target, options.port);
  let browser;
  let context;
  let page;
  let tracing = false;
  let primaryError;

  try {
    await waitForServer(`${baseUrl}/embed`, server);
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext();
    page = await context.newPage();
    await context.tracing.start({ screenshots: true, snapshots: true });
    tracing = true;

    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    const routeController = createBackendRouteController();
    await page.route('**/api/**', (route) => routeController.handle(route));

    await Promise.race([
      (async () => {
        await page.goto(`${baseUrl}/embed`, { waitUntil: 'networkidle' });
        await page.getByRole('heading', { name: 'How can I help?' }).waitFor();
        await page.locator('textarea, input').first().waitFor();
        await page.locator('chat-welcome-suggestion').first().waitFor();

        await assertCompatibilityMarkers(page);
        routeController.throwIfRecorded();

        if (pageErrors.length > 0) {
          throw new Error(
            `Page errors during compatibility smoke:\n${pageErrors
              .map(String)
              .join('\n')}`
          );
        }
        if (consoleErrors.length > 0) {
          throw new Error(
            `Console errors during compatibility smoke:\n${consoleErrors.join(
              '\n'
            )}`
          );
        }
      })(),
      routeController.waitForFailure(),
    ]);
    throwIfServerExited(server);
  } catch (error) {
    primaryError = error;
  } finally {
    await finalizeRuntimeSmoke({
      primaryError,
      serverOutput: server.getOutput(),
      captureScreenshot:
        primaryError && page
          ? () => page.screenshot({ path: artifactPath('runtime-smoke.png') })
          : undefined,
      stopTracing: tracing
        ? () =>
            context.tracing.stop(
              primaryError
                ? { path: artifactPath('runtime-smoke-trace.zip') }
                : undefined
            )
        : undefined,
      closeBrowser: browser ? () => browser.close() : undefined,
      terminateServer: () => terminateServer(server.child),
    });
  }
}

async function main() {
  await runRuntimeSmoke(parseRuntimeArgs(process.argv.slice(2)));
}

export {
  assertPortAvailable,
  assertCompatibilityMarkers,
  COMPATIBILITY_PACKAGES,
  createBackendRouteController,
  finalizeRuntimeSmoke,
  getServerArgs,
  parseRuntimeArgs,
  terminateServer,
  throwIfServerExited,
  waitForServer,
};

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  main().catch((error) => {
    console.error(`\n✖ Runtime smoke failed: ${error.message}`);
    process.exitCode = 1;
  });
}
