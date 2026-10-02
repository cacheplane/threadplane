# React Subgraphs preview

Native `MessageList`, `ChatInput` and `useAgent` dogfood the private LangGraph candidate using the existing Subgraphs Python assistant and shared deployment. The parent conditionally enters a compiled child graph. The child receives only a research topic and returns a brief; its schema has no parent conversation channel.

The application confirms the current route only from the final graph's exact human/answer identity pair and successful delivery, with matching current child boundary observations for a research turn. Parent conversation history is retained. Internal router output and child tokens do not become parent chat rows. The panel displays literal topic, brief and full namespace segments as read-only observations, without inferred child execution status or commands.

Creation is lazy, uses a confirmed UUID and disables SDK retries. Stop, uncertainty, errors, pauses and unexpected tool evidence require New conversation. Reset and page exit detach the old owner before cleanup. No replay, child controls, branching, browser storage or public candidate API is added.

Build, unit and SDK browser proof use project-scoped Nx targets. The isolated production build consumes installed candidate packages and excludes Angular/workspace implementations. Local fixture controls and build proofs are excluded from public assembly. The canonical guide remains Angular by default and offers this bounded React preview explicitly.
