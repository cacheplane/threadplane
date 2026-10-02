import { MdxRenderer } from './MdxRenderer';
import type { ExampleCodeContext } from '../../lib/example-code';

const source = `# React interrupts preview

This experimental example uses native React approval controls with the same Python LangGraph refund graph as Angular. The refund is simulated: the graph creates a fake refund ID and issues no real charge. React, core, content, and the framework-neutral LangGraph packages remain private source-build packages; they are not published npm packages.

## Review a refund

Choose **Run**, then describe a refund or use a suggested request. The draft arrives incrementally before the graph pauses. Review the amount, customer, and reason in the inline approval card. **Approve refund** resumes with approval, **Decline refund** resumes with rejection, and **Edit amount** lets you approve an explicit nonnegative amount. Blank or invalid edits cannot be submitted.

The paused conversation accepts decisions rather than another message. Text stays blocked for every pause. A malformed, unknown, or multiple-interrupt batch requires **New conversation**; the example never guesses which interrupt to resume. While a decision is pending, further decisions are blocked.

**Stop** cancels active work. After cancellation, a request failure, or an uncertain result, choose **New conversation** to start fresh. The example never silently replays an uncertain conversation creation or decision request.

## Ownership and rendering

A stable application owner creates the session only after the conversation is confirmed. React observes its snapshots through useAgent and renders native ApprovalCard, MessageList, and ChatInput components. Each decision is bound to the exact current root interrupt batch. A replaced batch invalidates old callbacks, even when its IDs are reused. Leaving the example releases the session and fences late results.

<ExampleCode file="cockpit/langgraph/interrupts/react/src/app.tsx" />

The application validates the complete root payload before admitting an authored decision. Child observations do not authorize a root resume. This preview demonstrates ordinary current-conversation decisions; it does not add branch or checkpoint navigation.

<ExampleCode file="cockpit/langgraph/interrupts/react/src/application.ts" />

The existing shared backend is used by default. A developer LangGraph target is configured through the workspace runtime settings, with credentials passed as SDK headers. Keep credentials out of messages and application code.

<ExampleCode file="cockpit/langgraph/interrupts/react/src/connection.ts" />

## Build from source

From a Threadplane checkout with dependencies installed:

~~~sh
npx nx build cockpit-langgraph-interrupts-react
npx nx e2e cockpit-langgraph-interrupts-react
~~~

The isolated build installs local candidate packages and checks the emitted browser modules. Browser tests use real SDK HTTP and SSE against a local fixture. Docs, Code, and Run select this same React implementation. Public React previews cover streaming, interrupts, memory, client tools, persistence, durable execution, subgraphs, time travel, and deployment runtime; AG-UI Streaming also has a React preview on its Event Mapping reference; other topics remain pending.
`;

export function ReactInterruptsPreview({
  exampleCode,
}: {
  exampleCode: ExampleCodeContext | null;
}) {
  return (
    <div className="docs-workspace-article">
      <article className="docs-article-layout flex-1 py-8 px-4 sm:px-6 md:px-12 md:max-w-3xl">
        <MdxRenderer source={source} exampleCode={exampleCode} />
      </article>
    </div>
  );
}
