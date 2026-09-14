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

## Durable client-tool result guard

Tier 1 durable dedup records inbound client-tool `ToolMessage` results by
`tool_call_id` before the graph continues. A duplicate redelivery can then be
filtered before server continuation logic sees it.

```ts
import {
  createInMemoryClientToolExecutionStore,
  filterDuplicateClientToolResultMessages,
  recordClientToolResults,
} from '@threadplane/middleware/langgraph';

const clientToolExecutions = createInMemoryClientToolExecutionStore();

async function agent(state: typeof State.State, config: { configurable?: { thread_id?: string } }) {
  const threadId = config.configurable?.thread_id ?? 'default-thread';
  const guard = await recordClientToolResults({
    threadId,
    messages: state.messages,
    store: clientToolExecutions,
  });
  const messages = filterDuplicateClientToolResultMessages({
    messages: state.messages,
    duplicateToolCallIds: new Set(guard.duplicateToolCallIds),
  });

  const llm = bindClientTools(baseLlm, SERVER_TOOLS, state);
  const response = await llm.invoke(messages);
  return { messages: [response] };
}
```

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

M3 is server-side Tier 1 only: it dedups delivered client-tool results and
supports lookup-based reload reconciliation. Pre-execution claims for
non-idempotent browser effects are a later opt-in layer.

## Peer dependencies

`@langchain/core` and `@langchain/langgraph`. The package has no runtime dependencies of its
own.
