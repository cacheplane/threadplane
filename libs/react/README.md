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

The root remains headless. These text views do not provide Markdown, execution
controls, citations, reasoning, rich chat parity, SSR or hydration support. The private
AG-UI review uses an O(N) pure root-text selection; previous-output row reuse is an
optional bounded current-row optimization. React composition memoizes by the actual
owner and immutable transcript reference without advancing a mutable render cache.

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
