import { MdxRenderer } from './MdxRenderer';
import type { ExampleCodeContext } from '../../lib/example-code';

const source = `# React chat timeline preview

This experimental example composes native React MessageList, Markdown, Reasoning, Citations and ChatInput with the existing Python Chat Timeline graph. The React, core, content and neutral LangGraph candidates remain private packages built from source. Angular remains the default on this canonical component guide.

## Start a conversation

Choose **Run**, type a message and send it. The first **Send** creates the conversation. **New conversation** opens a blank local view and waits for Send before creating anything. Mounting, reading Docs or Code, and changing workspace modes make no thread requests.

<ExampleCode file="cockpit/chat/timeline/react/src/app.tsx" />

## Preview a saved checkpoint

Choose **Refresh checkpoints** to explicitly load the recent checkpoint page. The reader requests a limit of 10; this is not a full-history browser and has no pagination. Refresh clears the selection. Successful turns do not automatically refresh the checkpoint list.

Select an available completed root checkpoint to load a separate read-only preview. The current conversation and draft stay in place. In-progress or invalid checkpoint references are unavailable. Unsupported saved transcripts fail preview validation. This strict preview accepts this graph's plain alternating human and assistant transcript; it does not accept arbitrary tool, subgraph or interrupt histories.

<ExampleCode file="cockpit/chat/timeline/react/src/checkpoints.ts" />
<ExampleCode file="cockpit/chat/timeline/react/src/preview.ts" />

## Continue or explicitly fork

**Send** always continues the current conversation. A validated preview stays visible, and selecting it never redirects Send or consumes the draft.

**Fork from here** uses the selected checkpoint and the current composer draft. After the fork is confirmed, its branch becomes the current conversation and the preview clears. For example, after turns A and B, preview A and send C: the current conversation is A+B+C. With A still selected, type D and choose Fork from here: the confirmed branch is A+D. Send E next to continue A+D+E.

<ExampleCode file="cockpit/chat/timeline/react/src/application.ts" />

The application checks each completed transcript before enabling continuation. A fork must preserve the selected preview prefix and add exactly the submitted exchange. Selection is read-only; explicit Fork is the only action that executes from the selected checkpoint.

<ExampleCode file="cockpit/chat/timeline/react/src/authority.ts" />

## Stop and recover

A failed or cancelled checkpoint read leaves the primary conversation usable. **Stop** or an uncertain execution requires **New conversation**; there is no automatic replay, retry or resume. Cleanup prevents late results from restoring authority.

Runtime settings select one configured target and header owner for creation, streams and checkpoint reads, with SDK retries disabled. The example uses the existing c-timeline graph on the shared backend. Docs, Code and Run select the same native React implementation. Mode navigation preserves the mounted frame and draft; reloading clears local state.

<ExampleCode file="cockpit/chat/timeline/react/src/connection.ts" />

## Build from source

From a Threadplane checkout with dependencies installed:

~~~sh
npx nx build cockpit-chat-timeline-react
npx nx e2e cockpit-chat-timeline-react
~~~

Browser tests use the real SDK and compiled Python graph with deterministic providers and real saved checkpoints. Verification endpoints are excluded from public output. The Angular API guide remains applicable to the Angular implementation: its Replay and Fork outputs require host wiring.
`;

export function ReactChatTimelinePreview({
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
