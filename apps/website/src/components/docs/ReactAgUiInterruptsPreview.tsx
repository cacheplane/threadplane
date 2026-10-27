import type { ExampleCodeContext } from '../../lib/example-code';
import { MdxRenderer } from './MdxRenderer';
const source = `# React AG-UI interrupts preview

Draft a fictional refund, review the amount, and approve, edit or cancel it. This experimental source-build example uses the native React approval card and the existing Python refund graph. It issues a fake refund identifier; no real payment is made. The React, core, content and framework-neutral AG-UI candidate packages remain private.

## Review a refund

Choose **Run** and send a fictional request containing a customer identifier, amount and reason. The agent streams an acknowledgement and pauses. The current **Refund approval** card shows those fields. **Approve** accepts the draft; **Edit and approve** submits the edited nonnegative amount; **Cancel refund** declines it. Each action addresses the current native interrupt explicitly.

<ExampleCode file="cockpit/ag-ui/interrupts/react/src/app.tsx" />

The native session owns execution, messages, state, run identity and the pause token. React observes it through **useAgent**. **TextTranscript** renders ordinary root text literally; **ChatInput** and **ApprovalCard** present app-authored actions. The card does not manufacture a decision or own the command.

## Match the current pause

An approval is available only after the current run has settled with one native root interrupt. Its thread/run identities, opaque pause token, interrupt ID and refund metadata must agree with the terminal and the exact submitted conversation prefix. A saved refund identifier or an older decision in graph state cannot authorize another action.

<ExampleCode file="cockpit/ag-ui/interrupts/react/src/approval-policy.ts" />

The first Send creates a local conversation UUID lazily. After a confirmed decision, another refund can use that same UUID and full canonical history. While paused, Send stays disabled. The app admits one action synchronously, rechecks the current pause before resume, and ignores stale card callbacks and competing clicks.

<ExampleCode file="cockpit/ag-ui/interrupts/react/src/application.ts" />

**New conversation** clears the card, transcript and draft; its next Send creates a fresh UUID. **Stop** cancels active work. Leaving the page revokes the old session. Unsupported interrupts, tools, child agents, errors and uncertain results require New. There is no automatic replay, reconnect or saved-history restoration control; the local UUID does not claim durable server persistence.

## Use the existing backend

**Shared runtime** uses the examples site's native route, \`/ag-ui/interrupts/agent/native\`. Runtime settings can supply an authored **Developer runtime** AG-UI endpoint. Its address stays out of the preview's visible UI.

<ExampleCode file="cockpit/ag-ui/interrupts/react/src/connection.ts" />

The existing refund graph keeps its models, prompts and approval behavior. Internal structured extraction is excluded from conversation events; the acknowledgement still streams. A dedicated native bridge counterpart emits structured interrupt outcomes and accepts native resume entries. The original Angular endpoint retains its legacy interrupt contract.

<ExampleCode file="cockpit/ag-ui/interrupts/python/src/native_agent.py" />

<ExampleCode file="cockpit/ag-ui/interrupts/python/src/server.py" />

## Source build and verification

From a Threadplane checkout with dependencies installed:

~~~sh
npx nx build cockpit-ag-ui-interrupts-react
npx nx e2e cockpit-ag-ui-interrupts-react
~~~

The isolated build installs local candidate artifacts with locked dependencies and strict types. Python tests exercise the actual compiled graph and bridge with frozen model responses. Browser tests use the installed AG-UI SDK over local HTTP/SSE, covering approve, edit, cancel, canonical history, protected outcomes, developer routing and cancellation of held streams. Docs, Code and Run select this same React implementation. AG-UI Streaming, Tool Views, JSON Render and Subagents and nine LangGraph topics also have React previews; other topics remain pending.
`;
export function ReactAgUiInterruptsPreview({ exampleCode }: {
  readonly exampleCode: ExampleCodeContext | null;
}) {
  return <div className="docs-workspace-article">
    <article className="docs-article-layout flex-1 py-8 px-4 sm:px-6 md:px-12 md:max-w-3xl">
      <MdxRenderer source={source} exampleCode={exampleCode} />
    </article>
  </div>;
}
