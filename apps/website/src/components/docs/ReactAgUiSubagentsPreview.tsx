import type { ExampleCodeContext } from '../../lib/example-code';
import { MdxRenderer } from './MdxRenderer';
const source = `# React AG-UI Subagents preview

Plan a fictional trip with the existing Python agent. Research, booking and itinerary specialists share read-only progress under the main agent’s task. This experimental source-build example uses private React, core, content and framework-neutral AG-UI packages.

## Follow the specialists

Choose **Run** and send **Plan a fictional three-day trip from LAX to JFK next month. Ask research, booking and itinerary specialists for a short recommendation each.** Each card displays its specialist’s literal response and observed status beside the task that started it.

The native AG-UI session owns requests, local conversation identity, complete message history and child lifecycle events. **useAgent** observes the application. **TextTranscript**, **ToolObservation** and **ChatInput** provide the conversation, task details and message controls.

<ExampleCode file="cockpit/ag-ui/subagents/react/src/app.tsx" />

## Confirm the current root

The final root snapshot removes child text from canonical history. The page captures a bounded, read-only copy before replacement, retaining completed cards across confirmed follow-ups. Each observation stays associated with its native child ID, parent tool call, original assistant and supported specialist role. Captured text never enters a request.

A child finishing or a task result arriving does not authorize another Send. The current root must finish successfully with matching thread and run IDs, the admitted human message, full prior native history, exact causal task results and all current children completed successfully. Direct replies, batches and multiple specialist rounds use the same confirmation.

<ExampleCode file="cockpit/ag-ui/subagents/react/src/children.ts" />

<ExampleCode file="cockpit/ag-ui/subagents/react/src/policy.ts" />

The first Send creates a local UUID lazily. Confirmed follow-ups retain the same UUID and full native history. **New conversation** clears the draft and cards; its next Send creates a fresh UUID. **Stop** and page exit revoke active work. Incomplete observations show stopped or incomplete status. Failed specialist cards show a generic message without provider errors or metadata.

Unknown roles, malformed attribution, orphan text, incomplete children, pauses, errors and uncertain outcomes require New. The example has no automatic replay, reconnect, saved-history restoration or child execution controls. A local UUID does not claim server persistence.

<ExampleCode file="cockpit/ag-ui/subagents/react/src/application.ts" />

## Use the existing trip-planning agent

**Shared runtime** uses the examples site’s existing Subagents agent. Runtime settings can supply an authored **Developer runtime** AG-UI endpoint. Its address stays outside the visible preview. The browser supplies no tool executor.

<ExampleCode file="cockpit/ag-ui/subagents/react/src/connection.ts" />

The graph retains its model, prompts, delegation roles and loop. Each task’s injected call ID also identifies its result message, keeping streamed results and final snapshots causal. That injected ID stays outside model-facing arguments. The existing bridge emits child lifecycle and attributed text events; Angular uses the same endpoint.

<ExampleCode file="cockpit/ag-ui/subagents/python/src/graph.py" />

<ExampleCode file="cockpit/ag-ui/subagents/python/src/streaming/subagent_emitting_agent.py" />

<ExampleCode file="cockpit/ag-ui/subagents/python/src/streaming/subagent_stream_handler.py" />

<ExampleCode file="cockpit/ag-ui/subagents/python/src/server.py" />

## Source build and verification

From a Threadplane checkout with dependencies installed:

~~~sh
npx nx build cockpit-ag-ui-subagents-react
npx nx e2e cockpit-ag-ui-subagents-react
~~~

The isolated build installs locked private artifacts with strict types. Browser checks run the actual compiled graph and child bridge with frozen providers. Docs, Code and Run select this same implementation. AG-UI Streaming, Interrupts, Tool Views and JSON Render and nine LangGraph topics also have React previews; other topics remain pending.
`;
export function ReactAgUiSubagentsPreview({
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
