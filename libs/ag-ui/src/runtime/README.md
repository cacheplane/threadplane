# Private native AG-UI application input

The private `createSession` owner accepts a literal string or
`{ message, state? }`. `message` is required and is not trimmed. `state` is an
optional shallow patch whose values use core `PlainValue`:

```ts
session.submit({
  message: 'Plan a visit',
  state: { model: 'small', reasoning_effort: 'low', gen_ui_mode: 'inline' },
});
```

The owner copies selected input fields and nested patch data at invocation,
before a subscriber command can be deferred. Caller data stays mutable. At
admission it merges the frozen patch into the latest owned state and publishes
the state, new user message and new run together. Unchanged owned branches keep
their identity; top-level patch values replace entire branches. Empty or equal
primitive patches reuse the state reference. Adding an own key with `undefined`
still changes the local document, although JSON can omit that key on the wire.

Both supplied patches and the current document must be plain records (ordinary
or null-prototype objects). A patch against a scalar, null or array returns
`error` before cancelling active work or publishing. Omitted or undefined state
preserves every literal current state. This is a portable-data ownership and
merge precondition, not model-argument validation. Interfaces without an index
signature may need an explicit plain-record projection to satisfy `PlainValue`.

Only message, state and the existing options signal are selected. Extra runtime
fields are ignored without reading their getters. State keys such as `messages`,
`constructor` and `__proto__` remain payload; they cannot override protocol
identity, history, tools, context or forwarded properties. Abort, disposal or a
newer command invoked from a getter prevents the older capture from committing,
including when that getter throws. Ordinary queued commands still run in order.

Each request receives independent mutable copies of the complete native history
and state. The admitted state is the baseline for incoming deltas. A server
snapshot replaces it entirely and can remove submitted fields or change the
document kind. After admission, stop, replacement, error and EOF retain the latest
local state and history. There is no rollback or assertion of remote persistence.

This module is private source, not a public backend export or a core
`AgentSession` implementation. Core submission stays string-only. Framework
observers and transcript components continue to consume the same native owner;
no second store, resume command or forwarding bag is introduced.

## Interruption evidence

Both `createSession` and standalone `createRun` default to
`interruptMode: 'native'`. They capture this constructor option once. A root
`CUSTOM on_interrupt` event is retained as `run.legacyInterrupt`, with its literal
value and selected metadata. It does not set `run.terminal` or close the stream.
A later native `RUN_FINISHED` or `RUN_ERROR` supplies terminal evidence. Child
custom notices and unrelated custom events do not become root notices.

An explicit `interruptMode: 'legacy-observation'` preserves the legacy convention:
the root custom notice occupies both evidence fields, selects `paused` and closes
the response. This option provides observation only, not legacy resume support.
Neither mode parses JSON strings, executes response schemas or guesses providers.

Server evidence and local outcomes are distinct. A terminal callback can stop the
owner, selecting local `aborted` while retaining the accepted native terminal.
A native notice followed only by EOF selects `interrupted`; stopping at the
notice selects `aborted`, with no invented native terminal. New runs reset these
run-local fields while retaining history and shared state.

Notices are not actionable decisions in this slice. There is no resume command,
decision ledger, retry guarantee or persistence/recovery contract. Caller control
remains unchanged, but ordinary resubmission is not evidence that a possible
server pause was safely resolved. Captured Mastra replay verifies event retention
and ordering only; it does not establish native Mastra resume compatibility.
