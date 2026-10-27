import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  createServer,
  request,
  type ClientRequest,
  type ServerResponse,
} from 'node:http';

type Phase = 'positive' | 'held-stop' | 'held-selection' | 'rejected';
interface Observation {
  method: string;
  path: string;
  body?: unknown;
  status?: number;
  forwarded: boolean;
  phase?: Phase;
  upstreamStatus?: number;
  upstreamComplete?: boolean;
  upstreamBytes?: number;
  downstreamHeadersSent?: boolean;
  downstreamFinished?: boolean;
  downstreamClosedBeforeCleanup?: boolean;
}

// Private proof boundary: fixed numeric provider destination, with only the
// concrete summary scenario's authored four terminal-write phases.
export async function observeProvider(
  port: number,
  scenario: 'approval' | 'trip-summary' | 'backup-effect' = 'approval'
) {
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65535);
  assert.ok(
    scenario === 'approval' ||
      scenario === 'trip-summary' ||
      scenario === 'backup-effect'
  );
  const requests: Observation[] = [];
  const forwardedRequests: Observation[] = [];
  const controls: { method: string; path: string; status: number }[] = [];
  const pending = new Set<ClientRequest>();
  const sockets = new Set<import('node:net').Socket>();
  const available = new Map<string, Observation>();
  const waiters = new Map<string, Set<ServerResponse>>();
  let closing = false,
    stateWrites = 0;
  const phases = [
    'positive',
    'held-stop',
    'held-selection',
    'rejected',
  ] as const;
  const send = (response: ServerResponse, entry: Observation) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(entry));
  };
  const publish = (path: string, entry: Observation) => {
    available.set(path, structuredClone(entry));
    for (const response of waiters.get(path) ?? []) send(response, entry);
    waiters.delete(path);
  };
  const capability = '/' + randomBytes(32).toString('hex');
  const allowed = new Set([
    '/held-stop/accepted',
    '/held-stop/closed',
    '/held-selection/accepted',
    '/held-selection/closed',
    '/rejected/observed',
  ]);
  const control =
    scenario === 'trip-summary'
      ? createServer((incoming, outgoing) => {
          incoming.resume();
          const path = incoming.url?.startsWith(capability + '/')
            ? incoming.url.slice(capability.length)
            : '';
          if (incoming.method !== 'GET' || !allowed.has(path)) {
            controls.push({ method: incoming.method ?? '', path, status: 404 });
            outgoing.writeHead(404);
            outgoing.end();
            return;
          }
          controls.push({ method: incoming.method, path, status: 200 });
          const entry = available.get(path);
          if (entry) send(outgoing, entry);
          else {
            const list = waiters.get(path) ?? new Set<ServerResponse>();
            list.add(outgoing);
            waiters.set(path, list);
            outgoing.once('close', () => list.delete(outgoing));
          }
        })
      : undefined;
  const server = createServer(async (incoming, outgoing) => {
    const path = incoming.url;
    if (
      !path?.startsWith('/') ||
      path.startsWith('//') ||
      /[\\\s#]/.test(path)
    ) {
      incoming.resume();
      outgoing.writeHead(400);
      outgoing.end();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of incoming) {
        size += chunk.length;
        assert.ok(size < 2_000_000);
        chunks.push(Buffer.from(chunk));
      }
      const bytes = Buffer.concat(chunks);
      const entry: Observation = {
        method: incoming.method!,
        path,
        ...(bytes.length ? { body: JSON.parse(bytes.toString()) } : {}),
        forwarded: false,
      };
      requests.push(entry);
      if (
        scenario === 'trip-summary' &&
        incoming.method === 'POST' &&
        /^\/threads\/[^/]+\/state$/.test(path)
      ) {
        assert.ok(
          stateWrites < phases.length,
          'Unexpected terminal state write'
        );
        entry.phase = phases[stateWrites++];
      }
      outgoing.once('close', () => {
        entry.downstreamHeadersSent = outgoing.headersSent;
        entry.downstreamFinished = outgoing.writableFinished;
        entry.downstreamClosedBeforeCleanup = !closing;
        if (entry.phase === 'held-stop' || entry.phase === 'held-selection')
          publish('/' + entry.phase + '/closed', entry);
      });
      if (entry.phase === 'rejected') {
        entry.status = 503;
        outgoing.writeHead(503, { 'content-type': 'application/json' });
        outgoing.end('{"detail":"Owned proof rejected before forwarding"}');
        publish('/rejected/observed', entry);
        return;
      }
      entry.forwarded = true;
      const upstream = request(
        {
          // Incoming targets can select a path, never a connection destination.
          hostname: '127.0.0.1',
          port,
          path,
          method: incoming.method,
          headers: { ...incoming.headers, host: `127.0.0.1:${port}` },
        },
        (response) => {
          entry.upstreamStatus = response.statusCode;
          if (entry.phase === 'held-stop' || entry.phase === 'held-selection') {
            // Drain the real committed response, bounded, without downstream
            // headers. A later client close cannot roll back that provider write.
            let count = 0;
            response.on('data', (bytes: Buffer) => {
              count += bytes.length;
              if (count > 2_000_000)
                response.destroy(
                  new Error('Provider acknowledgement limit exceeded')
                );
            });
            response.once('end', () => {
              entry.upstreamBytes = count;
              entry.upstreamComplete = response.complete;
              entry.downstreamHeadersSent = outgoing.headersSent;
              publish('/' + entry.phase + '/accepted', entry);
            });
            response.once('error', () => outgoing.destroy());
          } else {
            entry.status = response.statusCode;
            response.once('end', () => {
              entry.upstreamComplete = response.complete;
            });
            outgoing.writeHead(response.statusCode!, response.headers);
            response.pipe(outgoing);
          }
        }
      );
      forwardedRequests.push(entry);
      pending.add(upstream);
      upstream.once('close', () => pending.delete(upstream));
      upstream.once('error', () => {
        if (!outgoing.headersSent) outgoing.writeHead(502);
        outgoing.end();
      });
      outgoing.once('close', () => upstream.destroy());
      upstream.end(bytes);
    } catch {
      if (!outgoing.headersSent) outgoing.writeHead(500);
      outgoing.end();
    }
  });
  for (const listener of [server, ...(control ? [control] : [])])
    listener.on('connection', (socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });
  const listen = async (listener: ReturnType<typeof createServer>) => {
    await new Promise<void>((yes, no) => {
      listener.once('error', no);
      listener.listen(0, '127.0.0.1', yes);
    });
    const address = listener.address();
    assert.ok(address && typeof address !== 'string');
    return `http://127.0.0.1:${address.port}`;
  };
  const close = async () => {
    closing = true;
    for (const request of pending) request.destroy();
    for (const socket of sockets) socket.destroy();
    waiters.clear();
    await Promise.all(
      [server, ...(control ? [control] : [])].map(
        (listener) => new Promise<void>((yes) => listener.close(() => yes()))
      )
    );
  };
  try {
    const url = await listen(server);
    const controlUrl = control
      ? (await listen(control)) + capability
      : undefined;
    return { url, controlUrl, requests, forwardedRequests, controls, close };
  } catch (error) {
    await close();
    throw error;
  }
}
