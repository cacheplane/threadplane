import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNativeMastraServer } from './server.mjs';
test('fresh actual service uses isolated database and closes exact owned child', async () => {
  const owner = await createNativeMastraServer();
  const response = await fetch(owner.url + '/agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      threadId: crypto.randomUUID(),
      runId: crypto.randomUUID(),
      protocolVersion: '1.0',
      messages: [
        {
          id: crypto.randomUUID(),
          role: 'user',
          content: 'Please reserve North Pines for 2 nights.',
        },
      ],
      state: {},
      tools: [],
      context: [],
      forwardedProps: {},
    }),
  });
  const bytes = await response.text();
  assert.match(bytes, /mastra:tool_suspend/);
  assert.equal(owner.stats().requests.length, 1);
  await owner.close();
  assert.ok(Object.values(owner.stats().closure).every(Boolean));
  assert.equal(owner.stats().closure.portsAbsent, true);
});
test('startup failure closes owned process and database', async () => {
  await assert.rejects(
    createNativeMastraServer({ failStartup: true }),
    (error) => {
      assert.ok(Object.values(error.fixtureClosure.closure).every(Boolean));
      return true;
    }
  );
});
test('listen failure removes exact temporary database and owned child', async () => {
  const { createServer } = await import('node:http');
  const blocker = createServer();
  await new Promise((yes) => blocker.listen(0, '127.0.0.1', yes));
  try {
    await assert.rejects(
      async () => {
        const unexpected = await createNativeMastraServer({
          port: blocker.address().port,
        });
        await unexpected.close();
      },
      (error) => {
        assert.match(error.message, /EADDRINUSE/);
        assert.ok(Object.values(error.fixtureClosure.closure).every(Boolean));
        return true;
      }
    );
  } finally {
    await new Promise((yes) => blocker.close(yes));
  }
});
test('SIGTERM during held actual stream closes upstream before cleanup', async () => {
  const owner = await createNativeMastraServer({ mode: 'held' });
  const response = await fetch(owner.url + '/agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      threadId: crypto.randomUUID(),
      runId: crypto.randomUUID(),
      protocolVersion: '1.0',
      messages: [
        {
          id: crypto.randomUUID(),
          role: 'user',
          content: 'Please reserve North Pines for 2 nights.',
        },
      ],
      state: {},
      tools: [],
      context: [],
      forwardedProps: {},
    }),
  });
  const reader = response.body.getReader();
  await reader.read();
  process.kill(owner.pid, 'SIGTERM');
  await reader.cancel();
  await owner.close();
  assert.ok(Object.values(owner.stats().closure).every(Boolean));
  assert.equal(owner.stats().requests[0].closed, true);
  assert.equal(owner.stats().requests[0].upstreamClosed, true);
});
test('inherited Library and provider environment cannot contaminate actual fixture', async () => {
  const names = [
    'OPENAI_BASE_URL',
    'AG_UI_MASTRA_DB_PATH',
    'THREADPLANE_AG_UI_FIXTURE_ENVIRONMENT',
  ];
  const saved = names.map((name) => process.env[name]);
  for (const name of names)
    process.env[name] = 'https://foreign.invalid/library';
  let owner;
  try {
    owner = await createNativeMastraServer();
    assert.match(
      owner.stats().configuration.modelUrl,
      /^http:\/\/127\.0\.0\.1:/
    );
    assert.ok(
      owner
        .stats()
        .configuration.database.startsWith(owner.stats().ownership.database)
    );
  } finally {
    await owner?.close();
    names.forEach((name, i) => {
      if (saved[i] === undefined) delete process.env[name];
      else process.env[name] = saved[i];
    });
  }
});
