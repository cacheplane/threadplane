import { MdxRenderer } from './MdxRenderer';
import type { ExampleCodeContext } from '../../lib/example-code';

const source = `# React Deep Agents Filesystem preview

This experimental example composes native React chat components with a read-only workspace and a protected-action approval panel. The React, core, content and native LangGraph candidates are private packages built from source. Angular remains the default on this canonical Filesystem guide. Both frontends use the same Python graph, filesystem prompt and shared FREE runtime.

## Start a runway note

Choose **Run**, type a message and choose **Send** or press **Enter**. **Runway note for KASE** fills this exact draft without sending:

> Work up a runway suitability note for KASE. Save your raw lookups to /notes/kase-data.md, then write the finished note to /reports/kase-runway.md.

Airport elevation and runway lookups use fixed tables in the unchanged graph. Only Send creates the owned thread. **New conversation** clears local files, selection, approval and conversation ownership; it waits for Send to create another thread. Opening the guide, changing frontend or mode, using browser history, filling a suggestion and choosing New do not author runs. Mode navigation and history preserve the mounted frame and unsent draft; reloading clears local state.

<ExampleCode file="cockpit/deep-agents/filesystem/react/src/app.tsx" />
<ExampleCode file="cockpit/deep-agents/filesystem/react/src/connection.ts" />

## Read the actual workspace

The workspace groups paths by directory in stable path order. Select a file to read its literal text. An explicit selection survives while its path exists; otherwise the panel selects the first existing path deterministically. Current UTF-8 records use their content string; valid legacy arrays of string lines join with newline. Empty text stays empty. Files are read-only and are never interpreted as HTML or Markdown.

The panel distinguishes **Live workspace** from checkpoint-confirmed files labeled **Paused · confirmed workspace**, **Saved workspace** or **Last confirmed workspace**. Streamed values can describe a change before checkpoint confirmation. At a confirmed pause, the saved panel shows actual files from the current root checkpoint beside proposed actions. A proposed file is awaiting approval; it is not a saved file.

The projection accepts at most 100 canonical paths of at most 1024 UTF-16 code units, with at most 65,536 code units per file and 1,048,576 total text units. Unsupported encodings, malformed records and oversized text remain visibly unavailable. Invalid workspace data retains the last confirmed workspace with a notice. The preview does not silently truncate content or label unsupported files Saved.

<ExampleCode file="cockpit/deep-agents/filesystem/react/src/workspace-state.ts" />
<ExampleCode file="cockpit/deep-agents/filesystem/react/src/workspace-panel.tsx" />

## Review the whole protected batch

The unchanged graph uses StateBackend and an interrupt permission over /reports/**. In the pinned backend, write_file and edit_file at the exact path /reports are allowed; report descendants are protected. Deletes covering /reports or the root are protected because their subtree overlaps the rule. Notes may run in parallel with a protected report call: an actual mixed pause can have an empty saved files map and three pending tool calls while requiring just one protected report decision. Count action_requests in the interrupt, not every unresolved tool call.

Every proposed action appears in its original order, including duplicate target paths. A write to an existing file is a replacement proposal: compare the actual saved text in the workspace with proposed new text in the approval panel. A new write is a new file proposal. An edit shows its actual old_string, new_string and replace_all setting; the UI does not predict the edited result. A delete shows the target path and file or subtree intent.

The controls offer **Approve entire batch** and **Reject entire batch**, only where the choice is permitted by every review config. There are no Edit or Respond controls. A supported batch contains at most 20 recognized write_file, edit_file or delete actions with bounded canonical arguments. Unknown arguments and malformed proposals leave decisions unavailable with an explanation and New conversation available. A malformed whole workspace map or unconfirmed checkpoint ownership blocks confirmation and decisions. Unsupported individual file records remain visibly unavailable and never supply literal file text; they do not by themselves block a supported batch whose raw saved map is confirmed. The example sends one decisions object containing exactly one ordered approve or reject decision for each protected action request, with no partial decision or automatic approval.

<ExampleCode file="cockpit/deep-agents/filesystem/react/src/approval-state.ts" />
<ExampleCode file="cockpit/deep-agents/filesystem/react/src/approval-panel.tsx" />

## Confirm what was saved

A tool result received is separate from saved workspace authority. Pause confirmation checks the native paused outcome, the exact current root checkpoint and history head, the owned human request and retained canonical message prefix, and the matching current interrupt batch. Terminal confirmation checks native success and a terminal root checkpoint with no pending tasks or interrupts. File contents come from that actual checkpoint, not from tool arguments, model prose or a predicted effect.

After a decision, the example reconciles the actual saved state. Approval does not guarantee a file will be created; a tool can fail. Rejection can lead to another proposal, which needs a new confirmed approval. It does not guarantee a terminal response, absence of the file or prevention of future writes.

<ExampleCode file="cockpit/deep-agents/filesystem/react/src/application.ts" />
<ExampleCode file="cockpit/deep-agents/filesystem/react/src/authority.ts" />

## Stop and recover

**Stop** preserves the last confirmed workspace and requires **New conversation** before another Send. An uncertain confirmation also keeps the last confirmed state and requires New; it never reuses a stale approval. New, Stop, disposal and changes of connection or operation invalidate local decision ownership. Stopping protects the client view and is not a rollback of backend writes. There is no automatic retry, replay or resume.

## Build from source

From a Threadplane checkout with dependencies installed:

~~~sh
npx nx build cockpit-deep-agents-filesystem-react
npx nx e2e cockpit-deep-agents-filesystem-react
~~~

Browser verification uses the real SDK, compiled Python graph and saved checkpoints with deterministic providers. Verification endpoints and fixtures are excluded from public Code output.
`;

export function ReactDeepAgentsFilesystemPreview({
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
