# Private native AG-UI session commands

The test-only [candidate package proof](../../../../fixtures/react-parity/ag-ui-candidate/README.md)
emits this actual owner, its text selector, its core message and tool-call
selectors and its core session with complete declarations, then runs
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

## Core session

The session `createSession` returns, with or without a client-tool catalog, is a
core `AgentSession`, so a component written for core sessions observes and
drives an AG-UI conversation directly:

```tsx
const session = createSession({ threadId, url });
<Chat session={session} />;
```

- `getSnapshot` returns the core snapshot,
  `{ status, messages, toolCalls, error?, plan?, usage?, state?, stateIssues?, interrupts?, subagents }`,
  together with the protocol evidence behind it: `transcript`,
  `earlierSubagents`, `decision`, `reasoningDurations` and `run`. `messages` and
  `toolCalls` are what the two selectors above return, and keep their
  references until they change. One publication always reads as one snapshot.
- `interrupts` lists what a paused run waits on, from the pause until an answer
  is sent. Each entry is the protocol's interrupt, so it has the core `id`,
  `reason`, `message` and `toolCallId` and any other field the backend sent. It
  is absent when nothing is waiting, and for a pause this session cannot answer.
- `subagents` lists every child the session knows as a core child agent:
  children of earlier root runs first, marked `earlier`, then the current run's,
  each in start order. A child has `id`, `name`, `description`, `toolCallId`,
  `parentId`, `status`, and its own `messages` and `toolCalls`, which the root
  lists do not repeat. The protocol evidence stays on each child as `started`
  and `terminal`. `earlierSubagents` still holds the earlier children's bare
  evidence.
  - Error evidence is `error` and carries its message. Finished evidence is
    `complete`, unless the child finished `suspended`: it paused and can
    continue, so it is `running` in its own run and while a later run is going,
    and `unknown` once a later run ends without continuing it. A child with no
    ending is `running` while the root run is going and `unknown` after it.
  - A child lists the records attributed to its run id within its own run. A
    child that starts again after pausing continues: it is one child, and keeps
    the records from before the pause. Any other child that reuses a run id
    replaces the earlier one and starts with none of its records.
  - A child keeps its reference until its evidence, status or records change.
- Every publication notifies subscribers, including one that changes only
  protocol evidence such as a decision or a child.
- `submit` takes text, or `{ message, state? }` with a state patch.
- `resume` is the core contract's command: it takes one response for each
  pending interrupt, named by `id` (see "Correlated native resume").
- The client-tool evidence is an AG-UI addition to the core contract.
- A failed run becomes `snapshot.error`. A backend `RUN_ERROR` is a `server`
  error carrying the backend's message. A stream that ended without a terminal
  is `interrupted`. A response that was not OK carries its HTTP status: 401 and
  403 are an `auth` error, any other status a generic `server` error. The
  response body is never shown. A request that got no response, such as an
  unreachable host, is a generic `server` error without a status.
- The snapshot records that status as `run.failure.status` when a
  response that was not OK is why the run failed, and clears it with the next
  run.
- A backend `RUN_ERROR` for a submission is `retryable: true` with
  `recovery: 'retry'`. Every other error has
  `retryable: false` and `recovery: 'none'`: a stream that ended without a
  terminal, a response that was not OK and a request that got no response leave
  open whether the backend did the work.
- The session has `checkStatus` when the application configures
  `persistence.reconcile` (see "Durability"). AG-UI itself defines no read-only
  way to ask a backend what became of a run: `HttpAgent` only posts new runs,
  and it does not implement the client's optional `connect` hook. So the
  question goes to the application's own reconciler, and a session without one
  has no `checkStatus` and never reports `recovery: 'check'`.
- `usage` is the token usage the settled run's `RUN_FINISHED` or `RUN_ERROR`
  reported, one entry per provider and model, with only the provider and model
  labels and finite counts copied. It is absent while a run is going and after a
  run that reported none, so it never carries over from an earlier run. The
  event's own `usage` stays on `run.terminal`.
