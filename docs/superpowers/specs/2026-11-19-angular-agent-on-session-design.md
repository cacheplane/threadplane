# Angular `Agent` on the session contract

Date: 2026-11-19. Branch: `blove/angular-agent-on-session` (long-lived).

## Intent

The framework-neutral `AgentSession` (in `libs/core`) becomes the only agent
runtime. The two Angular-only implementations, `libs/langgraph/src/lib/**` and
`libs/ag-ui/src/lib/**`, are deleted. Angular keeps its developer experience:
an app still calls `provideAgent`, injects an agent, reads signals from it and
passes it to `<chat>`.

React already runs on the session contract. This work brings Angular onto the
same runtime, so one implementation serves both frameworks.

## Decisions (made by the product owner; do not reopen)

1. **Names.** The neutral contract keeps the name `AgentSession`. The instance
   an Angular component injects is named `Agent`.
2. **Shape.** `Agent` is exactly the session's snapshot fields as signals plus
   the session's commands. No translation layer keeps legacy member names.
   Angular chat components, examples and docs are rewritten to the new shape.
3. **Angular patterns stay.** `provideAgent(config)`, `injectAgent()`, typed
   refs, per-field signals such as `agent.messages()`, and
   `<chat [agent]="agent">`.
4. **No bridge period.** No component ever runs on an adapter from session to
   the legacy `Agent`. The legacy type is replaced outright.
5. **Full parity.** The new `Agent` must do everything the legacy one does.
   Nothing is dropped for Angular users. A capability the session runtime
   lacks is built, either in the runtime or in the Angular layer.
6. **One Angular provider.** There is no backend-specific Angular provider.
   An app writes `provideAgent({ createSession: (context) => createSession({
   apiUrl, assistantId, ...context }) })` with `provideAgent` from
   `@threadplane/angular` and `createSession` from the backend package.
7. **Landing.** One long-lived branch, merged to `main` when everything
   compiles and passes. Breaking changes are allowed; no backwards
   compatibility is required.

## Design

### The `Agent` type (`@threadplane/angular`)

A generic signal view of a session:

- every snapshot field is a signal (`messages()`, `status()`, `error()`,
  `toolCalls()`, `state()`, `interrupts()`, `subagents()`, `plan()`,
  `usage()`), including backend extras (`history()`, `subgraphs()`,
  `decision()`, `transcript()`);
- every session command passes through unchanged (`submit`, `stop`, `resume`,
  `retry`, `regenerate`, and backend commands such as `fork`).

The injected `Agent` is stable for the life of its injector. Where a session is
bound to one thing that an app changes at run time (the thread is the main
case), the `Agent` replaces the session underneath and its signals carry on.

### Where each capability lives

- **Runtime (`libs/langgraph/src/runtime`, `libs/ag-ui/src/runtime`).** Anything
  about talking to the backend or projecting what it sends. React gets it too.
- **Core (`libs/core`).** Anything both backends publish in the same shape, and
  the testing fakes.
- **Angular layer (`libs/angular`).** Signals, dependency injection, and
  behaviour that only exists because the injected instance outlives a session:
  thread switching, a retained list of custom events, a registry of live
  agents.

### Order of work

1. Close the runtime, core and Angular-layer gaps below (parallel
   workstreams). Done 2026-11-19; integrated and verified against live
   backends with fixtures.
2. Both runtimes produce the core contract's optional members, with live
   tests for the features no app exercises yet.
3. Rewrite the Angular chat components (`libs/chat/src/lib`) to the new `Agent`.
4. Convert the 37 Angular example and cockpit apps and the smoke template.
5. Update the Angular docs (about 90 pages).
6. Delete the legacy implementations, move the pieces the runtimes import out
   of the legacy folders, and move the factories to the package roots. The
   move waits for this step: the transition's packaging guards
   (`scripts/react-parity/package-policy.mjs`, `verify-boundaries.mjs`) name
   the current locations and are rewritten together with the deletion.

## Gap list

From a read-only audit on 2026-11-19. Every item is something the legacy path
does that the session path does not. Line references were true on that date;
verify before relying on them.

### A. LangGraph runtime (`libs/langgraph/src/runtime`)

Legacy reference: `libs/langgraph/src/lib/agent.fn.ts`,
`lib/internals/stream-manager.bridge.ts`, `lib/agent.types.ts`,
`lib/agent.provider.ts`.

- `transcriptNodeNames`: filter which top-level nodes' messages enter the
  transcript.
- `subagentToolNames`, and relating a child graph to the tool call that
  started it, so `subagents[].toolCallId` and `description` are set. Legacy
  attributes `tools:` namespaces through values events.
- History with state: `history` entries carry no `values`; legacy
  `AgentCheckpoint { id, label, values }`, `messageCheckpoints`,
  `langGraphHistory`. Needed by timeline, timeline slider and the debug
  inspector.
- Time travel and branching: submit from a checkpoint (`checkpointId`),
  `branch` / `setBranch`, `experimentalBranchTree`. Today only `fork` from a
  completed checkpoint exists.
- Per-submit options: `command`, `multitaskStrategy`, `interruptBefore` /
  `interruptAfter`, `streamMode`, `streamSubgraphs`, `durability`,
  `onDisconnect`, `webhook`, `afterSeconds`, `ifNotExists`, `onRunCreated`,
  `feedbackKeys`; `submit(null)`; a resume combined with a state update.
- Queueing (`multitaskStrategy: 'enqueue'`, the `queue` signal).
- `joinStream(runId, lastEventId?)` for an arbitrary run; today `reconnect()`
  joins only the session's own retained run.
- Options: `initialValues`, `toMessage`, `throttle`, `a2uiClientCapabilities`,
  `telemetry` sink, operation-failure reporter, development-install runtime,
  devtools emitter and scripted runs.
