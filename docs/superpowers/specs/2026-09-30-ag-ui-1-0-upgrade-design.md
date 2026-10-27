# Upgrade to AG-UI 1.0.x: cut the TypeScript client over, adopt the 1.0 surface, then move the Python runtimes

**Date:** 2026-09-30
**Status:** Design approved; not implemented
**Branch:** `blove/ag-ui-upgrade-plan-d90659`

## 1. Why

AG-UI 1.0.0 shipped on 2026-09-17 and 1.0.1 on 2026-09-29. This repo pins `@ag-ui/client` and `@ag-ui/core` at `^0.0.59` and `ag-ui-protocol` between 0.1.18 and 0.1.22 depending on the cockpit topic. The 1.0 release freezes the protocol, generates every SDK from one JSON Schema, and adds an enforcement stage to the client. Staying on 0.0.59 leaves `@threadplane/ag-ui` on a line whose deprecations expire on 2027-09-17 and whose peers will drift as integrations rebuild against 1.0.

Everything below was verified against the published npm tarballs (0.0.59 and 1.0.1), the PyPI wheels (0.1.22 and 1.0.0), the upstream `DEPRECATIONS.md`, the migration guide, and a repo-wide census of how this monorepo consumes the packages. Where a claim could not be verified it says so.

## 2. What 1.0.x changes, as it applies here

### 2.1 `@ag-ui/core`

- The main entry is now zod-free. Every runtime validator (`InterruptSchema`, `MessageSchema`, `ResumeEntrySchema`, `RunAgentInputSchema`, all `*EventSchema`) moved to the new `@ag-ui/core/schemas` subpath. That subpath does not exist in 0.0.59. It imports `zod/v4`; the peer is `zod ^3.25.18 || ^4.0.0`, and the root already resolves `zod 3.25.76`.
- `EventType` drops the five `THINKING_*` members. The repo never used them.
- `BinaryInputContent` is gone. Not used here.
- Content-part types are renamed (`InputContent` becomes `ContentPart`, `TextInputContent` becomes `TextPart`, and so on). Old names remain as deprecated aliases until 2027-09-17. Not used here.
- `SubAgentInfo` becomes `SubagentInfo` and `multiAgent.subAgents` becomes `subagents`, with no alias for the field. Not used here.
- New: `PROTOCOL_VERSION` (`"1.0"`), `RunFinishedCancelledOutcome`, `usage: TokenUsage[]` on `RUN_FINISHED` and `RUN_ERROR`, `pendingToolCallIds` on the success outcome, `ToolMessage.content` and `TOOL_CALL_RESULT.content` widened to `string | ContentPart[]`, `FileSource`, `omitOptionalNulls`, `contentToText`, `contentHasMedia`, token-usage helpers.

### 2.2 `@ag-ui/client`

- `AbstractAgent` and `HttpAgent` keep every public method and field the adapter uses, including `pendingInterrupts`, `abortController`, `subscribe`, `runAgent`, `abortRun`, `addMessage`, `setMessages`. `transformChunks`, `verifyEvents`, `mergeMetadata` are still exported.
- `prepareRunAgentInput` now stamps `protocolVersion: "1.0"` into every outgoing request built by `runAgent`. It already filtered `activity` messages out of the outgoing history in 0.0.59.
- `HttpAgent.run` now passes the outgoing input through an outgoing enforcement step that strips unknown top-level keys with a console warning.
- A new inbound pipeline: always-on `CompatibilityBoundary` (translates `THINKING_*` to `REASONING_*`, upgrades legacy binary parts, turns whole-optional nulls into absent fields), then `enforceEvents` (drops unknown event types with a warning, strips unknown properties with a warning, fails the run on a malformed known field), then chunk expansion, then `verifyEvents`. This pipeline runs inside `runAgent`, `connectAgent`, and the legacy bridge. It does not run inside a bare `HttpAgent.run` call, which only parses the transport.
- `MESSAGES_SNAPSHOT` now applies in snapshot order rather than appending unseen messages at the end. Reasoning events no longer overwrite an activity message with the same id. Framing buffers are capped.
- `maxVersion` is deprecated in favor of `maxProtocolVersion`. `BackwardCompatibility_0_0_47` is removed.
- 1.0.1 fixes `connectAgent` throwing when reconnecting to a thread with pending interrupts. Nothing else changed between 1.0.0 and 1.0.1.

### 2.3 `ag-ui-protocol` (Python)

