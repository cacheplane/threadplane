# LangGraph session reference

This directory is the source of `@threadplane/langgraph`. The package root,
`src/public-api.ts`, exports `createSession` and the rest of the public surface
listed in the [package README](../../README.md). Nothing here imports a UI
framework, and core and the framework bindings do not own backend execution
positions.

`node scripts/react-parity/verify-langgraph-package.mjs` packs the built
package, installs the tarball and runs plain Node plus both framework consumer
suites against it. Commands, frozen manual review and dependency and type
limits are in
[`fixtures/react-parity/langgraph-package/README.md`](../../../../fixtures/react-parity/langgraph-package/README.md).

## Thread creation

`threadId` is optional. A session created without one (or with `null`) starts
empty and sends no request until its first submit, which calls
`transport.createThread(signal)` once, before the run. The owned SDK transport
implements it with `client.threads.create()`, the call the Angular transport
makes, under the owned `maxRetries` policy (0 unless a number is supplied). A
supplied transport without `createThread` makes construction throw. The created id
is reported once through `onThreadId` and is read from `session.threadId`; a
throwing callback does not affect the run. The id is not part of the snapshot.

- A submit that replaces a submit waiting on creation shares the same request,
  so one session never creates two threads. Stop leaves the request running and
  keeps a thread it creates; dispose aborts it and reports nothing.
- A failed creation settles the submit as `error` with the generic request
  message. Only an unprotected SDK error's numeric status is read (401 and 403
  report `auth`), never its message or body. No run started, so the error is
  `recovery: 'retry'` when `retry()` exists and `none` otherwise; the next submit
  or `retry()` makes a new creation request.
- Before the thread exists, `load()` and `checkStatus()` resolve without a
  request, `fork()` and `regenerate()` reject, and `reconnect()` and `resume()`
  reject as they do with nothing to join or answer.
- There is no thread switch: a session still belongs to one thread once it has one.

## Visible text

The shared private wire helper preserves a top-level string verbatim. Arrays join
string entries and string `text` fields from `text`, `output_text` or untyped
objects in order, without separators. Empty and whitespace strings are preserved.
Unknown typed blocks (including reasoning, thinking, images and tool blocks),
non-string text, nested arrays and other values are ignored without coercion.
Inputs are neither mutated nor frozen; only the projected string is published.

History and canonical final messages replace text exactly, including shorter or
empty corrections. Deltas append verbatim. Interim answer snapshots retain the
existing prefix rule: a shorter prefix or empty snapshot does not truncate the
answer. This differs from reasoning snapshot replacement. Committed canonical text
bars late interim text. Text shape does not establish finality, tool identity or
execution authority; actual ToolMessage roles and IDs still determine settlement.

This closes text-alias loss shared by the native bindings. It does not retain rich
media/block order for rendering, add multimodal input, or establish provider,
SSR or performance parity. The legacy Angular extractor remains a bounded
duplicate until the separate backend cutover.

## Transcript node names

`createSession({ transcriptNodeNames })` names the root nodes whose streamed
message chunks enter `snapshot.messages`. A chunk names its node in
`messageMetadata.langgraph_node`; one from a node outside the list is not
projected. Omit the option to accept every root node. Use it when a graph has
side-effect model nodes, such as title generation, whose output is not chat
content. A chunk that names no node is accepted, and a message the graph saves
to its state still arrives with that state. Child graphs are never filtered:
their messages belong to `snapshot.subgraphs`. The list is copied at creation.

## Owned citations

History, root streams and read-only child streams project citations from
`additional_kwargs.citations ?? additional_kwargs.sources`. Supported arrays replace
the list; an empty array clears it. Missing metadata retains the current list on
interim events within one generation, while canonical messages and authoritative
history reads define the complete state and clear omissions. Later interim events
cannot undo committed canonical metadata. Equal metadata shares owned references,
including when only text changes. Terminal candidates and queued publications
capture metadata before callers can mutate it.

The private normalizer stages the existing Angular extractor's aliases without an
Angular dependency. Consolidate this bounded duplication at the backend cutover.
The adapters do not promise identical arbitrary-extra semantics: neutral snapshots
accept plain provider records and string/finite-number timestamps, omit unsupported
optional fields, and reject instances/cycles in extras at the ownership boundary.
Exact checkpoint ingress remains stricter: it captures the complete plain state
before projection and rejects Date instances even in otherwise optional metadata.
Citation changes never authorize tools, change execution positions, or reopen
delivery. Rich blocks, event render state and citation components remain separate
future capabilities.

## Owned reasoning

