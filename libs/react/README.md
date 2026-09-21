# @threadplane/react

Private, unpublished React binding for app-owned `AgentSession` values from
`@threadplane/core`. The root exports `useAgent(session)`, which returns the
current `AgentSnapshot` through React's `useSyncExternalStore`. Tool names,
arguments, and results retain the session's declared types.

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

The root retains `use client`. Server rendering and hydration are not supported
by this binding. No backend constructor is exported here; the current real
LangGraph runtime is still a private development composition seam. This API is
under development and is not a published compatibility or feature-parity claim.

Build with `npx nx build react`; run `npx nx test react` and
`npx nx run react:type-tests` for real-session and strict type coverage. React
19.2.4 is the tested runtime; React DOM is used only by the test host.
