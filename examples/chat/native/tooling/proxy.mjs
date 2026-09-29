import http from 'node:http';
import https from 'node:https';

// Validate before URL parsing silently normalizes dot segments or backslashes.
function safePath(path) {
  try {
    const decoded = decodeURIComponent(path);
    return (
      !/[\\\x00-\x20\x7f]/.test(decoded) &&
      !decoded.includes('//') &&
      !decoded.split('/').some((segment) => segment === '.' || segment === '..')
    );
  } catch {
    return false;
  }
}

export function readProxyConfiguration(env = {}) {
  const target = env.NATIVE_LANGGRAPH_URL;
  let url;
  try {
    url = new URL(target);
  } catch {
    /* Value-free diagnostic below. */
  }
  const rawPath =
    typeof target === 'string' ? target.replace(/^https?:\/\/[^/]+/, '') : '';
  if (
    !url ||
    !/^https?:\/\//.test(target) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    target.includes('?') ||
    target.includes('#') ||
    !safePath(rawPath) ||
    /[\s\\]/.test(target)
  )
    throw new Error(
      'Set NATIVE_LANGGRAPH_URL to an HTTP(S) upstream without credentials, query, fragment or dot segments.'
    );
  const apiKey = env.NATIVE_LANGGRAPH_API_KEY ?? '';
  if (typeof apiKey !== 'string' || /[^\x20-\x7e]/.test(apiKey))
    throw new Error(
      'NATIVE_LANGGRAPH_API_KEY must be a valid single-line header value.'
    );
  return { target, apiKey };
}

const requestHeaders = ['content-type', 'accept', 'last-event-id'];
const responseHeaders = [
  'content-type',
  'cache-control',
  'retry-after',
  'x-accel-buffering',
];
function failure(response, status, message) {
  if (response.destroyed) return;
  if (response.headersSent) {
    response.destroy();
    return;
  }
  response.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify({ error: message }));
}

