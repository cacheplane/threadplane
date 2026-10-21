# @threadplane/react

Private, unpublished React binding for app-owned sessions. The root exports
`useAgent(session)`, which accepts `getSnapshot()` and `subscribe(notify)` methods
and returns their concrete `TSnapshot` through React's `useSyncExternalStore`.
The observer contract is structural:

```ts
{
  getSnapshot(): TSnapshot;
  subscribe(notify: () => void): () => void;
}
```

`TSnapshot` is unconstrained. The hook preserves its exact authored type,
including readonly fields and, for core-compatible sessions, typed tool names,
arguments and results. It does not require a core display projection.

```tsx
import { useAgent } from '@threadplane/react';
import type { AgentSession } from '@threadplane/core';

export function Status({ session }: { session: AgentSession }) {
  const snapshot = useAgent(session);
  return <p>{snapshot.status}</p>;
}
```

The hook borrows the session. Rendering, subscribing, StrictMode remounts, and
unmounting do not start runs. Unmounting releases that observer's subscription;
it does not stop pending work or dispose the session. Multiple components can
observe the same session. The app calls `session.submit(text)`, `session.stop()`,
and `session.dispose()` and owns the session's lifetime. Replacing the session
prop transfers the subscription without disposing the previous session.
Snapshot reads and subscription calls preserve the session method receiver.

The owner must return a stable snapshot between changes, publish a changed
aggregate reference when data changes, and notify its subscribers. React compares
snapshots with `Object.is`. Subscribing must register notifications without
issuing commands and return an idempotent release function. The owner is
responsible for immutable snapshots; the hook neither freezes mutable data nor
adds deep readonly types to caller-authored mutable fields.

Keep the concrete session type when observing backend-specific fields. The private
LangGraph fixture exposes a broad readonly `values` map on its snapshot: `undefined`
means no current application-values map is observed, while `{}` is an observed
empty map. The hook preserves that field without inferring an application schema,
validating values, or issuing extra reads. Values and messages arrive in the same
immutable snapshot. This does not make the private backend factory public or add
state-writing support.

The private AG-UI session is also observed directly: its native snapshot contains
`transcript`, `state`, `subagents` and root `run` evidence. Partial tool arguments
remain raw protocol strings; observing them does not authorize tool execution or
invent core pending-tool states. Integration tests borrow the actual private
owner through a browser-safe Fetch API fixture. This is not a public AG-UI factory
or a claim that shared display components accept every native snapshot.

The root retains `use client`. Server rendering and hydration are not supported
by this binding. No backend constructor is exported here; the current real
LangGraph runtime is still a private development composition seam. This API is
under development and is not a published compatibility or feature-parity claim.

Build with `npx nx build react`; run `npx nx test react` and
`npx nx run react:type-tests` for real-session and strict type coverage. React
19.2.4 is the tested runtime; React DOM is used only by the test host.

`@threadplane/react/chat` is a separate client entry for a plain-text conversation:

```tsx
import { TextTranscript } from '@threadplane/react/chat';

const rows = [
  { id: 'question', role: 'user', content: 'Hello\nworld' },
] as const;
<TextTranscript messages={rows} label="Conversation" />;
```

Rows are readonly structural `id`, core `role`, and string `content` values; extra
fields are allowed. IDs must be unique within the list. The component renders all
supplied rows literally, including empty text and intentionally supplied system or
tool rows. Caller composition selects visible messages without rewriting history.
It preserves whitespace and keyed mounted rows, using a named section and ordered
list. It does not announce tokens, move focus, scroll, issue commands or own a
session. Unmount/remount creates new DOM while ownership stays with the app.

The same `/chat` entry exports `ToolObservation` and readonly
`ToolObservationProps` for explicitly supplied tool text:

```tsx
import { ToolObservation } from '@threadplane/react/chat';

<ToolObservation
  name="weather"
  argumentsText={'{"city":'}
  label="Worker weather"
/>;
```

`name` and `argumentsText` are required strings. Optional `resultText` is omitted
when absent; an empty string still renders a Result field. The default label is
`Tool observation`. All text renders literally with whitespace and long-line
wrapping, including partial JSON and strings such as `null` or `undefined`.
The caller selects the call, associates its result and formats known values.
The component does not parse arguments, infer execution status, subscribe or
execute tools. Updating text preserves its mounted section and arguments DOM;
remounting creates new DOM.

