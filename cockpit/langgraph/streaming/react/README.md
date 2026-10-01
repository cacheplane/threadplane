# React streaming cockpit

This experimental frontend uses the same `streaming` assistant as the Angular cockpit. It observes an application-owned LangGraph session with `useAgent`, prepares rows with the content owner, and renders the existing React `MessageList` and `ChatInput` components.

The build consumes isolated local tarballs for core, content, React, and the neutral LangGraph candidate. These candidates are private development artifacts; this example does not imply a published React package or parity across the cockpit catalog. The neutral internal iframe bridge is copied into that build without Angular.

Run `npx nx build cockpit-langgraph-streaming-react`, `npx nx test cockpit-langgraph-streaming-react`, and `npx nx lint cockpit-langgraph-streaming-react`. Run `npx nx e2e cockpit-langgraph-streaming-react` for the installed browser proof. The proof server is local test tooling and is never deployed.

One conversation is created lazily. Creation and execution use zero SDK retries. Stop, uncertain creation, or an incomplete run requires an explicit new conversation; the example cannot replay uncertain work. Page exit releases the session and content owner. The shared target uses `/api`; an accepted developer configuration keeps its key exclusively in SDK request headers. Request failures display a protected message. Parent readiness proves bootstrap, while request errors remain visible in the application.

Browser coverage uses actual SDK HTTP requests and incremental SSE bytes. It checks confirmed completion, Stop, explicit new conversations, uncertain creation without retry, literal-safe content, protected errors, and the existing origin/nonce/generation bridge across real local origins.

The public Website exposes this bounded pilot at `/docs/langgraph/guides/streaming?frontend=react`. The Example UI selector swaps documentation, source and runtime together. The separately staged runtime is `/langgraph/streaming/react`; Angular retains `/langgraph/streaming`. Other topics selected with `frontend=react` display an availability notice. Deployment enumeration comes from `getCockpitFrontends()`, without adding another backend deployment.
