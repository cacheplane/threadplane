import type { ExampleCodeContext } from '../../lib/example-code';
import { MdxRenderer } from './MdxRenderer';
const source = `# React durable execution preview

This experimental example uses native React chat components with the existing Python LangGraph durable execution graph. React, core, content, and the framework-neutral LangGraph candidates remain private source-build packages.

## Follow saved pipeline checkpoints

Choose **Run** and ask the assistant to plan a fictional project. The graph runs **Analyze**, **Plan**, and **Generate** in order. The **Saved pipeline checkpoints** panel marks a node complete after its checkpoint is observed; it does not identify the node currently running.

Intermediate analysis and planning drafts appear during the request. After the final outcome is confirmed, the transcript shows the original question and its exact final answer. Send another request to reuse the same conversation. The pipeline starts pending again, and the final transcript shows that latest request. Choose **New conversation** for an empty draft; a new thread is created only when you send a message.

<ExampleCode file="cockpit/langgraph/durable-execution/react/src/app.tsx" />

## Confirm an uncertain outcome

If the adapter can safely reconcile an uncertain submission, **Check status** reads the saved outcome for that same request. It does not create a thread, start another model run, replay the request, or resume the graph. A completed read alone is not confirmation. Pending or unrelated history keeps the composer blocked.

The final graph node records both the original question ID and the final answer ID. The application requires that exact pair, successful delivery for the current request, and an idle safe session before accepting completion. This also lets the application exclude intermediate drafts retained by the SDK. A previous checkpoint or a different answer cannot authorize the current request.

<ExampleCode file="cockpit/langgraph/durable-execution/react/src/application.ts" />

**Stop** cancels active work and revokes its authority. Choose **New conversation** after stopping, an unsupported pause, or an outcome that cannot be reconciled. Competing commands are blocked while a request or read is active, and late results after cancellation or disposal cannot restore the old view.

## Server checkpointing and connection

The LangGraph server supplies checkpointing for the existing three-node graph. This browser preview observes saved checkpoints and demonstrates read-only outcome confirmation. Its healthy public run does not simulate a server process crash or prove recovery across a restart.

<ExampleCode file="cockpit/langgraph/durable-execution/python/src/graph.py" />

The shared backend is used by default. Developer runtime settings can provide a LangGraph target; credentials travel in SDK headers. Thread creation and execution use zero SDK retries.

<ExampleCode file="cockpit/langgraph/durable-execution/react/src/connection.ts" />

## Build from source

From a Threadplane checkout with dependencies installed:

~~~sh
npx nx build cockpit-langgraph-durable-execution-react
npx nx e2e cockpit-langgraph-durable-execution-react
~~~

The isolated build installs local candidate packages and checks strict declarations and emitted browser modules. Browser tests exercise real SDK HTTP and SSE against a local fixture, including uncertain outcomes and cancellation. Docs, Code, and Run select this same React implementation. Streaming, interrupts, memory, client tools, persistence, subgraphs, time travel and deployment runtime also have public React previews; AG-UI Streaming also has a React preview on its Event Mapping reference; other topics remain pending.
`;
export function ReactDurableExecutionPreview({
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
