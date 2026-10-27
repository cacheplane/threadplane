import { MdxRenderer } from './MdxRenderer';
import type { ExampleCodeContext } from '../../lib/example-code';

const source = `# React chat tool calls preview

This experimental example composes native React ToolObservation, MessageList, Markdown and ChatInput with the existing Python Chat Tool Calls graph. The React, core, content and neutral LangGraph candidates remain private packages built from source.

## Inspect observed calls and results

Choose **Run**, select **Flight UA123**, **Compare airports**, or **Find routes**, then send the draft. The graph uses a read-only aviation demo dataset through lookup_flight, get_airport_info and find_routes. A prompt suggestion fills the draft without creating a conversation or sending a request.

Each tool observation appears under the assistant message that requested it. Arguments appear after the runtime exposes a complete call. A result appears only when its tool-call identity and name match the later result message. Multiple calls to the same tool remain separate, including parallel airport lookups whose results arrive in a different order.

<ExampleCode file="cockpit/chat/tool-calls/react/src/app.tsx" />

Arguments and results are literal observed data. A completed observation does not establish that a business operation succeeded: an unknown flight can return an error in the demo data. The example validates the supported argument shapes and withholds malformed calls. ToolObservation renders the supplied text; the application owns association and formatting.

<ExampleCode file="cockpit/chat/tool-calls/react/src/projection.ts" />

## Confirm the saved conversation

After a successful stream, the application reads saved history once. Follow-up messages remain blocked until the exact observed messages, tool identities, arguments and results agree with a terminal root checkpoint for the current conversation. Every completed tool call must have one later matching result. Text-only answers are also supported.

The owner retains an observed conflict even if a later response restores the earlier content. Changed call arguments, replaced results, failed messages, interrupts, subgraphs and uncertain work require a new local conversation. Partial argument chunks stay private in the runtime and do not count as malformed finalized calls.

<ExampleCode file="cockpit/chat/tool-calls/react/src/authority.ts" />

These checks cover state observed by this page. They do not prevent another client from changing the same server thread without this page observing it. Each page creates a fresh thread and has no shared-thread picker.

## Stop and recover locally

While work is active, Send and New conversation stay blocked and Stop remains available. **Stop** immediately detaches the owner; late stream or saved-history responses cannot restore its commands. **New conversation** releases the old local owner and clears the old draft. New text typed during cleanup is preserved. The next server thread is created only when another message is sent.

<ExampleCode file="cockpit/chat/tool-calls/react/src/application.ts" />

The shared backend runs c-tool-calls. Runtime settings can select a developer LangGraph target; thread creation, streaming and saved history use that same target, with SDK retries disabled. Creation must confirm the exact requested thread identity.

<ExampleCode file="cockpit/chat/tool-calls/react/src/connection.ts" />

Moving between Code and Run preserves the mounted example and unsent draft. Reloading starts an empty page-local conversation.

## Build from source

From a Threadplane checkout with dependencies installed:

~~~sh
npx nx build cockpit-chat-tool-calls-react
npx nx e2e cockpit-chat-tool-calls-react
~~~

The isolated build uses installed private candidate packages. Browser tests use the real SDK and a persistent compiled Python graph with deterministic providers and real saved checkpoints. The local worker and verification routes are excluded from public output. Background title generation updates metadata without entering the answer stream. Docs, Code and Run select this same React implementation; Angular remains the default.
`;

export function ReactChatToolCallsPreview({
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
