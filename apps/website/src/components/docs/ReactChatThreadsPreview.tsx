import { MdxRenderer } from './MdxRenderer';
import type { ExampleCodeContext } from '../../lib/example-code';

const source = `# React chat threads preview

This experimental example composes native React MessageList, Markdown, Reasoning, Citations and ChatInput with the existing Python Chat Threads graph. The React, core, content and neutral LangGraph candidates remain private packages built from source.

## Create and switch conversations

Choose **Run**, select **Try a question**, then send the draft. The suggestion only fills the composer. The first Send creates a conversation; **New conversation** opens a blank local view and waits for Send before creating another.

The picker contains conversations created while this page is open. Select a saved conversation to restore its messages and draft. Each selection loads its saved history before another message can be sent. New preserves drafts on saved conversations and replaces an unsent blank view.

<ExampleCode file="cockpit/chat/threads/react/src/app.tsx" />

The list and drafts belong to this page. Reloading clears them. This preview has no shared conversation search, arbitrary-ID loading, URL routing, renaming or remote deletion. Angular remains the default on this canonical guide.

## Keep titles optional

A completed turn or successful selection can fetch a title for its known conversation. Titles are displayed as literal text, limited to 80 Unicode code points. Missing or invalid titles leave the numbered fallback or last valid title in place. A title request does not hold up the composer.

Changing conversations, sending again, stopping or leaving the page cancels the previous title request. Late title data cannot rename the newly selected conversation. Titles never authorize execution or replace saved-history validation.

<ExampleCode file="cockpit/chat/threads/react/src/titles.ts" />

## Check saved history before continuing

After each successful stream, the application reads saved history and compares it with the observed messages. Selection creates a fresh session fixed to the selected thread identity and checks the exact saved transcript and root checkpoint retained for that conversation. Follow-up messages must extend the confirmed prefix with one user message and one completed assistant answer.

<ExampleCode file="cockpit/chat/threads/react/src/authority.ts" />

Plain local records retain identity, draft, title and confirmed evidence; they do not keep inactive sessions or content stores alive. These checks cover state observed by this page and cannot detect an external change that this page has not read.

<ExampleCode file="cockpit/chat/threads/react/src/records.ts" />

## Stop and recover

While creating, receiving or loading, **Stop** releases the current owner and prevents late responses from restoring its commands. An uncertain conversation is marked unavailable. Other confirmed conversations remain selectable, and **New conversation** can start a separate one after cleanup. There is no retry, replay or resume of uncertain work.

Text typed during streaming or saved-history confirmation is kept as the next draft. Selection and cleanup temporarily disable typing. Switching back to a confirmed conversation restores its own draft.

<ExampleCode file="cockpit/chat/threads/react/src/application.ts" />

Runtime settings can select a developer LangGraph target. Creation, streams, history and optional title reads use the same target with SDK retries disabled. Creation must confirm the requested thread identity. The shared backend runs c-threads. Docs, Code and Run select the same React implementation; mode navigation preserves the mounted example and draft.

<ExampleCode file="cockpit/chat/threads/react/src/connection.ts" />

## Build from source

From a Threadplane checkout with dependencies installed:

~~~sh
npx nx build cockpit-chat-threads-react
npx nx e2e cockpit-chat-threads-react
~~~

The isolated build installs private candidate packages. Browser tests use the real SDK and compiled Python graph with deterministic providers and real saved checkpoints. Test workers and verification endpoints are excluded from public output. Background title generation updates metadata without entering the answer stream. This preview does not claim the Angular thread adapter's search, routing or management features.
`;

export function ReactChatThreadsPreview({
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
