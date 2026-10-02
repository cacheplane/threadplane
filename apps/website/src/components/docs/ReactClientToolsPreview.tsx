import { MdxRenderer } from './MdxRenderer';
import type { ExampleCodeContext } from '../../lib/example-code';

const source = `# React client-tools preview

This experimental example uses native React chat and approval components with the existing Python LangGraph client-tools graph. It runs five explicitly authored browser functions. Weather data and booking decisions are simulated; no real weather or booking service is contacted. React, core, content, and the framework-neutral LangGraph candidates remain private source-build packages.

## Try browser tools

Choose **Run** and ask for weather in a city, a slow status check, a weather card, a weather snapshot, or confirmation of a fictional booking. The graph receives the authored catalog and requests a function. The browser handles its finalized arguments after the model run finishes.

Normal tools return results to another model run in the same confirmed conversation. Weather cards publish literal finalized details and return a shown acknowledgement. A standalone **weather snapshot** publishes its panel and persists that acknowledgement into the same thread without another model run. The composer remains busy until persistence completes. In a mixed batch, any normal tool makes the whole batch follow up.

<ExampleCode file="cockpit/langgraph/client-tools/react/src/tools.ts" />

## Booking decisions and ownership

Each fictional booking gets a separate **Confirm booking** or **Cancel booking** card. These actions stay available while chat is busy. Parallel cards resolve independently, including identical summaries. Completed weather panels and booking outcomes remain visible until **New conversation**.

React borrows snapshots through useAgent and renders native MessageList, ChatInput, and ApprovalCard. Weather details and booking summaries render as literal text. This preview uses authored functions and example-owned presentation; it does not implement a general view-tool or ask-tool registry or infer schemas from TypeScript.

<ExampleCode file="cockpit/langgraph/client-tools/react/src/app.tsx" />

The application confirms one conversation before dispatch and blocks duplicate commands synchronously. **Stop** cancels active work and revokes pending decisions. Failures, uncertain requests, unexpected pauses, and unresolved or unsupported tool requests require **New conversation**. Leaving the example releases its session and prevents late handlers from continuing the model.

<ExampleCode file="cockpit/langgraph/client-tools/react/src/application.ts" />

The existing shared backend is used by default. A developer LangGraph target can be configured through runtime settings; credentials travel in SDK headers. Keep credentials out of messages and source code.

<ExampleCode file="cockpit/langgraph/client-tools/react/src/connection.ts" />

## Build from source

~~~sh
npx nx build cockpit-langgraph-client-tools-react
npx nx e2e cockpit-langgraph-client-tools-react
~~~

The isolated build installs local candidate packages and checks strict declarations and emitted browser modules. Browser tests use real SDK HTTP and SSE against a local fixture. Docs, Code, and Run select this same React implementation. Public React previews cover streaming, interrupts, memory, client tools, persistence, durable execution, subgraphs, time travel, and deployment runtime; other topics remain pending.
`;

export function ReactClientToolsPreview({ exampleCode }: { readonly exampleCode: ExampleCodeContext | null }) {
  return <div className="docs-workspace-article"><article className="docs-article-layout flex-1 py-8 px-4 sm:px-6 md:px-12 md:max-w-3xl"><MdxRenderer source={source} exampleCode={exampleCode} /></article></div>;
}
