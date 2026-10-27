# React client-tools cockpit

This experimental frontend shares the existing Python `client-tools` assistant with Angular. Five explicitly authored browser tools provide simulated weather, a cancellable slow status check, finalized weather panels, a snapshot without model follow-up, and fictional booking confirmation. No real weather or booking service is contacted.

Native React `MessageList`, `ChatInput`, and `ApprovalCard` observe one confirmed application-owned session with `useAgent`. Literal weather panels and completed booking outcomes remain visible. Parallel booking requests have separate application-owned decision tokens; these are presentation identities, not runtime call IDs. Pending decisions remain available while the composer is busy. Stop and disposal immediately revoke their authority.

The neutral session executes the authored catalog. Normal tools produce same-thread model follow-up; a standalone `weather_snapshot` writes its acknowledgement into the same thread without another model run. Mixed batches follow the neutral runtime's batch policy. This preview does not implement a general view-tool or ask-tool registry.

Thread creation and execution use zero SDK retries. Stop, failures, uncertain creation, unexpected root pauses, unknown tools, and unresolved tool observations require New conversation. Page exit disposes the owner. A new conversation clears panels and transcript.

Use `npx nx build cockpit-langgraph-client-tools-react`, `npx nx test cockpit-langgraph-client-tools-react`, `npx nx lint cockpit-langgraph-client-tools-react`, and `npx nx e2e cockpit-langgraph-client-tools-react`.

The isolated build consumes private local candidate packages and checks strict installed declarations and emitted modules. No npm publication is implied. The public guide is `/docs/chat/guides/client-tools?frontend=react`; assets use `/langgraph/client-tools/react/`. The shared backend deployment is reused. Developer keys travel only in SDK headers; local proof routes and build-proof JSON are excluded from deployment.
