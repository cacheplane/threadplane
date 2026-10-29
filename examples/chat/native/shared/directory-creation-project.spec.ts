import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createThreadDirectory } from './directory.js';

const signal = () => new AbortController().signal;
for (const projectId of [' project/one ', '__proto__', null, undefined])
  test(`project creation sends one exact initial POST ${String(
    projectId
  )}`, async () => {
    const calls: { method: string | undefined; body: unknown }[] = [];
    const directory = createThreadDirectory({
      apiBase: 'http://localhost/api',
      browserOrigin: 'http://localhost',
      fetch: async (input, init) => {
        assert.equal(String(input), 'http://localhost/api/threads');
        calls.push({
          method: init?.method,
          body: JSON.parse(String(init?.body)),
        });
        assert.ok(init?.signal);
        return Response.json({
          thread_id: ' a/b ',
          metadata: {
            title: 'Created',
            ...(projectId == null ? {} : { projectId }),
          },
        });
      },
    });
    const result = await directory.create(signal(), projectId);
    assert.deepEqual(calls, [
      {
        method: 'POST',
        body: { metadata: projectId == null ? {} : { projectId } },
      },
    ]);
    assert.equal(result.kind, 'ready');
    if (result.kind === 'ready') {
      assert.equal(result.value.id, ' a/b ');
      assert.equal(result.value.projectId, projectId ?? undefined);
      assert.ok(Object.isFrozen(result.value));
    }
  });

test('project creation rejects malformed targets before transport', async () => {
  let calls = 0;
  const directory = createThreadDirectory({
    apiBase: 'http://localhost/api',
    browserOrigin: 'http://localhost',
    fetch: async () => {
      calls++;
      return Response.json({ thread_id: 'a' });
    },
  });
  for (const project of ['', ' ', 42, false, {}, []])
    assert.equal(
      (await directory.create(signal(), project as string)).kind,
      'failed'
    );
  const controller = new AbortController();
  controller.abort();
  assert.equal(
    (await directory.create(controller.signal, 'p')).kind,
    'cancelled'
  );
  assert.equal(calls, 0);
});

for (const body of [
  null,
  {},
  { thread_id: '' },
  { thread_id: ' ' },
  { thread_id: '.' },
  { thread_id: '..' },
  { thread_id: 42 },
  { thread_id: 'a' },
  { thread_id: 'a', metadata: {} },
  { thread_id: 'a', metadata: { projectId: 'wrong' } },
])
  test(`project creation needs raw exact confirmation ${JSON.stringify(
    body
  )}`, async () => {
    const directory = createThreadDirectory({
      apiBase: 'http://localhost/api',
      browserOrigin: 'http://localhost',
      fetch: async () => Response.json(body),
    });
    assert.equal((await directory.create(signal(), 'p')).kind, 'failed');
  });

test('project creation rejects inherited project evidence from decoded SDK response', async () => {
  // JSON cannot encode inherited properties; mutating Object.prototype makes
  // the missing-own-property distinction observable at the raw boundary.
  Object.defineProperty(Object.prototype, 'projectId', {
    value: 'p',
    configurable: true,
  });
  try {
    const directory = createThreadDirectory({
      apiBase: 'http://localhost/api',
      browserOrigin: 'http://localhost',
      fetch: async () => Response.json({ thread_id: 'a', metadata: {} }),
    });
    assert.equal((await directory.create(signal(), 'p')).kind, 'failed');
  } finally {
    Reflect.deleteProperty(Object.prototype, 'projectId');
  }
});

test('project creation has no retries on HTTP failure and cancellation cannot confirm', async () => {
  let calls = 0;
  for (const status of [400, 500]) {
    const directory = createThreadDirectory({
      apiBase: 'http://localhost/api',
      browserOrigin: 'http://localhost',
      fetch: async () => {
        calls++;
        return new Response('failed', { status });
      },
    });
    assert.equal((await directory.create(signal(), 'p')).kind, 'failed');
  }
  assert.equal(calls, 2);
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
  const pending = directory.create(controller.signal, 'p');
  for (let i = 0; i < 30 && !finish; i++) await Promise.resolve();
  controller.abort();
  finish(Response.json({ thread_id: 'a', metadata: { projectId: 'p' } }));
  assert.equal((await pending).kind, 'cancelled');
});