The root remains headless. `TextTranscript` and `ToolObservation` do not provide Markdown, execution
controls, citations, reasoning, rich chat parity, SSR or hydration support. The private
AG-UI review uses an O(N) pure root-text selection; previous-output row reuse is an
optional bounded current-row optimization. React composition memoizes by the actual
owner and immutable transcript reference without advancing a mutable render cache.

`Reasoning` borrows a required owned `MarkdownSnapshot`, typically
`row.reasoning` from `@threadplane/content/messages`. It renders the existing
Markdown view inside an accessible disclosure. Streaming defaults open with
“Thinking…”; completed content defaults collapsed with “Show reasoning”. Empty
documents hide the disclosure. Optional `label`, `defaultExpanded`, `className`
and app-supplied `durationMs` customize presentation; no timing is inferred.

Manual expansion choices persist through updates and completion within a
generation. A new generation or completed document reopening resets the choice.
The view never parses, subscribes, runs commands or disposes its snapshot. Default
`MessageList` shows reasoning before assistant answers; custom renderers select
their own presentation. Styles remain opt-in through `/chat/styles.css`.

`@threadplane/react/markdown` exports the client component `Markdown` and readonly
`MarkdownProps`. It accepts a required, whole `MarkdownSnapshot` from an app-owned
content object:

```tsx
import { useAgent } from '@threadplane/react';
import { Markdown } from '@threadplane/react/markdown';
import type { Markdown as MarkdownOwner } from '@threadplane/content/markdown';

export function Answer({ owner }: { owner: MarkdownOwner }) {
  const snapshot = useAgent(owner);
  return <Markdown snapshot={snapshot} />;
}
```

Create and update the owner in application composition, outside React rendering.
The component only presents the supplied snapshot; it has no parsing, subscription
or owner lifecycle. Use `useAgent` when observation is needed, or pass a snapshot
directly. Unmounting the view does not dispose the owner. A document generation
change resets local image state; replacing an image destination allows recovery
after a failed load.

The renderer preserves literal HTML as text, uses semantic lists/tables and
disabled task checkboxes, and resolves references from the snapshot. Math remains
delimited text; citations are numbered or unresolved text markers. Missing,
blocked and failed images show an accessible alt-text fallback. Destination
classification is the fixed [`content/markdown` policy](../content/README.md),
including exclusion of data images. The root binding stays headless; rich math,
syntax highlighting, citation overlays, custom node registries, legacy migration,
SSR and hydration remain outside this private feature.

## Chat

`Citations` presents an explicit readonly `Citation[]` from `@threadplane/core`
as a named Sources section. Empty input renders nothing. It preserves supplied
order, index, title, snippet and source-type text; IDs must be unique. Optional
`label` and `className` customize the section. Same-ID updates preserve mounted
source items. An absent title falls back to the supplied URL or `Source <index>`;
intentionally empty fields remain empty.

```tsx
import { Citations } from '@threadplane/react/chat';

<Citations citations={message.citations ?? []} />;
```

Allowed URLs use the existing content/Markdown link policy, with a native new-tab
link and `noopener noreferrer`. Missing or blocked URLs display text. The view
does not fetch icons, previews or metadata, parse snippets, merge Markdown
sidecars, infer dates/types, subscribe or dispose anything. Default MessageList
shows supplied sources after assistant answers; custom row rendering selects its
own presentation. Styles are opt-in through `/chat/styles.css`. This bounded
Sources view does not provide the legacy citation overlays or full citation parity.

`MessageActions` renders a named group of explicitly authored native buttons.
Supply readonly actions with unique `id`, string `label`, argumentless `onSelect`
and optional `disabled`. Root `disabled`, `label` and `className` are optional;
empty actions render nothing. The app owns clipboard writes, async feedback,
ratings and regeneration commands. Mounting or updating the view invokes no action.
Callbacks may return promises; the app must handle their completion and errors.

```tsx
import { MessageActions } from '@threadplane/react/chat';

<MessageActions
  actions={[{ id: 'copy', label: 'Copy answer', onSelect: () => void copyAnswer() }]}
  disabled={copyPending}
/>;
```

`ApprovalCard` is an inline, named region with an app-authored body and explicit
actions. Each action has a unique `id`, `label`, `onSelect` callback and optional
`disabled` flag. The card's `disabled` flag disables all actions. Clicking does
not hide or consume the card; the app owns interrupt matching, decision tokens,
pending/error state and command handling. Async callbacks must handle their own
rejections. The card adds no modal, focus management, timer or session lifecycle.

