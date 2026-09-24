import {
  bindClientTools, clientToolsChannel, clientToolsRouter,
  createInMemoryClientToolExecutionStore, createPostgresClientToolExecutionStore,
  THREADPLANE_CLIENT_TOOL_EXECUTIONS_SCHEMA,
  type ClientToolExecutionStore, type ClientToolExecutionKey,
  type ClientToolExecutionRecord, type ClientToolExecutionStatus,
  type ClientToolResult, type PostgresTaggedSql,
} from '@threadplane/middleware/langgraph';
import { Annotation, MessagesAnnotation } from '@langchain/langgraph';

const state = Annotation.Root({ ...MessagesAnnotation.spec, ...clientToolsChannel() });
export function route(value: typeof state.State) { return clientToolsRouter([])(value); }
export const model = bindClientTools({ bindTools: (tools: unknown[]) => tools }, [], { messages: [] });
const store: ClientToolExecutionStore = createInMemoryClientToolExecutionStore();
const key: ClientToolExecutionKey = { threadId: 'consumer', toolCallId: '__proto__' };
const result: ClientToolResult = { ok: true, value: 'literal string' };
const claim: 'claimed' | ClientToolExecutionRecord = await store.claim(key);
if (claim === 'claimed') await store.record(key, result);
const lookup: Record<string, ClientToolExecutionRecord> = await store.lookup(key.threadId, [key.toolCallId]);
export const status: ClientToolExecutionStatus = lookup[key.toolCallId].status;
export function postgres(sql: PostgresTaggedSql): ClientToolExecutionStore { return createPostgresClientToolExecutionStore(sql); }
export const schema: string = THREADPLANE_CLIENT_TOOL_EXECUTIONS_SCHEMA;
