import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createRequire } from 'node:module';
import { startProofServer, threadEnvelope } from '../tooling/proof-server.mjs';
import { createThreadDirectory } from './directory.js';

const signal = () => new AbortController().signal;
async function fixture(
  t: TestContext,
  expectations: Parameters<typeof startProofServer>[0]
) {
  const server = await startProofServer(expectations);
  t.after(async () => {
    await server.close();
  });
  return {
    server,
    directory: createThreadDirectory({
      apiBase: server.origin + '/api',
      browserOrigin: server.origin,
    }),
  };
}

test('directory uses actual installed SDK 1.10.0 and construction is inert', async (t) => {
  assert.equal(
    createRequire(import.meta.url)('@langchain/langgraph-sdk/package.json')
      .version,
    '1.10.0'
  );
  const { server, directory } = await fixture(t, []);
  assert.equal(typeof directory.get, 'function');
  await new Promise<void>((done) => setImmediate(done));
  server.verify();
});

test('directory lookup, search and explicit creation use real SDK envelopes and exact payloads', async (t) => {
  const { server, directory } = await fixture(t, [
    { method: 'GET', path: '/api/threads/thread-1', body: threadEnvelope() },
    {
      method: 'POST',
      path: '/api/threads/search',
      payload: { limit: 50, offset: 0 },
      body: [threadEnvelope()],
    },
    {
      method: 'POST',
      path: '/api/threads',
      payload: { metadata: {} },
      body: threadEnvelope('new', ''),
    },
  ]);
  const old = process.env.LANGGRAPH_API_KEY;
  process.env.LANGGRAPH_API_KEY = 'ambient-secret';
  t.after(() => {
    if (old === undefined) delete process.env.LANGGRAPH_API_KEY;
    else process.env.LANGGRAPH_API_KEY = old;
  });
  // Construct while an ambient key is present as well as during requests.
  const keyed = createThreadDirectory({
    apiBase: server.origin + '/api',
    browserOrigin: server.origin,
  });
  assert.deepEqual(await keyed.get('thread-1', signal()), {
    kind: 'ready',
    value: { id: 'thread-1', title: 'First conversation' },
  });
  assert.deepEqual(await directory.list(signal()), {
    kind: 'ready',
    value: [{ id: 'thread-1', title: 'First conversation' }],
  });
  assert.deepEqual(await directory.create(signal()), {
    kind: 'ready',
    value: { id: 'new', title: 'Untitled' },
  });
  server.verify();
  for (const request of server.requests)
    assert.equal(request.headers['x-api-key'], undefined);
});

for (const status of [404, 422, 401, 403, 500, 503]) {
  test(
    `directory lookup safely classifies owned HTTP ${status} without consuming a hostile held body`,
    { timeout: 5000 },
    async (t) => {
      const { server, directory } = await fixture(t, [
        { method: 'GET', path: '/api/threads/one', status, holdBody: true },
      ]);
      const result = await directory.get('one', signal());
      assert.deepEqual(result, {
        kind: status === 404 || status === 422 ? 'missing' : 'failed',
      });
      server.verify();
      assert.deepEqual(await server.steps[0].closed, { finished: false });
      assert.doesNotMatch(
        JSON.stringify(result),
        /hostile|secret|HTTP|headers|body/
      );
    }
  );
}

for (const [id, path] of [
  ['one/two?x#y', '/api/threads/one%2Ftwo%3Fx%23y'],
  ['one%2Ftwo', '/api/threads/one%252Ftwo'],
])
  test(`directory lookup treats ${id} as one path segment`, async (t) => {
    const { server, directory } = await fixture(t, [
      {
        method: 'GET',
        path,
        body: threadEnvelope(id, 'Delimiter ID'),
      },
    ]);
    assert.deepEqual(await directory.get(id, signal()), {
      kind: 'ready',
      value: { id, title: 'Delimiter ID' },
    });
    server.verify();
  });

test('directory lookup cannot represent dot segments and fails without a request', async (t) => {
  const { server, directory } = await fixture(t, []);
  for (const id of ['.', '..'])
    assert.deepEqual(await directory.get(id, signal()), { kind: 'failed' });
  server.verify();
});