```tsx
import { ApprovalCard } from '@threadplane/react/chat';

<ApprovalCard
  disabled={!canRespond}
  actions={[{ id: 'approve', label: 'Approve', onSelect: respond }]}
>
  <p>{reason}</p>
</ApprovalCard>;
```

```tsx
import { Chat } from '@threadplane/react/chat';
import '@threadplane/react/chat/styles.css';

<Chat session={session} />;
```

`Chat` observes an app-owned `AgentSession`, streams assistant Markdown, shows tool
calls and the session error, and sends with Enter (Shift+Enter adds a line). It
submits the trimmed draft and ignores rejected `submit`/`stop` promises; the session
reports failures through its snapshot. A failed send does not restore the draft.
Switching sessions resets the draft. Chat never disposes the session.

Without a `content` prop, Chat owns one message projection per session and releases
it on unmount or session change. To keep the projection across remounts, create it
once with `createMessageContent()` from `@threadplane/content/messages` and pass it
as `content`:

```tsx
// Module scope (or wherever the app keeps its session), not inside render.
const content = createMessageContent();

<Chat session={session} content={content} />;
```

The app owns that projection and calls `content.dispose()` when it is done with it;
Chat never disposes app-passed content. The stylesheet is opt-in and scoped to `.tp-chat*`
classes, with `--tp-chat-*` custom properties that fall back to `--ds-*` tokens.
Compose `MessageList` and `ChatInput` directly when your app owns selection or
rendering.

`MessageList` infers the concrete row type from `rows`, including authored fields
and typed tool contracts, and passes it to `renderMessage`. Keep that callback
stable so unchanged rows stay memoized. Give the list a bounded height and
overflow scrolling in app CSS; it follows row updates while at the bottom and
preserves the reader's position when scrolled up. Key it by conversation ID when
a new selection should start at the bottom. Same-ID updates preserve scroll state.
Where `ResizeObserver` is available, the list also follows height changes inside
unchanged rows, including image loads and disclosure expansion, while pinned.
The same observer follows scroll-region size changes, including a height-only
window resize, while pinned.
Reading above the bottom preserves position. The observer disconnects on unmount;
without it, row-update following remains available. The list uses one unstyled
content wrapper inside its existing scroll region.

## Controlled conversation lists

The private `ThreadList` view from `@threadplane/react/chat` renders supplied
conversation rows without owning their data or selection:

```tsx
<ThreadList
  threads={loadedThreads}
  activeThreadId={selectedId}
  onSelect={selectThread}
  label="Loaded conversations"
/>
```

`ThreadListItem` has a readonly `id` and optional plain-text `title`; a missing
or empty title falls back to the full ID. The readonly collection keeps its
supplied order. Provide unique stable IDs so surviving rows retain their DOM
through reordering and updates. Selection requests pass the exact ID to
`onSelect`; only the supplied `activeThreadId` controls `aria-current`. There
are no automatic commands on mount, rerender or removal.

The view renders a named semantic list of ordinary buttons, with default label
“Conversations”, scoped wrapping/focus styles and optional root `className`.
An empty collection renders an empty list. The application owns loaded-title
filtering, loading/error/empty notices, data fetching and execution. Rename,
delete, archive, pin/project actions, drag reordering, relative timestamps and
custom row rendering remain future work. This is a bounded private T29 slice.

## Controlled chat panels

`ChatPopup` is a private non-modal shell from `@threadplane/react/chat`:

```tsx
import { useState } from 'react';
import { Chat, ChatPopup } from '@threadplane/react/chat';
import '@threadplane/react/chat/styles.css';

function Support() {
  const [open, setOpen] = useState(false);
  return (
    <ChatPopup open={open} onOpenChange={setOpen} title="Support">
      <Chat session={session} content={content} />
    </ChatPopup>
  );
}
```

The application owns visibility. The launcher, Close button and unclaimed Escape
inside the panel request changes through `onOpenChange`; accepted `open` changes
control visibility and focus. Opening focuses Close; closing returns focus to the
launcher unless another page control already has focus. `launcherLabel`,
`closeLabel`, `closeOnEscape` and `className` customize the shell.

