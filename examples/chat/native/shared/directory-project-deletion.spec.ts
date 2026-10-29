import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createThreadDirectory } from './directory.js';
const signal = () => new AbortController().signal;
test('project membership searches exact first-page metadata and retains literal IDs', async () => {
  const directory = createThreadDirectory({
    apiBase: 'http://localhost/api',
    browserOrigin: 'http://localhost',
    fetch: async (input, init) => {
      assert.equal(String(input), 'http://localhost/api/threads/search');
      assert.equal(init?.method, 'POST');
      assert.deepEqual(JSON.parse(String(init?.body)), {
        metadata: { projectId: ' p/x ' },
        limit: 50,
        offset: 0,
      });
      return Response.json([
        {
          thread_id: ' a/b ',
          metadata: { projectId: ' p/x ', archived: true },
        },
        { thread_id: '__proto__', metadata: { projectId: ' p/x ' } },
      ]);
    },
  });
  assert.deepEqual(await directory.projectMembers!(' p/x ', signal()), {
    kind: 'ready',
    value: [' a/b ', '__proto__'],
  });
});
for (const body of [
  null,
  {},
  [{ thread_id: 'a' }],
  [{ thread_id: 'a', metadata: { projectId: 'other' } }],
  [{ thread_id: ' ', metadata: { projectId: 'p' } }],
  [{ thread_id: '.', metadata: { projectId: 'p' } }],
  [
    { thread_id: 'a', metadata: { projectId: 'p' } },
    { thread_id: 'a', metadata: { projectId: 'p' } },
  ],
  Array.from({ length: 51 }, (_, i) => ({
    thread_id: String(i),
    metadata: { projectId: 'p' },
  })),
])
  test(`membership rejects malformed complete page ${JSON.stringify(body).slice(
    0,
    70
  )}`, async () => {
    const directory = createThreadDirectory({
      apiBase: 'http://localhost/api',
      browserOrigin: 'http://localhost',
      fetch: async () => Response.json(body),
    });
    assert.equal(
      (await directory.projectMembers!('p', signal())).kind,
      'failed'
    );
  });
test('membership validates arguments and aborted admission before IO', async () => {
  let calls = 0;
  const directory = createThreadDirectory({
    apiBase: 'http://localhost/api',
    browserOrigin: 'http://localhost',
    fetch: async () => {
      calls++;
      return Response.json([]);
    },
  });
  for (const id of ['', ' ', null, 42])
    assert.equal(
      (await directory.projectMembers!(id as string, signal())).kind,
      'failed'
    );
  const controller = new AbortController();
  controller.abort();
  assert.equal(
    (await directory.projectMembers!('p', controller.signal)).kind,
    'cancelled'
  );
  assert.equal(calls, 0);
});

test('membership cancellation during response cannot publish its IDs', async () => {
  let finish!: (response: Response) => void;
  const directory = createThreadDirectory({
    apiBase: 'http://localhost/api',
    browserOrigin: 'http://localhost',
    fetch: async () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  });
  const controller = new AbortController();
  const pending = directory.projectMembers!('p', controller.signal);
  for (let i = 0; i < 30 && !finish; i++) await Promise.resolve();
  controller.abort();
  finish(Response.json([{ thread_id: 'a', metadata: { projectId: 'p' } }]));
  assert.deepEqual(await pending, { kind: 'cancelled' });
});
