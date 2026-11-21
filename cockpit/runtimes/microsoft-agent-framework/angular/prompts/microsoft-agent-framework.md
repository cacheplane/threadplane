# Prompt: runtime-agnostic Angular UI over an agent-framework backend

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
  its entries carry the pending
  tool call under `metadata.agent_framework.function_call`.
- Map Approve/Cancel to `agent.resume([{ interruptId, status: 'resolved',
  value: { approved: true | false } }])`, with `interruptId` the `id` of
  `agent.interrupts()[0]`.
- Mirror the backend's shared `expense` state (`agent.state()`) into a side
  panel; it streams predictively while the tool-call arguments are still
  being generated.
