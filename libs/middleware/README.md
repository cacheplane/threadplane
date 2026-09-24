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

`createInMemoryClientToolExecutionStore()` and
`createPostgresClientToolExecutionStore()` retain the `claim`, `record`, and
`lookup` execution-store contract. A caller that acquires a claim can execute a
tool and record its result; a later caller can reuse the saved result. In-memory
records live only for the lifetime of that store instance.

For persistent storage, create the table once and pass a `postgres`-style SQL
tag to the Postgres store:

```ts
import postgres from 'postgres';
import {
  THREADPLANE_CLIENT_TOOL_EXECUTIONS_SCHEMA,
  createPostgresClientToolExecutionStore,
} from '@threadplane/middleware/langgraph';

const sql = postgres(process.env.DATABASE_URL!);
await sql.unsafe(THREADPLANE_CLIENT_TOOL_EXECUTIONS_SCHEMA);

const clientToolExecutions = createPostgresClientToolExecutionStore(sql);
```

These stores do not yet persist durable invocation provenance: identity is a
thread and tool-call ID (plus the configured PostgreSQL tenant), without a
verified tool name or argument identity, and without a guarantee of lossless
result fidelity. `record` does not
authenticate an owner token. Applications must coordinate which claimant may
write a result and handle unresolved executions themselves.

A saved result does not establish that a redelivered call is the same invocation,
prove that the graph consumed it, or guarantee exactly-once effects. Do not use
the execution records as delivery receipts or filter graph history based on
them. Two PostgreSQL stores using the same database, table, and tenant share
records. No new receipt table is introduced by this removal.

## Peer dependencies

`@langchain/core` and `@langchain/langgraph`. The package has no runtime dependencies of its
own.
