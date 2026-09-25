# Private native AG-UI session commands

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
no second store or forwarding bag is introduced.

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

## Correlated native resume

An observed root custom notice installs an unsupported decision blocker. A later
native interrupt batch replaces it with one immutable `decision` containing a
fresh branded `PauseId`, the source run ID and the already owned interrupt array.
Child notices do not create root decisions. Duplicate interrupt IDs retain an
unsupported blocker. The locked SDK rejects empty wire batches before delivery;
that error preserves an existing blocker or claim and invents no terminal.

After the native pause has locally settled, explicitly answer its current token:

```ts
const snapshot = session.getSnapshot();
if (
  snapshot.decision?.kind === 'native' &&
  !snapshot.decision.attempt &&
  snapshot.run?.outcome
) {
  await session.resume(snapshot.decision.id, [
    { interruptId: 'approval', status: 'resolved', payload: null },
  ]);
}
```

Every observed interrupt needs exactly one response with its exact ID. Resolved
responses may omit payload; `null` is meaningful. Cancelled responses use
`{ interruptId, status: 'cancelled' }` and cannot contain a defined payload.
Optional metadata must be a plain record. Responses and the options signal are
captured once before queueing; nested data is copied and frozen without freezing
the caller. Extra runtime getters are ignored. Response schemas are opaque; this
owner neither validates business answers nor guesses defaults or aliases.

Eligibility is checked at invocation and admission. The token must identify the
current unclaimed native generation, the current run must be locally settled,
and every supplied expiry must parse to a time strictly in the future. An
observing terminal callback cannot enqueue future resume intent before settlement.
Two observers can claim only once. Admission publishes the attempt and new run
together, preserving state and transcript references and adding no user message.
The wire request contains fresh mutable copies of full native history and state,
native top-level `resume`, and empty tools, context and forwarded properties.
Resume accepts no new message, state patch, identity or transport override.

Availability is derived from existing run settlement and the optional attempt:
an unsettled observation is not yet actionable; a settled unclaimed native
decision is claimable; an unsettled attempt is running; a settled attempt without
conclusive native evidence is uncertain. Any decision blocks ordinary submission
before reading its input or cancelling active work. Stop and dispose remain local
controls, not backend rejection or recovery.

Each private run result reports `fetchInvoked`, recorded immediately before the
captured fetch call. A claim cancelled before that boundary is released and can
be retried with the same token. Once fetch was invoked, failure, EOF or abort
without conclusive native evidence retains the attempt and forbids replay or
ordinary bypass. `RUN_STARTED`, local promise completion and exception properties
do not establish server acknowledgement or socket closure. No retry, reset,
session reconstruction or persistence/recovery guarantee is provided.

Native success clears the decision at local settlement, even if a terminal
listener selected local `aborted`. A new native pause receives a fresh token even
when backend interrupt IDs repeat; old finalizers cannot clear that generation.
Legacy observation has no resume support. Captured Strands replay establishes
native response wire shape with synthetic completion only. Captured Mastra and
translated Microsoft evidence do not establish provider resume interoperability.
