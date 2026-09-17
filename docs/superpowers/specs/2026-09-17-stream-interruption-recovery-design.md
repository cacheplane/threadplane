# An unexpectedly closed stream is reported as an interruption, with recovery scoped to what the adapter can prove

**Date:** 2026-09-17
**Status:** Design approved; not implemented
**Branch:** `blove/stream-interruptions-recovery-e6e202`
**Predecessor:** the session handoff `2026-09-15-stream-interruption-recovery.md` (uncommitted, in another worktree). This spec supersedes it.

## 1. Why

When an agent stream closes without the adapter's own terminal evidence, neither adapter says so.

**AG-UI** settles a silently closed stream in `settleTransportClose` (`libs/ag-ui/src/lib/to-agent.ts`). A run that owns assistant messages finalizes as `interrupted`; a run that owns none finalizes as `success`. Either way the active run returns to `idle`, `isLoading` goes false, and `store.error` is cleared. A truncated HTTP 200 stream that carried only `RUN_STARTED` is therefore indistinguishable from a clean finish: the composer re-enables and no error is shown. The preceding session confirmed this shape directly, by intercepting a production stream so it emitted `RUN_STARTED` and nothing else.

**LangGraph** is closer but makes the same inference in the other direction. `finishOutcome` (`libs/langgraph/src/lib/internals/stream-manager.bridge.ts`) returns the recorded terminal outcome when there is one, and otherwise returns `success` when the current step has terminal evidence **or no assistant chunk was ever seen**. The second half of that disjunction is the gap: a stream that dies before its first chunk is reported as a completed turn. `finalizeClosedAttempt` already refreshes thread history at exactly the moment we would want to consult it, but it computes the outcome *before* the refresh and does not read the refreshed state back into that decision.

**The shared layer** has one error kind for all of this. `AgentErrorKind` includes `interrupted`, documented as retryable, and `chat-error.component.ts` renders a Retry button whenever `err.retryable` is true. So every interruption that does surface offers the same action, including interruptions where the request may already have executed a tool or committed a reservation on the server. That is the unsafe case: a dropped confirmation is not proof that nothing happened.

**What this is not.** A connection that stays open but stops producing events is out of scope. Detecting that requires timeout rules that would have to distinguish a slow model or a slow tool from a dead stream, and getting those wrong turns normal latency into a false failure. This version treats only streams that actually close.

## 2. Decisions this spec rests on

Accepted during brainstorming, recorded here so implementation does not relitigate them:

1. **Recovery controls, not just detection.** Offer an action the adapter can justify: retry only when the request is known not to have been dispatched, a read-only status check where the backend supports one, and a plain explanation of uncertainty where it does not. Never automatically replay an uncertain tool action or approval.
2. **Scope is unexpectedly closed streams.** Open-but-silent connections are deferred.
3. **One automatic read-only check.** Where the backend supports a read-only check, the adapter makes it once, automatically, before publishing the error. A manual action remains available when the automatic check is unsupported or fails. Never resubmit the operation, and never poll.
4. **Protocol-specific evidence.** AG-UI's event requirements do not apply to LangGraph and vice versa. A closed stream alone never establishes an invalid API key, and never proves server-side work failed.

Intended behavior across the situations that reach this code:

| Situation | Behavior |
| --- | --- |
| Confirmed completion | Finish normally |
| Valid approval pause | Preserve approval state; no interruption error |
| User presses Stop | Stop normally; no interruption error |
| Unexpected close | Preserve partial content and surface an interruption error |
| Request known not dispatched | Offer Retry |
| Outcome uncertain, check supported | Offer Check status |
| Outcome uncertain, check unsupported | Explain the uncertainty; offer no action |

## 3. Section 1: what counts as an unexpected close

A close is unexpected when the stream ends without the adapter's own terminal evidence and without a user Stop. Each adapter judges this by its own protocol.

### 3.1 AG-UI

Terminal evidence is `RUN_FINISHED` carrying a valid outcome, or `RUN_ERROR`. The existing validity check (`hasValidFinishedOutcome`) is unchanged, as is the existing treatment of an `interrupt`-typed outcome as an approval pause.

`settleTransportClose` changes in one way: a close with neither form of terminal evidence is **always** an interruption. The run finalizes as `interrupted` regardless of whether it owns messages, partial content stays in the message list, and `store.error` is set to an interrupted `AgentError` rather than cleared. Status goes to `error`, not `idle`.

Unchanged: a close after a valid `RUN_FINISHED` (including an `interrupt` outcome) settles normally; `abortRun` still settles a user Stop as `aborted` with the error cleared; explicitly thrown failures still flow through `failRun` and keep their existing `auth` / `server` / `connection` classification. Run ownership, generation tracking, and stale-event suppression are untouched.

