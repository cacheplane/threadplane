import type { ExampleCodeContext } from '../../lib/example-code';
import { MdxRenderer } from './MdxRenderer';
const source = `# React AG-UI tool views preview

Ask for a city's weather and watch an authored weather card appear alongside the conversation. This experimental source-build example uses native React components and the existing Python server tool. Readings are fixed demo data. React, core, content and the framework-neutral AG-UI candidate remain private packages.

## Observe a server tool

Choose **Run** and ask for the weather in San Francisco. The agent calls **weather_card** on the server. React displays its location, temperature, conditions, humidity and wind. Open **Tool details** to inspect literal arguments and results. This page supplies no browser tool executor.

<ExampleCode file="cockpit/ag-ui/tool-views/react/src/app.tsx" />

<ExampleCode file="cockpit/ag-ui/tool-views/react/src/weather-card.tsx" />

The native AG-UI session owns requests, messages, state and run identity. **useAgent** observes it; **TextTranscript**, **ToolObservation** and **ChatInput** display native text and tools with an app-authored weather card. Each card belongs to the assistant that requested it. Markup remains literal text.

## Confirm the whole turn

Partial arguments and tool-call endings do not complete the request. A received reading can appear while the agent is still working. Another Send becomes available only after the current root run succeeds, its thread and run IDs match, and the full canonical history contains the submitted question, every associated result and the final assistant reply. Ordinary text, a batch of calls and multiple tool rounds use the same rule.

<ExampleCode file="cockpit/ag-ui/tool-views/react/src/tool-view-policy.ts" />

The first Send creates a local UUID lazily. Confirmed follow-ups retain full native history, including tool calls and results, on that UUID. **New conversation** clears the display and draft; its next Send creates another UUID. **Stop** and page exit revoke active work. Unknown tools, malformed readings, child agents, pauses, errors and uncertain outcomes require New. There is no automatic replay, reconnect or saved-history restoration; a local UUID does not claim server persistence.

<ExampleCode file="cockpit/ag-ui/tool-views/react/src/application.ts" />

## Use the existing agent

**Shared runtime** uses the examples site's existing AG-UI Tool Views route. Runtime settings can supply an authored **Developer runtime** endpoint. Its address stays outside the visible preview.

<ExampleCode file="cockpit/ag-ui/tool-views/react/src/connection.ts" />

The existing graph keeps its model, prompt and server tool loop. The weather tool returns the same five fields as plain JSON in a ToolMessage. Its runtime-injected call ID also identifies the result message, so incremental events and the final snapshot preserve one causal result. The injected ID is absent from model-facing arguments. Angular retains the same endpoint and reading.

<ExampleCode file="cockpit/ag-ui/tool-views/python/src/graph.py" />

<ExampleCode file="cockpit/ag-ui/tool-views/python/src/server.py" />

## Source build and verification

From a Threadplane checkout with dependencies installed:

~~~sh
npx nx build cockpit-ag-ui-tool-views-react
npx nx e2e cockpit-ag-ui-tool-views-react
~~~

The isolated build installs locked candidate artifacts with strict types. Python checks exercise the actual graph and bridge with frozen model responses. Browser checks use the installed SDK over HTTP/SSE for tool rounds, retained history, partial results, cancellation and protected outcomes. Docs, Code and Run select this same implementation. AG-UI Streaming, AG-UI Interrupts and nine LangGraph topics also have React previews; other topics remain pending.
`;
export function ReactAgUiToolViewsPreview({
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