- While a decision is waiting, `submit` resolves `error` without sending.
  `snapshot.inputBlocked` says why, so a view can disable its input as the
  Angular adapter's `isInputBlocked` did. It is `'decision'` from a pause until
  its answer succeeds (including a decision this session cannot answer and one
  left uncertain), `'client-tools'` while the client-tool ledger has a blocker,
  and `'hydrating'`, `'checking'` or `'storage'` while the session itself
  cannot take a command (see "Durability"). It is absent when a submission
  would be admitted. A run in progress is not a reason: read `status`.

### State

`snapshot.state` is the session's state document. Declare its type with
`stateType` when creating the session:

```ts
import { type } from '@threadplane/core';

const session = createSession({
  threadId,
  url,
  state: { topic: 'billing', notes: [] },
  stateType: type<{ topic: string; notes: string[] }>(),
});
session.getSnapshot().state?.topic; // string | undefined
await session.submit({ message: 'Go on', state: { topic: 'refunds' } });
```

- `type<T>()` declares the type and checks nothing. Pass a Standard Schema, such
  as a Zod object, to check each document as well: `state` is then the schema's
  output, frozen. Each document is checked once, however often it is read.
- A document the schema rejects does not fail the run. `state` keeps the last
  document that passed, or stays absent when none has, and `stateIssues` lists
  the reasons until a document passes again. A schema must validate
  synchronously and produce plain data.
- Without a declaration `state` is plain data and a submitted patch is any plain
  record.
- A session created without `state` reports none, and its schema is not asked,
  until the application submits a patch or the backend sends a state. The
  request still carries `{}` until then.
- Each request sends the literal document, whatever is declared. The schema's
  output is never sent to the backend, and the literal document is not
  published.

### Retry

Every session has `retry()`. Without a client-tool catalog it sends the
last submission again after its run failed with a backend `RUN_ERROR`,
rebuilding the request from exactly the history and state that submission sent.
No second user message is added, and the failed run's output and state changes
are dropped. It resolves `aborted` without sending while a run is active, when
nothing failed or when the last run was not a failed submission. It rejects
without sending when the error's `recovery` is not `'retry'`, because the
failure leaves the backend outcome open.

- A failed resume is not retried. Its decision stays `uncertain`, as described
  under "Correlated native resume".
- With a client-tool catalog, `retry()` sends the failed request again,
  whichever request of the command that was: the submission itself, or the
  continuation that carried local tool results. The request is rebuilt from what
  the failed one sent, so results the handlers already produced travel again and
  no handler runs a second time. The session still installs its `uncertain`
  blocker for the failure, so an ordinary `submit` cannot bypass it; `retry`
  lifts exactly that blocker. Any other blocker (a conflict, a cancelled call,
  an unsupported call, the group limit) is not a retryable failure.
- A `RUN_ERROR` settles that the run failed, not that it did nothing. Work the
  backend did before failing can be repeated.

### Regenerate

Every session has `regenerate(messageId, options?)`,
with the same semantics as the Angular adapter's `regenerate`. It takes the `id`
of a root assistant record, or of the reasoning record a reasoning-only answer is
shown under, which is the `id` the snapshot's `messages` give that message. It keeps the history
up to and including the user message before that record, drops everything after
it, and sends a run with that history and the current state. The prompt is not
added again. Regenerating an earlier answer drops every later turn.

- It rejects without sending after disposal, while a run is active, while a
  decision is waiting, for an id that is not an assistant record, and when no
  user message precedes it.
- A regenerate that fails with a backend `RUN_ERROR` can be sent again with
  `retry`, from the same trimmed history.
- It is the core session's `regenerate`, so React `Chat` offers Regenerate on
  assistant messages.
