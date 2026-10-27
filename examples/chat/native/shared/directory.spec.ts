import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createRequire } from 'node:module';
import { startProofServer, threadEnvelope } from '../tooling/proof-server.mjs';
import { createThreadDirectory } from './directory.js';

const signal = () => new AbortController().signal;

for (const pinned of [true, false]) {
  for (const [id, path] of [
    ['literal', '/api/threads/literal'],
    ['one/two?x#y', '/api/threads/one%2Ftwo%3Fx%23y'],
    ['one%2Ftwo', '/api/threads/one%252Ftwo'],
  ])
    test(`pin ${pinned} encodes exact target ${id} and patches only its metadata field`, async (t) => {
      const { directory, server } = await fixture(t, [
        {
          method: 'PATCH',
          path,
          payload: { metadata: { pinned } },
          body: {
            ...threadEnvelope(id, 'Unchanged'),
            metadata: { title: 'Unchanged', pinned, other: 'kept' },
          },
        },
      ]);
      const result = await directory.setPinned!(id, pinned, signal());
      assert.deepEqual(result, {
        kind: 'ready',
        value: { id, title: 'Unchanged', updatedAt: 1790553601000, pinned },
      });
      assert.ok(Object.isFrozen(result));
      server.verify();
    });
  for (const body of [
    { thread_id: 'wrong', metadata: { pinned } },
    { thread_id: 'a', metadata: { pinned: !pinned } },
    { thread_id: 'a', metadata: {} },
    { thread_id: 'a' },
    { thread_id: 'a', metadata: { pinned: pinned ? 'true' : 0 } },
  ])
    test(`pin ${pinned} requires raw exact ID and boolean confirmation ${JSON.stringify(
      body
    )}`, async (t) => {
      const { directory, server } = await fixture(t, [
        {
          method: 'PATCH',
          path: '/api/threads/a',
          payload: { metadata: { pinned } },
          body,
        },
      ]);
      assert.deepEqual(await directory.setPinned!('a', pinned, signal()), {
        kind: 'failed',
      });
      server.verify();
    });
}
for (const status of [404, 500])
  test(
    `pin HTTP ${status} cancels hostile held body without retry`,
    { timeout: 5000 },
    async (t) => {
      const { directory, server } = await fixture(t, [
        {
          method: 'PATCH',
          path: '/api/threads/a',
          payload: { metadata: { pinned: true } },
          status,
          holdBody: true,
        },
      ]);
      assert.deepEqual(await directory.setPinned!('a', true, signal()), {
        kind: 'failed',
      });
      assert.deepEqual(await server.steps[0].closed, { finished: false });
      server.verify();
    }
  );
for (const phase of ['headers', 'body'])
  test(`pin abort releases held ${phase}`, { timeout: 5000 }, async (t) => {
    const { directory, server } = await fixture(t, [
      {
        method: 'PATCH',
        path: '/api/threads/a',
        payload: { metadata: { pinned: false } },
        holdHeaders: phase === 'headers',
        holdBody: true,
      },
    ]);
    const controller = new AbortController();
    const result = directory.setPinned!('a', false, controller.signal);
    await server.steps[0].received;
    if (phase === 'body') await server.steps[0].headersSent;
    controller.abort();
    assert.deepEqual(await result, { kind: 'cancelled' });
    assert.deepEqual(await server.steps[0].closed, { finished: false });
    server.verify();
  });
test('pin invalid booleans, dot IDs and preaborted requests do no network work', async (t) => {
  const { directory, server } = await fixture(t, []);
  for (const id of ['.', '..'])
    assert.deepEqual(await directory.setPinned!(id, true, signal()), {
      kind: 'failed',
    });
  for (const value of [undefined, null, 0, 1, 'true'])
    assert.deepEqual(
      await directory.setPinned!('a', value as unknown as boolean, signal()),
      { kind: 'failed' }
    );
  const controller = new AbortController();
  controller.abort();
  assert.deepEqual(await directory.setPinned!('a', true, controller.signal), {
    kind: 'cancelled',
  });
  server.verify();
});
test('pin thrown transport errors are contained with one attempt', async () => {
  let calls = 0;
  const directory = createThreadDirectory({
    apiBase: 'http://localhost/api',
    browserOrigin: 'http://localhost',
    fetch: async () => {
      calls++;
      throw { status: 404, message: 'hostile' };
    },
  });
  assert.deepEqual(await directory.setPinned!('a', true, signal()), {
    kind: 'failed',
  });
  assert.equal(calls, 1);
});

