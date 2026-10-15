import type { ExampleCodeContext } from '../../lib/example-code';
import { MdxRenderer } from './MdxRenderer';

const source = `# React Microsoft Agent Framework expense preview

This experimental private source-build preview handles bounded fictional expenses. No real reimbursement occurs. The native React, core, content, and AG-UI candidate packages are private artifacts, with no public npm availability claim. Angular retains the canonical provider example and shared backend and prompt. This React preview uses the same generated Microsoft Agent Framework service directly; it does not claim the Angular wrapper's specialist streaming behavior.

## Request and review an expense

Choose **Run**, then **Team dinner for 4** to fill an editable message. Only **Send** starts a request or creates a native Session and thread. The read-only predictive draft is separate from canonical approval fields. **Approve** and **Decline** become available only for a current correlated native approval for **submit_expense**. A local draft, assistant prose, or compatibility state cannot authorize a decision. Decline resumes with **approved: false**; it is distinct from Stop.

<ExampleCode file="cockpit/runtimes/microsoft-agent-framework/react/src/app.tsx" />

<ExampleCode file="cockpit/runtimes/microsoft-agent-framework/react/src/approval-policy.ts" />

## Resume the native session

The decision uses top-level native \`session.resume(pauseId, [{ interruptId, status: 'resolved', payload: { approved } }], { signal })\`. The application preserves the original native pause and validates its current run, tool call, and expense correlation before accepting a decision.

<ExampleCode file="cockpit/runtimes/microsoft-agent-framework/react/src/application.ts" />

Native text and predictive expense state are projected for display. **Observed backend result** shows the exact literal tool text separately from assistant prose. Confirmation requires the current normal root **RUN_FINISHED**, a matching authoritative snapshot tool result, and a settled continuation. A normal terminal may omit its outcome field. A legitimate Decline result may appear only in the snapshot, without a **TOOL_CALL_RESULT** event. HTTP completion, a local decision, and assistant prose alone cannot confirm an expense. An unconfirmed outcome requires **New conversation** and never replays an accepted decision.

<ExampleCode file="cockpit/runtimes/microsoft-agent-framework/react/src/expense-projection.ts" />

## Stop and start fresh

**Stop** revokes current controls. **New conversation** clears local state and waits for owned cleanup before another Send. Docs, Code, and Run retain the same iframe and unsent draft without starting a request. Leaving the page or switching frontend disposes the Session. Reload the preview after an owned cleanup failure; Send, decisions, and New conversation remain disabled for that application lifetime. There is no automatic reconnect, replay, saved-history restoration, or durable cross-reload claim.

## Use the shared service

Shared runtime uses **/runtimes/microsoft-agent-framework/agent**; this frontend lives at **/runtimes/microsoft-agent-framework/react/** and uses the AG-UI adapter. A configured AG-UI Developer runtime is supported. Runtime addresses and credentials remain outside the visible preview.

<ExampleCode file="cockpit/runtimes/microsoft-agent-framework/react/src/connection.ts" />

<ExampleCode file="cockpit/runtimes/microsoft-agent-framework/python/src/agent.py" />

<ExampleCode file="cockpit/runtimes/microsoft-agent-framework/python/src/server.py" />

## Build and verify from source

~~~sh
npx nx build cockpit-runtimes-microsoft-agent-framework-react
npx nx e2e cockpit-runtimes-microsoft-agent-framework-react
~~~

The e2e target serializes frozen Python 3.12 fixture preparation before running the unchanged generated service against a deterministic offline OpenAI model seam. The fixture owns isolated temporary dependencies and HTTP processes, verifies actual native pause/resume and literal results, and closes its owned resources. These checks prove local HTTP/SSE interoperability; they do not prove a live model-provider request. Docs, Code, and Run select this same authored implementation.

<ExampleCode file="cockpit/runtimes/microsoft-agent-framework/react/project.json" />
`;

export function ReactMafPreview({ exampleCode }: { readonly exampleCode: ExampleCodeContext | null }) {
  return <div className="docs-workspace-article"><article className="docs-article-layout flex-1 min-w-0 py-8 px-4 sm:px-6 md:px-12 md:max-w-3xl"><MdxRenderer source={source} exampleCode={exampleCode} /></article></div>;
}