History and root/child streams capture backend-supplied reasoning into the optional
readonly `Message.reasoning` string. The private normalizer prefers a top-level
string, then `additional_kwargs.reasoning_content`, then ordered reasoning/thinking
blocks. Each block contributes string text (or thinking's string `thinking` fallback)
followed by string summary text. Explicit empty strings win source precedence;
recognized empty blocks yield an empty string, while unsupported sources fall
through and ordinary answer text never becomes reasoning.

Within a delivery generation, omitted interim reasoning is retained, deltas append
verbatim, and cumulative snapshots replace even shorter or empty strings. Canonical
messages and full history replace exactly, including clearing omissions. Committed
canonical data bars later interim changes; ordered canonical corrections still
replace it. New independent generations do not inherit reasoning. Reconnecting the
same physical run retains captured reasoning while rebasing its delivery generation.
Equal histories preserve identity, and reasoning-only changes publish through the existing queue.
Captured terminal candidates and published strings cannot change with wire mutation.

This bounded normalization duplicates part of the legacy Angular extractor until
backend cutover. It uses explicit event modes, not that adapter's prefix heuristics
or clock map. No rich-block, renderer, event-only retention, provider-version
conformance or complete T09/T15 parity is claimed. Strict checkpoint capture still
rejects non-plain/cyclic data before display normalization. Reasoning never changes
tool admission, checkpoint authority, transport requests or lifecycle scheduling.

### Reasoning time

The backend sends no duration, so the session measures arrival time on its own
clock and publishes it as `Message.reasoningDurationMs`, in milliseconds. A root
assistant step is timed from the first publication in which it has reasoning and
nothing else, to the first in which it has answer text, a finalized tool call or a
completed delivery. Each step of a turn is timed on its own.

Reasoning that is first seen already settled has no duration: saved history, and a
step delivered whole with its answer, were never observed arriving. The field is
then absent, never zero. A correction that removes the reasoning removes its time.
The measurement lives outside the deterministic reducer, is not stored or sent, and
is lost with the session, so a reloaded conversation shows no durations. A network
stall counts as reasoning time.

Assistant steps in `snapshot.subgraphs` are timed the same way, each child graph
on its own clock, since namespaces can repeat message identifiers. A child
graph's timings last as long as the session lists it: a new submission starts
with no child graphs, so their durations go with them.

## Completed checkpoint forks

`session.fork(checkpoint, input, options?)` submits new input in the session's
fixed thread from an exact, completed root checkpoint. Pass the full SDK/history
checkpoint reference; capture checks the thread, root namespace, ID and optional
map. The source must have no remaining graph work, interrupts or unanswered tool
calls. Selecting history in a UI does not change this authority.

After activation, subsequent submit, tool follow-up, result persistence and load
use the session's resulting checkpoint. Root checkpoint frames are candidates;
the owner confirms the physical run has ended and reads its exact saved state
before permitting another effect. A custom transport must perform single requests,
return exact checkpoint routing after writes, and deliver checkpoint frames during
both creation and joining. An owned SDK client configured to retry requests cannot
activate this capability. Retrying an ambiguous write could create a sibling.

New tool calls retain the existing execution-store and follow-up policies.
Tool candidates for new effects must match the invocation and resolution evidence
in the confirmed saved messages. Transient stream calls or results cannot
independently authorize or suppress execution.
Locally settled invocations retain identity-bound completion evidence for their
branch owner across loads. Graphs may consume a result and remove its wire message;
that does not authorize another handler invocation when a pause resumes. History
and wire results cannot create this completion evidence, and a new fork starts
with none.
Historical ToolMessages establish entry eligibility only; they do not restore
typed results or prove historical guard coverage. A new invocation cannot reuse a
baseline call ID. Serialized result writes retain their originating owner and
advance through each returned checkpoint, including already-authorized cleanup
after local stop or disposal.

Missing final evidence and ambiguous write acknowledgments leave authority
unavailable. Commands cannot silently use an older checkpoint or adopt the global
tip. `checkStatus()` does not repair a branch: ready is a no-op; active, disposed
or uncertain states reject. Explicit reconnect can join a retained physical run
when sufficient run/cursor evidence exists. It never submits another run.

### Regenerate

`session.regenerate(messageId, options?)` is the core session's optional
regenerate command, built on `fork`. It takes the `id` of an assistant message,
finds the prompt before it, reads the thread's history, and forks from the
newest saved checkpoint that does not hold that prompt yet, submitting the
prompt's text there. The earlier answer stays on its old branch in the thread;
the snapshot shows the new one.

- The command exists only when the transport has `getHistory`, `getState`,
  `getRunStatus` and `joinStream`, the same capabilities `fork` needs.
- It rejects for an id that is not an assistant message, when no prompt
  precedes it, while a response is running, when the conversation changes
  while history is read, and when no such checkpoint is in the history page the
  transport returned. A prompt older than that page cannot be regenerated.
- Only the prompt's text is sent again. Input state and anything else the
  original submission carried are not.
- After the read, every rule of `fork` applies, including its refusal to
  replace active or unsettled work.

## History with state

`snapshot.history` holds only checkpoint metadata. A session created with
`historyState: true` also keeps each loaded checkpoint's state and publishes
three views of the page, all absent until a page has been read:

- `snapshot.checkpoints`: the page, oldest first, as the core contract lists a
  history. Each entry is the core `AgentCheckpoint`, with the checkpoint `id`,
  a `label` (the first node it would run next) and its `values` (the saved
  graph state, `messages` included), plus `saved`, the checkpoint as the
  backend sent it. `snapshot.history` keeps the backend's order, newest first.
- `snapshot.messageCheckpoints`: a record from an assistant message id to the
  id of the newest checkpoint whose assistant messages end with it. Checkpoints
  without an id are skipped.
- `snapshot.branchTree`: the page arranged by parent checkpoint. A `sequence`
  holds `node` items and, where a checkpoint has several children, a `fork`
  whose `items` are the alternative sequences, oldest first. A node's `value`
  is the entry in `checkpoints` and its `path` lists the fork choices that lead
  to it. A page that starts mid-thread is rooted at its newest lineage.

`load()` fills them, and the page is read again after every run that ends in
success or a pause. That read updates only these views and `history`; the
transcript stays the stream's, and a read a newer command overtakes is dropped.
Everything is owned frozen data and keeps its reference while a page is equal
to the last one. The option is off by default because a page's states can be
large.

`session.setBranch(branch)` records which branch a view shows and publishes it
as `snapshot.branch`, absent for the default branch. `branch` is the fork
choices joined with `>`. It is a view selection: nothing is requested and the
transcript does not change. `selectBranch(tree, branch)` returns that branch's
checkpoints, oldest first, following the newest continuation (the last of a
fork's `items`) at any fork the branch does not name.

## Run settings

`submit`, `resume`, `fork` and `regenerate` take the LangGraph settings of the
run they create under `options.run`, beside `config`, `context`, `metadata`
and `signal`. They are grouped so that a caller states them on purpose: a
`command` or `streamMode` at the root of the options is never read.

- `command: { update, goto }` sends a graph command with the run. On `resume`
  the session adds the answer, so one command both answers the pause and
  updates the state. `command.resume` is rejected: the answer is `resume`'s
  argument.
- `multitaskStrategy`, `interruptBefore`, `interruptAfter`, `streamSubgraphs`,
  `durability`, `checkpointDuring`, `onCompletion`, `onDisconnect`, `webhook`,
  `afterSeconds`, `ifNotExists` and `feedbackKeys` are passed to the request.
- `streamMode` adds modes. The modes the session needs are always kept.
- `onRunCreated` is called with each run the command creates, after the
  session has recorded it. A throwing callback is ignored.
- `checkpointId`, or `checkpoint`, starts the run from a saved checkpoint: see
  below.

Every setting is captured and owned before the request, a setting that is not
plain data rejects before anything is sent, and nothing carries over to the
next command. `command`, `checkpoint` and `checkpointId` apply to the first run
of a command only, not to the runs that hand tool results back.

### A run with no input

`submit(null)`, or `submit(undefined)`, starts a run with no input: the graph
continues from the thread's saved state and no user message is added. Use it
with `run.command` to route or update the graph, or after an external state
update. It is recovered, retried and reconnected like a resume, but it answers
nothing and does not mark `interruptResolvedAt`.

`runWithoutMessage({ state }?, options?)` is the core contract's command for
the same run. A `state` is sent as the run's input, so the graph merges it and
runs on the conversation as it stands; without one the input is null. Either
way, client tool results that were settled and not yet written travel with the
run as its `messages`, so they are never dropped by a run that adds no user
message.

### A run from a checkpoint

`run.checkpointId` starts the run from that checkpoint; the thread gains a
branch there. When the session has the checkpoint's state (`historyState: true`
and the checkpoint is in the loaded page), the transcript is first set back to
what the checkpoint held, so the new turn follows it. Otherwise the session
loads history once the run has ended, and the saved branch replaces the
transcript then. A session that is already on a `fork` branch rejects the
setting. `fork` remains the guarded form: it verifies a completed checkpoint
and confirms the position each run saved.

### Queued runs

`submit(input, { run: { multitaskStrategy: 'enqueue' } })` during a run does
not replace it. The session creates the run on the backend with
`transport.createQueuedRun`, lists it in `snapshot.queue` (`id`, `message`,
`createdAt`; the field is absent when nothing waits) and returns a promise that
resolves with that run's outcome. When the active run ends, the oldest queued
run is joined from its first event with `transport.joinStream`; its user
message enters the transcript at that point. Queued runs are not joined after
an outcome that offers a check or a retry, so that recovery is not replaced;
they are joined after the next run that ends cleanly.

LangGraph orders queued runs by when they were created. When the transport
reports run creation (the owned transport does), a queued submission is sent
only after the active run exists on the backend, or has streamed its first
event, or has ended. Queued any earlier, it could run ahead of the run it was
meant to follow.

`cancelQueued(runId)` removes one run and `clearQueue()` removes all, each
asking the backend to cancel through `transport.cancelRun`; the removed
submissions resolve `'aborted'`. `stop()` does the same for the whole queue.
`dispose()` resolves them `'aborted'` without cancelling anything. Queueing
needs an existing thread and both transport methods, and rejects otherwise; a
failed queue request rejects with a safe error and leaves the active run
alone. With nothing running, an `enqueue` submission starts at once and passes
the strategy to the backend.

## Joining a run by id

`session.joinStream(runId, lastEventId?, { signal }?)` projects a run of this
thread that the session did not start: one created by another client, by a
schedule, or before a reload. Without `lastEventId` the run is joined from its
first event, which the backend serves only for a resumable stream; with it the
stream continues after that event. Joining replaces an active run the way a
submit does, adds no user message, creates no run and takes no run settings.
It resolves with the joined run's outcome, settled from the exact run status
when the transport has `getRunStatus`, and `'aborted'` when the session has no
thread yet. It rejects without `transport.joinStream` and for an invalid run
id. `reconnect()` is still the way to continue the session's own retained run.

## Interruptions and recovery

A stream that closes without this runtime's own terminal evidence settles as
`interrupted`, never as a completed turn, and the error offers only the recovery
the session can prove is safe. A failure that leaves the backend outcome open is
never `recovery: 'retry'`: a thrown iterator cannot show that a request was
undispatched (a browser `TypeError: fetch failed` carries no cause, and a reset
after the server accepted the request looks identical to one that never left), so
a pre-response failure is an `interrupted` error too, not a retryable
`connection` one. The only `retry` the runtime emits is for a run the backend
itself reports as failed (see "Retry" below), and for a first submit whose thread
could not be created, which started no run (see "Thread creation" above).

`recovery: 'check'` is offered exactly when `transport.getHistory` exists for an
ordinary submit, with or without a captured run id, and `checkStatus()` is exposed
on the same condition. The check is read-only: with a captured run id it inspects
the exact run first (`getRunStatus`), then reads this turn's saved checkpoint and
correlates it by the submitted user message. An in-flight run leaves the snapshot
untouched so the check can be repeated; a failed run is reported as such and
offers at most the retry below; a committed answer or a pending interrupt settles the
turn. Close-time settlement performs the same read once, automatically, unless the
exact run is known to be still in flight; a stream that throws instead of closing
gets that same single read, and a conclusive answer settles the attempt itself. Fork attempts and tool follow-ups after
a resume are never reconciled from history and report `recovery: 'none'`.

A first-group resume is reconciled too, anchored on the turn's existing user
message rather than a new one. Its evidence is activity the turn did not have
when the decision was sent (message ids outside the captured turn), or a pause
the thread did not have (a different interrupt id or payload). A different or
recurring pause after new activity settles as paused on that pause; new activity
on an idle thread, or a newer user turn, settles as success. The same pause with
nothing new is inconclusive: the decision may never have landed, or may still be
executing before its first checkpoint, so the runtime neither restores the pause
nor replays the decision. An uncertain resume does not strand the user: `load()`
and `resume()` withdraw a check owned by an earlier resume (one owned by an
uncertain submit still blocks them), reloading restores the still-pending pause,
and the decision can be sent again.

An exact `interrupted` run status is ambiguous: the pause event may have been lost
when the stream dropped, or a newer run may have cancelled this one. The runtime
disambiguates through history before settling; pending interrupts for this turn
mean paused, anything else is the failed run.

`snapshot.retainedRun` and `session.reconnect()` are LangGraph-specific extensions,
not part of the core contract: they join the retained physical run from its last
cursor when `joinStream` and `getRunStatus` exist and the run is not confirmed
ended. Portable callers use `checkStatus()`; a resolved check clears the retained
run so the two surfaces cannot disagree.

### Retry

`session.retry()` is the core session's optional retry command. It exists only
when the transport has `getRunStatus`, because only the exact run's status can
settle a failure. It sends a command again when, and only when, the backend
reported that command's run as `error` or `timeout`, at close or through
`checkStatus()`, or when the command's thread could not be created. That error
carries `retryable: true` and `recovery: 'retry'`.

- The transcript and values return to what they were before the command, and the
  command's captured input is sent again. A submission keeps its user message id,
  so the snapshot gains no second copy, and neither does a thread whose
  `messages` key uses the standard `add_messages` reducer, which replaces a
  message by id. A resume sends the same response and no message.
- An `interrupted` run status, a run whose status is unknown or still running, a
  fork, and a command whose tool follow-up failed are never retried. While such
  an error is shown, `retry()` rejects; after `checkStatus()` settles it as a
  failed run, `retry()` is allowed.
- `retry()` resolves with the re-run's outcome. It resolves `aborted` without
  sending, as an ignored `submit` does, while a request, history load or
  checkpoint preparation is active, and when nothing failed. Replacing the transcript
  through `load()` or another command withdraws the retry.
- A failed run can still have done work in the steps before it failed. Retrying
  runs the graph again from the same input, so those steps can run again.

Errors are plain frozen snapshots (`AgentError` from `@threadplane/core`), not
`Error` instances: `instanceof Error` and `instanceof` the `@threadplane/chat`
`AgentError` class are both false. Read `kind`, `recovery` and `detail` instead.
The interruption copy is owned here: this neutral graph imports no UI package,
and a view shows the `message` and `detail` the snapshot carries.

## Graph state

`snapshot.state` is the root graph state the backend last reported, without
`messages` and `__interrupt__`, or `undefined` before any is observed. Each
`snapshot.subgraphs[]` entry has its own `state`.

A session created without `stateType` reports a broad readonly record. Declare
the type to read fields directly:

```ts
import { type } from '@threadplane/core';

const session = createSession({
  assistantId,
  threadId,
  stateType: type<{ todos: Todo[]; draft?: string }>(),
});
session.getSnapshot().state?.todos; // readonly Todo[]
await session.submit({ message: 'Go', state: { draft: 'Notes' } });
```

`type<T>()` checks nothing at runtime. Pass a Standard Schema, such as a Zod
object, to check each reported state as well. `state` is then the schema's
output, which must be a plain data record. A state the schema rejects does not
fail the run: `state` stays at the last one that passed and
`snapshot.stateIssues` lists what was wrong until a valid state arrives. A run
often reports partial state before the graph has written every field, so make
fields the graph fills in later optional. The declaration covers the root graph
only; child graph state stays a broad record.

## Custom events

`session.onCustomEvent(listener)` delivers each `custom` stream frame, from the
root or any subgraph namespace, as `{ name, data }`. The frame is read the way the
Angular adapter reads it: a `{ name, data }` payload unwraps, and any other payload
is the data with an empty name. Events are not state: no snapshot holds them, and
a listener added later does not receive earlier events. `data` is owned frozen
plain data; a payload that is not plain data is dropped. The middleware's
subagent binding frame is protocol and is not delivered. A throwing listener
does not affect the run or other listeners. Disposal releases every listener,
including in the middle of a delivery, and later registrations are inert. Owned
streams always request `custom` mode; a supplied transport delivers what its own
stream modes produce.

## Lifecycle timestamps

`session.lifecycle` is a small observable beside the snapshot, for a debug
panel or telemetry: `getSnapshot()` returns a frozen `LangGraphLifecycle` and
`subscribe(notify)` reports each change, so React reads it with `useAgent` or
`useSyncExternalStore`. Each value is epoch milliseconds on this clock, null
until its milestone happens.

| Value                 | Stamped                                                 |
| --------------------- | ------------------------------------------------------- |
| `streamStartedAt`     | The first event to arrive on any run's stream.          |
| `streamErrorAt`       | The most recent published failure, as `{ at, kind }`.   |
| `interruptReceivedAt` | The first time the session held a pending interrupt.    |
| `interruptResolvedAt` | The most recent `resume` the session accepted.          |
| `threadCreatedAt`     | When the session created its own thread.                |
| `threadPersistedAt`   | The first history read that returned saved checkpoints. |
| `toolCallStartedAt`   | The first time the session held a tool call.            |
| `toolCallCompletedAt` | The first time a tool call was complete or failed.      |

A session serves one thread, so nothing is reset: where the Angular adapter
clears its `AgentLifecycle` on `switchThread()`, a session for another thread
starts again from null. `threadCreatedAt` stays null for a session that was
given a `threadId`. Interrupts and tool calls restored from saved history are
stamped when they are read, not when they first happened. The same failure
published again keeps its time; a different one, or one that returns after
clearing, is stamped again. The timestamps are kept apart from the snapshot, so
they never cause a transcript render, and they are neither stored nor sent.
Disposal releases every listener and later subscriptions are inert.

## Dynamic pauses

Every interrupt in the snapshot's `interrupts` has the `id` a response names: the
backend's id when it sent one, `breakpoint` for a static breakpoint, and the
position (`interrupt-0`) otherwise. The wire metadata stays alongside. Child
observations in `subgraphs` keep the wire shape, where `id` is optional.

`resume(responses)` is the core contract's command. Each response names one pending
interrupt and has the status `resolved`. With one interrupt pending, its response's
`value` is sent as the resume value, and a response with no value sends no command.
With several pending, the answered ones are sent as one map keyed by backend id, so
each needs an id the backend sent and a value; the others stay pending. `resume`
rejects without sending when a response names an interrupt that is not pending,
names one twice, or is `cancelled`: LangGraph has no cancelled response, so a
refusal is a value the graph reads.

Branch resume reads the exact retained pause before sending a decision. Task and
interrupt identities, payloads and unconsumed task results must match. Undefined
does not mean replay; pass an explicit defined response, including null where
appropriate. Static breakpoints and child execution are outside this capability.

On the locked interrupts backend (LangGraph 1.1.6 / API 0.7.96), a physically
successful run can be paused. Resuming the same consumed task again can reuse its
first decision even though checkpoint values and interrupt metadata still look
paused. The preflight detects already-observed consumption, but it is not an atomic
server claim. Applications must coordinate responders to the same task. Distinct
checkpoint branches do not provide independent opposing decisions on one task.

## Child agents

`snapshot.subgraphs` holds one entry for each child graph the run reported, with
its `namespace`, its own `messages` and `toolCalls`, its `state`, `interrupts`
and `error`. `snapshot.subagents` publishes the same children as the core
contract's child agents, one for each and in the same order, so a component
written for core sessions can show them:

- `id` is the namespace path as JSON, which stays unique whatever a segment
  contains. `parentId` is the `id` of the enclosing child graph, and is absent
  for a child of the root graph. `namespace` is kept alongside.
- `name` is the node that started the child: the part of the last namespace
  segment before its `:`.
- `messages` and `toolCalls` are the child graph's own, the same references as
  in `subgraphs`. The root `messages` and `toolCalls` do not repeat them.
- `status` is `error` for a child that failed, with the display text in
  `error`, and `running` while the root run is going. After the run, a child
  whose last message succeeded is `complete`, one a pause stopped is still
  `running` because a resume continues it, and any other child is `unknown`.
- A child the session related to the root tool call that started it carries
  that call's id as `toolCallId`, its task as `description`, and the requested
  subagent type as `name`. Once that call has a result the child is `complete`
  (or `error`), even while the root run continues.

### Relating a child to its tool call

`createSession({ subagentToolNames })` names the root tools that start a child
agent; the default is `['task']`, and an empty list relates nothing. A call
counts when its arguments carry a `subagent_type` (3 to 50 letters, digits,
`_` or `-`, starting with a letter). A child graph counts when the last segment
of its namespace is the only `tools:<task id>` segment in it. Plain subgraph
nodes and nested delegations are never related.

LangGraph does not put the tool call id on a child's namespace, so the relation
is established in this order and never changes once made:

1. the middleware's `threadplane.subagent_binding` custom event, which states
   it (`{ namespace: 'tools:<task id>', tool_call_id }`);
2. the child's first message is the `description` of one unrelated call, or
   contains or is contained in it;
3. exactly one unrelated call is still pending or running.

With several calls outstanding and nothing to tell them apart, a child stays
unrelated. `snapshot.subgraphs[].delegation` holds the relation
(`toolCallId`, `name`, `description`, `status`) and `snapshot.subagents`
publishes it. The tool call's own entry stays in `snapshot.toolCalls`.

A child agent keeps its reference while its child graph and status are
unchanged. Child agents give no command authority: answering a pause is the
root session's `resume`.

## Core contract members

The session produces the optional members of the core contract
(`@threadplane/core`, "What a session may also carry") with the core types.

- **Structured content.** A message whose wire content holds more than text
  (an image, an inline tool invocation, a tool result) carries `blocks`, the
  core `ContentBlock` list; `content` is still the text of its text blocks. A
  text-only message, however the backend split it, has no `blocks`. Chunks
  carry fragments, so blocks arrive with the full message.
  `submit({ message, blocks })` sends text and image blocks as the human
  message's content (`image` becomes `image_url`) and shows them on the user
  message; a tool
  block is rejected before anything is sent. `Message.extra` holds the wire
  fields the transcript does not otherwise publish (`additional_kwargs`,
  `response_metadata`, `usage_metadata`, `tool_calls`, a tool message's
  `status` and `artifact`), only on a session created with `rawMessages: true`.
- **Tool calls.** `snapshot.streamingToolCalls` lists the calls whose
  arguments the root model is still writing, from the message stream's tool
  call chunks: `argsText` as written and `args`, a best reading of it. A call
  leaves the list when its finalized form enters `toolCalls` under the same
  id, and nothing is left when the run settles. A child's are in
  `subagents[].streamingToolCalls`. A tool message with `status: 'error'`
  settles its call as `error`, with the message text as `error`, live and from
  history; a failed delegation therefore makes its child `error`. A tool
  message whose content is an array gives the call `parts`, that array.
- **Error diagnostics.** `snapshot.errorDiagnostic` describes what the
  published error was classified from, when the session read it: an error
  event the backend sent, a failure with an HTTP status, or a malformed
  response. It is absent for a failure reported in the session's own words (a
  dropped stream, a failed history read, a thread that could not be created)
  and always absent with a protected owned transport, which keeps failures
  generic.
