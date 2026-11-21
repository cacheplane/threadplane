# LangGraph Streaming (Angular)

This capability demonstrates real-time token streaming from a LangGraph agent using the `@threadplane/angular/chat` Angular component library. The example shows how to wire an `agent` ref into the `<chat>` host component and compose `<chat-message-list>`, `<chat-input>`, and `<chat-typing-indicator>` to deliver a responsive, streaming chat experience.

Key components used: `<chat>`, `<chat-message-list>`, `<chat-input>`, `<chat-typing-indicator>`. The `agent` signal handles SSE fan-out from the LangGraph streaming endpoint, and the chat components subscribe reactively without any manual subscription management.
