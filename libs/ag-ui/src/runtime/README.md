# Private native AG-UI session commands

The test-only [candidate package proof](../../../../fixtures/react-parity/ag-ui-candidate/README.md)
emits this actual owner, its text selector, its core message and tool-call
selectors and its core session view with complete declarations, then runs
the existing browser and local-provider oracles against installed tarballs. It
does not change this private API's status or the current published Angular root.

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
preserves every literal current state. A literal `null` current state stays
local; the AG-UI 1.0 client omits a whole-optional `null` state from the
request. This is a portable-data ownership and merge precondition, not
model-argument validation. Interfaces without an index
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

## Core messages and reasoning time

`projectMessages(snapshot, previous?)` and `projectToolCalls(snapshot,
previous?)` are private, display-only selectors from the native snapshot to core
`Message` and `ToolCall` values, so views written for core snapshots can render
an AG-UI conversation:

```ts
const snapshot = session.getSnapshot();
const messages = projectMessages(snapshot, previousMessages);
const toolCalls = projectToolCalls(snapshot, previousToolCalls);
const rows = content.project({ status: snapshot.status, messages, toolCalls });
```

- Root user and assistant text become messages. An assistant record lists its
  shown calls as `toolCallIds` and is a message even without text. A root tool
  record becomes a `tool` message with its text and `toolCallId`. System,
  developer and activity records and child-attributed records are not projected
  in this slice, and an assistant record with no text, reasoning or shown call
  is left out.
- The protocol sends reasoning as its own records. Each is attached to the next
  assistant record as that message's `reasoning`; several before one assistant
  are joined by blank lines. Reasoning with no assistant record after it yet is
  shown as an assistant message under the reasoning record's ID, so that row's
  ID changes when the answer record arrives.
- While the session runs, the message built from the last root record is
  streaming. Every other message is complete, with the run's outcome for the
  last assistant message of the latest turn and success otherwise. Each message
  uses its own ID as its delivery generation.
- AG-UI has no citation event, so a backend sends sources as application
  state. An assistant message carries the sources listed for it under
  `state.citations[messageId]` as core citations. An entry may be a URL string
  or a record; `id` or `refId`, `title` or `name`, `url`, `href` or `source`,
  and `snippet`, `content` or `excerpt` are read, and a missing `id` or `index`
  is filled from the entry's position. The key must be the message's current
  identifier: a backend that saves a message under a new one lists its sources
  under the saved identifier, so they appear once the messages snapshot
  arrives.
- Unchanged messages, and an unchanged list, keep their references when the
  previous result is passed.

The session measures how long each root reasoning message took to arrive, from
`REASONING_MESSAGE_START` to `REASONING_MESSAGE_END` on the local clock, and
publishes it as `snapshot.reasoningDurations` by message ID. The selector adds
up the times of the records it attaches into `Message.reasoningDurationMs`. The
field is absent, never zero, when nothing was measured: restored history, and
reasoning whose end event never arrived. A messages snapshot keeps measured
times (see "Messages snapshots" at the end). A network stall
counts as reasoning time. Child reasoning is not timed. The native transcript
and the request history are unchanged; reasoning records are still sent back as
the protocol requires.

Tool calls follow these rules:

- The transcript keeps argument fragments as they arrive and does not record the
  end event, so a call is shown only once its arguments are final: the session
  is not running, the call has a result, something follows the call in the root
  transcript, or the text already parses as a JSON object or array. Until then
  neither selector mentions the call. A call with no arguments, or scalar
  arguments, that is the last thing in the transcript therefore appears when its
  result or the next record arrives.
- Empty argument text is a call without input: `args` is undefined.
- A call with a root tool record is `complete`. Its `result` is the record's
  text parsed as JSON when it is JSON, and the text otherwise. A record with an
  `error` makes the call an `error` with that text.
- A call without a record is `running` while the session runs and `pending` once
  it stops, which is where a call waiting for a decision or a client tool sits.
  A backend that never sends results leaves its calls `pending`.
- Final arguments that are not JSON make the call an `error`.
- Calls owned by a child-attributed record, media parts of a tool result and the
  session's own client-tool statuses are not projected.

The test-only candidate package entry exports both selectors next to
`createSession`. They are still private source: the published package root does
not export them.

## Core session view

`createAgentSession(session)` wraps a native session, with or without a
client-tool catalog, as a core `AgentSession`, so a component written for core
sessions can observe and drive an AG-UI conversation:

```tsx
const native = createSession({ threadId, url });
const session = createAgentSession(native);
<Chat session={session} />;
```

- It is a view, not a second owner. `getSnapshot` derives
  `{ status, messages, toolCalls, error?, plan? }` from the native snapshot with
  the two selectors above and keeps its reference until one of those fields
  changes. Subscribers hear about those changes only, so a native publication
  that touches only state, child evidence or a decision is silent here.
- `submit` takes text and goes straight to the native session, as do `stop` and
  `dispose`. Disposing the view disposes the session.
- A failed run becomes `snapshot.error`. A backend `RUN_ERROR` is a `server`
  error carrying the backend's message. A stream that ended without a terminal
  is `interrupted`. A response that was not OK carries its HTTP status: 401 and
  403 are an `auth` error, any other status a generic `server` error. The
  response body is never shown. A request that got no response, such as an
  unreachable host, is a generic `server` error without a status.
- The native snapshot records that status as `run.failure.status` when a
  response that was not OK is why the run failed, and clears it with the next
  run.
- Every error has `retryable: false` and `recovery: 'none'`. Nothing in the
  snapshot proves a request never reached the backend, and the owner has no
  status check, so the view has no `checkStatus`.
