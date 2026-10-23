import { MdxRenderer } from './MdxRenderer';
import type { ExampleCodeContext } from '../../lib/example-code';

const source = `# React chat debug preview

Inspect current nonmessage state and explicitly selected saved checkpoints beside native React MessageList, Markdown and ChatInput. This experimental first slice uses private source-build packages and the existing c-debug Python graph. Angular remains the default on this page.

## Opt in to a passive panel

Import the separate debug entry point and its stylesheet explicitly. The root React entry point does not export the panel or include its CSS. Importing these assets includes them in your build; the application decides when to expose development tools.

~~~tsx
import { ChatDebug } from '@threadplane/react/debug';
import '@threadplane/react/debug/styles.css';

// snapshot is owned by the application, not by ChatDebug.
<ChatDebug
  contextKey={snapshot.contextKey}
  current={snapshot.current}
  checkpointPage={snapshot.checkpointPage}
  selection={snapshot.selection}
  inspection={snapshot.inspection}
  activity={{ busy: snapshot.busy, status }}
  onRefresh={(request) => { void application.refresh(request); }}
  onInspect={(selection) => { void application.inspect(selection); }}
/>
~~~

ChatDebug accepts plain, application-owned display data and synchronous notifications. The application owns the SDK, session, reads, cancellation, stale-result checks and disposal. Opening, docking, changing tabs or closing the panel performs no network reads. Choose **Refresh checkpoints** or an **Inspect** button to request a read.

Only open, dock and tab preferences are stored, with guarded browser storage. Conversation state, messages, credentials and runtime targets are not persisted by the panel. Escape closes it and returns focus to the launcher. Outside-pointer interaction closes it without blocking the clicked target. The scoped CSS uses the existing eight --tp-chat-* tokens. The demo locally aliases Markdown's --ds-text-primary to --tp-chat-text.

## One owner, one configured target

The runtime descriptor is **chat-debug-python-react**, with route **/chat/debug/react**, local port **4645** and assistant **c-debug**. Code shows the complete authored React application, its project configuration, and the same Python graph and prompt as Angular. It excludes test fixtures, wire servers and credentials.

**Send** lazily creates a UUID thread. A stable application owner serializes Send, Refresh and Inspect. Follow-up is allowed only after live delivery, the exact current root checkpoint's full message identities and nonmessage values, and a separate primary-session history load all confirm the turn. This graph contributes one human and three legitimate assistant messages per turn; title generation is metadata only. The process node measures the generated answer using Unicode codepoints and literal-space words; public model output is variable.

**New conversation** revokes the old context and clears inspection before awaiting cleanup; it creates no server thread. **Stop** during a read aborts only that read and leaves the confirmed conversation usable. Stop during Send requires New conversation. Failed cleanup quarantines authoring until reload. These browser lifetime checks do not acknowledge backend cancellation or prove durable storage.

A failed or unconfirmed Send keeps clearly labelled last-confirmed data and requires New conversation before another Send. A failed Refresh or Inspect reports its read error without replacing the confirmed transcript or current state; a read error alone does not quarantine authoring.

Shared/default configuration uses the same-origin **/api** target; an explicit LangSmith target uses its configured URL and headers for every operation. AG-UI targets are unsupported by this example.

## Current state and exact historical reads

After confirmation, **Current state** shows observed values with messages projected out. Unknown or unavailable values stay distinct from an observed empty object. **Selected checkpoint** is separately labelled and appears only after explicit inspection. Its state never replaces the transcript or current observation.

The application uses the existing SDK directly for these read operations:

~~~ts
// Explicit Refresh: metadata from one bounded page, in server order.
const history = await client.threads.getHistory(threadId, { limit: 10, signal });

// Explicit Inspect: the full checkpoint captured for the selected row.
const state = await client.threads.getState(threadId, capturedCheckpoint, { signal });
~~~

These SDK calls use POST history and POST state/checkpoint on the wire; they do not create runs. The application binds a selection to its current context, page generation and opaque row key, checks returned checkpoint identity and rejects late or mismatched reads. Replacing the page or conversation clears selection, disclosure and copy feedback. Missing or duplicate checkpoint identities remain visible but cannot be inspected. An intermediate checkpoint can be readable without being eligible to fork. The last ten entries are a bounded page, not a full branch tree or automatic pagination.

## Bounded viewing and Copy

The viewer bounds depth to 6, entries to 200, strings to 2000 codepoints, and displayed/copied JSON to 32768 UTF-8 bytes. The application retains at most 131072 bytes for an inspection. Copy writes exactly the shown valid JSON and reports truncation; it is not a full raw export. These limits apply to inspection, not lossless conversation strings. Initial SDK decoding happens before application ownership bounds, and the viewer does not isolate hostile Proxy objects.

## Graph and validation scope

The shared graph runs generate, process, summarize and title nodes. TAG_NOSTREAM suppresses title-model message callbacks, so the three answer/analysis/summary messages remain legitimate while the title updates metadata.

<ExampleCode file="cockpit/chat/debug/python/src/graph.py" region="graph-wiring" />

Local browser tests use the actual compiled graph with InMemorySaver, deterministic providers and blocked sockets. They exercise real SDK HTTP/SSE through captured callback replay after graph completion; they do not prove live-provider timing, external persistence or cancellation acknowledgment. Docs, Code and Run preserve the same mounted React iframe and unsent draft across mode navigation.

~~~sh
npx nx build cockpit-chat-debug-react
npx nx e2e cockpit-chat-debug-react
~~~

T29 remains partial: historical diff, Replay/Fork callbacks and controls, the full checkpoint tree and broader devtools parity are still planned. The React panel has no Replay or Fork buttons in this slice. The canonical Angular guide retains its own API and behavior.
`;

export function ReactChatDebugPreview({ exampleCode }: { readonly exampleCode: ExampleCodeContext | null }) {
  return (
    <div className="docs-workspace-article">
      <article className="docs-article-layout flex-1 py-8 px-4 sm:px-6 md:px-12 md:max-w-3xl">
        <MdxRenderer source={source} exampleCode={exampleCode} />
      </article>
    </div>
  );
}
