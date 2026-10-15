import { MdxRenderer } from './MdxRenderer';
import type { ExampleCodeContext } from '../../lib/example-code';

const source = `# React chat theming preview

This experimental example composes native React MessageList, Markdown and ChatInput with the existing c-theming Python aviation assistant. React, core, content and neutral LangGraph candidates remain private source-build packages.

## Four local palettes

Choose **Run** and select **Dark**, **Light**, **Ocean** or **Forest**. The palette changes a class on this chat root. It preserves the same application owner, exact unsent draft, messages and active conversation during streaming and saved-history confirmation. Palette changes make no runtime requests, cancel no work and do not change the document theme. A second chat root can choose independently; reload restores Dark.

The eight React chat CSS tokens are **--tp-chat-text**, **--tp-chat-muted**, **--tp-chat-border**, **--tp-chat-surface**, **--tp-chat-accent**, **--tp-chat-on-accent**, **--tp-chat-danger** and **--tp-chat-gap**. These local presets demonstrate this composed React surface. The Angular guide retains its framework-specific token API.

<ExampleCode file="cockpit/chat/theming/react/src/styles.css" />

Markdown uses its design-system text variable. The demo scopes a --ds-text-primary alias to --tp-chat-text around message and reasoning bodies; this is a demo-local bridge, not a ninth React chat token or a global override.

<ExampleCode file="cockpit/chat/theming/react/src/app.tsx" />

## Ask and continue

Only **Send** creates a confirmed server thread and starts the existing aviation graph. Ask an aviation question, then wait for **Response saved** before following up in the same conversation. Saved history must retain the exact confirmed prefix and current question/answer identities; streamed text alone cannot authorize continuation. Theme selection remains available while the owner is busy.

**New conversation** clears local state and creates nothing until Send. **Stop** revokes active delivery; stopped, failed or uncertain work requires a new conversation without automatic retry or replay. Cleanup failure permanently disables authoring and requires reload. These browser ownership checks do not claim a durable external store or backend cancellation acknowledgment.

<ExampleCode file="cockpit/chat/theming/react/src/application.ts" />

One configured LangGraph target serves thread creation, streaming and saved history with SDK retries disabled. The shared backend reuses c-theming. The title model carries TAG_NOSTREAM, so title generation updates thread metadata without entering the visible answer stream.

<ExampleCode file="cockpit/chat/theming/react/src/connection.ts" />
<ExampleCode file="cockpit/chat/theming/python/src/graph.py" />

## Build from source

~~~sh
npx nx build cockpit-chat-theming-react
npx nx e2e cockpit-chat-theming-react
~~~

The isolated build consumes installed candidate packages. Local browser tests exercise actual SDK HTTP and SSE from the compiled Python graph with deterministic providers; they do not prove live provider execution. Docs, Code and Run use the same React implementation and preserve the mounted iframe and draft across mode navigation. Angular remains the default, with its own components and tokens.
`;

export function ReactChatThemingPreview({
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
