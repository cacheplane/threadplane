import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createThreadDirectory } from './directory.js';

const signal = () => new AbortController().signal;
for (const projectId of [' project/one ', '__proto__', null]) {
  for (const id of [' a/b ', '__proto__', 'one%2Ftwo'])
    test(`project assignment preserves exact bytes ${JSON.stringify([
      id,
      projectId,
    ])}`, async () => {
      let calls = 0;
      const directory = createThreadDirectory({
        apiBase: 'http://localhost/api',
        browserOrigin: 'http://localhost',
        fetch: async (input, init) => {
          calls++;
          assert.equal(
            String(input),
            `http://localhost/api/threads/${encodeURIComponent(id)}`
          );
          assert.equal(init?.method, 'PATCH');
          assert.deepEqual(JSON.parse(String(init?.body)), {
            metadata: { projectId },
          });
          assert.ok(init?.signal);
          return Response.json({
            thread_id: id,
            metadata: { projectId, title: 'ignored' },
          });
        },
      });
      const result = await directory.setProject!(id, projectId, signal());
      assert.deepEqual(result, { kind: 'ready', value: { id, projectId } });
      assert.ok(Object.isFrozen(result));
      if (result.kind === 'ready') assert.ok(Object.isFrozen(result.value));
      assert.equal(calls, 1);
    });
}
for (const body of [
  null,
  {},
  { thread_id: 'other', metadata: { projectId: null } },
  { thread_id: 'a' },
  { thread_id: 'a', metadata: {} },
  { thread_id: 'a', metadata: { projectId: '' } },
])
  test(`project assignment needs exact raw confirmation ${JSON.stringify(
    body
  )}`, async () => {
    const directory = createThreadDirectory({
      apiBase: 'http://localhost/api',
      browserOrigin: 'http://localhost',
      fetch: async () =>
        body === null
          ? new Response(null, { status: 204 })
          : Response.json(body),
    });
    assert.deepEqual(await directory.setProject!('a', null, signal()), {
      kind: 'failed',
    });
  });
test('project assignment rejects malformed runtime arguments before transport', async () => {
  let calls = 0;
  const directory = createThreadDirectory({
    apiBase: 'http://localhost/api',
    browserOrigin: 'http://localhost',
    fetch: async () => {
      calls++;
      return Response.json({});
    },
  });
  for (const id of ['', ' ', '.', '..', null, 42])
    assert.equal(
      (await directory.setProject!(id as string, 'p', signal())).kind,
      'failed'
    );
  for (const project of ['', ' ', undefined, 42, false, {}])
    assert.equal(
      (await directory.setProject!('a', project as string, signal())).kind,
      'failed'
    );
  const controller = new AbortController();
  controller.abort();
  assert.equal(
    (await directory.setProject!('a', 'p', controller.signal)).kind,
    'cancelled'
  );
  assert.equal(calls, 0);
});

test('project transport failure and late body cancellation cannot confirm a write', async () => {
  for (const status of [400, 404, 500]) {
    const directory = createThreadDirectory({
      apiBase: 'http://localhost/api',
      browserOrigin: 'http://localhost',
      fetch: async () => new Response('failure', { status }),
    });
    assert.equal(
      (await directory.setProject!('a', 'p', signal())).kind,
      'failed'
    );
  }
  let finish!: (response: Response) => void;
  const directory = createThreadDirectory({
    apiBase: 'http://localhost/api',
    browserOrigin: 'http://localhost',
    fetch: async () =>
      new Promise<Response>((done) => {
        finish = done;
      }),
  });
  const controller = new AbortController();
  const pending = directory.setProject!('a', 'p', controller.signal);
  for (let i = 0; i < 30 && !finish; i++) await Promise.resolve();
  controller.abort();
  finish(Response.json({ thread_id: 'a', metadata: { projectId: 'p' } }));
  assert.deepEqual(await pending, { kind: 'cancelled' });
});
