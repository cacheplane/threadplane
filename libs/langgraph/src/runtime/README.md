# Private LangGraph session development

This directory stages the framework-independent session owner. It is not the
published LangGraph package entry point. Core and framework bindings do not own
backend execution positions.

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
