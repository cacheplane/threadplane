# AG-UI Streaming (Angular)

This capability demonstrates real-time token streaming from an AG-UI compatible agent using the `@threadplane/chat` Angular component library. The example shows how to wire the agent (provided by `provideAgent` from `@threadplane/angular` over `createSession` from `@threadplane/ag-ui`, retrieved with `injectAgent()`) into the `<chat>` host component and compose `<chat-message-list>`, `<chat-input>`, and `<chat-typing-indicator>` to deliver a responsive, streaming chat experience.

Key components used: `<chat>`, `<chat-message-list>`, `<chat-input>`, `<chat-typing-indicator>`. The AG-UI session handles SSE event processing from the AG-UI streaming endpoint, and the chat components subscribe reactively without any manual subscription management.

The demo illustrates the chat-runtime decoupling: the same `<chat>` composition works with any agent runtime - LangGraph, AG-UI, or others - because every runtime's session publishes the same `Agent` from `@threadplane/angular`.
