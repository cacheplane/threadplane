# @threadplane/middleware

The backend half of client tools in [Threadplane](https://github.com/cacheplane/threadplane),
the open-source thread-plane for agents. Client tools are declared in the browser: the model
calls them, and the browser executes them.

The `@threadplane/middleware/langgraph` entrypoint is the LangGraph.js twin of the Python
`threadplane-middleware` package: it binds client-declared tool stubs onto your model and
routes client-tool-only turns to `END` so the browser executes them.

## How it works

When a browser client sends a tool catalog (`{ name, description, parameters }` objects)
along with a run request, the graph exposes those tools to the model and routes their calls
back to the browser instead of executing them server-side. The browser executes the call and
re-runs the graph with a `ToolMessage` carrying the result.

The catalog is read from `state.tools`, falling back to `state.client_tools` if `tools` is
absent.

## Installation

```bash
npm install @threadplane/middleware
# peer deps:
npm install @langchain/core @langchain/langgraph
```

## Usage

```ts
import { Annotation, MessagesAnnotation, StateGraph, END } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import {
  bindClientTools,
  clientToolsChannel,
  clientToolsRouter,
} from '@threadplane/middleware/langgraph';

// Declare the client-tools state channels (tools + client_tools) in one line.
const State = Annotation.Root({ ...MessagesAnnotation.spec, ...clientToolsChannel() });

const SERVER_TOOLS: unknown[] = []; // your server-owned tools (if any)
const baseLlm = new ChatOpenAI({ model: 'gpt-4o-mini' });

async function agent(state: typeof State.State) {
  // Call bindClientTools per-run inside the node — the client catalog arrives
  // in state and may differ between runs.
  const llm = bindClientTools(baseLlm, SERVER_TOOLS, state);
  const response = await llm.invoke(state.messages);
  return { messages: [response] };
}

const graph = new StateGraph(State)
  .addNode('agent', agent)
  .addEdge('__start__', 'agent')
  // clientToolsRouter binds the server tool names once; pass [] when there are none.
  // With no server tools there is no tool node, so END is the only destination.
  .addConditionalEdges('agent', clientToolsRouter([]), [END])
  .compile();
```

The router's server destination defaults to `'server_tools'`. It cannot default to
`'tools'`: `clientToolsChannel()` declares a `tools` state channel, and LangGraph.js
shares one namespace between channel names and node names, so `addNode('tools', …)`
throws *"tools is already being used as a state attribute"*. Name the server tool node
`server_tools` (or pass `{ toolsNode }` to use another name).

### What happens with a client tool call

1. The model emits a tool call whose name matches a client-declared tool.
2. `clientToolsRouter` (via `routeAfterAgent`) returns `"__end__"` — the run ends.
3. The browser receives the partial output, executes the tool locally, and re-runs the graph
   with a `ToolMessage` containing the result.
4. The model continues from there as if it had called a server tool.

A turn that mixes a server tool call and a client tool call routes to the **server**
destination first (the server tool runs; the client call surfaces on a later turn).

### Lower-level helpers

```ts
import {
  clientToolSpecs,    // → OpenAI function-tool objects for model.bindTools
  clientToolNames,    // → Set<string> of client tool names
  hasClientToolCall,  // → boolean
  hasServerToolCall,  // → boolean (takes serverToolNames)
  lastMessage,        // → the last message from state.messages
  routeAfterAgent,    // → routing string (takes serverToolNames)
} from '@threadplane/middleware/langgraph';
```

## Execution stores and receipt helper removal

The receipt helpers `extractClientToolResultMessages`,
`filterDuplicateClientToolResultMessages`, `lookupClientToolExecutions`, and
`recordClientToolResults` have been deliberately removed. Their helper-only types
`ClientToolResultMessage`, `RecordClientToolResultsInput`, and
`RecordClientToolResultsResult` are also removed. This is a breaking API change:
remove those imports and any receipt-ingestion or message-filtering integration.
There is no replacement receipt helper or compatibility alias.

### Unreleased invocation ownership protocol

This source-tree change is unreleased. It does not imply that the currently published
middleware version implements this contract. Upgrade the runtime, provider integration,
and database together when adopting this code; no compatibility adapter is provided.

The existing factory names now implement `acquire(key, invocation)` and
`settle(key, { invocation, token, result })`. `claim`, `record`, `lookup`,
`ClientToolResult`, `ClientToolExecutionRecord`, and `ClientToolExecutionStatus` are
removed. The key remains a thread ID and tool-call ID, plus the configured PostgreSQL
tenant. The invocation is opaque metadata bound to that stable key, never another key.

Acquisition returns one of:

- `{ status: 'acquired', token }`: the only owner allowed to execute and settle.
- `{ status: 'complete', result }`: an exact encoded completion for reuse, with no owner token.
- `{ status: 'conflict' }`: the stable identity is already bound to a different invocation.
- `{ status: 'unavailable' }`: executing, unknown, legacy, or completed without a reusable result.

Settlement returns `accepted` or `rejected`. It never inserts an unknown execution.
Only the original token and invocation can complete it. An identical reusable string
retry is acknowledged without changing the logical result; a different result is
rejected. After a `null` non-reusable completion, every retry is rejected. SQL UPDATE
triggers may still run for an identical acknowledgment retry. There is no lease,
expiration, ownership takeover, or automatic runtime retry after an uncertain response.
Memory records last only as long as their store instance.

The private LangGraph session owns the representation: it compares tool name and exact
plain arguments (including missing values, array holes, and special numbers), and
reuses a result only if its entire success/error envelope survives JSON serialization
without changing that value. Literal JSON-looking and `Error:` strings stay strings.
Undefined values/properties, sparse arrays, NaN, infinities, and negative zero complete
exactly for the original owner but store `null`; later sessions cannot reuse or rerun
them. A mismatch blocks further execution and graph writes in that session, including
after a history load. Tools marked `idempotent: true` bypass durable storage while
retaining same-session invocation identity checks.

These guarantees apply to the private shared runtime and this new provider protocol.
The legacy `@threadplane/chat` execution guard still uses its separate old contract and
is outside this guarantee. Do not adapt it by merely renaming its methods.

### PostgreSQL setup and cutover

For a **fresh** installation, explicitly apply
`THREADPLANE_CLIENT_TOOL_EXECUTIONS_SCHEMA`. For an **existing** table, explicitly apply
`THREADPLANE_CLIENT_TOOL_EXECUTIONS_MIGRATION`. Factory construction never runs DDL.

```ts
import postgres from 'postgres';
import {
  THREADPLANE_CLIENT_TOOL_EXECUTIONS_MIGRATION,
  createPostgresClientToolExecutionStore,
} from '@threadplane/middleware/langgraph';

const sql = postgres(process.env.DATABASE_URL!);
// Run once as an operational cutover step after draining and auditing writers.
await sql.unsafe(THREADPLANE_CLIENT_TOOL_EXECUTIONS_MIGRATION);
const clientToolExecutions = createPostgresClientToolExecutionStore(sql, {
  tenantId: 'tenant-a',
});
```

Cut over by draining tool executions and all writers, auditing custom SQL writers,
applying the migration, deploying the new runtime/provider integration, then resuming
traffic. The repeat-safe migration locks the existing table in a transaction. It keeps
the table and its primary key, historical status/result JSON, timestamps, and existing
new-protocol data. Only missing ownership tokens receive a legacy-unknown marker.
Historical rows remain unavailable; historical JSON results are never promoted into
certified completions, including partially upgraded rows with invocation metadata.

The required owner-token column has no default. This rejects the old factory's
INSERT/UPSERT statements for both existing and new identities, but **does not fence
custom direct UPDATE writers**. The drain and audit are therefore required. Resolve
unknown executions externally; the migration neither guesses their outcomes nor
reopens their identities.

A saved execution result is not a graph-delivery receipt or an exactly-once guarantee
for external effects. Do not filter graph history from these records. Two PostgreSQL
stores using the same database, table, and tenant share ownership. The removed receipt
helpers have no replacement and no new receipt table is introduced.

## Peer dependencies

`@langchain/core` and `@langchain/langgraph`. The package has no runtime dependencies of its
own.