### 3.2 LangGraph

Terminal evidence is the root completion event for the current step (`currentStepHasTerminalEvidence` / `rootTerminalEvidence`).

`finishOutcome` drops the `|| !attempt.sawAssistantChunk` clause. A close with no terminal evidence is `interrupted` whether or not a chunk arrived. The recorded `terminalOutcome` still wins when one exists, so a thread interrupt in state still settles as paused and a user abort still settles as `aborted`.

The explicit-error paths that already read `attempt.sawAssistantChunk ? 'interrupted' : 'error'` keep that distinction. Those cases have a real error object to classify; the inference problem is specific to a silent close.

## 4. Section 2: the automatic check and its conclusions

The check runs **inside the adapter**, exactly once, before the interrupted error is published. It issues only read-only calls that already exist in the transport surface. It never resubmits.

### 4.1 LangGraph

`finalizeClosedAttempt` already calls `refreshHistory` at this point. The change is to compute the outcome *after* the refresh and read its result rather than assume:

| Refreshed state | Outcome |
| --- | --- |
| No pending interrupt, and a new assistant turn attributable to this attempt | `success` |
| Pending interrupt present | paused, via the existing interrupt path |
| Neither, or the refresh threw | `interrupted`, `recovery: 'check'` |

`recovery: 'check'` rather than `'none'` even on a failed refresh, because the transport *does* support the read: the user can ask again when connectivity returns.

### 4.2 AG-UI

AG-UI has no universal run-status API. `reconcileInterrupt` is interrupt-specific, requires a configured `AgUiInterruptPersistence` with a `reconcile` callback, and refuses to run while a request is active. It is the only read-only authority available, and it describes resume attempts.

So the recovery value depends on both what was dispatched and whether a reconciler exists:

| Close happened | Reconciler configured | Recovery |
| --- | --- | --- |
| Before any event, on an ordinary submit | either | `retry` |
| After `RUN_STARTED`, on an ordinary submit | either | `none` |
| On a client-tool continuation | either | `none` |
| On a resume attempt carrying an interrupt decision | yes | `check` |
| On a resume attempt carrying an interrupt decision | no | `none` |

`retry` is safe in the first row only. The request never reached the server, and the existing `retry()` already restores the pre-run snapshot and re-runs without appending a duplicate user message. Every other row may have executed server-side work.

A client-tool continuation gets `none` for the same reason as an ordinary submit: it carries no interrupt decision, so the reconciler has nothing correlated to report on.

`check` is offered for resume attempts only, and this is narrower than it first appears. The reconciler's whole vocabulary is the interrupt session: its statuses are `pending`, `acknowledged`, `completed` and `unknown`, and the validation in `InterruptPersistence` ties each of them to a session phase and a correlated resume attempt. It has nothing authoritative to say about an ordinary turn that carried no interrupt. `InterruptPersistence.reconcile()` also returns `null` outright, without calling the backend at all, when no record has been persisted for the thread. Offering a status check on an ordinary submit would therefore either ask a question the backend cannot answer or make no call whatsoever, and in both cases the button would be a lie. An ordinary submit that was dispatched and then truncated gets `none`, with a `detail` sentence saying the outcome could not be confirmed.

When a reconciler exists, the automatic check calls `InterruptPersistence.reconcile()` once. That wrapper takes no arguments, validates the authoritative answer, writes it, and returns the updated thread record; it **throws** when the backend answers `unknown` or when the answer fails validation. The raw four-value status is therefore not visible to the caller, so the outcome is read from the session phase of the returned record:

| Session phase after reconcile | Outcome |
| --- | --- |
| `none` | `success` — the run finished and nothing is pending |
| `pending` | paused — a pending interrupt batch, rendered by the existing interrupt panel |
| `acknowledged` | `interrupted`, `recovery: 'check'` |
| any other phase, or the call threw | `interrupted`, `recovery: 'check'` |

`acknowledged` means the server received the resume and started it, not that it finished, so it stays uncertain. The uncertain rows keep `recovery: 'check'` so the user can ask again later.

The automatic call happens after the run has settled, because `reconcileInterrupt` refuses to run during an active request, and it is guarded by the staleness rule below. It reuses the existing `reconciling` gate so a manual and an automatic check cannot overlap.

### 4.3 Staleness

A check result is applied only when the run it belongs to is still the active run and no newer submit has started. A resolved-too-late check must not write to the store, must not clear a newer error, and must not overwrite a newer thread. The `checkStatus` action refuses while a request is in flight, matching the existing `reconcileInterrupt` guard.

## 5. Section 3: error shape and UI

### 5.1 AgentError

Two optional fields, set by adapters through the existing `toAgentError` projection:

