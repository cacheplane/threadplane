/**
 * Local e2e only: a thin recording + fault-injection proxy between the React
 * cockpit static server and a real `langgraph dev` that talks to aimock.
 *
 * The graph, the LangGraph HTTP/SSE wire and the model replies are all real
 * (aimock replays the per-prompt fixtures shared with the Angular example).
 * This layer only adds what a browser contract test needs and a live server
 * cannot produce on demand:
 *
 *   GET  /__requests          every /api and /developer-api request, in order
 *   GET  /__lifetime          { activeStream, activeHistory }
 *   POST /__reset             forget requests, drop held responses, clear modes
 *   POST /__fail-create       next thread creation answers 500 without forwarding
 *   POST /__history/<mode>    safe | hold | changed | missing | pending | failed
 *   POST /__release-history   finish a held history read
 *   POST /__hold/stream       hold the next run stream; body { afterText? }
 *   POST /__release           flush and resume a held run stream
 *
 * Nothing here is reachable from a production build: only
 * scripts/react-cockpit/serve.mjs imports it.
 */
import { request as httpRequest } from 'node:http';

const HISTORY_MODES = ['safe', 'hold', 'changed', 'missing', 'pending', 'failed'];
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-length', 'host']);

const json = (response, value, status = 200) => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
};

function upstreamHeaders(headers, length) {
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP.has(name.toLowerCase())) out[name] = value;
  }
  if (length !== undefined) out['content-length'] = String(length);
  return out;
}

function forwardedHeaders(headers) {
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP.has(name.toLowerCase())) out[name] = value;
  }
  return out;
}

/** Text of an AI message chunk carried by a LangGraph `messages` SSE event. */
function aiText(rawEvent) {
  const name = /^event: *(.*)$/m.exec(rawEvent)?.[1]?.trim() ?? '';
  if (!name.startsWith('messages')) return null;
  const data = rawEvent
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''))
    .join('\n');
  try {
    const value = JSON.parse(data);
    const message = Array.isArray(value) ? value[0] : null;
    if (!message || !String(message.type ?? '').startsWith('AI')) return null;
    return typeof message.content === 'string' ? message.content : '';
  } catch {
    return null;
  }
}