- **Child agents.** `subagents[].state` is the child graph's state. The
  `pending` status is never reported: LangGraph names a child by a namespace
  that exists only once the child runs, so a child asked for and not yet
  started has no stable id to be listed under.
- **Refused input.** `snapshot.inputBlocked` is present, with a `reason` and a
  `message`, exactly while `submit` would reject: `tool-conflict` (a tool
  invocation identity conflict), `checkpoint` (a checkpoint branch with active
  or unsettled work), `unsettled-tools` (a tool whose result is unresolved)
  and `persisting-tools` (tool results being written). A pending interrupt
  does not block input here: a new message replaces the pause.
- **History.** `checkpoints` and `messageCheckpoints` are the core fields, on
  a session created with `historyState: true`: see "History with state".
  `messageCheckpoints` keeps the Angular agent's rule, the newest checkpoint
  whose assistant messages end with the message, which for a message followed
  by another turn is the checkpoint that already holds the next prompt.
- **Running without a message.** `runWithoutMessage`: see "A run with no
  input".
- **Resume options.** `resume(responses, { message, blocks, state })` sends a
  user message and a state update in the same request as the answers, in the
  resume command's `update`, merged over `run.command.update` (which must then
  be a record). The message is added to the transcript under the id that is
  sent, and the turn that follows is anchored on it.
