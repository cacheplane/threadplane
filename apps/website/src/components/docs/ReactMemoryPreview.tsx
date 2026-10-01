import { MdxRenderer } from './MdxRenderer';
import type { ExampleCodeContext } from '../../lib/example-code';

const source = `# React memory preview

This experimental example uses native React chat components with the existing Python LangGraph memory graph. It starts each conversation empty and keeps learned facts in that thread's state. React, core, content, and the framework-neutral LangGraph candidates remain private source-build packages.

## Learn and recall in one conversation

Choose **Run** and introduce a fictional name or preference. The response streams first; a separate extraction pass then updates **Learned facts**. Wait for **Response complete**, then ask the assistant to recall those facts in the same conversation. Corrections are extracted on a later turn.

The panel displays confirmed string facts from the server. It replaces the previous dictionary rather than merging facts in the browser. Missing or malformed memory clears the panel, and keys and values render as literal text.

**New conversation** releases the previous session and starts with an empty transcript and facts panel. These facts are thread-scoped: this preview does not demonstrate the Store API, a user namespace, or memory shared across conversations.

## Ownership and rendering

A stable application owner confirms conversation creation before sending a message. React borrows snapshots with useAgent and renders the native MessageList and ChatInput alongside a simple facts panel.

<ExampleCode file="cockpit/langgraph/memory/react/src/app.tsx" />

**Stop** cancels active work. Cancellation, failed or uncertain requests, and every unexpected pause require **New conversation**. The owner blocks duplicate commands synchronously and fences late results after disposal. It never guesses a resume command or silently retries thread creation.

<ExampleCode file="cockpit/langgraph/memory/react/src/application.ts" />

The existing shared backend is used by default. A developer LangGraph target is configured through runtime settings, with credentials passed as SDK headers. Keep credentials out of messages and source code.

<ExampleCode file="cockpit/langgraph/memory/react/src/connection.ts" />

## Build from source

From a Threadplane checkout with dependencies installed:

~~~sh
npx nx build cockpit-langgraph-memory-react
npx nx e2e cockpit-langgraph-memory-react
~~~

The isolated build installs local candidate packages and checks strict declarations and emitted browser modules. Browser tests use real SDK HTTP and SSE against a local fixture. Docs, Code, and Run select this same React implementation. Streaming and interrupts also have public React previews; other topics remain pending.
`;

export function ReactMemoryPreview({
  exampleCode,
}: {
  exampleCode: ExampleCodeContext | null;
}) {
  return (
    <div className="docs-workspace-article">
      <article className="docs-article-layout flex-1 py-8 px-4 sm:px-6 md:px-12 md:max-w-3xl">
        <MdxRenderer source={source} exampleCode={exampleCode} />
      </article>
    </div>
  );
}