export function createLanggraphProxy({ upstream }) {
  const target = new URL(upstream);
  let requests = [];
  let failCreate = false;
  let historyMode = 'safe';
  let holdNextStream = null;
  let heldStream;
  let heldHistory;

  function reset() {
    heldStream?.response.destroy();
    heldHistory?.response.destroy();
    heldStream = heldHistory = undefined;
    requests = [];
    failCreate = false;
    historyMode = 'safe';
    holdNextStream = null;
  }

  function send(method, path, headers, body) {
    return new Promise((resolve, reject) => {
      const outgoing = httpRequest(
        {
          hostname: target.hostname,
          port: target.port,
          method,
          path,
          headers: upstreamHeaders(headers, body.length),
        },
        resolve,
      );
      outgoing.once('error', reject);
      outgoing.end(body);
    });
  }

  async function readAll(stream) {
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
  }

  function transformHistory(states) {
    if (!Array.isArray(states) || states.length === 0) return states;
    const [latest, ...rest] = states;
    let messages = latest.values?.messages ?? [];
    if (historyMode === 'changed')
      messages = messages.map((m, i) =>
        i === messages.length - 1 ? { ...m, content: 'Changed saved answer' } : m,
      );
    if (historyMode === 'missing') messages = messages.slice(0, -1);
    return [
      {
        ...latest,
        values: { ...latest.values, messages },
        next: historyMode === 'pending' ? ['generate'] : latest.next,
      },
      ...rest,
    ];
  }

  async function proxyHistory(request, response, path, body) {
    if (historyMode === 'failed') {
      json(response, { error: 'PRIVATE history' }, 500);
      return;
    }
    const upstreamResponse = await send(request.method, path, request.headers, body);
    const raw = await readAll(upstreamResponse);
    const finish = () => {
      if (response.destroyed) return;
      if (upstreamResponse.statusCode !== 200) {
        response.writeHead(upstreamResponse.statusCode, forwardedHeaders(upstreamResponse.headers));
        response.end(raw);
        return;
      }
      json(response, transformHistory(JSON.parse(raw.toString('utf8'))));
    };
    if (historyMode !== 'hold') return finish();
    const held = { response, finish };
    heldHistory = held;
    response.on('close', () => {
      if (heldHistory === held) heldHistory = undefined;
    });
  }

  async function proxyStream(request, response, path, body) {
    const hold = holdNextStream;
    holdNextStream = null;
    const upstreamResponse = await send(request.method, path, request.headers, body);
    response.writeHead(upstreamResponse.statusCode, forwardedHeaders(upstreamResponse.headers));
    response.flushHeaders();
    const abort = () => upstreamResponse.destroy();
    response.on('close', abort);
    if (!hold) {
      upstreamResponse.pipe(response);
      return;
    }
    // Forward whole SSE events until the hold condition is met, then buffer.
    let pending = '';
    let text = '';
    let holding = false;
    let armed = true;
    const buffered = [];
    const held = {
      response,
      release() {
        if (heldStream === held) heldStream = undefined;
        holding = false;
        for (const chunk of buffered.splice(0)) response.write(chunk);
        if (upstreamResponse.readableEnded) response.end();
      },
    };
    upstreamResponse.setEncoding('utf8');
    upstreamResponse.on('data', (chunk) => {
      if (holding) return void buffered.push(chunk);
      pending += chunk;
      let match;
      while (!holding && (match = /\r?\n\r?\n/.exec(pending))) {
        const end = match.index + match[0].length;
        const raw = pending.slice(0, end);
        pending = pending.slice(end);
        response.write(raw);
        const delta = aiText(raw);
        if (delta === null) continue;
        text += delta;
        if (armed && delta && (!hold.afterText || text.includes(hold.afterText))) {
          armed = false;
          holding = true;
          heldStream = held;
        }
      }
      if (holding && pending) {
        buffered.push(pending);
        pending = '';
      }
    });
    upstreamResponse.on('end', () => {
      if (holding) return;
      if (pending) response.write(pending);
      response.end();
    });
    response.on('close', () => {
      if (heldStream === held) heldStream = undefined;
    });
  }

  const controls = {
    '/__requests': ['GET', () => requests],
    '/__lifetime': ['GET', () => ({ activeStream: Boolean(heldStream), activeHistory: Boolean(heldHistory) })],
    '/__reset': ['POST', () => { reset(); return {}; }],
    '/__fail-create': ['POST', () => { failCreate = true; return {}; }],
    '/__release': ['POST', () => { heldStream?.release(); return {}; }],
    '/__release-history': ['POST', () => {
      const held = heldHistory;
      heldHistory = undefined;
      held?.finish();
      return {};
    }],
    '/__hold/stream': ['POST', (body) => { holdNextStream = { afterText: body.afterText ?? null }; return {}; }],
  };

  return async function handle(request, response, pathname) {
    if (pathname.startsWith('/__history/')) {
      const mode = pathname.slice('/__history/'.length);
      if (!HISTORY_MODES.includes(mode)) json(response, {}, 400);
      else {
        historyMode = mode;
        json(response, {});
      }
      return true;
    }
    if (Object.hasOwn(controls, pathname)) {
      const [method, run] = controls[pathname];
      if (request.method !== method) {
        json(response, {}, 405);
        return true;
      }
      const raw = (await readAll(request)).toString('utf8');
      json(response, await run(raw ? JSON.parse(raw) : {}));
      return true;
    }
    const prefix = pathname.startsWith('/api/')
      ? '/api'
      : pathname.startsWith('/developer-api/')
        ? '/developer-api'
        : null;
    if (!prefix) return false;

    const body = await readAll(request);
    const search = new URL(request.url, 'http://localhost').search;
    const path = pathname.slice(prefix.length) + search;
    requests.push({
      path: pathname,
      method: request.method,
      body: body.length ? JSON.parse(body.toString('utf8')) : {},
      key: request.headers['x-api-key'] ?? null,
    });
    try {
      if (request.method === 'POST' && /^\/threads\/?$/.test(pathname.slice(prefix.length))) {
        if (failCreate) {
          failCreate = false;
          json(response, { error: 'PRIVATE creation' }, 500);
          return true;
        }
      }
      if (request.method === 'POST' && /\/threads\/[^/]+\/history$/.test(pathname))
        await proxyHistory(request, response, path, body);
      else if (request.method === 'POST' && /\/runs\/stream$/.test(pathname))
        await proxyStream(request, response, path, body);
      else {
        const upstreamResponse = await send(request.method, path, request.headers, body);
        response.writeHead(upstreamResponse.statusCode, forwardedHeaders(upstreamResponse.headers));
        upstreamResponse.pipe(response);
      }
    } catch {
      if (!response.headersSent) json(response, { error: 'LangGraph upstream unavailable' }, 502);
      else response.destroy();
    }
    return true;
  };
}
