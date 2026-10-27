# React persistence cockpit

This experimental frontend shares the existing Python `persistence` assistant with Angular. The server automatically checkpoints each conversation. A semantic picker lists only confirmed conversations created on the current page; reloading clears the picker but does not delete server history. This preview does not provide a server-wide catalog, browser storage, history pagination, branching, deletion, or the Store API.

Native React `MessageList` and `ChatInput` observe one application owner with `useAgent`. Selecting an available entry releases the previous session and transcript, binds a fresh session to the selected confirmed UUID, and explicitly loads server history. The composer and picker stay disabled during the read. Selection starts neither a new thread nor a model run, and cached rows grant no command authority.

Creation and execution use zero SDK retries. Stop, failures, uncertain creation or execution, and every unexpected pause quarantine the affected conversation. New conversation or another available entry can continue; unavailable entries cannot silently resume. Page exit disposes the owner and fences late creation, history, and run results. A fulfilled history promise alone never grants authority after cancellation.

Build with `npx nx build cockpit-langgraph-persistence-react`, test with `npx nx test cockpit-langgraph-persistence-react`, lint with `npx nx lint cockpit-langgraph-persistence-react`, and verify installed SDK behavior with `npx nx e2e cockpit-langgraph-persistence-react`.

The isolated build consumes private local core/content/React and neutral LangGraph candidate packages. Strict installed declarations and emitted modules are checked without Angular or workspace implementation imports. The internal runtime bridge is copied explicitly. No npm publication is implied.

The public guide is `/docs/langgraph/guides/persistence?frontend=react`; runtime assets use `/langgraph/persistence/react/`. Docs, Code and Run select this same implementation. The existing shared deployment is reused. Local proof routes and build-proof JSON are excluded from deployment. Developer keys travel only in SDK headers.