- A state patch, native resume and client-tool evidence have no core
  equivalent. Keep the native session for those; both can be used together.
  While a native decision is waiting, `submit` resolves `error` without sending,
  and nothing in the core snapshot says why. Show the decision instead, as
  below.

### Approvals

`decisionState(snapshot)` reads the native snapshot's pending decision and how
far it has got, so an app can show it in `Chat`'s `approval` slot and answer it
on the native session:

```tsx
const pending = decisionState(useAgent(native));
<Chat
  session={session}
  approval={
    pending?.kind === 'native' ? (
      <ApprovalCard
        disabled={pending.phase !== 'ready'}
        actions={[
          {
            id: 'approve',
            label: 'Issue refund',
            onSelect: () =>
              void native.resume(pending.id, [
                { interruptId: pending.interrupts[0].id, status: 'resolved' },
              ]),
          },
        ]}
      >
        {pending.interrupts[0].reason}
      </ApprovalCard>
    ) : null
  }
/>;
```

- It is absent when nothing is waiting, and `{ kind: 'unsupported' }` for a
  pause this owner cannot answer.
- A native pause has a `phase`: `observing` until the pausing run has settled
  locally, `ready` when it can be answered, `answering` while the answer's run
  is going, and `uncertain` when that run ended without proof the backend took
  the answer. An uncertain answer cannot be sent again.
- The same decision in the same phase returns the same reference.
- `ready` does not look at the clock: an interrupt past its `expiresAt` still
  reads `ready`, and `resume` then resolves `error`.
- What the buttons mean, and which payload answers which interrupt, stay with
  the app. Response schemas are not interpreted.

The candidate package entry exports it. The published package root does not.

## Custom events

`session.onCustomEvent(listener)` delivers each `CUSTOM` event except the
`on_interrupt` notice as `{ name, data }`, root and child-attributed alike, the
way the Angular adapter surfaces them on `events$`. A string value that parses as
JSON becomes that data; other text stays a string. `data` is owned frozen plain
data, and a value that is not plain data is dropped. Events are not state: no
snapshot holds them, and a listener added later does not receive earlier events.
A throwing listener does not affect the run or other listeners. Disposal releases
every listener, and later registrations are inert. With a client-tool catalog,
commands a listener issues wait until the current event finishes, so a listener
that disposes the session does not stop the rest of that one delivery.

The method is optional on the `Session` type so hand-written sessions need not
supply it; the factory always does. `createAgentSession` forwards it when the
native session has one.

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
`RUN_FINISHED.outcome` maps `success` (or no outcome) to `success`, a native
`interrupt` batch to `paused` and `cancelled` to `aborted`, matching the public
adapter. An unrecognised outcome type is stripped by the 1.0 client and
therefore reads as success.

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
    { interruptId: 'approval', status: 'resolved', payload: { approved: true } },
  ]);
}
```

Every observed interrupt needs exactly one response with its exact ID. Resolved
responses may omit payload; a `null` payload is treated as absent (the AG-UI 1.0
client omits whole-optional nulls on the wire). Cancelled responses use
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

## Pinned local Mastra interoperability proof

Run the actual private owner against the existing service and its exact lock:

```sh
npm ci --prefix deployments/ag-ui-mastra --no-audit --no-fund
npm test --prefix deployments/ag-ui-mastra
node node_modules/typescript/bin/tsc -p scripts/react-parity/tsconfig.native-mastra.json
node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.base.json scripts/react-parity/verify-native-mastra.ts
```

This separate process uses the actual `@ag-ui/mastra` 1.1.2 bridge and LibSQL with a scripted local
model, dummy credentials and owned ephemeral loopback servers. It checks eight
complete native request envelopes across four independent owners. Approval and
decline are established by actual reservation tool results, not the model's fixed
prose. Native cancellation completes without a tool result. A response-loss case
records actual provider success, removes only its matching root terminal, and
requires the owner to retain uncertainty and reject replay without another POST.
Both HTTP sides must physically close before cleanup. JSON output includes the
installed provider/client versions, service lock hash and scenario evidence.

The bridge consumes the first resolved/cancelled entry only. Resolved null or
undefined falls outside its resume branch; arbitrary payload and multi-interrupt
support are unproved. Literal false and native cancellation differ from the
`{ approved: false }` application payload. Cancellation completion does not prove
durable snapshot deletion. This local proof establishes neither hosted-model or
remote-agent compatibility nor persistence, recovery or public backend exports.

## Messages snapshots

A `MESSAGES_SNAPSHOT` replaces the transcript in the snapshot's own order.
`@ag-ui/client` instead keeps surviving IDs where they were and appends new
ones. A backend that streams a step under one ID and saves it under another
(the LangGraph adapter renames assistant, tool and some reasoning records in
its final snapshot) then leaves a tool result before its call and reasoning
before the wrong step, both on screen and in the next request's history. The
session does not copy that.

- A record with a surviving ID takes the snapshot's record and position.
- An ordinary record the snapshot omits is dropped.
- Local reasoning records are kept only when the snapshot carries no reasoning,
  and local activity records only when it carries no activity. A kept record
  stays directly after the closest earlier record that is still present, or at
  the front when there is none.

Measured reasoning time follows the reasoning through the snapshot. The
transcript's root reasoning records form runs, one per stretch of consecutive
reasoning. When the snapshot leaves as many runs as there were, each run keeps
its measured total, moved onto the run's first record when its IDs changed.
When the count differs, only records whose IDs survive keep their time, so the
total can be lower than what was measured.
