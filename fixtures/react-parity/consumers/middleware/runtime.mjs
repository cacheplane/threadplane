import assert from 'node:assert/strict';
import * as middleware from '@threadplane/middleware/langgraph';

for (const name of ['extractClientToolResultMessages', 'filterDuplicateClientToolResultMessages', 'lookupClientToolExecutions', 'recordClientToolResults']) {
  assert.equal(Object.hasOwn(middleware, name), false, `Removed runtime export remains: ${name}`);
}
for (const name of ['bindClientTools', 'clientToolsChannel', 'clientToolsRouter', 'clientToolSpecs', 'clientToolNames', 'lastMessage', 'hasClientToolCall', 'hasServerToolCall', 'routeAfterAgent', 'createInMemoryClientToolExecutionStore', 'createPostgresClientToolExecutionStore']) {
  assert.equal(typeof middleware[name], 'function', `Missing supported export ${name}`);
}
assert.equal(typeof middleware.THREADPLANE_CLIENT_TOOL_EXECUTIONS_SCHEMA, 'string');
const store = middleware.createInMemoryClientToolExecutionStore();
const key = { threadId: 'consumer', toolCallId: '__proto__' };
assert.equal(await store.claim(key), 'claimed');
assert.deepEqual(await store.claim(key), { status: 'executing' });
const result = { ok: true, value: 'literal string' };
await store.record(key, result);
assert.deepEqual(await store.lookup(key.threadId, [key.toolCallId]), { ['__proto__']: { status: 'done', result } });
assert.deepEqual(await store.claim(key), { status: 'done', result });
console.log('Installed middleware ESM and execution-store controls passed.');
