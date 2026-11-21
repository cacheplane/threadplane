# Prompt: runtime-agnostic Angular UI over an AWS Strands backend

Build an Angular chat UI over the neutral `Agent` contract:

- Provide the agent with `provideAgent({ createSession })` from
  `@threadplane/angular`, where `createSession` calls `createSession({ url })`
  from `@threadplane/ag-ui`, and retrieve it with `injectAgent()` — no
  backend-specific code.
- Render the conversation with `<chat [agent]="agent">` from
  `@threadplane/angular/chat`.
- Render the pending human-in-the-loop approval with
  `<chat-approval-card [agent]="agent">`. The interrupt arrives as the
  protocol-standard `RUN_FINISHED` outcome, listed by `agent.interrupts()`;
  each Strands entry carries the
  tool name under `reason` and the tool's interrupt payload under
  `metadata.reason`.
- Map Approve/Cancel to `agent.resume([{ interruptId, status: 'resolved',
  value: { approved: true | false } }])`, with `interruptId` the `id` of
  `agent.interrupts()[0]`.
- Mirror the backend's shared state (`agent.state()`) into a side panel.
  The Strands bridge is SNAPSHOT-only (no STATE_DELTA): the panel re-renders
  from complete `{ availability, booking }` snapshots the backend's per-tool
  ToolBehavior hooks emit.