test('pin capability writes and confirms explicit false through the SDK boundary', async (t) => {
  const { directory, server } = await fixture(t, [
    {
      method: 'PATCH',
      path: '/api/threads/a',
      payload: { metadata: { pinned: false } },
      body: {
        ...threadEnvelope('a', 'Alpha'),
        metadata: { title: 'Alpha', pinned: false },
      },
    },
  ]);
  const pin = (
    directory as typeof directory & {
      setPinned?: (
        id: string,
        pinned: boolean,
        signal: AbortSignal
      ) => Promise<unknown>;
    }
  ).setPinned;
  assert.deepEqual(await pin?.('a', false, signal()), {
    kind: 'ready',
    value: { id: 'a', title: 'Alpha', updatedAt: 1790553601000, pinned: false },
  });
  server.verify();
});
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
    value: {
      id: 'thread-1',
      title: 'First conversation',
      updatedAt: 1790553601000,
    },
  });
  assert.deepEqual(await directory.list(signal()), {
    kind: 'ready',
    value: [
      { id: 'thread-1', title: 'First conversation', updatedAt: 1790553601000 },
    ],
  });
  assert.deepEqual(await directory.create(signal()), {
    kind: 'ready',
    value: { id: 'new', title: 'Untitled', updatedAt: 1790553601000 },
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
      value: { id, title: 'Delimiter ID', updatedAt: 1790553601000 },
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

test('directory rename confirms exact encoded target and title through one SDK PATCH', async (t) => {
  const id = 'one/two?x#y';
  const { server, directory } = await fixture(t, [
    {
      method: 'PATCH',
      path: '/api/threads/one%2Ftwo%3Fx%23y',
      payload: { metadata: { title: 'New title' } },
      body: threadEnvelope(id, 'New title'),
    },
  ]);
  assert.deepEqual(await directory.rename!(id, 'New title', signal()), {
    kind: 'ready',
    value: { id, title: 'New title', updatedAt: 1790553601000 },
  });
  server.verify();
});

for (const body of [
  threadEnvelope('wrong', 'New title'),
  threadEnvelope('one', 'Old title'),
  { thread_id: 'one', metadata: {} },
])
  test('directory rename rejects missing or mismatched raw confirmation', async (t) => {
    const { server, directory } = await fixture(t, [
      {
        method: 'PATCH',
        path: '/api/threads/one',
        payload: { metadata: { title: 'New title' } },
        body,
      },
    ]);
    assert.deepEqual(await directory.rename!('one', 'New title', signal()), {
      kind: 'failed',
    });
    server.verify();
  });

for (const status of [401, 404, 422, 503])
  test(
    `directory rename HTTP ${status} cancels hostile body without retry`,
    { timeout: 5000 },
    async (t) => {
      const { server, directory } = await fixture(t, [
        {
          method: 'PATCH',
          path: '/api/threads/a',
          payload: { metadata: { title: 'New' } },
          status,
          holdBody: true,
        },
      ]);
      assert.deepEqual(await directory.rename!('a', 'New', signal()), {
        kind: 'failed',
      });
      server.verify();
      assert.deepEqual(await server.steps[0].closed, { finished: false });
    }
  );
for (const phase of ['headers', 'body'] as const)
  test(
    `directory rename abort releases held ${phase}`,
    { timeout: 5000 },
    async (t) => {
      const { server, directory } = await fixture(t, [
        {
          method: 'PATCH',
          path: '/api/threads/a',
          payload: { metadata: { title: 'New' } },
          holdHeaders: phase === 'headers',
          holdBody: true,
        },
      ]);
      const controller = new AbortController();
      const pending = directory.rename!('a', 'New', controller.signal);
      await server.steps[0].received;
      if (phase === 'body') await server.steps[0].headersSent;
      controller.abort();
      assert.deepEqual(await pending, { kind: 'cancelled' });
      assert.deepEqual(await server.steps[0].closed, { finished: false });
      server.verify();
    }
  );
test('directory rename is inert when preaborted, blank, or an unrepresentable dot ID', async (t) => {
  const { server, directory } = await fixture(t, []);
  const controller = new AbortController();
  controller.abort();
  assert.deepEqual(await directory.rename!('a', 'New', controller.signal), {
    kind: 'cancelled',
  });
  for (const id of ['.', '..'])
    assert.deepEqual(await directory.rename!(id, 'New', signal()), {
      kind: 'failed',
    });
  assert.deepEqual(await directory.rename!('a', '   ', signal()), {
    kind: 'failed',
  });
  server.verify();
});

for (const archived of [true, false]) {
  for (const [id, path] of [
    ['literal', '/api/threads/literal'],
    ['one/two?x#y', '/api/threads/one%2Ftwo%3Fx%23y'],
    ['one%2Ftwo', '/api/threads/one%252Ftwo'],
  ])
    test(`archive ${archived} encodes exact target ${id} and patches only its metadata field`, async (t) => {
      const { directory, server } = await fixture(t, [
        {
          method: 'PATCH',
          path,
          payload: { metadata: { archived } },
          body: {
            ...threadEnvelope(id, 'Unchanged'),
            metadata: { title: 'Unchanged', archived, other: 'kept' },
          },
        },
      ]);
      const result = await directory.setArchived!(id, archived, signal());
      assert.deepEqual(result, {
        kind: 'ready',
        value: { id, title: 'Unchanged', updatedAt: 1790553601000, archived },
      });
      assert.ok(Object.isFrozen(result));
      server.verify();
    });
  for (const body of [
    { thread_id: 'wrong', metadata: { archived } },
    { thread_id: 'a', metadata: { archived: !archived } },
    { thread_id: 'a', metadata: {} },
    { thread_id: 'a' },
    { thread_id: 'a', metadata: { archived: archived ? 'true' : 0 } },
  ])
    test(`archive ${archived} requires raw exact ID and boolean confirmation ${JSON.stringify(
      body
    )}`, async (t) => {
      const { directory, server } = await fixture(t, [
        {
          method: 'PATCH',
          path: '/api/threads/a',
          payload: { metadata: { archived } },
          body,
        },
      ]);
      assert.deepEqual(await directory.setArchived!('a', archived, signal()), {
        kind: 'failed',
      });
      server.verify();
    });
}
for (const status of [404, 500])
  test(
    `archive HTTP ${status} cancels hostile held body without retry`,
    { timeout: 5000 },
    async (t) => {
      const { directory, server } = await fixture(t, [
        {
          method: 'PATCH',
          path: '/api/threads/a',
          payload: { metadata: { archived: true } },
          status,
          holdBody: true,
        },
      ]);
      assert.deepEqual(await directory.setArchived!('a', true, signal()), {
        kind: 'failed',
      });
      assert.deepEqual(await server.steps[0].closed, { finished: false });
      server.verify();
    }
  );
for (const phase of ['headers', 'body'])
  test(`archive abort releases held ${phase}`, { timeout: 5000 }, async (t) => {
    const { directory, server } = await fixture(t, [
      {
        method: 'PATCH',
        path: '/api/threads/a',
        payload: { metadata: { archived: false } },
        holdHeaders: phase === 'headers',
        holdBody: true,
      },
    ]);
    const controller = new AbortController();
    const result = directory.setArchived!('a', false, controller.signal);
    await server.steps[0].received;
    if (phase === 'body') await server.steps[0].headersSent;
    controller.abort();
    assert.deepEqual(await result, { kind: 'cancelled' });
    assert.deepEqual(await server.steps[0].closed, { finished: false });
    server.verify();
  });
test('archive invalid booleans, dot IDs and preaborted requests do no network work', async (t) => {
  const { directory, server } = await fixture(t, []);
  for (const id of ['.', '..'])
    assert.deepEqual(await directory.setArchived!(id, true, signal()), {
      kind: 'failed',
    });
  for (const value of [undefined, null, 0, 1, 'true'])
    assert.deepEqual(
      await directory.setArchived!('a', value as unknown as boolean, signal()),
      { kind: 'failed' }
    );
  const controller = new AbortController();
  controller.abort();
  assert.deepEqual(await directory.setArchived!('a', true, controller.signal), {
    kind: 'cancelled',
  });
  server.verify();
});
test('archive thrown transport errors are contained with one attempt', async () => {
  let calls = 0;
  const directory = createThreadDirectory({
    apiBase: 'http://localhost/api',
    browserOrigin: 'http://localhost',
    fetch: async () => {
      calls++;
      throw { status: 404, message: 'hostile' };
    },
  });
  assert.deepEqual(await directory.setArchived!('a', true, signal()), {
    kind: 'failed',
  });
  assert.equal(calls, 1);
});

test('archive capability writes and confirms explicit false through the SDK boundary', async (t) => {
  const { directory, server } = await fixture(t, [
    {
      method: 'PATCH',
      path: '/api/threads/a',
      payload: { metadata: { archived: false } },
      body: {
        ...threadEnvelope('a', 'Alpha'),
        metadata: { title: 'Alpha', archived: false },
      },
    },
  ]);
  const archive = (
    directory as typeof directory & {
      setArchived?: (
        id: string,
        archived: boolean,
        signal: AbortSignal
      ) => Promise<unknown>;
    }
  ).setArchived;
  assert.deepEqual(await archive?.('a', false, signal()), {
    kind: 'ready',
    value: {
      id: 'a',
      title: 'Alpha',
      updatedAt: 1790553601000,
      archived: false,
    },
  });
  server.verify();
});

test('pinned ordering SDK writes rank alone and requires exact raw confirmation without retries or reads', async (t) => {
  for (const [id, rawId, rawRank, expected] of [
    ['one/two', 'one/two', 2, 'ready'],
    ['a', 'wrong', 2, 'failed'],
    ['a', 'a', '2', 'failed'],
    ['a', 'a', undefined, 'failed'],
  ] as const) {
    const { directory, server } = await fixture(t, [
      {
        method: 'PATCH',
        path: '/api/threads/' + encodeURIComponent(id),
        payload: { metadata: { pinnedOrder: 2 } },
        body: {
          ...threadEnvelope(rawId, 'Title'),
          metadata: { pinnedOrder: rawRank },
        },
      },
    ]);
    const write = directory.setPinnedOrder;
    assert.equal(typeof write, 'function');
    assert.equal((await write!(id, 2, signal())).kind, expected);
    server.verify();
  }
});
test('pinned ordering rejects invalid ranks and IDs before I/O', async (t) => {
  const { directory, server } = await fixture(t, []);
  const write = directory.setPinnedOrder;
  assert.equal(typeof write, 'function');
  for (const id of ['', '.', '..', undefined, 2])
    assert.equal((await write!(id as string, 0, signal())).kind, 'failed');
  for (const rank of [
    -1,
    0.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    '0',
    undefined,
  ])
    assert.equal((await write!('a', rank as number, signal())).kind, 'failed');
  server.verify();
});

for (const status of [404, 500])
  test(
    `pinned ordering HTTP ${status} cancels hostile held error body with exactly one attempt`,
    { timeout: 5000 },
    async (t) => {
      const { directory, server } = await fixture(t, [
        {
          method: 'PATCH',
          path: '/api/threads/a',
          payload: { metadata: { pinnedOrder: 0 } },
          status,
          holdBody: true,
        },
      ]);
      assert.deepEqual(await directory.setPinnedOrder!('a', 0, signal()), {
        kind: 'failed',
      });
      assert.deepEqual(await server.steps[0].closed, { finished: false });
      server.verify();
    }
  );
for (const phase of ['headers', 'body'])
  test(
    `pinned ordering abort releases held ${phase} without retry or lookup`,
    { timeout: 5000 },
    async (t) => {
      const { directory, server } = await fixture(t, [
        {
          method: 'PATCH',
          path: '/api/threads/a',
          payload: { metadata: { pinnedOrder: 0 } },
          holdHeaders: phase === 'headers',
          holdBody: true,
        },
      ]);
      const controller = new AbortController();
      const result = directory.setPinnedOrder!('a', 0, controller.signal);
      await server.steps[0].received;
      if (phase === 'body') await server.steps[0].headersSent;
      controller.abort();
      assert.deepEqual(await result, { kind: 'cancelled' });
      assert.deepEqual(await server.steps[0].closed, { finished: false });
      server.verify();
    }
  );
test('pinned ordering SDK preabort is inert and thrown transport errors are contained without retry', async (t) => {
  const { directory, server } = await fixture(t, []);
  const controller = new AbortController();
  controller.abort();
  assert.deepEqual(await directory.setPinnedOrder!('a', 0, controller.signal), {
    kind: 'cancelled',
  });
  server.verify();
  let calls = 0;
  const throwing = createThreadDirectory({
    apiBase: 'http://localhost/api',
    browserOrigin: 'http://localhost',
    fetch: async () => {
      calls++;
      throw { message: 'hostile', status: 404 };
    },
  });
  assert.deepEqual(await throwing.setPinnedOrder!('a', 0, signal()), {
    kind: 'failed',
  });
  assert.equal(calls, 1);
});