- With a client-tool catalog, `regenerate` also forgets the client-tool calls
  that belonged to the dropped records, with their results, so
  `clientTools.calls` lists only the calls of the history that remains. A new
  answer that calls a tool runs its handler again, as a new call, even when the
  backend reuses a dropped call's identifier. It rejects while a blocker is
  installed, except the blocker a backend `RUN_ERROR` left, which it lifts as
  `retry` does.

### Approvals

`decisionState(snapshot)` reads the snapshot's pending decision and how far it
has got, so an app can show it in `Chat`'s `approval` slot and answer it with
`resume`:

```tsx
const pending = decisionState(useAgent(session));
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
              void session.resume([
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
  reads `ready`, and `resume` then rejects.
- What the buttons mean, and which value answers which interrupt, stay with
  the app. Response schemas are not interpreted.

The candidate package entry exports it. The published package root does not.

## Durability

A session can restore its thread when it is created and keep it saved as it
changes, as the Angular adapter did with `persistence`, `replay` and `ready`:

```ts
const session = createSession({
  threadId,
  url,
  replay: httpReplay({ url: (id) => `/api/threads/${id}/events` }),
  persistence: { namespace: 'my-app', store, reconcile },
});
await session.ready;
```

- `ready` resolves once the thread is restored, and at once for a session with
  neither option. Until then `snapshot.inputBlocked` is `'hydrating'`, and
  `submit`, `resume`, `retry` and `regenerate` wait for it before they run. It
  rejects only when the stored thread could not be read; a failed replay does
  not reject it.
- `replay` is `(threadId, signal) => events`: a promise of an array, or
  anything with an observable's `subscribe`. Replay wins whenever it returns at
  least one event, and `persistence` is then not read. An empty result, a
  failure, or events that cannot be folded fall back to `persistence`, or to
  the thread the session was created with. `signal` aborts on `dispose`.
  `httpReplay({ url, fetch?, headers? })` covers `GET url(threadId)` answering
  `{ events }`, with a `404` read as no events.
- Each replayed run goes through the pipeline a live response goes through, so
  retired shapes and chunk events are read as they are live, and is applied the
  way a live event is. A run stops at its terminal event. A run with no
  terminal is settled `interrupted` and the thread is left idle. A run after a
  paused one is that pause's answer. User messages a `RUN_STARTED.input`
  carries are added. Reasoning durations come from the events' `timestamp`s and
  are absent without them. A paused last run restores as a pending interrupt
  that `resume` answers.
- `persistence` is `{ namespace, store, reconcile? }`. The store has
  `load(key)` and `compareAndSwap(key, expectedRevision, next)`. A record is
  plain JSON: `{ version: 1, namespace, threadId, revision, messages, state?,
  subagents?, pause? }`, where `pause` holds the pending interrupts, the
  command profile when one applies, and the `attempt` when an answer was sent.
  A pause this session cannot answer is not saved.
- The thread is saved after every command settles, before an answer is sent,
  and when the answering run reports `RUN_STARTED`. The save before sending is
  awaited: an answer that could not be saved is not sent, and its claim is
  released.
- Writes use the revision. A write that loses its compare-and-swap is not
  retried: another writer owns the thread. That, and a store that fails, put
  the session in `inputBlocked: 'storage'` with an error whose message is the
  storage copy. `submit` then resolves `error` and the other commands reject
  until `reconcileInterrupt` succeeds.
- A pause restored without an answer is `ready`. A pause restored with its
  answer is `uncertain`, because the record cannot say how that run ended:
  `resume` rejects and `submit` is refused. Only reconciliation continues.
- The format is this runtime's own. Records the Angular adapter wrote are not
  read.

### Reconciliation

`persistence.reconcile(record)` asks the application's backend what became of
the saved thread and answers `{ status: 'unknown' }` or a status with the
thread as it now stands:

- `pending`: the pause still waits and no answer arrived. `pause` has no
  `attempt`.
- `acknowledged`: the answer arrived and its run started; how it ended is not
  known. `pause` keeps its `attempt`.
- `completed`: the answer's run ended. `pause` is absent, or is a new pause
  from another run.

An answer that does not fit its status is rejected and nothing is written.

- `session.reconcileInterrupt()` is present with `persistence`. It adopts
  whatever the reconciler reports, including `acknowledged`, clears a storage
  hold, and rejects after disposal, while a run or another check is going,
  without a reconciler, and when the backend does not know.
- `session.checkStatus()` is present with a reconciler, and is the core
  contract's command. An answer that was sent and not proven taken publishes
  `error.recovery: 'check'`, and the session asks once on its own. It settles
  only on `completed` or `pending`; `acknowledged`, `unknown` and a reconciler
  that throws leave the error in place so the check can be offered again. It
  never sends the answer again. An ordinary failed submission is never checked.
- While a check runs `inputBlocked` is `'checking'`, `submit` resolves `error`
  and the other commands reject.

### Interrupt session

`interruptSession(snapshot)` reads the full interrupt batch and its request
ownership, as the Angular adapter's `interruptSession` did:
`{ phase, id?, interrupts, runId?, command?, attempt? }`.

- `phase` is `none`, `collecting` (the pausing run has not settled), `pending`,
  `resuming`, `acknowledged`, `uncertain`, `recovery-required` or
  `unsupported`. Claiming and sending are one step in a session, so there is no
  `claimed`.
- `acknowledged` and `recovery-required` need a durable session: only it
  records that the answering run reported `RUN_STARTED`. Elsewhere that event
  is not taken as proof of anything, and a sent answer that fails is
  `uncertain`.
- `id` changes with every new pause, as the legacy `generation` did. `attempt`
  is the answer that was claimed: its run, responses and command.
- The same decision in the same phase returns the same reference.

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
supply it; the factory always does.

## Interruption evidence

Both `createSession` and standalone `createRun` default to
`interruptMode: 'native'`. They capture this constructor option once. A root
`CUSTOM on_interrupt` event is retained as `run.legacyInterrupt`, with its literal
value and selected metadata. It does not set `run.terminal` or close the stream.
A later native `RUN_FINISHED` or `RUN_ERROR` supplies terminal evidence. Child
custom notices and unrelated custom events do not become root notices.

An explicit `interruptMode: 'legacy-observation'` preserves the legacy convention:
the root custom notice occupies both evidence fields, selects `paused` and closes
the response. This option provides observation only; answering a notice is
`interruptTransport`'s job (see "Interrupt resume profiles").
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

## Interrupt resume profiles

`interruptTransport` selects how a session answers a pause, with the values the
Angular adapter's option had:

```ts
const session = createSession({ threadId, url, interruptTransport: 'auto' });
```

- Absent or `'protocol'`: only the protocol's own interrupt outcome is answered,
  with top-level `resume` entries. A `CUSTOM on_interrupt` notice installs a
  decision this session cannot answer, as described below.
- `'auto'`: the protocol's outcome is answered natively and wins over a notice
  in the same run. A notice with no such outcome is answered through
  `forwardedProps.command`: in the Mastra shape when the notice's value names a
  `toolCallId`, and as `{ command: { resume } }` otherwise.
- `'legacy-command'`: every pause, a notice or the protocol's outcome, is
  answered as `forwardedProps: { command: { resume } }`.
- `'mastra-command'`: every pause is answered as
  `forwardedProps: { command: { resume, interruptEvent: { toolCallId, runId } } }`.
  `toolCallId` comes from the notice, and `runId` from the notice or else the
  run that paused. `resume` rejects when the notice names no `toolCallId`.

A notice the session can answer is one entry in `snapshot.interrupts`:
`{ id, reason: 'on_interrupt', value, toolCallId? }`. `value` is what the notice
carried, with JSON text read as its data, and `toolCallId` is set when the value
names one. The pause is answered with the same `resume` command, and the
response's `value` becomes the command's `resume`:

```ts
const [interrupt] = session.getSnapshot().interrupts ?? [];
await session.resume([
  { interruptId: interrupt.id, status: 'resolved', value: { approved: true } },
]);
```

- The request carries the command in `forwardedProps` and no top-level `resume`.
- A command answers exactly one interrupt with a resolved response that has a
  value. `resume` rejects, sending nothing, for a cancelled response, a missing
  value, and a protocol batch of several interrupts under a command profile.
- A run that sends a notice and then finishes in the ordinary way settles
  `paused`, and the pause stays until its answer's run succeeds. Without a
  profile that answers notices the same finish settles `success` and clears
  the notice, as before.
- A repeated notice in one run updates the same pause. A notice in the
  answering run starts a new pause with a new `id`.
- With `interruptMode: 'legacy-observation'` the notice still closes the
  response; a profile that answers notices makes that pause answerable too.
- Sending, failure and uncertainty follow "Correlated native resume": a claim
  cancelled before fetch is released, and a sent answer whose run ends without
  proof stays `uncertain`.
- With a client-tool catalog the answer travels with the unresolved calls
  observed at the pause, as for a native pause.

## Correlated native resume

An observed root custom notice installs an unsupported decision blocker. A later
native interrupt batch replaces it with one immutable `decision` containing a
fresh branded `PauseId`, the source run ID and the already owned interrupt array.
Child notices do not create root decisions. Duplicate interrupt IDs retain an
unsupported blocker. The locked SDK rejects empty wire batches before delivery;
that error preserves an existing blocker or claim and invents no terminal.

After the native pause has locally settled, answer its interrupts with the core
contract's `resume`:

```ts
const snapshot = session.getSnapshot();
if (snapshot.interrupts?.length && snapshot.run?.outcome) {
  await session.resume(
    snapshot.interrupts.map((interrupt) => ({
      interruptId: interrupt.id,
      status: 'resolved',
      value: { approved: true },
    }))
  );
}
```

`resume` takes the responses alone and answers the pause that is pending; there
is no pause token to pass. Every pending interrupt needs exactly one response
with its exact ID. A resolved response may omit `value`; a `null` value is
treated as absent (the AG-UI 1.0 client omits whole-optional nulls on the wire).
The request carries the value as the protocol's `payload`, and so does
`decision.attempt.responses`. A cancelled response is
`{ interruptId, status: 'cancelled' }` and cannot carry a value. A response may
also carry the protocol's optional `metadata`, which must be a plain record.

`resume` rejects with a `TypeError`, sending nothing, when no interrupt is
waiting, the pausing run has not settled, an answer was already sent, a run is
active, an interrupt has expired, the responses are not an array, a response
names an interrupt that is not pending or names one twice, or an interrupt is
left unanswered. It resolves `aborted`, sending nothing, after disposal and when
its signal is already aborted. Once the answer is sent it resolves with that
run's outcome. Responses and the options signal are
captured once before queueing; nested data is copied and frozen without freezing
the caller. Extra runtime getters are ignored. Response schemas are opaque; this
owner neither validates business answers nor guesses defaults or aliases.

Eligibility is checked at invocation and admission. The pending decision must be
the current unclaimed native generation, the current run must be locally settled,
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
be retried. Once fetch was invoked, failure, EOF or abort
without conclusive native evidence retains the attempt and forbids replay or
ordinary bypass. `RUN_STARTED`, local promise completion and exception properties
do not establish server acknowledgement or socket closure. No retry, reset,
session reconstruction or persistence/recovery guarantee is provided.

Native success clears the decision at local settlement, even if a terminal
listener selected local `aborted`. A new native pause is a fresh generation even
when backend interrupt IDs repeat; old finalizers cannot clear that generation.
Legacy observation has no resume support unless `interruptTransport` selects a
profile that answers notices. Captured Strands replay establishes
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