- **Client tools.** A session created without a fixed `tools` map has
  `session.clientTools`. `setCatalog(specs)` replaces the catalog sent as
  `client_tools` with later runs. Once a catalog has been declared,
  `snapshot.pendingClientTools` lists the calls to declared tools that have no
  result, between runs only; each is the entry `toolCalls` lists.
  `settle(id, result)` records a result: the call shows it at once, and its
  tool message (`client-tool-result-<id>`) is staged. `flush()` writes the
  staged messages with `transport.updateState` without starting a run, keeps
  them staged when the write fails, and rejects without that method.
  `resolve(id, result)` settles and then starts a run without a message that
  carries the staged messages and the catalog. Each throws for an id that is
  not pending. A session with a fixed `tools` map runs its tools itself and
  has no `clientTools`.
- **Render-store updates.** A `custom` frame `{ name: 'state_update', data }`
  is delivered by `onCustomEvent` under that name, so the core helper
  `onAgentStateUpdate(session, listener)` follows it.

`snapshot.retainedRun` (formerly `snapshot.reconnect`) names the run
`reconnect()` can join. It was renamed so that a binding which exposes snapshot
fields and commands on one object can show both.

## Raw LangGraph data

The transcript in `snapshot.messages` is text and tool data. A view that needs
what LangGraph actually sent reads these backend fields, each absent until it
has something to hold:

