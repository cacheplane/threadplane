import { MdxRenderer } from './MdxRenderer';
import type { ExampleCodeContext } from '../../lib/example-code';

const source = `# React persistence preview

This experimental example uses native React chat components with the existing Python LangGraph persistence graph. Conversation history is saved by the server's checkpointer. React, core, content, and the framework-neutral LangGraph candidates remain private source-build packages.

## Create and revisit conversations

Choose **Run** and introduce a fictional name or preference. Wait for **Response complete**, choose **New conversation**, and send a different fictional fact. The **Saved conversations** picker lists the two confirmed conversations created on this page.

Select **Conversation 1** to load its history from the server. The old transcript clears while history loads, and the composer and picker stay disabled until the read finishes. Ask the assistant to recall the first fictional fact, then select **Conversation 2** to see its separate history. Switching conversations does not create a thread or start a model run.

The picker belongs to the current page. Reloading clears its list even though the server retains the conversations. This preview does not provide a server-wide conversation catalog, browser storage, history pagination, branching, deletion, or the Store API.

## Ownership and rendering

A stable application owner records only confirmed thread IDs. Selecting a known conversation creates a fresh session bound to its ID and explicitly loads server history. Cached rows never authorize a selected session. React borrows snapshots with useAgent and renders the native MessageList and ChatInput alongside a semantic conversation picker.

<ExampleCode file="cockpit/langgraph/persistence/react/src/app.tsx" />

**Stop** cancels active work. A stopped, failed, uncertain, or unexpectedly paused conversation becomes unavailable on this page. Choose **New conversation** or another available entry to continue. The owner blocks competing commands synchronously and fences late results after cancellation or disposal; a fulfilled history promise alone never grants command authority.

<ExampleCode file="cockpit/langgraph/persistence/react/src/application.ts" />

The existing shared backend is used by default. A developer LangGraph target can be configured through runtime settings, with credentials passed as SDK headers. Creation and execution use zero SDK retries.

<ExampleCode file="cockpit/langgraph/persistence/react/src/connection.ts" />

## Build from source

From a Threadplane checkout with dependencies installed:

~~~sh
npx nx build cockpit-langgraph-persistence-react
npx nx e2e cockpit-langgraph-persistence-react
~~~

The isolated build installs local candidate packages and checks strict declarations and emitted browser modules. Browser tests use real SDK HTTP and SSE against a local fixture. Docs, Code, and Run select this same React implementation. Public React previews cover streaming, interrupts, memory, client tools, persistence, durable execution, subgraphs, time travel, and deployment runtime; AG-UI Streaming and Interrupts also have React previews on Event Mapping and the Interrupts guide; other topics remain pending.
`;

export function ReactPersistencePreview({
  exampleCode,
}: {
  readonly exampleCode: ExampleCodeContext | null;
}) {
  return (
    <div className="docs-workspace-article">
      <article className="docs-article-layout flex-1 py-8 px-4 sm:px-6 md:px-12 md:max-w-3xl">
        <MdxRenderer source={source} exampleCode={exampleCode} />
      </article>
    </div>
  );
}
