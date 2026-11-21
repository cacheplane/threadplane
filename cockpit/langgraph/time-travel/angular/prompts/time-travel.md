# LangGraph Time Travel (Angular)

This capability demonstrates LangGraph's time-travel feature — replaying or branching from any past checkpoint — using the `@threadplane/chat` Angular component library. A checkpoint timeline lists the saved checkpoints of a thread and forks execution from any of them.

Key components used: `<chat>` and a timeline sidebar. The session is created with `historyState: true`, so the timeline reads `agent.checkpoints()`; forking calls `agent.submit(input, { run: { checkpointId } })` to resume from that point in history.
