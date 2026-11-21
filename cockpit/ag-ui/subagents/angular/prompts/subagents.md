# AG-UI Subagents (Angular)

This capability demonstrates subagent cards over the AG-UI transport using the `@threadplane/angular/chat` Angular component library. An orchestrator agent delegates focused subtasks to specialized subagents by calling a `task` tool; the backend emits the protocol's `SUBAGENT_STARTED` / `SUBAGENT_FINISHED` events with each subagent's streamed tokens attributed to its run, and the `@threadplane/ag-ui` session projects them onto `agent.subagents()` so `<chat>` renders a card per subagent.

The example wires the agent (provided by `provideAgent` from `@threadplane/angular` over `createSession` from `@threadplane/ag-ui`, retrieved with `injectAgent()`) into the `<chat>` host component. No subagent-specific wiring is needed in the component — `<chat>` renders a `chat-subagent-card` for each entry of `agent.subagents()`.

The demo illustrates the chat-runtime decoupling: the same `<chat>` composition works with any agent runtime - LangGraph, AG-UI, or others - because every runtime's session publishes the same `Agent` from `@threadplane/angular`.
