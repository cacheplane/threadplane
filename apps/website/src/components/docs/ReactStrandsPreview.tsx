import type { ExampleCodeContext } from '../../lib/example-code';
import { MdxRenderer } from './MdxRenderer';

const source = `# React AWS Strands meeting preview

Review a proposed meeting with a Strands agent, then choose whether to continue. The application combines ordinary conversation rendering with a decision tied to the backend’s current pause.

The native React APIs on this page are experimental, private source-build packages. Run the repository example to use them; they are not an npm installation recipe.

## Read the pause and confirm the result

The Strands bridge sends an AG-UI interrupt whose payload includes the proposed topic and slot. The application preserves its identity, submits the selected response, and waits for the resumed tool result. A schedule snapshot and assistant prose are useful display data, but neither replaces confirmation of the requested operation. The calendar in this example is fictional process-local data.

The [conversation walkthrough](/docs/langgraph/concepts/conversation-turns) connects this capability to requests, tools, UI state, and saved history.

## Request and review a meeting

Choose **Run**, then **Q3 roadmap review** to fill an editable message. Only **Send** creates a native Session and thread and starts the request. A draft, assistant prose, or observed schedule cannot authorize a decision. **Approve** and **Decline** appear only for the current native generic interrupt for **book_meeting**. Its **metadata.reason** carries the topic and slot; the interrupt has no tool-call id or approval schema. The application validates the current root run and exact meeting before enabling the controls.

<ExampleCode file="cockpit/runtimes/aws-strands/react/src/app.tsx" />

<ExampleCode file="cockpit/runtimes/aws-strands/react/src/approval-policy.ts" />

## Resume and confirm

The application preserves the original opaque pause id and calls native \`session.resume(pauseId, [{ interruptId, status: 'resolved', payload: { approved } }], { signal })\`. Decline sends **approved: false** and resumes the tool; it is separate from Stop. A local decision never confirms a booking.

<ExampleCode file="cockpit/runtimes/aws-strands/react/src/application.ts" />

Confirmation requires the distinct resumed run, its matching normal root **RUN_FINISHED**, a settled continuation, and the matching canonical tool result decoded through exactly one JSON layer. **Observed backend result** displays the tool's exact text separately from assistant prose. HTTP completion, assistant text, a wrong run, an error terminal, or an absent result cannot confirm a meeting. An unconfirmed outcome requires **New conversation** with no automatic business retry or replay.

**Last observed schedule** is a separate read-only snapshot. It may remain pending after a sequential booking, or become final when a later batch availability lookup publishes state. Neither snapshot shape is required confirmation evidence. The fictional calendar is process-global, shared across conversations; a new thread does not isolate or reset it.

<ExampleCode file="cockpit/runtimes/aws-strands/react/src/schedule-projection.ts" />

## Stop and start fresh

**Stop** revokes current controls. **New conversation** clears local state and waits for owned cleanup before another Send. Docs, Code, and Run navigation preserves the mounted iframe and editable draft. Page exit or switching frontend disposes the Session. If cleanup fails, controls remain revoked, New conversation stays disabled, and the preview requires a reload. There is no automatic reconnect, decision replay, saved-history restoration, or durable cross-reload guarantee.

## Use the shared service

The shared AG-UI route is **/runtimes/aws-strands/agent**; this frontend is **/runtimes/aws-strands/react/**. A configured AG-UI Developer runtime is supported. Runtime addresses and credentials stay outside the visible preview.

<ExampleCode file="cockpit/runtimes/aws-strands/react/src/connection.ts" />

<ExampleCode file="cockpit/runtimes/aws-strands/python/src/agent.py" />

<ExampleCode file="cockpit/runtimes/aws-strands/python/src/server.py" />

The required backend helper is included for source completeness; its research functionality is outside this React slice.

<ExampleCode file="cockpit/runtimes/aws-strands/python/src/subagent_emitter.py" />

## Build and verify from source

~~~sh
npx nx build cockpit-runtimes-aws-strands-react
npx nx e2e cockpit-runtimes-aws-strands-react
~~~

The e2e target prepares frozen Python 3.12 dependencies before running the unchanged generated Strands service against a deterministic offline OpenAI model seam. The owned fixture checks actual HTTP/SSE native pause/resume and canonical results and closes its temporary processes and dependencies. This proves local interoperability, without proving a live model-provider request. Docs, Code, and Run select this same authored implementation.

<ExampleCode file="cockpit/runtimes/aws-strands/react/project.json" />
`;

export function ReactStrandsPreview({ exampleCode }: { readonly exampleCode: ExampleCodeContext | null }) {
  return <div className="docs-workspace-article"><article className="docs-article-layout flex-1 min-w-0 py-8 px-4 sm:px-6 md:px-12 md:max-w-3xl"><MdxRenderer source={source} exampleCode={exampleCode} /></article></div>;
}
