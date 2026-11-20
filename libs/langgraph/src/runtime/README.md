# Private LangGraph session development

This directory stages the framework-independent session owner. It is not the
published LangGraph package entry point. Core and framework bindings do not own
backend execution positions.

The test-only candidate proof emits this real factory and its complete local
JavaScript/declaration graph, installs a private local tarball, and runs plain
Node plus both full framework consumer suites. Run
`node scripts/react-parity/verify-langgraph-candidate.mjs` after the foundation
builds. Commands, frozen manual review and dependency/type limitations are in
[`fixtures/react-parity/langgraph-candidate/README.md`](../../../../fixtures/react-parity/langgraph-candidate/README.md).
This does not change the published package root or narrow the current custom
transport declaration into a final public contract.

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

- `snapshot.checkpoints`: the page, newest first. Each entry has the checkpoint
  `id`, a `label` (the first node it would run next), its `values` (the saved
  graph state, `messages` included) and `saved`, the checkpoint as the backend
  sent it.
- `snapshot.messageCheckpoints`: a record from an assistant message id to the
  id of the newest checkpoint whose assistant messages end with it. Checkpoints
  without an id are skipped.
- `snapshot.branchTree`: the page arranged by parent checkpoint. A `sequence`
  holds `node` items and, where a checkpoint has several children, a `fork`
  whose `items` are the alternative sequences, newest first. A node's `value`
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
checkpoints, oldest first, following the newest continuation at any fork the
branch does not name.

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

`cancelQueued(runId)` removes one run and `clearQueue()` removes all, each
asking the backend to cancel through `transport.cancelRun`; the removed
submissions resolve `'aborted'`. `stop()` does the same for the whole queue.
`dispose()` resolves them `'aborted'` without cancelling anything. Queueing
needs an existing thread and both transport methods, and rejects otherwise; a
failed queue request rejects with a safe error and leaves the active run
alone. With nothing running, an `enqueue` submission starts at once and passes
the strategy to the backend.

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

`snapshot.reconnect` and `session.reconnect()` are LangGraph-specific extensions,
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
The interruption copy is a bounded duplicate of `AGENT_RECOVERY_MESSAGES` and
`AGENT_RECOVERY_DETAILS` from `@threadplane/chat`, which this neutral graph cannot
import; `runtime-recovery-copy.spec.ts` under the Angular test target fails when
they drift.

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
| `threadPersistedAt`   | The first history read that returned saved checkpoints. |
| `toolCallStartedAt`   | The first time the session held a tool call.            |
| `toolCallCompletedAt` | The first time a tool call was complete or failed.      |

A session serves one thread, so nothing is reset: where the Angular adapter
clears its `AgentLifecycle` on `switchThread()`, a session for another thread
starts again from null. There is no `threadCreatedAt`, because a session never
creates its thread. Interrupts and tool calls restored from saved history are
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
directory and the Angular `LangGraphThreadsAdapter.directory`. Limits: one page
of 50 conversations, no paging or search, and no refresh when another tab
changes a thread; `refreshDirectoryOnRunEnd` refreshes after each run.

## Verification

Run `langgraph:runtime-quality`, `langgraph:runtime-type-tests` and
`langgraph:type-tests`. Actual server coverage lives in the client-tools and
interrupts cockpit `checkpoint-session.spec.ts` files; adjacent protocol tests
characterize the locked SDK/backend behavior. Installed Angular/React consumers
verify shared ownership and lifecycle regressions separately. No replay API,
branch-tree UI, cross-client lease, public package migration or release is implied.