- `maxRetries` defaults to 0 (legacy: SDK default 4) and a non-zero value
  disables `regenerate`.
- Automatic history load when a thread id is given, and restoring child
  transcripts from history (`getChildState`).
- Raw data: `langGraphMessages`, `langGraphToolCalls`, `getToolCalls(message)`,
  `getMessagesMetadata`, `toolProgress`.
- `usage`.
- `lifecycle`: `threadCreatedAt` is missing.

### B. AG-UI runtime (`libs/ag-ui/src/runtime`)

Legacy reference: `libs/ag-ui/src/lib/to-agent.ts`, `lib/reducer.ts`,
`lib/provide-agent.ts`.

- `retry` and `regenerate` are absent when the session has client tools.
- `checkStatus`; legacy offered it with `persistence.reconcile`.
- Interrupt resume profiles: `interruptTransport`
  `'auto' | 'protocol' | 'legacy-command' | 'mastra-command'`. The session has
  observation only for legacy interrupts.
- `persistence` (store plus reconcile), `replay` / `httpReplay`, `ready`,
  `reconcileInterrupt`, `interruptSession`.
- A session over any AG-UI client agent (`toAgent(source: AbstractAgent)`), not
  only HTTP; `agentId`; `threadId` optional.
- Subagents from `ACTIVITY` records with `activityType === 'subagent'`, not
  only from `SUBAGENT_*` events.
- `rawEvents$`.
- `a2uiClientCapabilities`, `telemetry`, operation-failure reporter, devtools.
- `isInputBlocked`: a way for a view to know why `submit` is refused.

### C. Core contract and testing (`libs/core`)

- Message `content` as blocks as well as a string, and `extra`.
- Tool calls with partial arguments while they stream, and tool `parts`.
- `AgentError.cause` or an equivalent for diagnostics.
- Per-child `state` on child agents, and a `pending` child status if the
  backends report one.
- A `state_update` event stream, or an equivalent the generated-UI render
  store can follow.
- Client tools as a capability: register a catalog after creation, list
  pending calls, settle, flush, resolve. Today tools are a fixed handler map
  given at creation.
- The fake session lacks `regenerate`, `retry`, `checkStatus`,
  `onCustomEvent`, `usage` and `history`.
- Conformance suites for sessions (legacy: `runAgentConformance`,
  `runInterruptConformance`, `runAgentWithHistoryConformance`), the reasoning
  fixture, and scripted fakes that drive the real projection
  (`MockAgentTransport`, `FakeStreamTransport`, AG-UI `FakeAgent`).

### D. Angular layer (`libs/angular`)

- The `Agent` signal view, `provideAgent`, `injectAgent`, `createAgentRef` /
  `AgentRef`, the multi-agent aliasing the legacy providers do.
- Thread switching: `switchThread(id)`, a `threadId` that is a signal,
  `isThreadLoading`, `onThreadId`, automatic history load.
- A retained `customEvents` signal over `onCustomEvent`.
- `AgentLifecycleRegistry` / `AGENT_LIFECYCLE` (used by
  `libs/cockpit-telemetry`).
- `provideFakeAgent` for both backends ("try without a backend").
- `LANGGRAPH_CLIENT_OPTIONS` and the operation-reporter tokens as Angular
  providers that feed session options.

### E. Structure

- Both runtimes import from the legacy folders: `FetchStreamTransport`,
  `lib/transport/checkpoint-position`, `lib/client/create-langgraph-client`
  (LangGraph); `lib/internal/copy-data`, `lib/internal/apply-patch` (AG-UI).
  These move before anything is deleted.
- `LangGraphThreadsAdapter`, `LANGGRAPH_THREADS_CONFIG`, `LANGGRAPH_CLIENT`
  live in the legacy folder but do not depend on the legacy agent. They stay.
- `refreshOnRunEnd` is typed to the legacy agent; `refreshOnTransition`,
  `extractCitations`, `bridgeCitationsState` lose their export unless moved.

## Consumers to convert

- `libs/chat/src/lib`: `compositions/chat/chat.component.ts` is the largest
  (reads `messages`, `isLoading`, `isInputBlocked`, `isThreadLoading`,
  `clientTools.pending`, `plan`, `toolCalls`, `error`, `interrupt`,
  `subagents`, `events$`, `state`, `lifecycle.streamStartedAt`,
  `customEvents`, `message.extra`; calls `stop`, `submit`,
  `regenerate(index)`). Also the approval card, interrupt panel, sidenav,
  thread sidebar, timeline slider, subagent card, and the primitives
  `chat-error`, `chat-input`, `chat-interrupt`, `chat-message-list`,
  `chat-subagents`, `chat-timeline`, `chat-tool-calls`,
  `chat-typing-indicator`; `client-tools/client-tool-executor.ts` and
  `client-tools-coordinator.ts`; `libs/chat/debug`.
- 37 Angular apps plus `examples/chat/smoke/template`. `switchThread` is called
  in 24 or more source files.
- About 90 of 114 pages under `apps/website/content/docs/angular`.

## Rules for every workstream

- Add capabilities; do not remove or weaken existing ones, tests or guards.
- React must keep working: `nx run-many -t test,type-tests,lint -p react`.
- New session features need runtime specs and type tests, and a README entry
  in the runtime's `README.md`.
- New source files need an entry in `scripts/react-parity/dispositions.json`
  (edit as text; never re-serialize), and may need adding to the reviewed
  source lists in `scripts/react-parity/ag-ui-candidate-package.mjs` and the
  count in `scripts/react-parity/verify-langgraph-candidate.mjs`.
- Never touch `scripts/react-parity/baseline.json` or
  `apps/website/content/api/**`.
- No competitor names in tracked files.
