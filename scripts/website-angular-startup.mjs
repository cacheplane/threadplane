import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// Each redirect and the index fallback share the original request deadline.
async function available(url, deadline, redirects = 0, fallback = true) {
  if (redirects > 10 || Date.now() >= deadline) return false;
  const response = await new Promise((done) => {
    const request = (url.protocol === 'https:' ? https : http).get(
      url,
      (res) => {
        res.resume();
        done({ status: res.statusCode, location: res.headers.location });
      }
    );
    const timer = setTimeout(
      () => request.destroy(),
      Math.max(1, deadline - Date.now())
    );
    request.on('close', () => clearTimeout(timer));
    request.on('error', () => done(null));
  });
  if (!response) return false;
  if (response.status >= 300 && response.status < 400 && response.location) {
    try {
      return await available(
        new URL(response.location, url),
        deadline,
        redirects + 1,
        fallback
      );
    } catch {
      return false;
    }
  }
  if (response.status >= 200 && response.status <= 403) return true;
  if (response.status === 404 && url.pathname === '/' && fallback) {
    return available(new URL('/index.html', url), deadline, redirects, false);
  }
  return false;
}

/** Run only inside an owned Unix process group; children inherit that group. */
export async function runPool(
  entries,
  {
    shutdownGraceMs = 10_000,
    poolLabel = 'Angular pool',
    readyMessage = 'Website Angular servers ready',
  } = {}
) {
  if (
    process.platform === 'win32' ||
    Number(
      execFileSync('ps', ['-o', 'pgid=', '-p', String(process.pid)], {
        encoding: 'utf8',
      }).trim()
    ) !== process.pid
  ) {
    throw new Error(
      `${poolLabel.replace(
        / pool$/,
        ''
      )} startup requires its own Unix process group`
    );
  }
  let stopping = false;
  const started = Date.now();
  const shutdown = (reason) => {
    if (stopping) return;
    stopping = true;
    console.error(`[${poolLabel}] ${reason}`);
    // Keep the leader alive until escalation: descendants can outlive their Nx parent.
    setTimeout(() => process.kill(-process.pid, 'SIGKILL'), shutdownGraceMs);
    process.kill(-process.pid, 'SIGTERM');
  };
  process.on('SIGTERM', () => shutdown('received SIGTERM'));
  process.on('SIGINT', () => shutdown('received SIGINT'));
  try {
    for (const entry of entries) {
      if (await available(new URL(entry.url), Date.now() + 1000))
        throw new Error(`${entry.url} already available`);
      if (stopping) return;
    }
    let next = 0;
    async function worker() {
      while (!stopping && next < entries.length) {
        const entry = entries[next++];
        const launched = Date.now();
        const deadline = launched + (entry.timeout ?? 60_000);
        const label = `${entry.name ?? entry.command} (${
          new URL(entry.url).port
        })`;
        const child = spawn(entry.command, entry.args ?? [], {
          cwd: entry.cwd,
          env: entry.env ?? process.env,
          detached: false,
          stdio: ['ignore', 'inherit', 'inherit'],
        });
        child.on('error', (error) => shutdown(`${label}: ${error.message}`));
        child.on('exit', (code, signal) =>
          shutdown(`${label} exited (code ${code}, signal ${signal})`)
        );
        while (!stopping) {
          if (Date.now() >= deadline) {
            shutdown(`${label} timed out after ${entry.timeout ?? 60_000}ms`);
            return;
          }
          if (await available(new URL(entry.url), deadline)) {
            if (stopping) return;
            console.error(
              `[${poolLabel}] ${label} ready in ${
                Date.now() - launched
              }ms; pool ${Date.now() - started}ms`
            );
            break;
          }
          await sleep(Math.min(100, Math.max(0, deadline - Date.now())));
        }
      }
    }
    await Promise.all([worker(), worker()]);
    if (!stopping) {
      console.error(
        `[${poolLabel}] all servers ready in ${Date.now() - started}ms`
      );
      console.log(readyMessage);
    }
  } catch (error) {
    shutdown(error.message);
  }
}

export function parseServers(value) {
  const servers = JSON.parse(value ?? 'null');
  if (!Array.isArray(servers) || servers.length === 0)
    throw new Error('Invalid Angular server manifest');
  return servers.map((server) => {
    const invalid = () => {
      throw new Error(
        `Invalid Angular server descriptor: ${JSON.stringify(server)}`
      );
    };
    if (
      !server ||
      typeof server !== 'object' ||
      Object.keys(server).some(
        (key) =>
          !['command', 'cwd', 'url', 'reuseExistingServer', 'timeout'].includes(
            key
          )
      )
    )
      invalid();
    const match =
      /^npx nx run (cockpit-[a-z0-9-]+-angular:serve:cockpit) --port (\d+)$/.exec(
        server.command
      );
    let url;
    try {
      url = new URL(server.url);
    } catch {
      invalid();
    }
    if (
      !match ||
      server.cwd !== '../..' ||
      server.reuseExistingServer !== false ||
      url.protocol !== 'http:' ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username ||
      url.password ||
      Number(url.port) !== Number(match[2]) ||
      Number(match[2]) < 1 ||
      Number(match[2]) > 65535 ||
      (server.timeout !== undefined &&
        (!Number.isFinite(server.timeout) || server.timeout <= 0))
    )
      invalid();
    return {
      command: 'npx',
      args: ['nx', 'run', match[1], '--port', match[2]],
      cwd: resolve(fileURLToPath(new URL('..', import.meta.url))),
      url: server.url,
      timeout: server.timeout ?? 60_000,
      name: match[1],
    };
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await runPool(parseServers(process.env.WEBSITE_ANGULAR_SERVERS));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
