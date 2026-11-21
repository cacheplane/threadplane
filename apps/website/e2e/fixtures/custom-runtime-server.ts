import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import {
  renderRuntimeBridgeFrame,
  type RuntimeBridgeFault,
} from './runtime-bridge-frame';

const HOST = '127.0.0.1';
const PORT = 4399;
const POISON = 'test-key-redact-me-poison-body';
const FIXTURE_KEY_BYTES = Buffer.from('test-key-redact-me');
const allowedRuntimeOrigins = new Set([
  'http://localhost:4300',
  'http://localhost:4321',
  'http://localhost:4506',
]);

interface SanitizedRequestRecord {
  readonly origin: string | null;
  readonly headerNames: readonly string[];
  readonly keyMatched: boolean;
}

const requestsByCase = new Map<string, SanitizedRequestRecord[]>();
let bfcacheObservation: {
  persisted: boolean;
  targetKind: 'shared' | 'other';
  privacy: 'clean' | 'dirty';
} | null = null;

function sanitizedHeaderNames(request: IncomingMessage): readonly string[] {
  return Object.freeze(
    Object.keys(request.headers)
      .map((name) => name.toLowerCase())
      .filter((name) => /^[a-z0-9-]{1,64}$/.test(name))
      .sort()
  );
}

function requestKeyMatched(request: IncomingMessage): boolean {
  const candidate = request.headers['x-api-key'];
  if (typeof candidate !== 'string') return false;
  const candidateBytes = Buffer.from(candidate);
  if (candidateBytes.length !== FIXTURE_KEY_BYTES.length) return false;
  return timingSafeEqual(candidateBytes, FIXTURE_KEY_BYTES);
}

function recordRequest(
  request: IncomingMessage,
  keyMatched: boolean,
  caseId: string
): void {
  const requests = requestsByCase.get(caseId) ?? [];
  requests.push(
    Object.freeze({
      origin:
        typeof request.headers.origin === 'string'
          ? request.headers.origin
          : null,
      headerNames: sanitizedHeaderNames(request),
      keyMatched,
    })
  );
  while (requests.length > 100) requests.shift();
  requestsByCase.set(caseId, requests);
}

function runtimeCase(
  url: URL
): { readonly caseId: string; readonly pathname: string } | null {
  const match = url.pathname.match(
    /^\/case\/([a-z0-9-]{1,80})(\/(?:ag-ui|langgraph)\/.*)$/
  );
  return match === null ? null : { caseId: match[1], pathname: match[2] };
}

function applyCors(
  request: IncomingMessage,
  response: ServerResponse
): boolean {
  const origin = request.headers.origin;
  if (typeof origin !== 'string' || !allowedRuntimeOrigins.has(origin)) {
    return false;
  }
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader(
    'Access-Control-Allow-Methods',
    'GET, POST, PATCH, OPTIONS'
  );
  response.setHeader(
    'Access-Control-Allow-Headers',
    'content-type, x-api-key, authorization, last-event-id'
  );
  response.setHeader('Access-Control-Expose-Headers', 'content-location');
  response.setHeader('Vary', 'Origin');
  return true;
}

function writeJson(
  response: ServerResponse,
  status: number,
  value: unknown
): void {
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(value));
}

function writePoisonFailure(response: ServerResponse, status: 401 | 403): void {
  writeJson(response, status, { error: POISON, authorization: POISON });
}

/**
 * The run identity an AG-UI request names. A conforming server echoes the
 * request's `threadId` and `runId` in RUN_STARTED and RUN_FINISHED, and the
 * session rejects a run that names another one.
 */
function agUiRunIdentity(body: string): { threadId: string; runId: string } {
  try {
    const input = JSON.parse(body) as { threadId?: unknown; runId?: unknown };
    if (typeof input.threadId === 'string' && typeof input.runId === 'string')
      return { threadId: input.threadId, runId: input.runId };
  } catch {
    // Not a run request; fall back to the fixture's own identity.
  }
  return { threadId: 'fixture-thread', runId: 'fixture-run' };
}

function writeAgUiSuccess(
  response: ServerResponse,
  { threadId, runId }: { threadId: string; runId: string }
): void {
  const messageId = 'fixture-assistant';
  const events = [
    { type: 'RUN_STARTED', threadId, runId },
    {
      type: 'TEXT_MESSAGE_START',
      messageId,
      role: 'assistant',
    },
    {
      type: 'TEXT_MESSAGE_CONTENT',
      messageId,
      delta: 'Custom AG-UI success',
    },
    { type: 'TEXT_MESSAGE_END', messageId },
    { type: 'RUN_FINISHED', threadId, runId },
  ];
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  });
  for (const event of events)
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  response.end();
}

