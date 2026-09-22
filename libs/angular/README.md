# @threadplane/angular

Private, unpublished Angular binding for app-owned sessions. The root exports
`observeAgent(session)`, which accepts `getSnapshot()` and `subscribe(notify)`
methods and returns a read-only `Signal<TSnapshot>`. The concrete snapshot must
extend the core `AgentSnapshot`; its additional fields and tool names, arguments,
and results retain their inferred types.

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

Keep the concrete session type when observing backend-specific fields. The private
LangGraph fixture exposes a broad readonly `values` map on its snapshot: `undefined`
means no current application-values map is observed, while `{}` is an observed
empty map. The binding preserves that field without inferring an application
schema, validating values, or issuing extra reads. Values and messages arrive in
the same immutable snapshot. This does not make the private backend factory public
or add state-writing, SSR, or hydration support.

No backend constructor is exported here; the current real LangGraph runtime is
still a private development composition seam. This API is under development and
does not claim full SSR, hydration, or feature parity. The Angular peer range
follows existing workspace policy; it is not a compatibility-matrix claim.

Build with `npx nx build angular` (ng-packagr and partial Angular compilation).
Run `npx nx test angular` and `npx nx run angular:type-tests` for real-session
and strict type coverage. The tests use Angular 21.1.6.
