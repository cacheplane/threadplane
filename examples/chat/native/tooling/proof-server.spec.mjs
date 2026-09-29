import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startProofServer } from './proof-server.mjs';

async function deadline(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Proof operation exceeded deadline')),
          2000
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const expectations = () => [
  { method: 'GET', path: '/list', body: ['list'], concurrentGroup: 'startup' },
  {
    method: 'GET',
    path: '/lookup',
    body: ['lookup'],
    concurrentGroup: 'startup',
  },
  { method: 'GET', path: '/history', body: ['history'] },
];

test('proof server sends exact SSE frames and validates a dynamic payload', async (t) => {
  const server = await startProofServer([
    {
      method: 'POST',
      path: '/stream',
      assertPayload(payload) {
        assert.deepEqual(payload, { message: 'Hello' });
      },
      events: [{ event: 'values', data: { messages: [] } }],
      holdBody: true,
    },
  ]);
  t.after(() => server.close());
  const response = await deadline(
    fetch(server.origin + '/stream', {
      method: 'POST',
      body: JSON.stringify({ message: 'Hello' }),
    })
  );
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  const reader = response.body.getReader();
  const first = await deadline(reader.read());
  assert.equal(
    new TextDecoder().decode(first.value),
    'event: values\ndata: {"messages":[]}\n\n'
  );
  assert.equal(first.done, false);
  server.steps[0].releaseBody();
  assert.equal((await deadline(reader.read())).done, true);
  assert.deepEqual(await deadline(server.steps[0].closed), { finished: true });
  server.verify();
});

test('proof server observes consumed held SSE physically close on cancellation', async (t) => {
  const server = await startProofServer([
    {
      method: 'GET',
      path: '/stream',
      holdBody: true,
      events: [{ event: 'values', data: { messages: [] } }],
    },
  ]);
  t.after(() => server.close());
  const controller = new AbortController();
  const response = await deadline(
    fetch(server.origin + '/stream', { signal: controller.signal })
  );
  const reader = response.body.getReader();
  assert.equal((await deadline(reader.read())).done, false);
  controller.abort();
  await assert.rejects(deadline(reader.read()), { name: 'AbortError' });
  assert.deepEqual(await deadline(server.steps[0].closed), { finished: false });
  server.verify();
});

test('proof server rejects failed dynamic payload assertions', async (t) => {
  const server = await startProofServer([
    {
      method: 'POST',
      path: '/stream',
      assertPayload(payload) {
        assert.deepEqual(payload, { message: 'Hello' });
      },
      events: [],
    },
  ]);
  t.after(() => server.close());
  const response = await fetch(server.origin + '/stream', {
    method: 'POST',
    body: JSON.stringify({ message: 'Different' }),
  });
  assert.equal(response.status, 500);
  await response.text();
  assert.throws(() => server.verify(), /Proof server rejected requests/);
});

for (const order of [
  ['list', 'lookup'],
  ['lookup', 'list'],
]) {
  test(`proof server concurrent startup accepts ${order.join(
    ' then '
  )} with stable handles`, async (t) => {
    const server = await startProofServer(expectations());
    t.after(() => server.close());
    for (const path of [...order, 'history']) {
      const response = await fetch(server.origin + '/' + path);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), [path]);
    }
    assert.equal((await server.steps[0].received).path, '/list');
    assert.equal((await server.steps[1].received).path, '/lookup');
    assert.equal((await server.steps[2].received).path, '/history');
    server.verify();
  });
}

for (const order of [
  ['history', 'list', 'lookup'],
  ['list', 'list', 'history'],
  ['unexpected', 'lookup', 'history'],
  ['list', 'lookup', 'history', 'history'],
]) {
  test(`proof server rejects out-of-group, duplicate, or unexpected sequence ${order.join(
    ', '
  )}`, async (t) => {
    const server = await startProofServer(expectations());
    t.after(() => server.close());
    const statuses = [];
    for (const path of order) {
      const response = await fetch(server.origin + '/' + path);
      statuses.push(response.status);
      await response.text();
    }
    assert.ok(statuses.includes(500));
    assert.throws(() => server.verify(), /Proof server rejected requests/);
  });
}

test('proof server concurrent groups still enforce exact payload and missing expectations', async (t) => {
  const server = await startProofServer([
    {
      method: 'POST',
      path: '/lookup',
      payload: { id: 'a' },
      concurrentGroup: 'startup',
    },
    { method: 'GET', path: '/list', concurrentGroup: 'startup' },
  ]);
  t.after(() => server.close());
  assert.throws(() => server.verify(), /Exact request count/);
  const response = await fetch(server.origin + '/lookup', {
    method: 'POST',
    body: JSON.stringify({ id: 'b' }),
  });
  assert.equal(response.status, 500);
  await response.text();
  assert.throws(() => server.verify(), /Proof server rejected requests/);
});
