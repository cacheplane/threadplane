import { MdxRenderer } from './MdxRenderer';
import type { ExampleCodeContext } from '../../lib/example-code';

const source = `# React Deep Agents Subagents preview

This experimental example composes native React chat components with parent task cards and separate child response observations. Angular remains the default on this canonical guide. Both frontends use the same Python graph, Subagents prompt and shared FREE runtime. The React, core, content and native LangGraph candidates are private packages built from source.

## Start an aviation brief

Choose **Run**, type a message and choose **Send** or press **Enter**. **Brief KASE and KDEN** fills this exact draft without sending:

> Brief me on KASE and KDEN: I need field data for both and the current weather at both.

**Field data for KSFO** fills this exact draft:

> What is the field data for KSFO?

The roster names **field-researcher** and **weather-analyst**. All aviation and weather lookups use fixed sample data. The prompt requests one airport per task call and parallel dispatch when appropriate, but does not guarantee four calls, delegation in every answer, or only those two agent types. The graph also supports general-purpose dispatches and generic tools. The sidebar counts actual observed task calls.

Only an explicit Send creates the owned thread, lazily, using the native selector **subagents**. Opening Docs or Run, changing frontend or mode, navigating history, filling suggestions and choosing **New conversation** do not author a run. Mode navigation and browser history preserve the mounted frame and unsent draft. Reload and New clear local conversation state; New waits for the next Send to create a thread.

<ExampleCode file="cockpit/deep-agents/subagents/react/src/app.tsx" />
<ExampleCode file="cockpit/deep-agents/subagents/react/src/connection.ts" />

## Read parent task cards

Parent cards preserve canonical tool-call IDs and declaration order. They show the actual literal description, subagent_type, arguments and results. Generic tools and general-purpose task calls remain literal observations too. Missing or unsupported task fields stay visibly unavailable; the preview does not invent a specialist name, result or dispatch count.

<ExampleCode file="cockpit/deep-agents/subagents/react/src/projection.ts" />

## Inspect separate child observations

Expand **Child response observations** to read user, assistant and tool transcripts under their full namespace arrays. These are current-session observations from this open conversation. The preview does not guess a binding between a namespace and a parent task card from description text, arrival order or position. Identical descriptions therefore do not imply a shared or matched card.

**Receiving** means local delivery is active. **Observed response** means the local turn finished with a supported child observation; it is not checkpoint-confirmed child history. **Stopped** marks canceled local delivery. **Incomplete** marks unsupported, interrupted or uncertain child data. These labels describe the lifetime of local observations, not restored execution status.

Child observations remain visible across root checkpoint reconciliation and canonical root load. They are not restored historical children and are never labeled Saved child history. Reload and New clear them.

<ExampleCode file="cockpit/deep-agents/subagents/react/src/children.ts" />

## Confirm the saved root conversation

**Response saved.** requires native success plus the actual owned raw current root state, a fresh history head and the exact checkpoint. The live and loaded canonical messages must match. The application performs canonical native load before permitting another Send. Model prose and child observations cannot supply this authority. A resolved root tool error can still be saved; its error card remains visible beside the saved root conversation.

Unsupported data or incomplete authority produces a notice, retains the prior confirmed root conversation and disables Send until **New conversation**. No inferred result is promoted to saved state.

The display bounds are cumulative across the open conversation: 100 task observations and 100 child namespaces, namespace depth 16 and components of at most 1024 UTF-16 code units, and at most 65,536 units per task description, result or joined child transcript. One shared 1,048,576-unit UTF-16 display-text ledger covers root messages, parent cards and children. Raw capture separately limits 10,000 nodes, depth 32 and 4 × 1024 × 1024 UTF-16 text units, including keys. Those structural limits can make a payload unavailable before it reaches 100 tasks or namespaces. Unsupported or oversized data stays visibly incomplete.

<ExampleCode file="cockpit/deep-agents/subagents/react/src/authority.ts" />
<ExampleCode file="cockpit/deep-agents/subagents/react/src/application.ts" />

## Stop and start again

**Stop** cancels local delivery and preserves prior confirmed root content. It does not roll back backend work. Start a **New conversation** before sending again after Stop or uncertain confirmation. There is no automatic resume, replay or retry.

## Build from source

From a Threadplane checkout with dependencies installed:

~~~sh
npx nx build cockpit-deep-agents-subagents-react
npx nx e2e cockpit-deep-agents-subagents-react
~~~

Browser verification uses the actual compiled Python graph, installed native SDK and deterministic model construction. Fixtures, proof endpoints and verification controls are excluded from public Code and the production frontend.
`;

export function ReactDeepAgentsSubagentsPreview({
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