Closed children remain mounted, hidden and inert. Drafts and borrowed subscriptions
survive closing; a running response continues. Closing never stops or disposes the
session or app-owned content. The application still owns Stop and final disposal.
Changing the selected conversation can independently reset its composer.

The dialog has a generated title relationship, ordinary non-modal Tab order and
viewport-bounded scrolling. It uses the same scoped chat stylesheet and tokens.
Mount it outside transformed or clipping ancestors: this first slice uses fixed
positioning in its existing DOM location, with no portal, backdrop, focus trap,
global shortcut or persisted open state.

`ChatSidebar` uses the same controlled props and retained-child behavior as
`ChatPopup`. Import it from the same `/chat` entry and replace `ChatPopup` in the
example above to use a full-height panel at the viewport's inline end. Its width
is 28rem on larger screens and the full viewport width at 640px and below. The
launcher hides while open; Close and scoped Escape request closure, then focus
returns to the launcher when appropriate. The surrounding page stays interactive
and Tab can leave the panel.

The sidebar overlays the page by default. To keep page content beside the open
panel on wider screens, pass that content as `pageContent` and set `pushContent`:

```tsx
<ChatSidebar open={open} onOpenChange={setOpen} title="Conversation"
  pageContent={<ConversationDirectory />} pushContent>
  <ConversationView />
</ChatSidebar>
```

`children` remains the chat panel content. The persistent page slot and panel
retain their mounted children when visibility or the layout preference changes.
The layout reserves 28rem at the inline end only while open with `pushContent`;
closing or disabling it restores the page width. At 640px and below it always
overlays with no reservation. Reservation applies only inside this sidebar's
layout wrapper; it does not coordinate peer panels or claim global page edges.
`className` still customizes the popup shell. Peer-panel edge claims, SSR,
hydration and public release remain separate work. Both panels are private
contributor APIs.

### Controlled conversation navigation

The private `/chat` entry also exports `ChatSidenav`, `ChatSidenavMode`,
`ChatSidenavProps`, `ChatSidenavScrim` and `ChatSidenavScrimProps`. The navigation
shell accepts application-owned navigation as `children`:

```tsx
<>
  <ChatSidenavScrim
    open={mode === 'drawer' && drawerOpen}
    onDismiss={() => setDrawerOpen(false)}
  />
  <ChatSidenav
    mode={mode}
    open={drawerOpen}
    onModeChange={setDesktopMode}
    onOpenChange={setDrawerOpen}
  >
    <ConversationDirectory />
  </ChatSidenav>
</>
```

Required `mode` selects `expanded`, `collapsed` or `drawer`; `open` controls only
the drawer. Expanded and collapsed navigation stay in normal flow at 18rem and
4rem. The drawer sits at the viewport's inline-start edge, is at most 20rem wide, and
uses a named non-modal navigation landmark with no built-in scrim or focus trap. The
application chooses modes and owns responsive breakpoints and persistence.
The consumer provides a bounded desktop height and lays out sibling content.
`onModeChange` requests only `expanded` or `collapsed`; the launcher, Close and
scoped Escape request drawer visibility through `onOpenChange`. Accepted props
determine visibility and focus. An open drawer focuses Close; hiding focused
content returns focus to the visible launcher or toggle while preserving external
control focus.

Children stay mounted across every mode. Collapsed content and closed drawers are
hidden and inert, retaining filters, drafts and borrowed subscriptions. The shell
does not select conversations, send commands, own session data or add global
listeners. Optional `label`, `launcherLabel`, `closeLabel`, `expandLabel`,
`collapseLabel` and `className` customize its accessible labels and styling.
Defaults are Conversations, Open conversations, Close conversations, Expand
conversations and Collapse conversations. Use the existing scoped chat stylesheet.

`ChatSidenavScrim` is an optional sibling backdrop, rendered only when its required
`open` prop is true. It is an ordinary keyboard-accessible button; activation calls
the required `onDismiss` callback without changing visibility itself. Optional
`label` defaults to Close conversation navigation backdrop; `className` customizes
styling. Its fixed viewport coverage sits below the drawer and above the page.
Mount both outside transformed or clipping ancestors and enclosing stacking
contexts. The application owns visibility and focus restoration when the focused
backdrop is removed. The primitive adds no Escape listener, focus trap, background
inertness, portal or session behavior; adding it does not make navigation modal.