- `snapshot.langGraphMessages`, on a session created with `rawMessages: true`:
  one wire record for each transcript message, in transcript order, owned and
  frozen. It is the newest record with that message id, so content blocks,
  `additional_kwargs`, `response_metadata`, `usage_metadata` and `tool_calls`
  are all there. A message still streaming is its latest chunk with `content`
  replaced by the text accumulated so far; a full message is never replaced by
  a late chunk. The user message a submit adds, and a message sent without an
  id, are given in wire shape from what the transcript holds. A history load
  replaces the records with the newest checkpoint's.
- `snapshot.messageMetadata`, with the same option: by message id, the
  `messages` stream metadata (`langgraph_node`, tags, model) of each root and
  child message that streamed.
- `langGraphToolCalls(messages)` pairs every tool call in such a transcript
  with its tool message: `{ id, call, result, aiMessage, index, state }`, with
  `state` `pending`, `completed`, or `error` when the tool message's `status`
  is `error`. `getToolCalls(aiMessage, messages)` returns one message's calls.
  Both are plain functions, so a binding can derive them from the snapshot.
- `snapshot.toolProgress`: what running tools reported through the `tools`
  stream mode, one entry for each tool (`toolCallId`, `name`, `state`,
  `input`, `data`, `result`, `error`), starting empty with every run. Owned
  streams do not request that mode, because older servers reject it: add it
  with `run: { streamMode: ['tools'] }`. With a protected owned transport the
  error is a generic text.