- `ag_ui.core` re-exports generated pydantic models. Old part names and `SubAgentInfo` stay as aliases; `BinaryInputContent` stays importable but is rejected on the wire; `MetadataMixin` is removed. `THINKING_*` event classes are gone.
- `PROTOCOL_VERSION` is exported. The SDK does not default `protocol_version` on `RunStartedEvent`; producers set it explicitly.
- The encoder is byte-identical to 0.1.22. Unknown keys are still kept on parse, so a 0.1.22 server accepts the new `protocolVersion` request key.
- `requires_python` and the pydantic floor are unchanged.

### 2.4 Integration packages

| Package | Latest | Works with 1.0.x | Note |
| --- | --- | --- | --- |
| `@ag-ui/mastra` | 1.1.5 | Yes, built for 1.0 | Peer floor still `>=0.0.58` |
| `@ag-ui/langgraph` | 0.0.43 | Resolves; not built for 1.0 | Unused in this repo; only a root devDependency |
| `ag-ui-langgraph` | 0.0.45 | Resolves with `ag-ui-protocol==1.0.0`; not built for 1.0 | No 1.0-built release exists |
| `ag-ui-strands` | 0.4.1 | Yes, built for 1.0 | Flattens content-part tool results to text |
| `agent-framework-ag-ui` | 1.4.0 | No, pins `ag-ui-protocol <0.2` | Refuses 1.0.0 |

## 3. Decisions this spec rests on

Accepted during brainstorming, recorded so implementation does not relitigate them:

1. **Two pull requests.** PR 1 upgrades the TypeScript client and adopts the 1.0 surface through the neutral chat contract. PR 2 moves the Python runtimes. PR 2 depends on PR 1 only for deployed-smoke evidence.
2. **Peer floor `^1.0.1`.** `@threadplane/ag-ui` declares `@ag-ui/client ^1.0.1` and `@ag-ui/core ^1.0.1`. No dual support for 0.0.59 consumers; the adapter imports `@ag-ui/core/schemas`, which 0.0.59 does not ship.
3. **Full 1.0 feature adoption in PR 1.** Cancelled outcome, token usage, authoritative pending tool-call ids, and content-part tool results all reach `@threadplane/chat`.
4. **Microsoft Agent Framework stays on 0.1.x.** Its integration refuses 1.0.0. The generated deployment must hold two protocol versions apart.

## 4. PR 1: TypeScript cut-over

### 4.1 Dependency and manifest changes

- Root `package.json`: `@ag-ui/client` to `^1.0.1`; add `@ag-ui/core ^1.0.1` as a direct dependency because the adapter imports its subpath; remove the unused `@ag-ui/langgraph` devDependency.
- `libs/ag-ui/package.json` peers: `^1.0.1` for both.
- `examples/chat/smoke/template/package.json`: `^1.0.1` for both.
- `deployments/ag-ui-mastra/package.json`: `@ag-ui/mastra 1.1.5`, `@ag-ui/client 1.0.1`; regenerate that deployment's own lockfile with `npm install` inside the deployment, since it is a standalone package.
- `fixtures/react-parity/ag-ui-candidate` and `scripts/react-parity/ag-ui-candidate-package.spec.mjs`: replace the hardcoded `0.0.59` with `1.0.1`. `fixtures/react-parity/baseline-evidence.json` records the resolved client version and is regenerated by the parity scripts, not edited by hand.
- Root `package-lock.json`: edit surgically so the Linux `@next/swc-*` bindings survive. Use `npm install --package-lock-only` for the changed packages and diff the result against the expected entries before committing.

### 4.2 Source changes forced by the type checker

- `libs/ag-ui/src/lib/interrupt-persistence.ts` and `interrupt-session.ts`: import the three validators from `@ag-ui/core/schemas`. Types continue to come from `@ag-ui/core`.
- `libs/ag-ui/src/lib/reducer.ts`: the hand-rolled loose `RunFinishedOutcome` type gains the `cancelled` variant and `pendingToolCallIds` on success. The comment explaining why the strict 0.0.59 schema was avoided is rewritten to describe 1.0's loose generated validators.
- Anything else the compiler reports. The census expects nothing else, because every other imported symbol survives in 1.0.1.

### 4.3 Wire-body and pipeline alignment

