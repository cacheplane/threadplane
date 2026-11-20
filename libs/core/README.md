# @threadplane/core

Private, unpublished agent contracts for the shared runtime work. The root exports
readonly text messages and citations, delivery outcomes, plain error projections, authored tool
call types, snapshots and the minimal session interface. This package implements
delivery constructors and error projection, not an execution owner or public store.

`@threadplane/core/tools` exports optional authored `FunctionTool<Args, Result>`,
minimal signal-based execution context, catalog inference, and a structural
acquire/settle invocation-ownership contract. `@threadplane/core/testing` exports
`createFakeAgentSession`, a transport-free session whose test controls publish frozen
snapshots, stream assistant text and record submit, stop and dispose calls, and the
session conformance suites described under "Testing a session" below.

Sessions accept text, optionally with a partial state, and an optional standard `AbortSignal`. Read and subscribe are
inert; subscribe notifies changes only. Implementations must publish owned, deeply
readonly plain snapshot data and keep references stable between changes. Raw errors,
causes, controllers and SDK instances belong to effect boundaries.
`projectAgentError` copies already classified display fields; it does not classify
transport failures. Tool failures carry a plain error string instead.

`AgentSession<TTools, TState>` carries an optional application state type. The
snapshot's `state` is deeply readonly, and absent until the backend reports one. A
session is told its state type by one declaration: `type<T>()` for the type alone, or
any Standard Schema value, such as a Zod object, to also check each state as it
arrives. `InferState` reads the type from either form. `type<T>()` rejects functions,
class instances, arrays and primitives with a sentence naming the problem. A typed
session is still assignable wherever an untyped `AgentSession` is expected, and
without a declaration `state` is plain data.

`submit` takes the message text, or `{ message, state }` where `state` is a partial
state the backend merges before the run: the declared keys for a typed session, any
plain record otherwise. `readState(declaration, value)` is for session
implementations. It returns the schema's output or the issue messages, never throws,
and treats a schema that validates asynchronously as invalid because a snapshot is
published synchronously. This package defines the contract; whether a backend session
supplies `state` is that session's choice.

A run that pauses for a person settles with the `'paused'` outcome and lists what it
waits on in the snapshot's `interrupts`. Each `AgentInterrupt` has an `id`, and may
carry the backend's `value`, a `reason`, display `message` and the `toolCallId` it is
about. `resume(responses)` answers them: each `AgentInterruptResponse` names one
pending interrupt and is `resolved`, optionally with a `value`, or `cancelled`. A
session rejects a response that names an interrupt that is not pending, names one
twice, or uses a status its backend cannot express. `interrupts` and `resume` are
optional: a session that cannot pause supplies neither.

The snapshot's optional `subagents` lists the child agents the root agent started, in
start order. An `AgentSubagent` has an `id`, a `status` of `running`, `complete`,
`error` or `unknown`, and its own `messages` and `toolCalls`, which are not repeated
in the root transcript. `unknown` means the child started, no ending was seen, and
no run is active that could still report one. `toolCallId` relates a child to the
root tool call that started it, and `parentId` to the child that did. The fake
session in `@threadplane/core/testing` publishes both fields and records `resume`
calls.

`Message.citations` optionally contains readonly `Citation` source metadata: stable
IDs/order, title, URL, snippet, source type, icon URL, primitive publication time,
and deeply readonly plain provider extras. These strings are authored display data;
they do not certify source accuracy or safe HTML/navigation. No URL is fetched or
footnote resolved. Date instances, SDK objects and functions are outside this
portable contract.

`Message.reasoning` is optional readonly backend-supplied display text. An explicit
empty string is distinct from absent data. It is not inferred from answer text,
an execution signal, a duration measurement, or a content block.

`Message.reasoningDurationMs` is the optional measured length of that reasoning in
milliseconds. A session sets it only when it measured the reasoning; absent means
unknown, and views must not show a time for it.

Tool contracts pair authored TypeScript argument/result types by name, including
ordinary interfaces. Pending calls have decoded, finalized arguments awaiting
execution; partial streamed arguments are not exposed as authored types (see
`streamingToolCalls` below). `void`
arguments/results appear as `undefined`. Tool values support plain primitives,
objects and arrays. Schema validation belongs to consumers and their chosen libraries;
there is no inference from schemas, runtime argument conversion or execution registry.
Function tools may carry caller-authored JSON Schema in `parameters`; it is metadata
only. Handlers may return promises or void and receive isolated mutable arguments.
The optional guard binds a stable thread/tool-call key to the exact invocation and
one owner token before handlers. Only that owner settles; observers reuse only exact
encoded completions. Results that cannot survive a whole-envelope JSON round trip
remain exact locally and store a non-reusable null marker. Different invocations
conflict; executing, legacy, malformed, and non-reusable completions fail closed.
Tools marked `idempotent: true` bypass durable storage but retain local identity checks.
There is no takeover, lease, automatic retry, or graph-delivery receipt inference.
This is an unreleased source-tree protocol change; old claim/record providers are
rejected at construction. The legacy chat execution guard remains separate.

The private LangGraph development session captures a fixed catalog and store at
construction. Its submit attempt owns tool execution and allows at most ten
automatic continuation groups per explicit user turn. `followUp: false` persists
results without another run. Stop/dispose settle local ownership promptly; required
owned cancellation cleanup and already-started durable writes may finish without publishing or
continuing. Failed handoffs retain stable tool-result messages for the next explicit
submission. Reading, subscribing and checking history never start tools.

Typed catalog sessions expose registered client calls. Already server-settled calls
are represented by raw ToolMessages in the transcript unless an authored local or
durable result is available: wire strings cannot recover arbitrary result types.
Sessions without a catalog retain the broad plain-data tool observation contract.

