import { MdxRenderer } from './MdxRenderer';
import type { ExampleCodeContext } from '../../lib/example-code';
const source = `# React Deep Agents Skills preview

Load detailed instructions only when the agent needs them. A skill index names available capabilities, while skill bodies and references are read on demand.

The native React APIs on this page are experimental, private source-build packages. Run the repository example to use them; they are not an npm installation recipe.

## Distinguish the index from evidence of a read

The backend provides skill metadata and tool results. The application renders the index separately from the paths actually inspected, because a requested path does not prove that its contents were read successfully. Some metadata arrives only in saved checkpoints, so the example checks that source before presenting a confirmed index. The native view stays read-only.

The [conversation walkthrough](/docs/langgraph/concepts/conversation-turns) connects this capability to requests, tools, UI state, and saved history.

## Start an assessment

Choose **Run**, type a message and choose **Send** or press **Enter**. **Mid-size jet at KASE** fills this exact draft without sending:

> Can a mid-size jet operate out of KASE?

Aviation examples use fixed sample data. Only explicit Send creates the owned thread, lazily, using the native selector **da-skills**. Opening Docs or Run, changing frontend or mode, navigating browser history, filling suggestions and choosing **New conversation** do not author a run. Mode navigation and browser history preserve the mounted frame and unsent draft. Reload and New clear the draft and local view.

<ExampleCode file="cockpit/deep-agents/skills/react/src/app.tsx" />
<ExampleCode file="cockpit/deep-agents/skills/react/src/connection.ts" />

## Inspect the index and actual reads

The index exposes names, descriptions, virtual instruction paths and optional support annotations from root **skills_metadata**. The local compiled graph exposes metadata in root stream values and saved checkpoints. Observed deployed API values omit private Skills keys while saved checkpoints retain metadata, consistent with declared output-schema filtering. Angular uses the custom event for its live index. React reads native root values and, when the public stream omits metadata, the confirmed saved checkpoint. The custom event does not supply React index authority or confirmed-read proof. Metadata alone does not establish that instructions were read. Both runway-analysis and weather-brief remain index evidence even when only one has associated reads.

**Observed root values** identifies live index evidence. **Confirmed checkpoint** requires matching current root state, fresh history head, exact checkpoint and the native transcript/load. Only absent live skills_metadata and skills_load_errors are permitted; present private values and every ordinary root value must agree with the checkpoint. Loaded values must agree fully. Saved checkpoint metadata remains authoritative. This Skills contract makes no inference about Memory visibility.

<ExampleCode file="cockpit/deep-agents/skills/react/src/index-projection.ts" />
<ExampleCode file="cockpit/deep-agents/skills/react/src/authority.ts" />

**Inspected** requires an associated raw read_file call with supported arguments and an actual successful tool result. Instruction and reference results remain literal text under **Literal read result**. Inspection does not claim the whole file was read. **Partially inspected**, **Read failed**, **Read pending**, **Read status unknown** and **Read evidence unavailable** distinguish incomplete evidence. A requested path or model prose alone cannot establish successful inspection. The Angular guide retains its requested-path marker behavior.

<ExampleCode file="cockpit/deep-agents/skills/react/src/read-projection.ts" />

## Save, restore and stop

**Response saved.** requires native success and exact fresh root authority. A resolved tool error can still belong to a saved response while the read remains failed. Unsupported data or uncertain confirmation shows a notice and disables Send until New. Display and raw capture limits bound the aggregate conversation before composing prior and current observations; oversized evidence remains unavailable.

**Saved conversations** restores only an exact retained local checkpoint and transcript. Choosing a saved conversation performs reads without authoring a run. **New conversation** clears the active draft and view; it retains locally confirmed entries until reload. **Stop** cancels local delivery; backend work may continue. There is no automatic retry, replay or Resume. Stale owner or generation results cannot restore an older view.

<ExampleCode file="cockpit/deep-agents/skills/react/src/application.ts" />

## Shared backend and source build

Skills instructions and references are mounted read-only through the shared adapter; default thread-local notes remain writable. The complete shared Python source includes the graph, adapter, and bundled instruction and reference assets in Code. The graph and adapter are shown here:

<ExampleCode file="cockpit/deep-agents/skills/python/src/graph.py" />
<ExampleCode file="cockpit/deep-agents/skills/python/src/skills_readonly.py" />

~~~sh
npx nx build cockpit-deep-agents-skills-react
npx nx e2e cockpit-deep-agents-skills-react
~~~

Browser verification uses the actual compiled Python graph, installed native SDK and deterministic model. Fixtures, proof endpoints and verification controls are excluded from public Code and the production frontend.
`;
export function ReactDeepAgentsSkillsPreview({
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
