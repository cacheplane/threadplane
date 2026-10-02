import type { ExampleCodeContext } from '../../lib/example-code';
import { MdxRenderer } from './MdxRenderer';
const source = `# React subgraphs preview

This experimental example uses native React chat components with the existing Python LangGraph conditional research graph. React, core, content, and the framework-neutral LangGraph candidates remain private source-build packages.

## Follow the parent and child boundary

Choose **Run** and ask a factual question. The parent routes that question through a research child graph, then answers using its returned brief. A greeting answers directly. Send another message to reuse the same conversation; the parent retains its confirmed conversation history.

The **Research boundary** panel shows the topic sent to the child and the brief returned to the parent after the current result is confirmed. The child shares those two fields; it does not receive the parent conversation. Its streamed messages remain outside the parent chat transcript.

<ExampleCode file="cockpit/langgraph/subgraphs/react/src/app.tsx" />

The **Child observations** panel displays the full namespace segments observed in the current child stream. An observation identifies a stream; it does not establish whether the child is running or complete, and it grants no child commands. Before the current result is confirmed, the route remains awaiting. Each new request clears the previous boundary and child observations.

## Confirm the current result

The final parent answer records both the original question ID and its final answer ID. The application requires that exact pair, successful delivery for this request, and an idle safe session. A nested result also requires matching topic and brief from the current observed child. A direct result requires empty boundary fields and no child observed for this turn. Previous values and completion markers cannot confirm a new request.

<ExampleCode file="cockpit/langgraph/subgraphs/react/src/application.ts" />

**Stop** cancels active work and revokes its authority. Choose **New conversation** after stopping or an unconfirmed result. New clears both panels and the transcript; it creates a new thread only when you send a message. Unsupported pauses, tools, or errors block further messages in that conversation. Late results after cancellation or leaving the page cannot restore the old view.

## Conditional composition and connection

The compiled research child runs as a parent graph node with a smaller state schema. The parent keeps its message reducer and clears the research fields when routing each request. Internal router output is not streamed into the chat.

<ExampleCode file="cockpit/langgraph/subgraphs/python/src/graph.py" />

The shared backend is used by default. Developer runtime settings can provide a LangGraph target; credentials travel in SDK headers. Thread creation and execution use zero SDK retries. This preview does not expose child resume, retry, or recovery controls.

<ExampleCode file="cockpit/langgraph/subgraphs/react/src/connection.ts" />

## Build from source

From a Threadplane checkout with dependencies installed:

~~~sh
npx nx build cockpit-langgraph-subgraphs-react
npx nx e2e cockpit-langgraph-subgraphs-react
~~~

The isolated build installs local candidate packages and checks strict declarations and emitted browser modules. Browser tests exercise real SDK HTTP and SSE against a local fixture, including conditional routing, namespace isolation, and cancellation. Docs, Code, and Run select this same React implementation. Streaming, interrupts, memory, client tools, persistence, durable execution, time travel and deployment runtime also have public React previews; AG-UI Streaming also has a React preview on its Event Mapping reference; other topics remain pending.
`;
export function ReactSubgraphsPreview({
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
