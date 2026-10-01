# React memory cockpit

This experimental frontend shares the existing Python `memory` assistant with Angular. The graph replies using the transcript and previously learned facts, then extracts facts into the same thread's state. A new conversation starts empty; this preview does not demonstrate the Store API or cross-thread memory.

Native React `MessageList` and `ChatInput` observe one confirmed application-owned session with `useAgent`. A literal learned-facts panel reflects authoritative own string entries in backend state. Server replacements remove old entries; absent or malformed memory clears the panel. No browser storage or client-side fact merging is used.

Thread creation and execution use zero SDK retries. Stop, failures, uncertain creation and every unexpected pause require New conversation. Page exit disposes the session and prevents late publication.

Build with `npx nx build cockpit-langgraph-memory-react`, test with `npx nx test cockpit-langgraph-memory-react`, lint with `npx nx lint cockpit-langgraph-memory-react`, and verify installed SDK browser behavior with `npx nx e2e cockpit-langgraph-memory-react`.

The isolated build consumes private local core/content/React and neutral LangGraph candidate packages. Strict installed declarations and emitted modules are checked without Angular or workspace implementation imports. The internal runtime bridge is copied explicitly. No npm publication is implied.

The public page is `/docs/langgraph/guides/memory?frontend=react`; runtime assets use `/langgraph/memory/react/`. Docs, Code and Run select this same frontend. The existing shared backend deployment is reused. Local proof routes and build-proof JSON are excluded from deployment. Developer keys travel only in SDK headers.
