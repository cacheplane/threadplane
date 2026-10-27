# React durable execution preview

Native `MessageList`, `ChatInput`, and `useAgent` dogfood the existing three-node Python graph. The public guide is `/docs/langgraph/guides/durable-execution?frontend=react`.

The checkpoint panel reports the most recently completed node. Each final checkpoint binds the original question ID and final answer ID; the owner verifies that unique pair and current successful delivery before displaying only the latest question and final answer. Intermediate drafts retained by the SDK do not become final-answer authority.

Creation is lazy, uses a cryptographic UUID with an exact server echo, and has zero SDK retries. Sequential requests reuse one confirmed thread. New conversation clears the view without I/O until submission. This graph replaces its messages rather than providing cross-turn memory.

Check status appears only when the adapter explicitly permits read-only reconciliation of the retained request. It reads history on the same session and never creates a thread, replays a request, or resumes the graph. Promise fulfillment without a conclusive safe current completion stays blocked. Stop, disposal, and pagehide revoke ownership and fence late results.

The server supplies checkpointing. Healthy public interaction observes checkpoints; it does not simulate a process crash or prove restart recovery. Local installed-SDK HTTP/SSE tests cover uncertain streams, pending and unrelated history, cancellation, protected failures, final identity bindings, developer headers, and narrow screens. Fixture controls are excluded from public assets.

```sh
npx nx test cockpit-langgraph-durable-execution-react
npx nx lint cockpit-langgraph-durable-execution-react
npx nx build cockpit-langgraph-durable-execution-react
npx nx e2e cockpit-langgraph-durable-execution-react
npx nx smoke cockpit-langgraph-durable-execution-python
```

The isolated build installs private candidate packages and verifies strict declarations and emitted browser modules. Default requests use the shared backend. Developer runtime settings carry credentials in SDK headers.
