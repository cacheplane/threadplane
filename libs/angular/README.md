# @threadplane/angular

Private, unpublished Angular binding for app-owned `AgentSession` values from
`@threadplane/core`. The root exports `observeAgent(session)`, which returns a
read-only `Signal<AgentSnapshot>`. Tool names, arguments, and results retain the
session's declared types.

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
The injected `DestroyRef` releases only this observer's subscription when its
context is destroyed. Pending work continues, and other observers remain
connected. The app calls `session.submit(text)`, `session.stop()`, and
`session.dispose()` and owns the session's lifetime.

No backend constructor is exported here; the current real LangGraph runtime is
still a private development composition seam. This API is under development and
does not claim full SSR, hydration, or feature parity. The Angular peer range
follows existing workspace policy; it is not a compatibility-matrix claim.

Build with `npx nx build angular` (ng-packagr and partial Angular compilation).
Run `npx nx test angular` and `npx nx run angular:type-tests` for real-session
and strict type coverage. The tests use Angular 21.1.6.
