import type { ExampleCodeContext } from '../../lib/example-code';
import { MdxRenderer } from './MdxRenderer';
const source = `# React AG-UI JSON Render preview

Ask for an airline operations dashboard, then filter its disruptions or change its layout. This experimental source-build example uses the existing Python agent and fixed demo data. React, core, content and the framework-neutral AG-UI candidate remain private packages.

## Render the authored dashboard

Choose **Run** and send **Show an airline operations dashboard with KPI cards, an on-time trend, flights by airline and recent disruptions.** The agent calls **render_spec** and the data tools. Six authored read-only views display the layout: a dashboard grid, a container, a statistic card, a line chart, a bar chart and a data grid. Charts include accessible data tables.

The native AG-UI session owns requests, conversation identity, complete message history and shared state. **useAgent** observes the application, **TextTranscript** displays literal native text, **ToolObservation** exposes server-tool details, and **ChatInput** admits a new question. **RenderSpec** resolves validated bindings against the latest dashboard state.

<ExampleCode file="cockpit/ag-ui/json-render/react/src/app.tsx" />

<ExampleCode file="cockpit/ag-ui/json-render/react/src/dashboard-views.tsx" />

## Bind live data to a retained layout

Send **Filter the recent disruptions to cancelled flights without changing the layout.** The data tool updates shared state. The dashboard already displayed under its original assistant reads that latest state, including while the current request is still working. Missing fields show a waiting message; empty lists and zero values remain valid data.

For a structural change, ask **Replace the layout with a single Flights today card.** Each accepted layout stays associated with the assistant that requested it. Earlier layouts continue reading the latest shared data, as in the Angular example.

The application owns a bounded copy of seven supported data fields and the existing six-type catalog. It validates scalar values, supported state pointers, child references and tool associations before rendering. Labels and raw protocol text stay literal.

<ExampleCode file="cockpit/ag-ui/json-render/react/src/dashboard-data.ts" />

<ExampleCode file="cockpit/ag-ui/json-render/react/src/dashboard-spec.ts" />

## Confirm the native turn

Partial tool arguments, data updates and final message snapshots do not authorize another Send. The current root run must succeed with matching thread and run IDs, the submitted human message, its complete native prefix, associated results and a final assistant reply. The same confirmation supports ordinary text, batches and multiple tool rounds.

<ExampleCode file="cockpit/ag-ui/json-render/react/src/dashboard-policy.ts" />

The first Send creates a local UUID lazily. Confirmed follow-ups retain full native history on that UUID. **New conversation** clears the display and draft; its next Send creates a fresh UUID. **Stop** and page exit revoke active work. Unsupported layouts, malformed state, unknown tools, child agents, pauses, errors and uncertain outcomes require New. The example has no automatic replay, reconnect or saved-history restoration; a local UUID does not claim server persistence.

<ExampleCode file="cockpit/ag-ui/json-render/react/src/application.ts" />

## Use the existing server tools

**Shared runtime** uses the examples site's existing JSON Render agent. Runtime settings can supply an authored **Developer runtime** AG-UI endpoint. Its address stays outside the visible preview. The browser supplies no tool executor.

<ExampleCode file="cockpit/ag-ui/json-render/react/src/connection.ts" />

The graph retains its model, prompt, catalog, reducers and loop. Each tool's injected call ID also identifies its result message, so streamed results and final snapshots retain one causal identity. The injected ID is absent from model-facing arguments. The layout is serialized once; the existing post-processing moves it into an empty assistant message or preserves an assistant's prose. Angular uses the same endpoint and data.

<ExampleCode file="cockpit/ag-ui/json-render/python/src/graph.py" />

<ExampleCode file="cockpit/ag-ui/json-render/python/src/dashboard_tools.py" />

<ExampleCode file="cockpit/ag-ui/json-render/python/src/server.py" />

## Source build and verification

From a Threadplane checkout with dependencies installed:

~~~sh
npx nx build cockpit-ag-ui-json-render-react
npx nx e2e cockpit-ag-ui-json-render-react
~~~

The isolated build installs locked private artifacts with strict types. Browser checks run the actual compiled graph and AG-UI bridge with frozen providers, covering layout changes, shared-state updates, tool rounds, retained native history, cancellation and protected outcomes. Docs, Code and Run select this same implementation. AG-UI Streaming, Interrupts and Tool Views and Subagents and nine LangGraph topics also have React previews; other topics remain pending.
`;
export function ReactAgUiJsonRenderPreview({
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
