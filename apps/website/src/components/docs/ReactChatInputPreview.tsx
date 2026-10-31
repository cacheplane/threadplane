import { MdxRenderer } from './MdxRenderer';
import type { ExampleCodeContext } from '../../lib/example-code';

const source = `# React chat input preview

Let the traveler write the next question while the current answer arrives. A controlled composer keeps its draft separate from the accepted message and the agent’s run status.

The native React APIs on this page are experimental, private source-build packages. Run the repository example to use them; they are not an npm installation recipe.

## Accept the draft synchronously

\`ChatInput\` calls \`onSubmit\` with the text as typed. Return \`false\` when the application cannot accept it; the draft then stays in place. Otherwise the input clears and the application can start asynchronous work. Use \`busy\` to block another Send while keeping the next draft editable, and pass \`onStop\` for active work.

~~~tsx
import { useState } from 'react';
import { ChatInput } from '@threadplane/react/chat';

export function TripComposer({ busy, accept, stop }: {
  busy: boolean;
  accept: (text: string) => boolean;
  stop: () => void;
}) {
  const [draft, setDraft] = useState('');
  return <ChatInput value={draft} onValueChange={setDraft} busy={busy}
    onSubmit={accept} onStop={stop} placeholder="Change the itinerary…" />;
}
~~~

The [conversation walkthrough](/docs/langgraph/concepts/conversation-turns) connects this capability to requests, tools, UI state, and saved history.

## Try the composer

Choose **Run** and type an aviation question. **Enter** sends your message; **Shift+Enter** adds a new line. Turn off **Enter sends a message** to use Enter for new lines and **Ctrl/Command+Enter** to send. Keyboard submission waits until text composition has finished, and whitespace-only drafts are not sent. Accepted messages preserve the text and spacing you typed.

Change **Custom placeholder** to update the empty composer. **Disable message input** blocks typing and sending. These settings stay local and do not start or replace a conversation.

## Keep your next draft

While the assistant responds, **Send** stays disabled and you can type your next draft. That draft remains in the composer while the response is confirmed and after **Response saved** appears. **Stop** stays available during active work, including when message input is disabled.

**New conversation** clears the current draft and transcript locally. If cleanup is still finishing, a newer draft typed during that time is preserved. Your composer settings stay selected. A new server thread is created only when you send a message.

<ExampleCode file="cockpit/chat/input/react/src/app.tsx" />

The application holds the controlled draft above the input's view key. Reset clears the old draft synchronously after checking the live owner; cleanup completion never clears newer text. A rejected submission leaves the draft intact.

## Confirm conversation history

After a successful response, the owner reads saved history once and requires the same confirmed messages and exact current question and answer. Send remains blocked through that confirmation. Title generation updates metadata without entering the answer stream.

A stopped, failed, uncertain or unexpectedly paused conversation requires **New conversation**. Resetting never retries an earlier question. This text-only example also blocks continuation if tools, interrupts or child work appear.

<ExampleCode file="cockpit/chat/input/react/src/application.ts" />

The shared backend runs c-input by default. Runtime settings may select a developer LangGraph target; creation, streaming and saved history all use that target. SDK retries are disabled, and creation requires the exact requested thread identity to be confirmed.

<ExampleCode file="cockpit/chat/input/react/src/connection.ts" />

Moving between Code and Run keeps the mounted example, draft and settings. Reloading starts an empty page-local conversation with the default settings.

## Build from source

From a Threadplane checkout with dependencies installed:

~~~sh
npx nx build cockpit-chat-input-react
npx nx e2e cockpit-chat-input-react
~~~

The isolated build uses installed private candidate packages. Browser tests exercise keyboard handling and actual SDK HTTP/SSE with events and saved state from the compiled Python graph and deterministic providers. Docs, Code and Run select this same React implementation. The default Angular example remains available.
`;

export function ReactChatInputPreview({
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
