/**
 * Serve one built cockpit Angular example for the Website control-plane suite.
 *
 * `ng serve` keeps a compiler, esbuild and a file watcher resident per app;
 * nine of them held about 10 GB on the 16 GB CI runner and pushed the suite
 * into swap. The suite only loads the apps, so CI builds them once and serves
 * the output from this process instead.
 *
 *   node scripts/website-angular-static.mjs <project> <port>
 *
 * Requests under the app's dev-server proxy prefixes answer 500, as the dev
 * server's proxy does when its backend is down: this suite starts no backend.
 */
import { createServer } from 'node:http';
import { readdirSync, readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

// Examples sit at cockpit/<product>/<topic>/angular; skip virtualenvs and deps.
function projectFiles(directory, depth = 0) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isFile() && entry.name === 'project.json')
      files.push(join(directory, entry.name));
    else if (
      entry.isDirectory() &&
      depth < 4 &&
      !entry.name.startsWith('.') &&
      !['node_modules', 'dist'].includes(entry.name)
    )
      files.push(...projectFiles(join(directory, entry.name), depth + 1));
  }
  return files;
}

/** Resolve a cockpit Angular project's build output and dev proxy prefixes. */
export async function resolveApp(project, workspace = root) {
  if (!/^cockpit-[a-z0-9-]+-angular$/.test(project))
    throw new Error(`Invalid Angular project ${project}`);
  const file = projectFiles(join(workspace, 'cockpit')).find(
    (candidate) => JSON.parse(readFileSync(candidate, 'utf8')).name === project
  );
  if (!file) throw new Error(`Unknown Angular project ${project}`);
  const targets = JSON.parse(readFileSync(file, 'utf8')).targets ?? {};
  const output = targets.build?.options?.outputPath;
  if (
    targets.build?.executor !== '@angular/build:application' ||
    !targets.build?.configurations?.cockpit ||
    !output ||
    typeof output.base !== 'string' ||
    typeof output.browser !== 'string'
  )
    throw new Error(`Unsupported Angular build for ${project}`);
  let prefixes = [];
  const proxy = targets.serve?.options?.proxyConfig;
  if (proxy) {
    const path = join(workspace, proxy);
    const config = proxy.endsWith('.json')
      ? JSON.parse(readFileSync(path, 'utf8'))
      : (await import(pathToFileURL(path).href)).default;
    prefixes = Object.keys(config);
  }
  return { directory: join(workspace, output.base, output.browser), prefixes };
}

/** Static files, SPA fallback for extensionless routes, 500 for proxy paths. */
export function createHandler({ directory, prefixes }) {
  const base = resolve(directory);
  return async (request, response) => {
    const send = (status, body, type = 'text/plain; charset=utf-8') => {
      response.writeHead(status, {
        'content-type': type,
        'cache-control': 'no-store',
      });
      response.end(request.method === 'HEAD' ? undefined : body);
    };
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, 'http://x').pathname);
    } catch {
      return send(400, 'Bad Request');
    }
    if (prefixes.some((prefix) => pathname.startsWith(prefix)))
      return send(500, '');
    if (request.method !== 'GET' && request.method !== 'HEAD')
      return send(405, 'Method Not Allowed');
    const target = resolve(base, `.${pathname}`);
    if (target !== base && !target.startsWith(base + sep))
      return send(404, 'Not Found');
    let file = target;
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      await stat(file);
    } catch {
      if (extname(pathname)) return send(404, 'Not Found');
      file = join(base, 'index.html');
    }
    try {
      const body = await readFile(file);
      send(200, body, types[extname(file)] ?? 'application/octet-stream');
    } catch {
      send(404, 'Not Found');
    }
  };
}

/** Listen on both loopback families, as `localhost` may resolve to either. */
export async function serve(handler, port) {
  const servers = [];
  for (const host of ['127.0.0.1', '::1']) {
    const server = createServer(handler);
    try {
      await new Promise((done, fail) => {
        server.once('error', fail);
        server.listen(port, host, done);
      });
      servers.push(server);
    } catch (error) {
      // A runner without IPv6 loopback still serves 127.0.0.1.
      if (host === '::1' && error.code === 'EADDRNOTAVAIL') continue;
      for (const open of servers) open.close();
      throw error;
    }
  }
  return servers;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [project, value] = process.argv.slice(2);
  const port = Number(value);
  try {
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error(`Invalid port ${value}`);
    const app = await resolveApp(project);
    await stat(join(app.directory, 'index.html'));
    await serve(createHandler(app), port);
  } catch (error) {
    console.error(`[Angular static] ${project}: ${error.message}`);
    process.exit(1);
  }
}
