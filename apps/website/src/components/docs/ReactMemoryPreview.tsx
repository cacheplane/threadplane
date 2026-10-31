import { MdxRenderer } from './MdxRenderer';
import type { ExampleCodeContext } from '../../lib/example-code';

const source = `# React memory preview

An assistant can use a preference from earlier in the conversation without asking for it again. Thread memory keeps that fact with the conversation; it is different from a local input value and from memory shared across threads.

The native React APIs on this page are experimental, private source-build packages. Run the repository example to use them; they are not an npm installation recipe.

## Read the backend projection

The memory graph extracts facts into its state and streams those values alongside messages. React observes the native LangGraph snapshot, and the example validates the expected memory fields before presenting them. Start by inspecting values as data; keep the composer draft in local React state. A new conversation has a new thread identity and therefore a separate thread-scoped memory.

~~~tsx
import type { LangGraphSession } from '@threadplane/langgraph';
import { useAgent } from '@threadplane/react';

export function MemoryState({ session }: { session: LangGraphSession }) {
  const snapshot = useAgent(session);
  return <pre>{JSON.stringify(snapshot.values, null, 2)}</pre>;
}
~~~

The [conversation walkthrough](/docs/langgraph/concepts/conversation-turns) connects this capability to requests, tools, UI state, and saved history.

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

The isolated build installs local candidate packages and checks strict declarations and emitted browser modules. Browser tests use real SDK HTTP and SSE against a local fixture. Docs, Code, and Run select this same React implementation.
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
