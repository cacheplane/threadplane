import { MdxRenderer } from './MdxRenderer';
import type { ExampleCodeContext } from '../../lib/example-code';

const source = `# React chat subagents preview

This experimental example composes native React ToolObservation, MessageList, Markdown and ChatInput with the existing Python Chat Subagents graph. The React, core, content and neutral LangGraph candidates remain private packages built from source.

## Inspect specialist requests and results

Choose **Run**, select **Plan LAX to JFK**, then send the draft. Research, booking and itinerary specialists provide model-generated planning suggestions. There is no live availability or price lookup, and no actual booking or purchase. The prompt suggestion fills the draft without creating a conversation or sending a request.

Each specialist request appears under the assistant message that requested it. The card identifies the requested role and displays literal task arguments. A result appears only when its call identity and name match the later result message. Repeated identical tasks and parallel results remain separate. An observed result does not establish that a business operation succeeded.

<ExampleCode file="cockpit/chat/subagents/react/src/app.tsx" />

<ExampleCode file="cockpit/chat/subagents/react/src/projection.ts" />

## Inspect local child responses

The **Child response observations** disclosure starts closed. It shows literal child text with the role supplied by that child's validated values. These are local observations from this open conversation, not restored execution history. They are not linked to individual specialist task cards: the native session does not expose the binding needed to make that association.

Observed child text remains visible after saved root confirmation and across follow-up turns. A valid empty child response adds no synthetic answer; its root result remains literal. Stop labels retained child observations **Stopped**, while failed or unconfirmed work labels them **Incomplete**. **Observed response** describes received text, not independent proof of successful child execution.

<ExampleCode file="cockpit/chat/subagents/react/src/children.ts" />

## Confirm the saved root conversation

After a successful stream, the application reads saved history once. Follow-up messages stay blocked until the exact observed root messages, task identities, arguments and results agree with a terminal root checkpoint for the current conversation. Every completed task requires one later matching result. Plain text clarifying answers are supported.

Child responses never enter root request history or authorize commands. Invalid specialist values, child tools or interruptions, changed completed responses, foreign generations and conflicting root evidence withhold continuation, even if a later history load clears child snapshots. A fulfilled history-read promise alone cannot restore continuation after Stop.

<ExampleCode file="cockpit/chat/subagents/react/src/authority.ts" />

These checks cover state observed by this page. They cannot detect a change made by another client without this page observing it. Each page creates a fresh thread and has no shared-thread picker.

## Stop and recover locally

While work is active, Send and New conversation stay blocked and Stop remains available. **Stop** detaches the owner immediately; late stream or history responses cannot restore its commands. **New conversation** releases the local owner and clears its transcript, child observations and old draft. New text typed during cleanup is preserved. The next server thread is created only when another message is sent. There is no replay, child control or remote deletion.

<ExampleCode file="cockpit/chat/subagents/react/src/application.ts" />

The existing shared backend runs c-subagents. Runtime settings can select a developer LangGraph target; thread creation, streaming and saved history use that same target with SDK retries disabled. Creation must confirm the requested thread identity. Code/Run navigation preserves the mounted example and draft; reloading starts an empty page-local conversation.

<ExampleCode file="cockpit/chat/subagents/react/src/connection.ts" />

## Build from source

From a Threadplane checkout with dependencies installed:

~~~sh
npx nx build cockpit-chat-subagents-react
npx nx e2e cockpit-chat-subagents-react
~~~

The isolated build installs private candidate packages. Browser tests use the real SDK and compiled Python parent and child graphs with deterministic providers and real saved checkpoints. Local workers and verification endpoints are excluded from public output. Background title generation updates metadata without entering the answer stream. Docs, Code and Run select the same React implementation; Angular remains the default. This preview does not claim full Angular subagent-card parity.
`;

export function ReactChatSubagentsPreview({
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