- The six specs that assert the exact request body (`runtime/application-input-http.spec.ts`, `runtime/resume-http.spec.ts`, `libs/react/src/use-agent.ag-ui.spec.tsx`, `libs/angular/src/observe-agent.ag-ui.spec.ts`, `lib/to-agent.resume-wire.spec.ts`, `lib/to-agent.interrupt-restoration.spec.ts`) expect `protocolVersion: '1.0'` alongside the existing keys. The value is read from `PROTOCOL_VERSION`, never typed as a literal in production code.
- `libs/ag-ui/src/runtime/create-session.ts` stamps `protocolVersion: PROTOCOL_VERSION` into the input it builds, so the private runtime path declares itself the way `runAgent` does.
- `libs/ag-ui/src/runtime/create-http-request.ts` pipes the raw `HttpAgent.run` stream through `new CompatibilityBoundary()` and `enforceEvents()` before `transformChunks()` and `verifyEvents()`, matching the client's own order. Without this the private path would fail verification on a `THINKING_*` stream or a whole-optional null that the public `toAgent` path translates.
- `libs/ag-ui/src/runtime/reconcile-transcript.ts` documents that it mirrors 0.0.59 snapshot ordering. The runtime snapshot specs are run first; where they disagree with 1.0.1's snapshot-order semantics, the reconciler follows the client and the spec expectations are updated with a comment citing the 1.0 processing rule.
- `scripts/verify-ag-ui-runtime.ts` keeps expecting 422 for an empty body. `threadId`, `runId`, and `messages` remain required in both SDKs.

### 4.4 Feature adoption through `@threadplane/chat`

**Cancelled outcome.** `RUN_FINISHED` with `outcome.type === 'cancelled'` finalizes the delivery run with the existing `'aborted'` outcome, returns `status` to `idle`, sets `isLoading` false, and leaves `error` unset. No new contract type.

**Token usage.** `Agent` gains an optional `usage?: Signal<AgentUsage | undefined>`, following the optional-capability pattern used by `interrupt` and `subagents`. `AgentUsage` lives in `libs/chat/src/lib/agent/agent-usage.ts`:

```ts
export interface AgentUsageEntry {
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  cacheWriteInputTokens?: number;
}
export interface AgentUsage {
  /** Usage for the most recent completed or errored run, one entry per provider and model. */
  entries: AgentUsageEntry[];
}
```

The AG-UI reducer sets `usage` from `usage` on `RUN_FINISHED` and `RUN_ERROR`, replacing the previous value per run; a run that reports no usage leaves the signal `undefined`. `toAgent` exposes the signal. The LangGraph adapter does not set it in this PR; usage parity is a named follow-up.

**Pending tool calls.** When the success outcome carries `pendingToolCallIds`, the client-tools capability uses it as the authoritative pending set: `selectPendingClientToolCalls` receives an optional `authoritativeIds` input and, when present, returns the catalog tool calls whose ids are in it and not yet resolved. When absent, the current derivation stands. `toAgent` reads `pendingToolCallIds` from the `RunAgentResult` returned by `runAgent`, which the client computes from the outcome or derives from the stream.

**Content-part tool results.** `TOOL_CALL_RESULT.content` and tool messages in `MESSAGES_SNAPSHOT` may carry `ContentPart[]`. The reducer maps parts to the chat contract without inventing values:

| Part | Mapping |
| --- | --- |
| `text` | `{ type: 'text', text }` content block; also concatenated into `ToolCall.result` text |
| `image` with `UrlSource` | `{ type: 'image', url, alt? }` content block |
| every other part (data-source image, audio, video, document, file source) | kept verbatim under `message.extra['ag-ui'].parts` on the tool message and under `ToolCall.parts` |

`ToolCall` gains an optional `parts?: unknown[]` holding the raw part list when the result was not a plain string, so tool views can render media without reparsing. `ToolCall.result` keeps today's behavior for strings (JSON parse with fallback) and becomes the concatenated text for part lists. A part list that is entirely media yields an empty-string result and a populated `parts`.

**Subagent capabilities rename.** Nothing in the repo reads `subAgents`. The plan adds a grep guard step, not code.

### 4.5 Docs and generated context

- `libs/ag-ui/README.md`, `README.md`, and `apps/website/content/docs/ag-ui/getting-started/installation.mdx` currently state the peer range as `*`; `apps/website/content/docs/ag-ui/guides/interrupts.mdx` says `0.0.59`. All move to `^1.0.1`.
- `apps/website/content/docs/ag-ui/reference/event-mapping.mdx` gains rows for the cancelled outcome, usage, pending tool-call ids, and content-part tool results.
- `CHANGELOG.md` and `apps/website/content/docs/chat/getting-started/changelog.mdx` record the peer change as a breaking upgrade note and list the new contract fields.
- Run `npm run generate-api-docs` (new chat exports) and `npm run generate-agent-context` (public guidance changed).

### 4.6 Verification for PR 1

