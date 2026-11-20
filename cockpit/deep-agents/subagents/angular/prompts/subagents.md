# Deep Agents Subagents (Angular)

This capability renders real child agents. `SubAgentMiddleware` gives the orchestrator a `task` tool taking `{ description, subagent_type }`, and each dispatch runs as its own graph in a `tools:<call_id>` namespace. Attribution is therefore structural rather than inferred: the session relates each child namespace to the `task` call that started it, so four children streaming at once land in four separate `<chat-subagent-card>` elements instead of interleaving into one.

`task` is the session's default dispatch-tool name (`subagentToolNames`), so a `deepagents` graph needs no client configuration for the cards to appear; `createSession()` names it explicitly as documentation. The sidebar reads `agent.subagents()` for a live dispatch and running count.
