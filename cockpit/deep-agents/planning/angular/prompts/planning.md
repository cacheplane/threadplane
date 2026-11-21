# Deep Agents Planning (Angular)

This capability renders the todo list that `deepagents` keeps on the graph state. `TodoListMiddleware` gives the model a `write_todos` tool; every call replaces the whole `todos` array, and the Angular sidebar is a `computed()` projection of it, so rows move from pending to in progress to completed while the agent works.

Key integration points: `injectAgent().state()` for the graph state, and the `<chat>` composition from `@threadplane/chat` for the conversation. A todo is `{ content, status }` — there is no identifier, so the panel tracks rows by index.
