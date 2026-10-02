import type { ExampleCodeContext } from '../../lib/example-code';
import { MdxRenderer } from './MdxRenderer';
const source = `# React time travel preview

This experimental example uses native React chat components with the existing Python LangGraph Time Travel graph. React, core, content, and the framework-neutral LangGraph candidates remain private source-build packages.

## Select a saved source, then fork

Choose **Run** and send two messages. **Refresh saved checkpoints** reads a checkpoint page for that conversation. The **Last loaded checkpoint page** retains the response order, including unavailable entries; it changes only when you explicitly refresh.

**Select** highlights an eligible completed root reference. Selection makes no request, restores no transcript, and does not redirect **Send**. Write a new message, then choose **Fork selected checkpoint** to start from that saved source. The adapter checks the exact saved state before creating the fork run. Pending tasks, interruptions, or unresolved tools cannot authorize a fork.

<ExampleCode file="cockpit/langgraph/time-travel/react/src/app.tsx" />

A selectable reference belongs to the same confirmed thread, has an empty root namespace, a unique nonempty checkpoint ID, an empty next-node list, and an absent or string-valued checkpoint map. The full reference is retained. Missing, duplicate, child, pending, or malformed entries stay visible without a Select control. Page metadata indicates a candidate; the exact completed-source check remains mandatory.

<ExampleCode file="cockpit/langgraph/time-travel/react/src/checkpoint-history.ts" />

## Continue the confirmed fork

After a successful fork, **Send** continues from its confirmed saved result. A separate writer advancing the thread's latest tip cannot redirect this retained position. The original path remains saved on the server. Refresh uses a separate disposable read-only session on the same UUID; it cannot change the execution session's routing. This is a last-loaded page, not a live branch tree or a current-checkpoint indicator.

<ExampleCode file="cockpit/langgraph/time-travel/react/src/application.ts" />

The graph's final response records the actual canonical message IDs plus the current human and final answer IDs. The application requires exactly the SDK-adopted source history followed by this turn's unique successful final pair. Later-tip turns, stale markers, incomplete history lists, and transient streamed chunk IDs cannot confirm the fork's transcript.

<ExampleCode file="cockpit/langgraph/time-travel/react/src/canonical-history.ts" />

<ExampleCode file="cockpit/langgraph/time-travel/python/src/graph.py" />

**Stop** revokes active work. An uncertain execution, failed fork, unsupported pause, or tool requires **New conversation** before another message. New clears the transcript, checkpoint page, selection and draft, creating a fresh thread only on the next Send. A failed read-only refresh shows a protected error and clears selection; a safe conversation can continue. Late results after cancellation or leaving the page cannot restore authority. There is no automatic replay, retry, resume, or latest-tip fallback.

## Connection and source build

The shared backend is used by default. Developer runtime settings can provide a LangGraph target; credentials travel in SDK headers. Thread creation and execution use zero SDK retries.

<ExampleCode file="cockpit/langgraph/time-travel/react/src/connection.ts" />

From a Threadplane checkout with dependencies installed:

~~~sh
npx nx build cockpit-langgraph-time-travel-react
npx nx e2e cockpit-langgraph-time-travel-react
~~~

The isolated build installs local candidate packages and checks strict declarations and browser modules. Tests exercise the real SDK against a local checkpoint fixture, including exact source reads, physical runs, retained continuation despite a competing tip, cancellation and canonical history. Docs, Code and Run select this same React implementation. Streaming, interrupts, memory, client tools, persistence, durable execution subgraphs, time travel and deployment runtime also have public React previews; AG-UI Streaming also has a React preview on its Event Mapping reference; other topics remain pending.
`;
export function ReactTimeTravelPreview({
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
