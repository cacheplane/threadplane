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
