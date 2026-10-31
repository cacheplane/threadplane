import type { ExampleCodeContext } from '../../lib/example-code';
import { MdxRenderer } from './MdxRenderer';

const source = `# React Mastra reservation preview

Connect a React conversation to a Mastra agent through AG-UI, including a human decision when the agent pauses. The UI stays focused on messages and decisions while the backend integration supplies the transport.

The native React APIs on this page are experimental, private source-build packages. Run the repository example to use them; they are not an npm installation recipe.

## Use the runtime’s actual continuation contract

Mastra’s HTTP service and persistence are part of this repository’s integration. The application observes the native AG-UI session and translates a person’s decision using that service’s resume convention. Do not substitute a different runtime’s approval payload merely because both display \`ApprovalCard\`. The walkthrough below follows the configured service and its stored pause.

The [conversation walkthrough](/docs/langgraph/concepts/conversation-turns) connects this capability to requests, tools, UI state, and saved history.

## Approve or decline a fictional reservation

Choose **Run**, then **Reserve the campsite** to fill the draft. Only **Send** starts a request. A current correlated native pause enables **Approve** or **Decline**. The compatibility notice is informational and cannot authorize a decision without the current native pause. Decline resumes with **approved: false**; it is distinct from cancellation.

<ExampleCode file="cockpit/runtimes/mastra/react/src/app.tsx" />

<ExampleCode file="cockpit/runtimes/mastra/react/src/approval-policy.ts" />

## Resume the native session

The decision uses exact top-level native \`session.resume(pauseId, [{ interruptId, status: 'resolved', payload: { approved } }], { signal })\`. The native session retains the pause correlation; policy validates the current pause, source run, tool call, and reservation before granting response authority. It does not use the Angular compatibility command transport.

<ExampleCode file="cockpit/runtimes/mastra/react/src/application.ts" />

The ordinary conversation projects native text. A reservation outcome is confirmed only after a current successful terminal outcome and a correlated literal backend tool result. **Observed backend result** displays the exact JSON string separately. Assistant prose, a local decision, or HTTP completion alone is insufficient. An uncertain outcome requires a new conversation and never replays an accepted decision.

## Stop and start fresh

**Stop** revokes current controls. **New conversation** clears the draft and local state and waits for owned cleanup before another Send. The first Send creates a conversation UUID lazily. Leaving Run or switching frontend disposes the session. There is no automatic reconnect, replay, saved-history restoration, or durable cross-reload claim.

## Use the shared service

Shared runtime uses **/runtimes/mastra/agent**; this frontend lives at **/runtimes/mastra/react/** and uses the AG-UI adapter. A configured AG-UI Developer runtime is supported. Runtime addresses and credentials remain outside the visible preview.

<ExampleCode file="cockpit/runtimes/mastra/react/src/connection.ts" />

<ExampleCode file="deployments/ag-ui-mastra/agents.mjs" region="reserve-campsite-tool" />

<ExampleCode file="deployments/ag-ui-mastra/server.mjs" region="run-and-stream" />

## Build and verify from source

From a repository checkout with Node/npm available:

~~~sh
npx nx build cockpit-runtimes-mastra-react
npx nx e2e cockpit-runtimes-mastra-react
~~~

The build installs private native package artifacts with strict types. The e2e target prepares the frozen service dependencies serially before running the unchanged actual service against a deterministic offline model seam and a fresh temporary database. These checks prove local HTTP/SSE interoperability and owned cleanup; they do not prove a live model-provider request. Docs, Code, and Run select this same authored implementation.

<ExampleCode file="cockpit/runtimes/mastra/react/project.json" />
`;

export function ReactMastraPreview({ exampleCode }: { readonly exampleCode: ExampleCodeContext | null }) {
  return <div className="docs-workspace-article"><article className="docs-article-layout flex-1 py-8 px-4 sm:px-6 md:px-12 md:max-w-3xl"><MdxRenderer source={source} exampleCode={exampleCode} /></article></div>;
}
