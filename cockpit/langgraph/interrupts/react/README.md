# React interrupts cockpit

This experimental frontend shares the existing Python `interrupts` assistant and simulated refund graph with Angular. It uses the native React `ApprovalCard`, `MessageList`, and `ChatInput` primitives. No real refund is issued.

One stable application owner creates a session only after conversation creation is confirmed. React borrows its snapshots with `useAgent`. Every pause blocks text. Only a complete single root `refund_approval` payload admits approve, decline, or an explicit finite nonnegative edited amount. Replaced batches invalidate old decisions, including reused IDs; child observations grant no root resume authority.

Creation and execution use zero SDK retries. Stop, uncertain creation/resume, failures, and interrupted completion require an explicit New conversation. Duplicate decisions are blocked before dispatch. Page exit aborts work, releases the owned session/content projection, and prevents late UI publication.

Build with `npx nx build cockpit-langgraph-interrupts-react`, test with `npx nx test cockpit-langgraph-interrupts-react`, lint with `npx nx lint cockpit-langgraph-interrupts-react`, and verify installed SDK browser behavior with `npx nx e2e cockpit-langgraph-interrupts-react`.

The isolated build consumes private local core/content/React and neutral LangGraph candidate packages. It checks strict installed declarations and emitted modules without Angular or workspace implementations. Nx prepares shared packages once before concurrent React builds. The neutral internal iframe bridge is copied explicitly; no npm publication is implied.

The local proof server exercises incremental draft SSE, complete root batches, distinct physical run status reads, exact null-input resume commands, held decisions, cancellation, page exit, protected failures, and developer connection headers. Its routes and build-proof JSON are excluded from deployment. The shared target uses `/api`; a developer key is passed only in SDK headers.

The public page is `/docs/langgraph/guides/interrupts?frontend=react`; runtime assets live at `/langgraph/interrupts/react`. Docs, Code, and Run select the same frontend. Streaming remains available as a separate React preview; other topic variants remain pending. Both frontends use the existing shared backend deployment.
