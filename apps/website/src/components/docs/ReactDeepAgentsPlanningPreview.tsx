import { MdxRenderer } from './MdxRenderer';
import type { ExampleCodeContext } from '../../lib/example-code';

const source = `# React Deep Agents Planning preview

This experimental example composes native React chat components with a read-only plan panel. The React, core, content and native LangGraph candidates are private packages built from source. Angular remains the default on this canonical Planning guide. Both frontends use the same Python graph, planning prompt and shared FREE runtime.

## Start a dispatch brief

Choose **Run**, type a message and choose **Send** or press **Enter**. **Dispatch brief: KSFO to KASE** fills the draft with the existing aviation suggestion; it does not send. Airport elevation, runway and weather lookups use fixed tables in the unchanged graph.

The first Send creates the conversation. **New conversation** clears the local view and waits for Send to create another conversation. A failed creation can be retried. Opening Docs, Code or Run makes no thread request. Mode navigation and browser history preserve the mounted frame and unsent draft; reloading clears local state.

<ExampleCode file="cockpit/deep-agents/planning/react/src/app.tsx" />
<ExampleCode file="cockpit/deep-agents/planning/react/src/connection.ts" />

## Watch the current plan

Each valid todos update replaces the whole observed list while the response is running. The panel preserves duplicate tasks and their order, and an empty list clears it. Empty task text has a visible placeholder. Validation allows at most 50 items and 2000 UTF-16 code units per task. An invalid update retains the last valid observed plan and shows a notice; a later valid update clears that notice.

The read-only panel shows the backend's pending, in-progress and completed statuses and derives progress from them. Finishing a response does not mark unfinished tasks completed. **Live observed plan** and **Last saved plan** are separate: a visible streamed update has not yet been confirmed as saved.

<ExampleCode file="cockpit/deep-agents/planning/react/src/plan-state.ts" />
<ExampleCode file="cockpit/deep-agents/planning/react/src/plan-panel.tsx" />

## Confirm what was saved

A tool marked complete means its result was received; it does not prove the plan was applied. Tool arguments, received results and errors remain inspectable beside the conversation. Saved confirmation separately checks the raw tool result status. The example confirms a saved plan only after the actual run succeeds and its exact saved checkpoint agrees with the current human request, retained conversation prefix, canonical native messages and successful write_todos evidence. Tool arguments and checkpoint todos must match exactly, including order and duplicates. Prose and printed Python representations do not supply plan authority.

<ExampleCode file="cockpit/deep-agents/planning/react/src/application.ts" />
<ExampleCode file="cockpit/deep-agents/planning/react/src/tool-evidence.ts" />
<ExampleCode file="cockpit/deep-agents/planning/react/src/terminal.ts" />

## Stop and recover

**Stop** keeps the last saved plan visible and requires **New conversation** before another Send. A first native failure before any saved checkpoint also requires New conversation. A later unconfirmed request keeps the saved plan separate; a later valid write can recover against the current conversation prefix. A response with no write can retain an unchanged, previously confirmed plan, but cannot adopt changed, unconfirmed todos. These are local display and submission rules, not a claim that stopping rolls back server state. There is no automatic replay or resume.

## Build from source

From a Threadplane checkout with dependencies installed:

~~~sh
npx nx build cockpit-deep-agents-planning-react
npx nx e2e cockpit-deep-agents-planning-react
~~~

Browser verification uses the real SDK, compiled Python graph and saved checkpoints with deterministic providers. Verification endpoints are excluded from public output.
`;

export function ReactDeepAgentsPlanningPreview({
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
