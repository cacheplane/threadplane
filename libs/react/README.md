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

The root remains headless. This first text view does not provide Markdown, tool
cards, citations, reasoning, rich chat parity, SSR or hydration support. The private
AG-UI review uses an O(N) pure root-text selection; previous-output row reuse is an
optional bounded current-row optimization. React composition memoizes by the actual
owner and immutable transcript reference without advancing a mutable render cache.
