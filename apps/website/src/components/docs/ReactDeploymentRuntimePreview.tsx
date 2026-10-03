import type { ExampleCodeContext } from '../../lib/example-code';
import { MdxRenderer } from './MdxRenderer';
const source = `# React deployment runtime preview

This experimental example uses native React chat components with the existing Python LangGraph Deployment Runtime graph. React, core, content, and the framework-neutral LangGraph candidates remain private source-build packages.

## Use the connected runtime

Choose **Run** and send a fictional deployment question. The connection panel identifies **Shared runtime** or **Developer runtime** and the fixed assistant key **deployment-runtime**. Shared runtime uses the examples site's same-origin proxy. The workspace's existing Runtime settings can supply a developer LangGraph target; credentials remain SDK request headers and are not shown in the preview.

<ExampleCode file="cockpit/langgraph/deployment-runtime/react/src/app.tsx" />

<ExampleCode file="cockpit/langgraph/deployment-runtime/react/src/connection.ts" />

The React frontend and Python graph are separate artifacts. This preview connects to the existing shared backend deployment; it does not deploy an agent or change cloud settings. For deployment commands and current options, consult the [official LangGraph CLI documentation](https://docs.langchain.com/langsmith/cli).

## Keep a confirmed conversation

The first Send creates a confirmed conversation lazily. Later successful messages retain its canonical history on the same UUID. The graph publishes the actual complete message IDs and current human/answer IDs. The owner accepts only its confirmed prefix followed by this turn's successful final pair; transient stream IDs, stale markers, and incomplete history cannot confirm a reply.

<ExampleCode file="cockpit/langgraph/deployment-runtime/python/src/graph.py" />

<ExampleCode file="cockpit/langgraph/deployment-runtime/react/src/canonical-history.ts" />

**New conversation** clears the transcript and draft, creating another thread only on the next Send. **Stop** revokes active work. Failed, uncertain, paused, or unsupported tool outcomes require New. Late results after cancellation or leaving the page cannot restore the old conversation. Creation and execution use zero SDK retries; the preview offers no replay, reconnect, resume, or history-restoration control.

<ExampleCode file="cockpit/langgraph/deployment-runtime/react/src/application.ts" />

## Source build and verification

From a Threadplane checkout with dependencies installed:

~~~sh
npx nx build cockpit-langgraph-deployment-runtime-react
npx nx e2e cockpit-langgraph-deployment-runtime-react
~~~

The isolated build installs local candidate packages and checks strict declarations and browser modules. Tests exercise the real SDK against a local HTTP/SSE fixture, including retained history, distinct physical runs, protected outcomes, credential headers and cancellation. Docs, Code and Run select this same React implementation. Streaming, interrupts, memory, client tools, persistence, durable execution, subgraphs and time travel also have public React previews; AG-UI Streaming and Interrupts also have React previews on Event Mapping and the Interrupts guide; other topics remain pending.
`;
export function ReactDeploymentRuntimePreview({
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
