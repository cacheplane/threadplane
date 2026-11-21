# LangGraph Persistence (Angular)

This capability demonstrates persisted conversation threads using LangGraph checkpointers and the `@threadplane/angular/chat` Angular component library. The `<chat>` component is paired with a thread list so users can switch between saved conversations — each backed by a LangGraph thread ID — without losing history.

Key components used: `<chat>` with a thread list sidebar driven by the LangGraph Threads API. `agent.switchThread(id)` moves the agent to the thread the user selects: the agent asks `createSession` for a session on that thread and loads its saved history, so the chat view shows the persisted conversation automatically.
