import { MdxRenderer } from './MdxRenderer';
import type { ExampleCodeContext } from '../../lib/example-code';

const source = `# React AG-UI A2UI preview

Turn a flight request into a form the traveler can edit. A2UI describes the surface and its data; the application renders an allowed catalog and sends explicit user actions back to the backend.

The native React APIs on this page are experimental, private source-build packages. Run the repository example to use them; they are not an npm installation recipe.

## Keep the received surface separate from edits

The server sends a surface description and data-model updates. React retains the received surface, while form controls hold the traveler’s current edits. Search, Select, and Modify send intentional actions; typing does not start another agent run. The example admits a fixed flight-form profile rather than every possible A2UI component.

The [conversation walkthrough](/docs/langgraph/concepts/conversation-turns) connects this capability to requests, tools, UI state, and saved history.

## Start a conversation

Choose **Run** and send a flight request. **Try a flight request** fills the composer without submitting it. The first Send creates the native session. Mounting, Docs, Code, frontend selection and mode navigation send no agent requests. New conversation clears the local view and waits for Send. Mode navigation preserves the mounted frame and an unsent draft; reload starts a fresh local view.

<ExampleCode file="cockpit/ag-ui/a2ui/react/src/app.tsx" />
<ExampleCode file="cockpit/ag-ui/a2ui/react/src/main.tsx" />
<ExampleCode file="cockpit/ag-ui/a2ui/react/src/connection.ts" />

## Edit the latest confirmed preview

Only the latest settled preview is interactive. Admission requires the original successful submission, matching native root run completion, idle native state, the exact ordinary transcript and an accepted shared presentation transition. Older cards retain their last displayed edits and remain read-only. Invalid input remains visible and receives focus; replaced callbacks cannot submit.

<ExampleCode file="cockpit/ag-ui/a2ui/react/src/application.ts" />
<ExampleCode file="cockpit/ag-ui/a2ui/react/src/terminal.ts" />
<ExampleCode file="libs/cockpit-a2ui-react/src/protocol.ts" />
<ExampleCode file="libs/cockpit-a2ui-react/src/form.ts" />
<ExampleCode file="libs/cockpit-a2ui-react/src/actions.ts" />
<ExampleCode file="libs/cockpit-a2ui-react/src/views.tsx" />

## Stop and recover

Stop or an uncertain run requires **New conversation** before continuing. Late responses from the old conversation cannot restore its controls. Correct ordinary form-validation errors in the current form. Modify restores the values supplied by the server. The closed flight profile supports ten views; it does not claim full A2UI catalog parity or SSR support.

<ExampleCode file="cockpit/ag-ui/a2ui/python/src/graph.py" />

## Build from source

~~~sh
npx nx build cockpit-ag-ui-a2ui-react
npx nx e2e cockpit-ag-ui-a2ui-react
~~~

The uncached e2e target prepares frozen Python 3.12 dependencies, verifies an isolated installed native application once, and runs the browser flow against actual compiled graph events with deterministic model responses. Each browser conversation owns its canonical child and checkpointer. Local fixture controls and proof artifacts are excluded from Code and the application bundle. This verifies local native execution; live model-provider behavior remains separate.
`;

export function ReactAgUiA2uiPreview({
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
