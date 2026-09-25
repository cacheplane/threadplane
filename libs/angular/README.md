# @threadplane/angular

Private, unpublished Angular binding for app-owned sessions. The root exports
`observeAgent(session)`, which accepts `getSnapshot()` and `subscribe(notify)`
methods and returns a read-only `Signal<TSnapshot>`. The observer contract is
structural:

```ts
{
  getSnapshot(): TSnapshot;
  subscribe(notify: () => void): () => void;
}
```

`TSnapshot` is unconstrained. The binding preserves its exact authored type,
including readonly fields and, for core-compatible sessions, typed tool names,
arguments and results. It does not require a core display projection.

Call `observeAgent` in an Angular injection context, such as a component field
initializer or provider factory, with a session supplied by the app:

```ts
import { observeAgent } from '@threadplane/angular';
import type { AgentSession } from '@threadplane/core';

// Invoke this factory within an Angular injection context.
export function observeStatus(session: AgentSession) {
  return observeAgent(session);
}
```

The function borrows the session. Reading or subscribing does not start a run.
Snapshot reads and subscription calls preserve the session method receiver.
The injected `DestroyRef` releases only this observer's subscription when its
context is destroyed. Pending work continues, and other observers remain
connected. The app calls `session.submit(text)`, `session.stop()`, and
`session.dispose()` and owns the session's lifetime.

The owner must return a stable snapshot between changes, publish a changed
aggregate reference when data changes, and notify its subscribers. Subscribing
must register notifications without issuing commands and return an idempotent
release function. The owner is responsible for immutable snapshots; a readonly
Signal prevents replacing its value through the binding but does not freeze data
or add deep readonly types to caller-authored mutable fields.

Keep the concrete session type when observing backend-specific fields. The private
LangGraph fixture exposes a broad readonly `values` map on its snapshot: `undefined`
means no current application-values map is observed, while `{}` is an observed
empty map. The binding preserves that field without inferring an application
schema, validating values, or issuing extra reads. Values and messages arrive in
the same immutable snapshot. This does not make the private backend factory public
or add state-writing, SSR, or hydration support.

The private AG-UI session is also observed directly: its native snapshot contains
`transcript`, `state`, `subagents` and root `run` evidence. Partial tool arguments
remain raw protocol strings; observing them does not authorize tool execution or
invent core pending-tool states. Integration tests borrow the actual private
owner through a browser-safe Fetch API fixture. This is not a public AG-UI factory
or a claim that shared display components accept every native snapshot.

No backend constructor is exported here; the current real LangGraph runtime is
still a private development composition seam. This API is under development and
does not claim full SSR, hydration, or feature parity. The Angular peer range
follows existing workspace policy; it is not a compatibility-matrix claim.

Build with `npx nx build angular` (ng-packagr and partial Angular compilation).
Run `npx nx test angular` and `npx nx run angular:type-tests` for real-session
and strict type coverage. The tests use Angular 21.1.6.

`@threadplane/angular/chat` is a separate APF entry exporting standalone
`TextTranscriptComponent`. Import it in your component's `imports` and bind rows:

```html
<threadplane-text-transcript [messages]="rows" label="Conversation" />
```

Rows are readonly structural `id`, core `role`, and string `content` values; extra
fields are allowed. IDs must be unique within the list. Every supplied row renders
literally, including empty text and intentionally supplied system or tool rows.
Select visible rows in app composition without rewriting the owner's history.
The named section and ordered list preserve whitespace and keyed mounted DOM.
The component has no commands, subscription, token announcements, focus or scroll
behavior. A remount creates new DOM; the app still owns the session lifetime.

The same `/chat` entry exports standalone, OnPush `ToolObservationComponent`.
Import it in your component's `imports` and supply literal text:

```html
<threadplane-tool-observation
  name="weather"
  [argumentsText]="partialArguments"
  label="Worker weather"
/>
```

`name` and `argumentsText` are required string inputs. Optional `resultText` is
omitted when absent; an empty string still renders a Result field. The default
label is `Tool observation`. All text renders literally with whitespace and
long-line wrapping, including partial JSON and strings such as `null` or
`undefined`. The caller selects the call, associates its result and formats known
values. The component does not parse arguments, infer execution status, subscribe
or execute tools. Updating text preserves its mounted section and arguments DOM;
remounting creates new DOM.

The root remains headless. These text views do not provide Markdown, execution
controls, citations, reasoning, full chat parity, SSR or hydration. The private AG-UI
review uses O(N) pure root-text selection with optional previous-output row reuse
bounded to current rows. Framework memoization follows immutable transcript
references and is disposable; it is not another owner or execution controller.