test('directory never treats arbitrary thrown status/message objects as owned HTTP failures', async () => {
  let textReads = 0;
  for (const hostile of [
    { status: 404, message: 'hostile-secret' },
    {
      status: 422,
      statusText: 'secret',
      text: () => {
        textReads++;
        return Promise.resolve('hostile-secret');
      },
    },
    new Error('HTTP 404: hostile-secret'),
  ]) {
    let attempts = 0;
    const directory = createThreadDirectory({
      apiBase: 'http://localhost/api',
      browserOrigin: 'http://localhost',
      fetch: async () => {
        attempts++;
        throw hostile;
      },
    });
    assert.deepEqual(await directory.get('one', signal()), { kind: 'failed' });
    assert.equal(attempts, 1);
    assert.equal(textReads, 0);
  }
});

test('directory pre-aborted operations are cancelled without network work', async (t) => {
  const { server, directory } = await fixture(t, []);
  const controller = new AbortController();
  controller.abort('hostile-secret');
  assert.deepEqual(await directory.get('one', controller.signal), {
    kind: 'cancelled',
  });
  assert.deepEqual(await directory.list(controller.signal), {
    kind: 'cancelled',
  });
  assert.deepEqual(await directory.create(controller.signal), {
    kind: 'cancelled',
  });
  server.verify();
});

for (const operation of ['list', 'create'] as const) {
  for (const status of [404, 422, 503]) {
    test(`directory ${operation} HTTP ${status} is a safe failure with exactly one POST`, async (t) => {
      const { server, directory } = await fixture(t, [
        {
          method: 'POST',
          path: operation === 'list' ? '/api/threads/search' : '/api/threads',
          payload:
            operation === 'list' ? { limit: 50, offset: 0 } : { metadata: {} },
          status,
        },
      ]);
      assert.deepEqual(await directory[operation](signal()), {
        kind: 'failed',
      });
      server.verify();
    });
  }
}

test('directory network failure on explicit create cannot cause a hidden second POST', async (t) => {
  const { server, directory } = await fixture(t, [
    {
      method: 'POST',
      path: '/api/threads',
      payload: { metadata: {} },
      disconnect: true,
    },
  ]);
  assert.deepEqual(await directory.create(signal()), { kind: 'failed' });
  server.verify();
});

for (const operation of ['get', 'list', 'create'] as const) {
  for (const phase of ['headers', 'body'] as const) {
    test(
      `directory ${operation} abort closes the underlying held ${phase} request`,
      { timeout: 5000 },
      async (t) => {
        const { server } = await fixture(t, [
          {
            method: operation === 'get' ? 'GET' : 'POST',
            path:
              operation === 'get'
                ? '/api/threads/one'
                : operation === 'list'
                ? '/api/threads/search'
                : '/api/threads',
            payload:
              operation === 'get'
                ? undefined
                : operation === 'list'
                ? { limit: 50, offset: 0 }
                : { metadata: {} },
            holdHeaders: phase === 'headers',
            holdBody: true,
          },
        ]);
        let receivedHeaders!: () => void;
        const responseAvailable = new Promise<void>((resolve) => {
          receivedHeaders = resolve;
        });
        const directory = createThreadDirectory({
          apiBase: server.origin + '/api',
          browserOrigin: server.origin,
          fetch: async (...args) => {
            const response = await fetch(...args);
            receivedHeaders();
            return response;
          },
        });
        const controller = new AbortController();
        const pending =
          operation === 'get'
            ? directory.get('one', controller.signal)
            : directory[operation](controller.signal);
        await Promise.race([server.steps[0].received, pending]);
        assert.equal(
          server.requests.length,
          1,
          'Request must reach the owned transport'
        );
        if (phase === 'body') {
          await server.steps[0].headersSent;
          await responseAvailable;
        }
        controller.abort('hostile-abort-reason');
        assert.deepEqual(await pending, { kind: 'cancelled' });
        assert.deepEqual(await server.steps[0].closed, { finished: false });
        server.verify();
      }
    );
  }
}

test('directory requires an explicit absolute same-origin browser API base', () => {
  for (const apiBase of [
    '/api',
    'https://other.invalid/api',
    'http://user:secret@localhost/api',
    'http://localhost/api?key=secret',
    'http://localhost/api#secret',
  ])
    assert.throws(() =>
      createThreadDirectory({ apiBase, browserOrigin: 'http://localhost' })
    );
});