- `snapshot.usage`: the core contract's token usage for the command that just
  settled, one entry for each provider and model, from the `usage_metadata` of
  the assistant messages it produced. A full message's usage is its total and
  replaces what its chunks reported. Messages from earlier turns are never
  counted. It is absent while a run is going, after a stopped run, and when
  the backend reported none.

`lifecycle.threadCreatedAt` records when the session created its thread. It
stays null for a session that was given a `threadId`.

## Host options

These `createSession` options let a host (a framework binding, a development
tool) supply what the Angular agent used to build in. None changes the
contract; all are optional and inert when omitted.

- `initialValues`: the state `snapshot.state` holds until the backend reports
  one. It is copied and frozen, published without the `stateType` check, and
  never sent to the graph.
- `toMessage(message)`: converts each wire message before the session reads
  it, from stream events and saved checkpoints, for the root graph and child
  graphs. Return the plain wire shape (`type` or `role`, `id`, `content`,
  `tool_calls`, `tool_call_id`). A message it throws on is read as sent.
- `throttle`: the least time in milliseconds between two calls to a
  `subscribe` listener while a run streams. `getSnapshot()` is never delayed,
  the last change is always delivered, and a change that ends the run is
  delivered at once. Each listener is paced separately. Off when omitted,
  `false` or `0`; the Angular agent's default was 16.
