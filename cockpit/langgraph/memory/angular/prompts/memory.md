# LangGraph Memory (Angular)

This capability demonstrates thread-scoped context using a `memory` dictionary in LangGraph state and the `@threadplane/chat` Angular component library. The graph replies using previously learned facts, then extracts new facts from the conversation. Facts remain available on later turns in the same thread; a new thread starts empty.

Key components used: `<chat>` and a learned-facts sidebar derived from graph state. This example does not use the LangGraph Store API, a user namespace, or memory shared across threads.
