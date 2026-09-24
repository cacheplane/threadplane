# Private LangGraph session development

This directory stages the framework-independent session owner. It is not the
published LangGraph package entry point. Core and framework bindings do not own
backend execution positions.

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
delivery. Rich blocks, reasoning timing, event render state and citation components
remain separate future capabilities.

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
or clock map. No timing, rich-block, renderer, event-only retention, provider-version
conformance or complete T09/T15 parity is claimed. Strict checkpoint capture still
rejects non-plain/cyclic data before display normalization. Reasoning never changes
tool admission, checkpoint authority, transport requests or lifecycle scheduling.

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

## Dynamic pauses

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

## Verification

Run `langgraph:runtime-quality`, `langgraph:runtime-type-tests` and
`langgraph:type-tests`. Actual server coverage lives in the client-tools and
interrupts cockpit `checkpoint-session.spec.ts` files; adjacent protocol tests
characterize the locked SDK/backend behavior. Installed Angular/React consumers
verify shared ownership and lifecycle regressions separately. No replay API,
branch-tree UI, cross-client lease, public package migration or release is implied.
