# Prompt: runtime-agnostic Angular UI over a Mastra backend

Build an Angular chat UI over the neutral `Agent` contract:

- Provide the agent with `provideAgent({ createSession })` from
  `@threadplane/angular`, where `createSession` calls
  `createSession({ url, interruptTransport: 'mastra-command' })` from
  `@threadplane/ag-ui`, and retrieve it with `injectAgent()`.
- Render the conversation with `<chat [agent]="agent">` from
  `@threadplane/angular/chat`.
- Mirror the backend's shared `packing_list` state (`agent.state()`) into a
  side panel. Mastra bridges its working memory to AG-UI shared state:
  a `STATE_SNAPSHOT` plus real JSON-Patch `STATE_DELTA` events stream while
  the agent updates the list.
- Render the pending human-in-the-loop approval with
  `<chat-approval-card [agent]="agent">`. A suspended Mastra tool surfaces
  as a `CUSTOM on_interrupt` payload (`{ toolCallId, toolName,
  suspendPayload, runId }`) followed by the protocol-standard
  `RUN_FINISHED` interrupt outcome; read the suspend payload from
  `agent.interrupts()?.[0]?.value`.
- Map Approve/Cancel to `agent.resume([{ interruptId, status: 'resolved',
  value: { approved: true | false } }])`, with `interruptId` the `id` of
  `agent.interrupts()[0]`.
  The `mastra-command` transport sends the Mastra resume shape on the wire:
  `forwardedProps.command = { resume, interruptEvent: { toolCallId, runId } }`.
- Do not build a subagents surface: Mastra reserves `ACTIVITY_*` events for
  background tasks (a measured red cell in the runtime-portability matrix).