function writeLangGraphSuccess(response: ServerResponse): void {
  const message = {
    id: 'fixture-langgraph-assistant',
    type: 'ai',
    content: 'Custom LangSmith success',
  };
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'Content-Location': '/threads/fixture-thread/runs/fixture-run',
  });
  response.write(
    `event: messages\ndata: ${JSON.stringify([
      message,
      { langgraph_node: 'fixture' },
    ])}\n\n`
  );
  response.write(
    `event: values\ndata: ${JSON.stringify({ messages: [message] })}\n\n`
  );
  response.end();
}

function behavior(
  pathname: string
):
  | 'success'
  | 'unauthorized'
  | 'forbidden'
  | 'cors'
  | 'delayed'
  | 'delayed-unauthorized' {
  if (pathname.includes('/delayed-unauthorized')) return 'delayed-unauthorized';
  if (pathname.includes('/unauthorized')) return 'unauthorized';
  if (pathname.includes('/forbidden')) return 'forbidden';
  if (pathname.includes('/cors')) return 'cors';
  if (pathname.includes('/delayed')) return 'delayed';
  return 'success';
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${HOST}:${PORT}`);
  if (url.pathname === '/health') return writeJson(response, 200, { ok: true });
  const requestLogMatch = url.pathname.match(
    /^\/__requests\/([a-z0-9-]{1,80})$/
  );
  if (requestLogMatch && request.method === 'GET') {
    return writeJson(response, 200, requestsByCase.get(requestLogMatch[1]) ?? []);
  }
  if (requestLogMatch && request.method === 'DELETE') {
    requestsByCase.delete(requestLogMatch[1]);
    response.writeHead(204, { 'Cache-Control': 'no-store' });
    return response.end();
  }
  if (url.pathname === '/__bfcache' && request.method === 'GET') {
    return writeJson(response, 200, bfcacheObservation);
  }
  if (url.pathname === '/__bfcache' && request.method === 'DELETE') {
    bfcacheObservation = null;
    response.writeHead(204, { 'Cache-Control': 'no-store' });
    return response.end();
  }
  const bfcacheMatch = url.pathname.match(
    /^\/__bfcache\/(shared|other)\/(clean|dirty)$/
  );
  if (bfcacheMatch && request.method === 'GET') {
    bfcacheObservation = {
      persisted: true,
      targetKind: bfcacheMatch[1] === 'shared' ? 'shared' : 'other',
      privacy: bfcacheMatch[2] === 'clean' ? 'clean' : 'dirty',
    };
    response.writeHead(204, {
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    return response.end();
  }
  if (url.pathname.startsWith('/bridge/')) {
    const fault = url.pathname.slice('/bridge/'.length) as RuntimeBridgeFault;
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'origin',
    });
    return response.end(renderRuntimeBridgeFrame(fault));
  }

  const selectedCase = runtimeCase(url);
  if (selectedCase === null)
    return writeJson(response, 400, { error: 'case_required' });
  const keyMatched = requestKeyMatched(request);
  recordRequest(request, keyMatched, selectedCase.caseId);
  const selectedBehavior = behavior(selectedCase.pathname);
  if (request.method === 'OPTIONS') {
    if (selectedBehavior !== 'cors') applyCors(request, response);
    response.writeHead(204, { 'Cache-Control': 'no-store' });
    return response.end();
  }
  if (selectedBehavior !== 'cors') applyCors(request, response);
  const chunks: Buffer[] = [];
  request.on('data', (chunk: Buffer) => chunks.push(chunk));
  const body = new Promise<string>((resolve) =>
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  );

  if (
    selectedCase.pathname.startsWith('/langgraph/') &&
    request.method !== 'OPTIONS' &&
    !keyMatched
  ) {
    return writePoisonFailure(response, 401);
  }

  const respond = () => {
    if (selectedBehavior === 'delayed-unauthorized') {
      return writePoisonFailure(response, 401);
    }
    if (selectedBehavior === 'unauthorized')
      return writePoisonFailure(response, 401);
    if (selectedBehavior === 'forbidden')
      return writePoisonFailure(response, 403);
    if (selectedBehavior === 'cors') return writePoisonFailure(response, 403);
    if (selectedCase.pathname.startsWith('/ag-ui/'))
      return void body.then((text) =>
        writeAgUiSuccess(response, agUiRunIdentity(text))
      );
    if (selectedCase.pathname.endsWith('/threads')) {
      return writeJson(response, 200, { thread_id: 'fixture-thread' });
    }
    if (selectedCase.pathname.includes('/runs/stream'))
      return writeLangGraphSuccess(response);
    if (selectedCase.pathname.endsWith('/history'))
      return writeJson(response, 200, []);
    return writeJson(response, 404, { error: 'fixture_not_found' });
  };

  if (
    selectedBehavior === 'delayed' ||
    selectedBehavior === 'delayed-unauthorized'
  ) {
    setTimeout(respond, 2_000);
  } else respond();
});

server.listen(PORT, HOST);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