The native React example opts in with exact `?presentation=sidenav`, keeps the
conversation inline, and chooses drawer mode at widths of 700px and below.
It composes the sibling scrim only while the drawer is open, restores local focus
after backdrop dismissal, and removes the backdrop on desktop mode changes.
Its directory filter and composer survive navigation visibility and breakpoint
changes; selecting a different conversation deliberately resets that composer's
draft. This is a bounded children-based navigation slice. Project/archive menus,
global shortcuts, debug ownership and full Angular composition parity remain
open under T30.

## Read-only render trees

The private `@threadplane/react/render` client entry exports `RenderSpec`.
Prepare and validate a plain-data tree in application composition, then supply
an authored registry and explicit immutable state:

```tsx
import { RenderSpec, type ReactRenderRegistry } from '@threadplane/react/render';

const registry: ReactRenderRegistry = {
  Title: ({ props }) => <h2>{String(props['text'] ?? '')}</h2>,
};
const spec = {
  root: 'title',
  elements: { title: { type: 'Title', props: { text: { $state: '/title' } } } },
} as const;
<RenderSpec spec={spec} state={{ title: 'Trip recap' }} registry={registry} />;
```

`RenderSpecData`, `RenderElementData`, `RenderSpecProps`, `RenderViewProps`,
`ReactRenderRegistry` and `RenderValue` describe readonly inputs and view values.
Views receive owned, recursively frozen `props` and `bindings`, ordered children,
`elementKey` and `loading`. Missing expressions can resolve to `undefined`.
Caller data is never frozen or mutated. Null specs, missing roots, hidden elements
and unknown types without a supplied `fallback` render nothing. Element and
registry lookup uses own keys; cyclic child paths are cut off. Duplicate sibling
IDs or repeat identities throw a contract error.

The adapter reuses the pinned `@json-render/core` expression, visibility and binding
resolvers. Repeat containers render their children per array item, with `$item`,
`$index` and absolute nested state paths. An own string or finite-number repeat
key preserves mounted identity across reorder; absent or unsupported keys use the
item index. String, number and index identities have separate namespaces.

Supply an optional `functions` map for authored `$computed` expressions:

```tsx
import type { ReactRenderFunctions } from '@threadplane/react/render';

const functions: ReactRenderFunctions = {
  uppercase: ({ value }) => String(value).toUpperCase(),
};
const computedSpec = {
  root: 'title',
  elements: {
    title: {
      type: 'Title',
      props: { text: { $computed: 'uppercase', args: { value: { $state: '/title' } } } },
    },
  },
} as const;
<RenderSpec spec={computedSpec} state={{ title: 'Trip recap' }} registry={registry} functions={functions} />;
```

`RenderComputedFunction` receives an owned, recursively frozen argument record
and synchronously returns `RenderValue`. Literal, state, item, index and nested
computed arguments use the existing resolver. Function results cross the same
plain-data ownership boundary as other resolved values. Promises, executable
callbacks and non-plain results are rejected. Calculations must be pure: React
can evaluate them repeatedly during rendering, and no call count, caching or
effect behavior is promised. Callback errors propagate as render errors.

Function maps must be plain records or null-prototype records. Every own
string-keyed callable data property is registered, including non-enumerable
entries; inherited names are unavailable. Accessors, symbol keys and non-callable
entries are rejected without invoking getters. The caller's map and data remain
unfrozen and unmodified. Unknown function names resolve to `undefined` with the
upstream warning behavior. This optional host map does not permit executable
callbacks in raw specs or add actions, watchers or state ownership.

The same entry exports the type-only `RenderReadinessEntry`. Direct function,
`memo` and `forwardRef` registrations still receive missing values as `undefined`.
An optional readiness descriptor delays one view's initial admission:

```tsx
import type {
  ReactRenderRegistry, RenderReadinessEntry, RenderViewProps,
} from '@threadplane/react/render';

// Keep the component and predicate identities stable outside rendering.
function Value({ props }: RenderViewProps) {
  return <output>{String(props['value'] ?? '')}</output>;
}
const valueEntry: RenderReadinessEntry = {
  kind: 'readiness',
  component: Value,
  isReady: (props) => typeof props['value'] === 'number',
  fallback: () => <span>Waiting for a value…</span>,
};
const readinessRegistry: ReactRenderRegistry = { Value: valueEntry };
```

