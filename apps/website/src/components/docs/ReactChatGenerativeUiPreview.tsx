import { MdxRenderer } from './MdxRenderer';
import type { ExampleCodeContext } from '../../lib/example-code';

const source = `# React chat generative UI preview

This experimental example composes native React MessageList, Markdown, Reasoning, ToolObservation, ChatInput and RenderSpec with the existing Python Chat Generative UI graph. The React, core, content and neutral LangGraph candidates remain private packages built from source. Angular remains the default on this canonical guide; its progressive rendering behavior is documented in the Angular article.

## Start a conversation

Choose **Run**, type a message and choose **Send** or press **Enter**. **Show dashboard** and **Cancelled flights** only seed the composer; they do not execute. The first Send creates the conversation. **New conversation** opens a blank local view and waits for Send before creating anything. Mounting, reading Docs or Code, and changing workspace modes make no thread requests.

<ExampleCode file="cockpit/chat/generative-ui/react/src/app.tsx" />

## Confirm layouts and data together

Ask for an airline operations dashboard. The example uses fixture data. The shared graph writes layouts into assistant messages, persists its owned dashboard data and completion evidence, and still emits custom JSON Pointer state updates for Angular's progressive views.

The React preview admits no provisional dashboard UI. It checks the actual successful run and its exact saved checkpoint, then publishes the validated layout and dashboard data together. Every retained layout reads the same latest confirmed dashboard data. A data-only request such as **Filter to only the cancelled flights** refreshes all those layouts without creating another layout.

<ExampleCode file="cockpit/chat/generative-ui/react/src/application.ts" />
<ExampleCode file="cockpit/chat/generative-ui/react/src/terminal.ts" />

A later structural layout adds another surface while earlier layouts remain in the conversation. A prose-only reply adds no surface. If the render call's parent already contains nonempty prose, the example preserves that prose, displays a layout no-op notice and keeps the raw tool result inspectable. Layout source and server tool observations remain available for inspection.

## A closed, read-only dashboard catalog

The example owns six view types: dashboard_grid, container, stat_card, line_chart, bar_chart and data_grid. Its bounded spec policy accepts only the supported read-only layout and data bindings. Actions, A2UI and foreign view types are unsupported in this React example. These restrictions are local example policy; they do not expand the public renderer API.

<ExampleCode file="cockpit/chat/generative-ui/react/src/dashboard-views.tsx" />
<ExampleCode file="cockpit/chat/generative-ui/react/src/dashboard-spec.ts" />
<ExampleCode file="cockpit/chat/generative-ui/react/src/dashboard-data.ts" />

## Stop and recover

**Stop** or an uncertain execution requires **New conversation** before continuing. There is no automatic replay, retry or resume. The application withholds unconfirmed changes and prevents late results from restoring authority.

<ExampleCode file="cockpit/chat/generative-ui/react/src/observation.ts" />
<ExampleCode file="cockpit/chat/generative-ui/react/src/tool-evidence.ts" />

Runtime settings select one configured target and header owner for thread creation, streams and checkpoint reads, with SDK retries disabled. Docs, Code and Run select the same native implementation. Mode navigation preserves the mounted frame and unsent draft; reloading clears local state.

<ExampleCode file="cockpit/chat/generative-ui/react/src/connection.ts" />

## Build from source

From a Threadplane checkout with dependencies installed:

~~~sh
npx nx build cockpit-chat-generative-ui-react
npx nx e2e cockpit-chat-generative-ui-react
~~~

Browser verification uses the real SDK and compiled Python graph with deterministic providers and real saved checkpoints. Verification endpoints are excluded from public output.
`;

export function ReactChatGenerativeUiPreview({
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