// SDK 1.10 concatenates apiUrl + Location for reconnect. Return its API-root
// suffix, never a browser redirect or an upstream address.
function runtimeLocation(value, origin, basePath) {
  if (
    typeof value !== 'string' ||
    (!value.startsWith('/') && !/^https?:\/\//.test(value))
  )
    return;
  try {
    const absolute = /^https?:\/\//.test(value);
    const rawPath = (
      absolute ? value.replace(/^https?:\/\/[^/]+/, '') : value
    ).split('?')[0];
    if (!safePath(rawPath)) return;
    const url = new URL(value, origin);
    if (url.origin !== origin || url.username || url.password || url.hash)
      return;
    const path = url.pathname;
    const hasBase =
      basePath && (path === basePath || path.startsWith(basePath + '/'));
    if (absolute && basePath && !hasBase) return;
    const suffix = (hasBase ? path.slice(basePath.length) : path) || '/';
    if (!safePath(suffix)) return;
    return suffix + url.search;
  } catch {
    return;
  }
}

export async function startProxy({
  target,
  apiKey = '',
  port = 0,
  assets,
} = {}) {
  readProxyConfiguration({
    NATIVE_LANGGRAPH_URL: target,
    NATIVE_LANGGRAPH_API_KEY: apiKey,
  });
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error('Invalid proxy port.');
  const upstream = new URL(target);
  const basePath = upstream.pathname.replace(/\/$/, '');
  const transport = upstream.protocol === 'https:' ? https : http;
  const active = new Set();
  const sockets = new Set();
  // Snapshot the already verified allowlist. Caller mutation cannot change bytes
  // after this server starts; no request ever resolves a filesystem path.
  const staticAssets = new Map();
  for (const [path, asset] of assets ?? []) {
    if (
      !path.startsWith('/') ||
      !safePath(path) ||
      /[%?#]/.test(path) ||
      path === '/api' ||
      path.startsWith('/api/')
    )
      throw new Error('Invalid static asset route.');
    if (
      !Buffer.isBuffer(asset.bytes) ||
      typeof asset.contentType !== 'string' ||
      /[\r\n]/.test(asset.contentType)
    )
      throw new Error('Invalid static asset.');
    staticAssets.set(path, {
      bytes: Buffer.from(asset.bytes),
      contentType: asset.contentType,
    });
  }
  const server = http.createServer((incoming, outgoing) => {
    const raw = incoming.url ?? '';
    const queryAt = raw.indexOf('?');
    const path = queryAt < 0 ? raw : raw.slice(0, queryAt);
    const query = queryAt < 0 ? '' : raw.slice(queryAt);
    if (path !== '/api' && !path.startsWith('/api/')) {
      const asset = safePath(path) && staticAssets.get(path);
      if (asset) {
        if (!['GET', 'HEAD'].includes(incoming.method)) {
          failure(outgoing, 405, 'Static assets require GET or HEAD.');
          return;
        }
        outgoing.writeHead(200, {
          'content-type': asset.contentType,
          'content-length': asset.bytes.length,
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        });
        outgoing.end(incoming.method === 'HEAD' ? undefined : asset.bytes);
        return;
      }
      failure(outgoing, 404, 'This proxy only serves /api requests.');
      return;
    }
    if (!safePath(path)) {
      failure(outgoing, 400, 'Invalid API request path.');
      return;
    }
    const controller = new AbortController();
    active.add(controller);
    let upstreamResponse;
    const abort = () => {
      controller.abort();
      upstreamResponse?.destroy();
      active.delete(controller);
    };
    incoming.once('aborted', abort);
    incoming.once('error', abort);
    outgoing.once('close', abort);
    const headers = Object.fromEntries(
      requestHeaders
        .filter((name) => incoming.headers[name] !== undefined)
        .map((name) => [name, incoming.headers[name]])
    );
    if (apiKey) headers['x-api-key'] = apiKey;
    const request = transport.request(
      upstream,
      {
        method: incoming.method,
        path: (basePath + path.slice(4) || '/') + query,
        headers,
        signal: controller.signal,
        agent: false,
      },
      (response) => {
        upstreamResponse = response;
        const status = response.statusCode ?? 502;
        if (status >= 300 && status < 400) {
          failure(outgoing, 502, 'Upstream redirects are not supported.');
          response.destroy();
          return;
        }
        for (const name of responseHeaders)
          if (response.headers[name] !== undefined)
            outgoing.setHeader(name, response.headers[name]);
        if (status >= 400) {
          const message =
            status === 401 || status === 403
              ? 'Upstream authentication failed. Check the server configuration.'
              : status >= 500
              ? 'The upstream service is unavailable.'
              : 'The upstream service rejected this request.';
          failure(outgoing, status, message);
          response.destroy();
          return;
        }
        if (response.headers['content-encoding'])
          outgoing.setHeader(
            'content-encoding',
            response.headers['content-encoding']
          );
        for (const name of ['location', 'content-location']) {
          const value = runtimeLocation(
            response.headers[name],
            upstream.origin,
            basePath
          );
          if (value) outgoing.setHeader(name, value);
        }
        outgoing.writeHead(status);
        outgoing.flushHeaders();
        response.once('error', () => {
          outgoing.destroy();
          abort();
        });
        response.once('aborted', () => {
          outgoing.destroy();
          abort();
        });
        // Node piping bounds buffering and pauses on backpressure in both directions.
        response.pipe(outgoing);
      }
    );
    request.once('error', () => {
      if (!controller.signal.aborted)
        failure(outgoing, 502, 'Unable to reach the upstream service.');
      abort();
    });
    incoming.pipe(request);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
  } catch {
    server.close();
    for (const socket of sockets) socket.destroy();
    throw new Error('Unable to listen on the local proxy port.');
  }
  let closing;
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close() {
      return (closing ??= new Promise((resolve) => {
        server.close(resolve);
        for (const controller of active) controller.abort();
        for (const socket of sockets) socket.destroy();
      }));
    },
  };
}
