import { MdxRenderer } from './MdxRenderer';
import type { ExampleCodeContext } from '../../lib/example-code';

const source = `# React chat messages preview

This experimental example composes native React MessageList, Markdown and ChatInput with the existing Python Chat Messages graph. The React, core, content and neutral LangGraph candidates remain private packages built from source.

## Ask and continue

Choose **Run** and ask an aviation question. The assistant's answer arrives as text and Markdown. Wait for **Response saved** before sending another question in the same conversation. **New conversation** clears the page; a new server thread is created only when you send a message.

**Stop** cancels active work. A failed, stopped, uncertain or unexpectedly paused conversation requires **New conversation**. Resetting never retries an earlier question. Reloading starts an empty page-local conversation.

## Compose message presentation

A stable row renderer labels user, assistant and system articles. It presents application-owned Markdown snapshots and preserves assistant reasoning and citations when supplied. Tool rows are deliberately hidden in this text-only example; observing a tool, interrupt or child blocks further submission.

<ExampleCode file="cockpit/chat/messages/react/src/app.tsx" />

The owner holds the composer disabled through one explicit server history read after a successful response. The saved terminal transcript must preserve every confirmed message and the exact current question and answer. Streaming success alone, changed history and fulfilled reads after Stop do not authorize continuation. Title generation updates thread metadata without entering the visible answer stream.

<ExampleCode file="cockpit/chat/messages/react/src/application.ts" />

The shared backend runs the existing c-messages graph by default. Runtime settings may select a developer LangGraph target; the same target is used for creation, streaming and saved history. SDK retries are disabled, and only the exact returned thread ID confirms creation.

<ExampleCode file="cockpit/chat/messages/react/src/connection.ts" />

## Build from source

From a Threadplane checkout with dependencies installed:

~~~sh
npx nx build cockpit-chat-messages-react
npx nx e2e cockpit-chat-messages-react
~~~

The isolated build uses installed private candidate packages. Browser tests exercise actual SDK HTTP and SSE with events from the compiled Python graph and deterministic providers. Docs, Code and Run select this same React implementation. The default Angular example and its backend remain available.
`;

export function ReactChatMessagesPreview({
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
