# LangGraph Durable Execution (Angular)

This capability demonstrates LangGraph's durable execution guarantees — a checkpoint saved after every node, so a request survives a network interruption — using the `@threadplane/chat` Angular component library. The `<chat-error>` component surfaces a failure together with the recovery the agent can prove is safe, and the sidebar follows the graph's `step` through `agent.state()`.

Key components used: `<chat>`, `<chat-error>`. When the SSE stream is interrupted, `<chat-error>` replaces the typing indicator with an error banner. The agent does not send the request again on its own: it offers a status check (`agent.checkStatus()`), which reads the thread's saved checkpoint and settles the turn from what the server already did, and a retry (`agent.retry()`) only for a run the server reports as failed.
