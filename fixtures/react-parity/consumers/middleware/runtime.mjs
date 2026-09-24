import assert from 'node:assert/strict';
import * as middleware from '@threadplane/middleware/langgraph';

for (const name of [
  'extractClientToolResultMessages',
  'filterDuplicateClientToolResultMessages',
  'lookupClientToolExecutions',
  'recordClientToolResults',
]) {
  assert.equal(
    Object.hasOwn(middleware, name),
    false,
    `Removed runtime export remains: ${name}`
  );
}
for (const name of [
  'bindClientTools',
  'clientToolsChannel',
  'clientToolsRouter',
  'clientToolSpecs',
  'clientToolNames',
  'lastMessage',
  'hasClientToolCall',
  'hasServerToolCall',
  'routeAfterAgent',
  'createInMemoryClientToolExecutionStore',
  'createPostgresClientToolExecutionStore',
]) {
  assert.equal(
    typeof middleware[name],
    'function',
    `Missing supported export ${name}`
  );
}
assert.equal(
  typeof middleware.THREADPLANE_CLIENT_TOOL_EXECUTIONS_SCHEMA,
  'string'
);
const store = middleware.createInMemoryClientToolExecutionStore();
const key = { threadId: 'consumer', toolCallId: '__proto__' };
const owner = await store.acquire(key, 'opaque');
assert.equal(owner.status, 'acquired');
assert.deepEqual(await store.acquire(key, 'opaque'), { status: 'unavailable' });
assert.deepEqual(await store.acquire(key, 'different'), { status: 'conflict' });
const result = JSON.stringify({ ok: true, value: 'literal string' });
assert.equal(
  await store.settle(key, { invocation: 'opaque', token: owner.token, result }),
  'accepted'
);
assert.deepEqual(await store.acquire(key, 'opaque'), {
  status: 'complete',
  result,
});
assert.equal(
  await store.settle(key, { invocation: 'opaque', token: 'foreign', result }),
  'rejected'
);
for (const method of ['claim', 'record', 'lookup'])
  assert.equal(Object.hasOwn(store, method), false);
assert.equal(
  typeof middleware.THREADPLANE_CLIENT_TOOL_EXECUTIONS_MIGRATION,
  'string'
);
console.log(
  'Installed middleware ESM and owned execution-store controls passed.'
);