## What a session may also carry

Every member in this section is optional. A session that leaves one out is still a
valid session, and a view offers no control for a command that is undefined.

**Structured content.** `Message.content` is always text. `Message.blocks` holds the
same message as `ContentBlock` values (`text`, `image`, `tool_use`, `tool_result`) when
the backend sent, or the caller submitted, more than text; `content` is then the text
of the `text` blocks, which `contentBlocksText(blocks)` computes. `submit` accepts
`{ message, blocks }` to send blocks. `Message.extra` holds backend-specific extras as
plain data; portable code does not rely on its shape.

**Tool calls.** A finished call may carry `parts`, the structured parts of its result,
beside the `result` or `error` text. A call whose arguments the model is still writing
is not a `ToolCall`: it is listed in the snapshot's `streamingToolCalls` as a
`StreamingToolCall` with the argument text so far in `argsText` and, when the session
parses partial JSON, a best-effort `args`. Once the arguments are final it leaves that
list and enters `toolCalls` under the same `id`.

**Error diagnostics.** `AgentError.diagnostic` describes what a failure was classified
from as an `AgentErrorDiagnostic`: `name`, `message`, `stack`, `code`, `status`,
further plain `data`, and a nested `cause` described the same way.
`projectErrorDiagnostic(thrown)` builds one from any thrown value, replacing
functions, class instances and cycles with short text. It is for logs and debug views;
a view shows `message` and `detail`. The thrown value itself is never held.

**Child agents.** `AgentSubagent.state` is the child's own state as plain data, and
`AgentSubagent.streamingToolCalls` its calls still being written.

**Interrupts.** `AgentInterrupt.resumable` is `false` for an interrupt the session can
show and cannot answer. `resume(responses, options)` accepts `message`, `blocks` and
`state` in its options to send a user message and a state update in the same request
as the answers.

**Running without a message.** `run({ state })` runs the agent on the conversation as
it stands, appending no user message, after merging the state when given. `submit`
always carries a message.

**Refused input.** `snapshot.inputBlocked` is present, with a `reason` and an optional
display `message`, while the session refuses ordinary submissions. A view disables its
composer; commands that clear the block, such as `resume`, stay available.

**History.** `snapshot.checkpoints` lists the saved history the session last loaded,
oldest first. Each `AgentCheckpoint` has the backend's `id`, a display `label`, and the
state `values` at that point. `snapshot.messageCheckpoints` maps an assistant message
`id` to the `id` of the checkpoint that first held it. `checkStatus` and `usage` are
described on the session and snapshot types.

**Client tools.** `session.clientTools` is the capability for tools the caller declares
and runs itself after the session exists. `setCatalog(specs)` replaces the catalog sent
with later runs; each `ClientToolSpec` is a name, a description and a JSON Schema. The
calls that wait for a result are in `snapshot.pendingClientTools`. `resolve(id, result)`
records a `ClientToolResult` and continues the run; the optional `settle(id, result)`
records one without continuing, and the optional `flush()` makes settled results
durable on the backend.

**Render-store updates.** A backend that feeds a generated-UI render store sends custom
events named `state_update` whose data maps render-store paths to values.
`onAgentStateUpdate(session, listener)` follows them over `onCustomEvent`, and
`agentStateUpdateFromEvent(event)` reads one event. They are events, not state: nothing
replays the ones sent before the listener was added.

## Testing a session

`createFakeAgentSession` carries `resume` always and the other optional members only
when asked, through `commands: ['run', 'regenerate', 'retry', 'checkStatus',
'onCustomEvent', 'clientTools']` or by passing `onRun`, `onRegenerate`, `onRetry` or
`onCheckStatus`. It records every call (`submits`, `resumes`, `runs`, `regenerates`,
`retryCount`, `checkStatusCount`, `catalogs`, `clientToolResults`, `flushCount`), and
its controls publish every snapshot field, including `setUsage`, `setCheckpoints` and
`emitCustomEvent`. `retry` calls again whichever handler last rejected.
`stream().appendReasoning(text)` adds reasoning and measures its duration.

Three conformance suites check any `AgentSession`. They import no test framework; pass
the runner's `describe` and `it`:

```ts
import { describe, it } from 'vitest';
import { runAgentSessionConformance } from '@threadplane/core/testing';

runAgentSessionConformance('my runtime', () => createSession(options), {
  describe,
  it,
});
```

- `runAgentSessionConformance(label, factory, runner)`: the required members, the
  snapshot's shape, stability and freezing, subscription and disposal.
- `runAgentSessionHistoryConformance(label, factory, runner)`: the base checks, then
  that a session seeded with `historyConformanceCheckpoints()` publishes them in order
  with their state values.
- `runInterruptConformance(label, harnessFactory, runner, { restoration })`: the whole
  paused batch is listed while idle, answers travel with a state update and a message
  in one request, a failed resume is retried unchanged, `stop` leaves the backend pause
  alone, and late delivery is applied while live and ignored after disposal. The
  harness drives the pause and the failure through the real session.

Each has a `...Scenarios` form that returns the checks as a map of named functions, for
runners without `describe` and `it`. `reasoningFixture()` describes a reply that
reasons and then answers, without a wire format; a runtime translates its events,
runs them through a real session and passes the messages to
`assertReasoningFixtureMessages`.

Core has no implementation dependencies. TypeScript consumers need standard platform
signal declarations (for example `lib: ["ES2022", "DOM"]`); loading those declarations
does not introduce browser imports or runtime effects.

Verify with `npx nx test core`, `npx nx run core:type-tests` and `npx nx build core`.
Packaging and dependency boundaries are
verified by the scripts in `scripts/react-parity`. Optional and testing entry
points must remain unreachable from the root runtime and declarations.
