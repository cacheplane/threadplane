import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';

/** @template T @returns {{ promise: Promise<T>, resolve: (value: T) => void }} */
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/**
 * An owned HTTP proof boundary. Importing it never opens a port. Each expected
 * request has independent header/body gates and a physical response-close event.
 * For SSE, frames are sent after headers; the body gate holds stream completion.
 * @param {Array<{ method: string, path: string, payload?: unknown, status?: number,
 * body?: unknown, holdHeaders?: boolean, holdBody?: boolean, disconnect?: boolean,
 * concurrentGroup?: string, assertPayload?: (payload: unknown) => void,
 * events?: Array<{ event: string, data: unknown }> }>} expectations
 */
export async function startProofServer(expectations = []) {
  const requests = [];
  const failures = [];
  const steps = expectations.map((expected) => {
    const received = deferred();
    const closed = deferred();
    const headers = deferred();
    const headersSent = deferred();
    const body = deferred();
    if (!expected.holdHeaders) headers.resolve(undefined);
    if (!expected.holdBody) body.resolve(undefined);
    return {
      expected,
      received: received.promise,
      closed: closed.promise,
      headersSent: headersSent.promise,
      releaseHeaders: () => headers.resolve(undefined),
      releaseBody: () => body.resolve(undefined),
      receive: received.resolve,
      close: closed.resolve,
      headers: headers.promise,
      body: body.promise,
      sentHeaders: headersSent.resolve,
    };
  });
  const remaining = [...steps];
  const server = createServer(async (request, response) => {
    // Only a declared, contiguous group may arrive out of order. Repeated
    // endpoints still consume their first expectation; later groups stay gated.
    const first = remaining[0];
    const group = first?.expected.concurrentGroup;
    const end = group
      ? remaining.findIndex((step) => step.expected.concurrentGroup !== group)
      : 1;
    const candidates = remaining.slice(0, end < 0 ? remaining.length : end);
    const step =
      candidates.find(
        (step) =>
          step.expected.method === request.method &&
          step.expected.path === request.url
      ) ?? first;
    if (step) remaining.splice(remaining.indexOf(step), 1);
    const observation = {
      method: request.method,
      path: request.url,
      headers: request.headers,
      payload: undefined,
    };
    requests.push(observation);
    response.once('close', () =>
      step?.close({ finished: response.writableFinished })
    );
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString('utf8');
      observation.payload = raw ? JSON.parse(raw) : undefined;
      assert.ok(step, 'Unexpected request');
      assert.equal(observation.method, step.expected.method);
      assert.equal(observation.path, step.expected.path);
      if (step.expected.assertPayload)
        step.expected.assertPayload(observation.payload);
      else assert.deepEqual(observation.payload, step.expected.payload);
      step.receive(observation);
      if (step.expected.disconnect) {
        response.destroy();
        return;
      }
      await step.headers;
      if (response.destroyed) return;
      response.writeHead(step.expected.status ?? 200, {
        'content-type': step.expected.events
          ? 'text/event-stream'
          : 'application/json',
        'x-proof-secret': 'hostile-header-secret',
      });
      response.flushHeaders();
      step.sentHeaders(undefined);
      if (step.expected.events) {
        for (const { event, data } of step.expected.events)
          response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      }
      await step.body;
      if (response.destroyed) return;
      response.end(
        step.expected.events
          ? undefined
          : JSON.stringify(
              step.expected.body ?? { detail: 'hostile-body-secret' }
            )
      );
    } catch (error) {
      failures.push(error);
      step?.receive(observation);
      response.writeHead(500);
      response.end('proof rejected unexpected request');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    steps,
    verify() {
      assert.deepEqual(failures, [], 'Proof server rejected requests');
      assert.equal(requests.length, expectations.length, 'Exact request count');
      assert.equal(remaining.length, 0, 'Every expectation consumed');
    },
    async close() {
      for (const step of steps) {
        step.releaseHeaders();
        step.releaseBody();
      }
      const closed = once(server, 'close');
      server.close();
      server.closeAllConnections();
      await closed;
    },
  };
}

/**
 * Realistic SDK Thread envelope; values/metadata remain mutable test inputs.
 * @returns {import('@langchain/langgraph-sdk').Thread}
 */
export function threadEnvelope(id = 'thread-1', title = 'First conversation') {
  return {
    thread_id: id,
    created_at: '2026-09-28T00:00:00.000Z',
    updated_at: '2026-09-28T00:00:01.000Z',
    state_updated_at: '2026-09-28T00:00:01.000Z',
    metadata: { title },
    status: 'idle',
    values: { messages: [] },
    interrupts: {},
  };
}