- `npx nx test ag-ui`, `npx nx run ag-ui:runtime-quality`, `ag-ui:runtime-type-tests`, `ag-ui:type-tests`, `npx nx test chat`, `npx nx test react`, `npx nx test angular`, `npx nx lint` for each touched project, `npx nx build ag-ui` and `build chat`.
- `node --test scripts/react-parity/*.spec.mjs fixtures/react-parity/traces.spec.mjs`, then `review-native-ag-ui.mjs --verify` and `verify-ag-ui-candidate.mjs`.
- `deployments/ag-ui-mastra`: `npm ci`, `node --check`, `npm test`.
- The packaged-consumer lane across Angular 20, 21, and 22 from the smoke template.
- Mutation check on every new spec: revert the feature and confirm the spec fails.
- Live-LLM smoke against the deployed runtimes before merge.

## 5. PR 2: Python runtimes

### 5.1 Pins

- Every cockpit topic under `cockpit/ag-ui/*/python` and `examples/ag-ui/python`: `ag-ui-protocol>=1.0.0`, `ag-ui-langgraph>=0.0.45`. Re-export each `requirements.txt` with the exact `uv export` command recorded in its header.
- `cockpit/runtimes/aws-strands/python`: replace the git pin with `ag-ui-strands>=0.4.1` from PyPI. Before the change lands, run the multi-agent route locally against 0.4.1 to confirm the crash the git pin worked around is gone; if it is not, keep the git pin at a 1.0-era commit and record why.
- `cockpit/runtimes/microsoft-agent-framework/python`: unchanged.
- Regenerate `deployments/ag-ui-dev` with `npx tsx scripts/generate-ag-ui-deployment-config.ts`.

### 5.2 Generator change for the split protocol version

The generator unions direct dependencies across topics with highest-version-wins. With MAF pinned below 0.2 and everything else at 1.0.0, the union is unsatisfiable, and the generator's own conflict check must say so rather than silently picking 1.0.0. Two Python processes cannot share one `ag_ui` import, so MAF leaves the shared image: the generator learns to exclude a framework from the union, and MAF gets its own deployment directory and Railway service mirroring `deployments/ag-ui-mastra` (its own Dockerfile, requirements, health check, and a proxy route in `scripts/ag-ui-proxy.ts`). The generator's conflict error is written first so the split is provable, then the MAF service is carved out. When Microsoft publishes an integration that accepts `ag-ui-protocol` 1.0, MAF folds back into the shared image and the extra service is retired.

### 5.3 Producer changes

- The four hand-built emitters (`examples/ag-ui/python/src/streaming/subagent_emitting_agent.py`, its cockpit copy, `cockpit/runtimes/aws-strands/python/src/subagent_emitter.py`, `cockpit/runtimes/microsoft-agent-framework/python/src/subagent_emitter.py`) set `protocol_version=PROTOCOL_VERSION` on any `RunStartedEvent` they construct. The MAF emitter imports the constant only if present, since its protocol package stays on 0.1.x.
- Wire-capture docs that state `ag-ui-protocol 0.1.22` are updated with the new version and a note that bridge-emitted `RUN_STARTED` from `ag-ui-langgraph` 0.0.45 carries no `protocolVersion`.

### 5.4 Verification for PR 2

- Each topic's pytest suite, `nx run <topic>:lint`, and the cockpit-smoke jobs.
- The requirements drift checks in `ci.yml` (`examples-ag-ui-e2e` and `cockpit-e2e`).
- The ag-ui-dev boot gate, `railway up`, and `scripts/verify-ag-ui-runtime.ts`.
- `examples-ag-ui-e2e` and the cockpit e2e matrix on fixture replay, then the live-LLM smoke.

## 6. Out of scope

- LangGraph adapter token-usage parity.
- Protobuf transport, file-source parts, and capabilities discovery.
- Upgrading `agent-framework-ag-ui` past 1.4.0.
- Any change to `apps/lifecycle` or `apps/growth-research`, which reach `@ag-ui/core` only through `@dawn-ai/*`.

## 7. Risks and how the plan contains them

- **Enforcement strips something the adapter relies on.** Unknown properties on known events are stripped before subscribers see them. The census found no adapter code reading non-schema event fields, and `BaseEvent` keeps its open index signature at the type level, so the risk is runtime-only and is caught by the transcript fixtures replayed in `runtime/*-http.spec.ts`.
- **Snapshot-order change breaks transcript reconciliation.** Covered in 4.3; the runtime snapshot specs run before any reconciler edit.
- **Console warnings in tests.** The boundary and enforcement warn on translation. Specs that replay legacy fixtures set `SUPPRESS_TRANSFORMATION_WARNINGS=true` or assert on the warning where the translation is the subject.
- **Renovate.** The 0.x to 1.x move is not grouped automatically; this upgrade is manual and Renovate takes over from 1.0.1.
