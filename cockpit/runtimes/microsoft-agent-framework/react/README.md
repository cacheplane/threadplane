# Microsoft Agent Framework expenses · React preview

This experimental source-build preview uses the native AG-UI Session with the React presentation package. It handles fictional expenses only.

The team dinner preset fills an editable message. Send explicitly requests a meals-policy lookup and expense approval. The read-only predictive draft is separate from the canonical approval fields. Approve and Decline apply only to the current native approval. The observed backend result displays the exact tool text separately from assistant prose. An unconfirmed or stopped operation requires New conversation.

Shared runtime uses the current origin's `/runtimes/microsoft-agent-framework/agent` endpoint. The runtime bridge also supports a configured AG-UI Developer runtime. LangSmith configuration is incompatible. Opening the preview, editing a message, and choosing a preset allocate no Session or thread.

Build with `npx nx build cockpit-runtimes-microsoft-agent-framework-react`. The target builds core, content, and React, then builds an isolated consumer from packed packages and the emitted native AG-UI candidate. Its output includes `build-proof.json`. There is no per-example package manifest.

Run project tests with `npx nx test cockpit-runtimes-microsoft-agent-framework-react` and lint with `npx nx lint cockpit-runtimes-microsoft-agent-framework-react`. Run real-service browser coverage with `npx nx e2e cockpit-runtimes-microsoft-agent-framework-react`; the target prepares frozen Python 3.12 dependencies serially in an isolated temporary environment before building and running the unchanged generated service against a deterministic offline OpenAI model seam. Preparation and active fixture lifetimes share an exclusive owner lock. Fixture cleanup closes its owned HTTP/model processes; it never mutates the canonical environment or backend. This proves local interoperability, not a live model-provider request.

Website Docs, Code, and Run select the same authored implementation. After fresh selected build and fixture preparation, focused local website coverage uses `WEBSITE_E2E_REACT_TOPIC=runtimes-microsoft-agent-framework WEBSITE_E2E_PORT=4390 npx playwright test --config apps/website/playwright.config.ts`. The ordinary `npx nx e2e website` target prepares fixtures and builds every registered React frontend first. The native packages are private source-build artifacts; no public npm availability is claimed.