- `recovery?: 'retry' | 'check' | 'none'` — absent on every non-`interrupted` error, so `auth`, `server`, `connection` and `aborted` are entirely unchanged.
- `detail?: string` — a short sentence explaining uncertainty. Set only when `recovery` is `check` or `none`.

`retryable` stays on the class. For `interrupted` errors it now derives from `recovery === 'retry'`. **This is a behavior change:** today every interruption renders Retry, and after this an interruption with uncertain dispatch does not. That is the intended consequence of decision 1. The repository ships breaking changes as patch releases at `0.0.x`, so no version-range gymnastics are required, but the change belongs in the release notes and in the `AgentErrorKind` documentation, which currently states flatly that `interrupted` is retryable.

`AGENT_ERROR_MESSAGES` is unchanged: its `interrupted` entry stays as the fallback for callers that construct an interrupted error without a recovery value. A second exported record, keyed by recovery value, supplies the specific copy that adapters use:

| Recovery | Message |
| --- | --- |
| `retry` | The response was interrupted before it started. Try again. |
| `check` | The connection dropped. The request may still have completed on the server. |
| `none` | The connection dropped. We could not confirm whether the request completed. |

### 5.2 Agent contract

Add one optional member, following the same optional-capability pattern as `interrupt` and `clientTools`:

```ts
/** Optional read-only reconciliation of an uncertain run outcome. Never resubmits. */
checkStatus?: () => Promise<void>;
```

Absent when the runtime cannot verify anything. LangGraph exposes it whenever the transport implements `getHistory`. AG-UI exposes it whenever a persistence reconciler is configured. A caller discovers the capability by presence, which is how every other optional surface in this contract is discovered.

### 5.3 Error component

`chat-error.component.ts` gains one branch over the current single Retry condition:

- `recovery === 'retry'` → Retry button, wired to `agent().retry()` as today.
- `recovery === 'check'` and `agent().checkStatus` present → Check status button.
- otherwise → the `detail` text, no button.

Non-interrupted errors keep rendering Retry from `retryable`, unchanged. Partial assistant content stays in the message list in every branch; nothing here rolls back a message.

## 6. Section 4: verification

### 6.1 Unit coverage

Every case here is a transport boundary condition, not a model behavior, so deterministic unit tests are the primary evidence.

**AG-UI**, extending the existing spec family (`to-agent.spec.ts`, `to-agent.interrupt-lifecycle.spec.ts`, `to-agent.interrupt-restoration.spec.ts`, `to-agent.resume-wire.spec.ts`, `to-agent.conformance.spec.ts`): truncation with only `RUN_STARTED`; truncation after partial text; truncation during a tool call; truncation of a resume attempt with and without a reconciler; valid `RUN_FINISHED`; valid interrupt pause; `RUN_ERROR`; user Stop. Each asserts run outcome, error kind, `recovery`, and that partial messages survive.

**LangGraph**, extending `stream-manager.bridge.spec.ts`: close with no chunks; close after chunks; close where the history refresh then shows a completed turn; close where it shows a pending interrupt; close where the refresh itself throws; and the same on the join and reconnect paths, which invoke this machinery separately.

**Shared chat:** projection tests for the two new fields, and component tests for the three render branches.

**Staleness:** on both adapters, a check that resolves after a newer submit must not write to the store. This is the case most likely to regress silently, so it gets an explicit test rather than being folded into another case.

### 6.2 Mutation check

This repository has a documented history of interrupt tests that pass vacuously. Before any completion claim, invert each new assertion once and confirm it fails. A suite that passes both with and against the change is not evidence.

### 6.3 Live verification

The five live canaries in `apps/website/e2e/platform-production-smoke.spec.ts`, merged in #1098, remain the end-to-end proof that legitimate approval flows still complete. Run them unchanged:

```sh
PRODUCTION_SMOKE=true BASE_URL=https://threadplane.ai NX_DAEMON=false npx nx e2e website --testFiles=apps/website/e2e/platform-production-smoke.spec.ts --workers=2 --skip-nx-cache
```

Add Chrome MCP walkthroughs of an induced truncation on the AG-UI and LangGraph demos, confirming the error appears, the correct control renders, and partial content stays on screen. Simulate truncation at the transport boundary; do not use aimock fixtures for the truncation itself, since replay is close to atomic and will not reproduce a mid-stream close.

### 6.4 Documentation

If the public contract changes as specified, the `AgentErrorKind` documentation, the `retry()` documentation on the Agent contract, and the AG-UI and LangGraph interrupt guides need review for the new `retryable` semantics. Regenerate API docs for the new exported members.

## 7. Out of scope

- Open-but-silent connections and any timeout rule.
- Polling or repeated status checks.
- A universal run-status API for AG-UI.
- Any rollback of server-side side effects on a local connection failure.
- Key rotation or provider-credential work; the earlier production incident was corrected separately.
