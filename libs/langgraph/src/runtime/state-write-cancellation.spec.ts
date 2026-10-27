import { createServer, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FetchStreamTransport } from '../lib/transport/fetch-stream.transport';
import { deferred } from './testing/deferred';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
});

async function endpoint(hold = false) {
  const started = deferred<ServerResponse>();
  const requests: { method?: string; url?: string; body: unknown }[] = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({
      method: request.method,
      url: request.url,
      body: JSON.parse(body),
    });
    started.resolve(response);
    if (!hold) {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ checkpoint_id: 'saved' }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      })
  );
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Expected TCP server');
  return {
    url: `http://127.0.0.1:${address.port}`,
    started: started.promise,
    requests,
  };
}

describe.each([false, true])(
  'state-write HTTP cancellation (protected=%s)',
  (protectedErrors) => {
    function transport(url: string) {
      const report = vi.fn();
      return {
        client: new FetchStreamTransport(
          url,
          undefined,
          { maxRetries: 0 },
          protectedErrors ? report : undefined
        ),
        report,
      };
    }

    it('does not send a state write when already aborted', async () => {
      const server = await endpoint();
      const { client, report } = transport(server.url);
      const controller = new AbortController();
      controller.abort();
      await expect(
        client.updateState('thread-a', {}, controller.signal)
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(server.requests).toEqual([]);
      expect(report).not.toHaveBeenCalled();
    });

    it('aborts an in-flight state write and closes its HTTP response', async () => {
      const server = await endpoint(true);
      const { client, report } = transport(server.url);
      const controller = new AbortController();
      const write = client.updateState('thread-a', {}, controller.signal);
      const rejected = expect(write).rejects.toMatchObject({
        name: 'AbortError',
      });
      const response = await server.started;
      const closed = new Promise<void>((resolve) =>
        response.once('close', resolve)
      );
      controller.abort();
      await rejected;
      await closed;
      expect(server.requests).toHaveLength(1);
      expect(report).not.toHaveBeenCalled();
    });

    it('preserves the state body and asNode for successful writes', async () => {
      const server = await endpoint();
      const { client } = transport(server.url);
      const values = Object.freeze({ messages: Object.freeze([]) });
      await client.updateState(
        'thread-a',
        values,
        new AbortController().signal,
        { asNode: '__start__' }
      );
      expect(server.requests).toEqual([
        {
          method: 'POST',
          url: '/threads/thread-a/state',
          body: { values, as_node: '__start__' },
        },
      ]);
    });
  }
);
