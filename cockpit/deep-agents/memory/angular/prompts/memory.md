# Deep Agents Memory (Angular)

This capability shows the file the agent keeps about you. `MemoryMiddleware` loads `/memories/AGENTS.md` into the system prompt at the start of every turn and the agent rewrites it with `edit_file` when it learns something durable — nothing in the Angular app parses the conversation for facts. `StoreBackend` puts that file in LangGraph's store rather than on the thread, so a brand new thread starts already knowing.

Reading it back needs a detour, and that is the interesting part. `memory_contents` is annotated `PrivateStateAttr`, so it never reaches the `values` stream. The graph republishes it as a `custom` stream event, which arrives on `agent.customEvents()`; the key IS on the checkpoint, so `agent.state()` covers a reopened thread once the client has hydrated it.
