import {
  bindClientTools,
  clientToolsChannel,
  clientToolsRouter,
  createInMemoryClientToolExecutionStore,
  createPostgresClientToolExecutionStore,
  THREADPLANE_CLIENT_TOOL_EXECUTIONS_SCHEMA,
  THREADPLANE_CLIENT_TOOL_EXECUTIONS_MIGRATION,
  type ClientToolExecutionStore,
  type ClientToolExecutionKey,
  type ClientToolExecutionAcquisition,
  type ClientToolExecutionSettlement,
  type PostgresTaggedSql,
} from '@threadplane/middleware/langgraph';
import { Annotation, MessagesAnnotation } from '@langchain/langgraph';

const state = Annotation.Root({
  ...MessagesAnnotation.spec,
  ...clientToolsChannel(),
});
export function route(value: typeof state.State) {
  return clientToolsRouter([])(value);
}
export const model = bindClientTools(
  { bindTools: (tools: unknown[]) => tools },
  [],
  { messages: [] }
);
const store: ClientToolExecutionStore =
  createInMemoryClientToolExecutionStore();
const key: ClientToolExecutionKey = {
  threadId: 'consumer',
  toolCallId: '__proto__',
};
const acquired: ClientToolExecutionAcquisition = await store.acquire(
  key,
  'opaque'
);
if (acquired.status === 'acquired') {
  const settlement: ClientToolExecutionSettlement = {
    invocation: 'opaque',
    token: acquired.token,
    result: '{"ok":true,"value":"literal string"}',
  };
  const acknowledgment: 'accepted' | 'rejected' = await store.settle(
    key,
    settlement
  );
  void acknowledgment;
}
const oldProvider = {
  claim: async () => 'claimed',
  record: async () => undefined,
};
// @ts-expect-error old providers do not implement invocation ownership
const old: ClientToolExecutionStore = oldProvider;
// @ts-expect-error old claim surface is removed
store.claim(key);
// @ts-expect-error old record surface is removed
store.record(key, {});
// @ts-expect-error old lookup surface is removed
store.lookup(key.threadId, [key.toolCallId]);
void old;
export function postgres(sql: PostgresTaggedSql): ClientToolExecutionStore {
  return createPostgresClientToolExecutionStore(sql);
}
export const schema: string = THREADPLANE_CLIENT_TOOL_EXECUTIONS_SCHEMA;
export const migration: string = THREADPLANE_CLIENT_TOOL_EXECUTIONS_MIGRATION;