`isReady` receives the owned, recursively frozen resolved prop record. It must be
pure and return a synchronous boolean; React may evaluate it repeatedly. Errors
propagate, and promises or other non-boolean results throw `TypeError`. This is
app-authored admission, without automatic Standard Schema or all-props-defined
validation. While pending, the descriptor fallback receives current `props`,
`bindings`, `elementKey` and `loading`, without children; absent fallback renders
nothing. The top-level `RenderSpec` fallback remains separate and handles unknown
registry types.

Only a successful real-view commit latches admission. Later ordinary missing
values, prop, binding or loading updates retain that view's actual DOM and local
state and skip further predicate calls. An initially suspended or abandoned
candidate cannot latch. Element key, element type, component or predicate identity
changes reset admission and remount even when the component is otherwise the
same. Equivalent registry/descriptor objects and fallback-only changes retain
admission; a committed pending replacement retires the old lifetime even if its
contract later returns. Hidden or missing elements, null specs, removal and
transitions to direct registrations reset the lifetime. Stable repeated keys retain
it. StrictMode effect cleanup does not reset admission or issue owner commands.

This private client contract adds no observation or owner lifetime: the app owns
state writes, commands and disposal. Forms, catalog views, actions, automatic
schema validation, SSR, hydration, public release and full legacy parity remain
outside this readiness slice.

State and resolved values must be finite, acyclic plain data. Functions, symbols,
accessors and non-plain objects are rejected. Raw props also reject `undefined`
and own `__proto__` keys because the upstream raw-prop resolver cannot preserve
that key; state-bound objects preserve empty and special own keys. These guards
are not application-schema validation. Validate untrusted trees before rendering.

The view does not parse JSON, observe owners, create a store, execute actions,
evaluate watch effects or manage disposal. It omits forms, action providers,
automatic schema validation, A2UI, telemetry, SSR and hydration. Native React
dogfoods this bounded feature by preparing the existing typed terminal trip
recap outside rendering. This is not arbitrary streamed JSON rendering or full
render parity. The root entry stays headless.

## Private Debug first slice

`@threadplane/react/debug` exports `ChatDebug` and narrow readonly data types.
Import `@threadplane/react/debug/styles.css` explicitly for the scoped panel CSS.
Root and chat imports carry no Debug JavaScript or styles.

```tsx
import { ChatDebug } from '@threadplane/react/debug';
import '@threadplane/react/debug/styles.css';

<ChatDebug
  contextKey="application-owner"
  current={{ contextKey: 'application-owner', status: 'ready', values: {} }}
  storageKey="my-app:debug-ui"
/>;
```

This passive, nonmodal view presents current application values and an app-owned
checkpoint page of at most ten metadata rows. Unknown/unavailable current state
is distinct from observed `{}`; an unloaded page is distinct from an empty page.
The app controls `selection` and supplies separately keyed `inspection` results.
Context, page generation and row key must match before historical values/errors
are displayed. The UI never interprets SDK checkpoint objects.

`onRefresh` and `onInspect` are synchronous notifications returning `undefined`.
Each explicit action supplies its complete ownership token; application code
validates it and starts any separately owned read. Rendering, mounting, opening,
tabs, docking, closing and unmounting issue no reads, runs or disposal. The app
owns network access, stale-result validation, selection and resource lifetime.
History order is as supplied, with no automatic paging or live branch-tree claim.
Fork, replay, diff and full T29 parity remain outside this first private slice.

Displayed plain JSON is bounded to depth 6, 200 entries, 2,000 Unicode code points
per string/key and 32 KiB of UTF-8 output. Truncation is disclosed separately from
valid JSON. Copy awaits clipboard success/failure and copies exactly the displayed
projection, never a complete-raw-state promise. Only visited prefixes are validated;
SDK decoding and caller allocation happen before this display bound. Invalid
visited data is unavailable. Plain app-owned data excludes executable objects,
accessors and proxies; this view is not an SDK validation boundary.

The panel's own data/default props produce deterministic server markup and can
hydrate independently of `useAgent`; this does not extend the hook's SSR contract.
After hydration, a supplied application-scoped `storageKey` restores only open,
dock and tab preferences, tolerating denied storage. Defaults never overwrite saved
preferences during hydration. State, history, IDs, target and selection are never
persisted. Use separate keys for independent panels. Scoped Escape handling and
outside-pointer close retain outside focus; user-close restores the launcher only
while focus remains owned by that panel.
