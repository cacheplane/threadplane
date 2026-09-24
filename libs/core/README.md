# @threadplane/core

Private, unpublished agent contracts for the shared runtime work. The root exports
readonly text messages and citations, delivery outcomes, plain error projections, authored tool
call types, snapshots and the minimal session interface. This package implements
delivery constructors and error projection, not an execution owner or public store.

`@threadplane/core/tools` exports optional authored `FunctionTool<Args, Result>`,
minimal signal-based execution context, catalog inference, and a structural
acquire/settle invocation-ownership contract. `@threadplane/core/testing` is reserved.

Sessions accept text and an optional standard `AbortSignal`. Read and subscribe are
inert; subscribe notifies changes only. Implementations must publish owned, deeply
readonly plain snapshot data and keep references stable between changes. Raw errors,
causes, controllers, SDK instances and arbitrary extras belong to effect boundaries.
`projectAgentError` copies already classified display fields; it does not classify
transport failures. Tool failures carry a plain error string instead.

`Message.citations` optionally contains readonly `Citation` source metadata: stable
IDs/order, title, URL, snippet, source type, icon URL, primitive publication time,
and deeply readonly plain provider extras. These strings are authored display data;
they do not certify source accuracy or safe HTML/navigation. No URL is fetched or
footnote resolved. Date instances, SDK objects and functions are outside this
portable contract.

`Message.reasoning` is optional readonly backend-supplied display text. An explicit
empty string is distinct from absent data. It is not inferred from answer text,
an execution signal, a duration measurement, or a rich content block model.

Tool contracts pair authored TypeScript argument/result types by name, including
ordinary interfaces. Pending calls have decoded, finalized arguments awaiting
execution; partial streamed arguments are not exposed as authored types. `void`
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

Core has no implementation dependencies. TypeScript consumers need standard platform
signal declarations (for example `lib: ["ES2022", "DOM"]`); loading those declarations
does not introduce browser imports or runtime effects.

Verify with `npx nx test core`, `npx nx run core:type-tests` and `npx nx build core`.
Packaging and dependency boundaries are
verified by the scripts in `scripts/react-parity`. Optional and testing entry
points must remain unreachable from the root runtime and declarations.
