import { MdxRenderer } from './MdxRenderer';
import type { ExampleCodeContext } from '../../lib/example-code';

const source = `# React chat interrupts preview

This experimental example composes native React ApprovalCard, MessageList, Markdown and ChatInput with the existing Python Chat Interrupts graph. The React, core, content and neutral LangGraph candidates remain private packages built from source.

## Review a demo booking

Choose **Run**, select **Book UA123** or **Book AA404**, then send the draft. These flights use demo data; no real ticket is purchased. The agent may look up flight information before pausing for your approval.

The example confirms the saved request before showing **Approve demo booking**. Review the flight details and choose **Confirm** or **Cancel**. Each button sends its fixed scalar decision once. Backend text is displayed literally and never supplies commands or button actions.

<ExampleCode file="cockpit/chat/interrupts/react/src/app.tsx" />

The composer is unavailable while a decision is waiting. During active work, Send and New conversation stay blocked while Stop remains available. You can continue on the same conversation after the decision's completed response is confirmed in saved history.

## Own approval authority

ApprovalCard presents the application-authored body and actions. The example owns when those actions may run: it requires one pending book_flight call, one supported root approval, a matching normalized flight number, and a saved checkpoint belonging to the current conversation. Completed lookup calls must have matching causal results.

The owner checks message and tool identities, the confirmed conversation prefix, and the exact current turn. An observed replacement of the interrupt batch, checkpoint or transcript withdraws the captured decision. Multiple pending bookings are blocked even when the backend exposes only one interrupt.

<ExampleCode file="cockpit/chat/interrupts/react/src/authority.ts" />

These checks fence state observed by this page. They are not an atomic checkpoint precondition on the backend resume request; another client changing the same thread without this page observing it is outside this example's guarantee. Each page creates its own fresh thread, and there is no shared-thread picker.

## Confirm completion and recover locally

After each paused or successful operation, the application reads saved history once. It keeps commands blocked until the messages, tool results and root checkpoint agree with the owned operation. Title generation updates metadata without entering the answer stream.

**Stop** detaches the current owner immediately. Late stream or history responses cannot restore its commands. A failed, uncertain, unsupported or stopped conversation requires **New conversation**, which clears local state without replaying the earlier request. The next server thread is created only when you send another message.

<ExampleCode file="cockpit/chat/interrupts/react/src/application.ts" />

The shared backend runs c-interrupts by default. Runtime settings can select a developer LangGraph target; creation, streaming, decisions and saved history all use that target with SDK retries disabled. Thread creation must confirm the exact requested identity.

<ExampleCode file="cockpit/chat/interrupts/react/src/connection.ts" />

Moving between Code and Run preserves the mounted example and unsent draft. Reloading starts an empty page-local conversation.

## Build from source

From a Threadplane checkout with dependencies installed:

~~~sh
npx nx build cockpit-chat-interrupts-react
npx nx e2e cockpit-chat-interrupts-react
~~~

The isolated build uses installed private candidate packages. Browser tests use the real SDK and a persistent compiled Python graph with deterministic providers and real saved checkpoints. The local worker and verification routes are excluded from public output. Docs, Code and Run select this same React implementation; Angular remains the default.
`;

export function ReactChatInterruptsPreview({
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
