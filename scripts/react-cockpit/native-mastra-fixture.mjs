/** Browser proof only; never included in Code or deployment assets. */
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { createNativeMastraServer } from '../../fixtures/react-parity/native-mastra-react/server.mjs';
export function createNativeMastraFixture() {
  let owner,
    closed = false,
    operations = Promise.resolve();
  const receipts = [];
  const serialize = (operation) => {
    const result = operations.then(operation);
    operations = result.catch(() => undefined);
    return result;
  };
  const stats = () =>
    structuredClone({ current: owner?.stats(), closed: receipts });
  const closeOwner = async () => {
    const previous = owner;
    owner = undefined;
    if (previous) {
      await previous.close();
      receipts.push(previous.stats());
    }
  };
  const reset = (options) =>
    serialize(async () => {
      assert.ok(!closed);
      await closeOwner();
      owner = await createNativeMastraServer(options);
    });
  const json = (response, value, status = 200) =>
    response
      .writeHead(status, { 'content-type': 'application/json' })
      .end(JSON.stringify(value));
  async function handle(request, response, path) {
    if (
      ![
        '/__reset',
        '/__stats',
        '/__requests',
        '/__finish',
        '/runtimes/mastra/agent',
      ].includes(path)
    )
      return false;
    try {
      if (path === '/__stats') {
        json(response, stats());
        return true;
      }
      if (path === '/__requests') {
        json(response, owner?.stats().requests ?? []);
        return true;
      }
      if (path === '/__finish') {
        await serialize(closeOwner);
        json(response, stats());
        return true;
      }
      if (path === '/__reset') {
        assert.equal(request.method, 'POST');
        let bytes = '';
        for await (const chunk of request) {
          bytes += chunk;
          assert.ok(bytes.length <= 2000000);
        }
        await reset(bytes ? JSON.parse(bytes) : {});
        json(response, stats());
        return true;
      }
      const current = owner;
      assert.ok(current && !closed, 'Explicit fixture reset required');
      assert.equal(request.method, 'POST');
      const upstream = httpRequest(
        current.url + '/agent',
        { method: 'POST', headers: { 'content-type': 'application/json' } },
        (incoming) => {
          if (response.destroyed || owner !== current) {
            incoming.destroy();
            return;
          }
          response.writeHead(incoming.statusCode, {
            'content-type':
              incoming.headers['content-type'] ?? 'application/json',
          });
          incoming.pipe(response);
          incoming.on('error', () => response.destroy());
        }
      );
      upstream.on('error', () => {
        if (!response.headersSent && !response.destroyed)
          json(response, { error: 'Native fixture unavailable' }, 502);
        else response.destroy();
      });
      response.once('close', () => upstream.destroy());
      request.pipe(upstream);
      return true;
    } catch {
      if (!response.headersSent)
        json(response, { error: 'Native fixture request failed' }, 500);
      else response.destroy();
      return true;
    }
  }
  const close = () => {
    closed = true;
    return serialize(closeOwner);
  };
  return Object.assign(handle, { reset, stats, close });
}