- `a2uiClientCapabilities`: `{ supportedCatalogIds, inlineCatalogs? }`, sent
  with every run that has input under the `a2ui_client_capabilities` state
  key, where the middleware reads it. A run with no input carries nothing.
- `telemetry`: a sink called with `{ event, properties }`:
  `tplane:runtime_instance_created` once, then for each command
  `tplane:runtime_request_created` (with `requestType`: `submit`, `resume`,
  `continue`, `retry`, `reconnect`, `join`, `join_queued` or `enqueue`),
  `tplane:stream_started`, and `tplane:stream_ended` or
  `tplane:stream_errored` (with `durationMs`, and the error kind as
  `errorClass`). A stopped or replaced run reports no ending. The sink may be
  asynchronous and a failure in it is ignored. `false` turns it off.
- `onOperationFailure(code)`: told when the owned SDK transport's request was
  refused as `unauthorized` or failed as `network_blocked`. Supplying it also
  makes the owned transport report generic errors only. A supplied transport
  ignores it.
- `developmentRuntime`: a development-install collector with `touch()`,
  `milestone(kind, durationMs?)` and `dispose()`, or a factory that builds one.
  The session touches it at creation and for each command, reports
  `transport.connected` on a run's first event, `thread.persisted` when a
  history read restores messages, `runtime.first_stream_completed` (with the
  run's duration) when a run the backend served ends in `success`, and
  `interrupt.handled` when that run was a resume. A scripted run reports no
  completion. It is disposed with the session. A factory is called once with
  `{ integration, packageName, packageVersion, installationToken, enabled }`:
  what this package knows of its own installation. `installationToken` is the
  token the install step wrote and is read only in an Angular development
  build (`ngDevMode`); everywhere else it is `null`. `enabled()` is the session's
  `isDevelopmentRuntimeEnabled()`: true unless the session was given a
  `telemetry` option, `false` included, which is the rule the Angular agent
  had. The session itself builds no collector and sends nothing: without the
  option nothing is collected, which is what a React app gets. In Angular,
  `provideAgent` hands the factory to the session factory as
  `context.developmentRuntime`, so `createSession({ ...context })` is all an
  app writes; the collector comes from `@threadplane/chat`.
- `devtools`: a sink told which published fields each event changed, by name
  and never by value. `begin(type)` and `end()` bracket a stream event,
  `outside(label, run)` brackets a change no event caused (`run:start`,
  `run:end`, `history`, `queue`, `branch`), and `wrote(name)` is called inside
  the bracket with the Angular devtools vocabulary: `status`, `values`,
  `messages`, `error`, `interrupt`, `interrupts`, `branch`, `history`,
  `isThreadLoading`, `toolProgress`, `toolCalls`, `messageMetadata`,
  `subagents`, `queue` and `custom`.
- `scriptedRuns`: `{ take() }` returns an armed run of `{ event, data }`
  frames, or null. An armed run's frames are normalized as the owned transport
  normalizes the SDK's and streamed in place of the next new run. The backend
  never sees it: no request is made and no thread is created for it, it is
  never offered a status check, and it is taken once.

### Children restored from history

No child event replays when a thread is loaded, so by default a history load
publishes no child. With `restoreSubagents: true`, `load()` rebuilds the
tool-started children from what the saved thread records:

- the root transcript's delegation calls and their tool results, which give
  each child its `toolCallId`, `description`, `name` and a `complete` or
  `error` status;
- the checkpoints' pushed tasks, which link a call to the task that ran it and
  so to the child's `tools:<task id>` namespace. A finished task is linked by
  the tool message in its result; a task still outstanding in the newest
  checkpoint is linked by its send index and is `running`, or `error` when the
  task carries one;
- the child's own newest checkpoint under that namespace, read through the
  optional `transport.getChildState`, which fills `messages`, `toolCalls` and
  `state` shortly after the load resolves. LangGraph API 0.7.96 answers that
  read with HTTP 400 for a child agent started inside a tool, so against that
  backend a restored child has its relation and status and no transcript.

A restored child keeps the namespace a continued run streams under, so
resuming after a reload updates the same child. A call with a result but no
recorded task is restored with its call id in place of the task id and no
transcript. A call still pending with no recorded task is not shown, as during
a run before its child reports. A transcript is only accepted from the
requested namespace, never replaces messages a live stream delivered first, and
a failed read leaves the child with its status. Plain subgraph nodes and
nested delegations are not rebuilt: history does not link them to a tool call.

## Automatic history load

Creating a session makes no request. With `autoLoad: true`, a session that has
a `threadId` and a transport that can read history calls `load()` on the next
microtask, unless the application issued a command first. On such a session
`snapshot.loading` is `true` while any history read is in flight, automatic or
explicit, and absent otherwise. A failed read, automatic or explicit, is
published as a `server` error with no recovery ("The conversation could not be
loaded."); an explicit `load()` also rejects. Nothing loaded is replaced, what
was thrown stays out of the snapshot, and the next successful read clears the
error.

## Thread directory

`createLangGraphThreadDirectory` in `thread-directory.ts` implements the
`ThreadDirectory` contract from `@threadplane/core` for a deployment's saved
conversations, and backs the React `ThreadSidebar`. It is a store with
`getSnapshot` and `subscribe`, so a framework binding observes it the same way
it observes a session. Pass `apiUrl` (with optional `clientOptions`) to have it
build its own protected SDK client with `maxRetries: 0`, or `client` to reuse an
existing one. With `browserOrigin`, a cross-origin `apiUrl` is rejected.

An entry is read from thread metadata: `title` (trimmed, else `titleFallback`,
default "New chat"), `archived`, `pinned`, `pinnedOrder` and `projectId`.
`threads` holds the active conversations, pinned ones first in their saved
order; `archived` holds the rest. Nothing is read until `refresh()` is called.
A failed read never rejects: it is published as `status: 'error'` and the lists
keep the last successful result. `status` is `'loading'` only until the first
successful read or while recovering from an error.

Mutations (`create`, `rename`, `remove`, `setArchived`, `setPinned`,
`reorderPinned`, `setProject`) apply optimistically, roll back and reject with a
safe error on failure, and confirm with a later read. A read that started before
a mutation settled never undoes it, and error bodies are never read.

Project names live in the LangGraph Store (`project-store.ts`), namespace
`['threadplane', 'projects']`, one item per project with value `{ name }`. Pass
`projects: false` to turn them off. When the Store API is unavailable, threads
still list and `projects` is absent.

The shared suite in `testing/thread-directory-conformance.ts` runs against this
directory. Limits: one page
of 50 conversations, no paging or search, and no refresh when another tab
changes a thread; `refreshDirectoryOnRunEnd` refreshes after each run.

## Verification

Run `langgraph:test` and `langgraph:type-tests` (`runtime-quality` and
`runtime-type-tests` are aliases of the two). `core-conformance.spec.ts` runs the core contract's
session, history and interrupt conformance suites against this session.

`npx nx run langgraph:runtime-live` runs the live-backend suite in
`libs/langgraph/live`: real sessions on the owned SDK transport against real
`langgraph dev` processes for the cockpit graphs, with the model replaced by
recorded fixtures. It needs `uv`, Python 3.12 and the `langgraph` CLI, and
starts one backend at a time. It covers `transcriptNodeNames`, child agents and
their relation to tool calls, `restoreSubagents`, history with state,
`messageCheckpoints`, a run from a checkpoint, `setBranch`, run settings,
queueing, `joinStream`, `autoLoad`, interrupts and `resume` with a state and a
message, client tools, and the core members described below. Further server
coverage lives in the client-tools and interrupts cockpit
`checkpoint-session.spec.ts` files; adjacent protocol tests
characterize the locked SDK/backend behavior. Installed Angular/React consumers
verify shared ownership and lifecycle regressions separately. No replay API,
branch-tree UI or cross-client lease is implied.
