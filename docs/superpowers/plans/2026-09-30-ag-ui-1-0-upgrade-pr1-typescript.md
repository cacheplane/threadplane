# AG-UI 1.0.x Upgrade, PR 1: TypeScript client cut-over and 1.0 feature adoption

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `@threadplane/ag-ui` and every TypeScript consumer in the monorepo from `@ag-ui/client`+`@ag-ui/core` 0.0.59 to 1.0.1, and surface the 1.0 protocol additions (cancelled outcome, token usage, authoritative pending tool-call ids, content-part tool results) through the neutral `@threadplane/chat` contract.

**Architecture:** The adapter's public path (`toAgent` over `runAgent`) inherits the client's new compatibility-boundary and enforcement pipeline automatically; the private runtime path (`libs/ag-ui/src/runtime`) calls `HttpAgent.run` directly and gets the same pipeline added by hand. Protocol additions land in the reducer and are exposed as optional capabilities on `Agent`, following the existing `interrupt?`/`subagents?` pattern, so the LangGraph adapter compiles unchanged.

**Tech Stack:** Angular signals, RxJS 7.8, vitest (via `nx test`), `@ag-ui/client` 1.0.1, `@ag-ui/core` 1.0.1 (`@ag-ui/core/schemas` for zod validators, zod/v4 provided by root zod 3.25.76).

**Spec:** `docs/superpowers/specs/2026-09-30-ag-ui-1-0-upgrade-design.md`

**Conventions used throughout:**
- Run commands from the repo root. `npx nx test ag-ui -- <path>` runs one spec file; `npx nx test ag-ui` runs the lib suite.
- Every new spec must be mutation-checked: temporarily revert the production change and confirm the spec fails, then restore. Each task says where to do this.
- Do not run `npm install` without `--package-lock-only` or the platform-specific bindings rule breaks the lockfile (see memory: never regenerate package-lock.json on macOS wholesale).
- Commit at the end of each task with the message given. Do not add co-author lines beyond what the session's attribution reminder requires.

---

## File map

| Path | Responsibility |
| --- | --- |
| `package.json`, `package-lock.json` | root pins |
| `libs/ag-ui/package.json` | peer floor `^1.0.1` |
| `examples/chat/smoke/template/package.json` | packaged-consumer pins |
| `deployments/ag-ui-mastra/package.json`, `package-lock.json` | Mastra service pins |
| `scripts/react-parity/ag-ui-candidate-package.spec.mjs`, `verify-packages.spec.mjs`, `fixtures/react-parity/ag-ui-candidate/README.md` | parity pins |
| `libs/ag-ui/src/lib/interrupt-persistence.ts`, `interrupt-session.ts` | validators from `@ag-ui/core/schemas` |
| `libs/ag-ui/src/runtime/create-session.ts` | stamps `protocolVersion` on the private path |
| `libs/ag-ui/src/runtime/create-http-request.ts` | boundary + enforcement on the private path |
| `libs/ag-ui/src/lib/internal/content-parts.ts` (new) | maps AG-UI `ContentPart[]` to chat blocks and tool results |
| `libs/ag-ui/src/lib/reducer.ts` | cancelled outcome, usage, pending ids, content parts |
| `libs/ag-ui/src/lib/to-agent.ts` | accepts cancelled outcome, exposes `usage` |
| `libs/ag-ui/src/lib/client-tools.ts` | authoritative pending ids |
| `libs/chat/src/lib/agent/agent-usage.ts` (new) | `AgentUsage` contract |
| `libs/chat/src/lib/agent/agent.ts`, `tool-call.ts`, `index.ts`, `libs/chat/src/public-api.ts` | contract additions and exports |
| `libs/chat/src/lib/client-tools/select-pending-client-tool-calls.ts` | `authoritativeIds` input |
| Docs: `README.md`, `libs/ag-ui/README.md`, `apps/website/content/docs/ag-ui/getting-started/installation.mdx`, `apps/website/content/docs/ag-ui/guides/interrupts.mdx`, `apps/website/content/docs/ag-ui/reference/event-mapping.mdx`, `CHANGELOG.md`, `apps/website/content/docs/chat/getting-started/changelog.mdx` | copy |

---

### Task 1: Bump the client packages and prove the break

**Files:**
- Modify: `package.json:40` (remove `@ag-ui/langgraph`), `package.json:116`
- Modify: `libs/ag-ui/package.json:16-17`
- Modify: `examples/chat/smoke/template/package.json:31-32`
- Modify: `package-lock.json` (via `--package-lock-only`)

- [ ] **Step 1: Edit the root manifest**

In `package.json`, delete the line `"@ag-ui/langgraph": "^0.0.41",` from `devDependencies` (nothing imports it; the census confirmed). In `dependencies`, replace `"@ag-ui/client": "^0.0.59",` with:

```json
    "@ag-ui/client": "^1.0.1",
    "@ag-ui/core": "^1.0.1",
```

`@ag-ui/core` becomes a direct dependency because the adapter now imports its `/schemas` subpath.

- [ ] **Step 2: Edit the adapter peers and the smoke template**

`libs/ag-ui/package.json`:

```json
    "@ag-ui/client": "^1.0.1",
    "@ag-ui/core": "^1.0.1",
```

`examples/chat/smoke/template/package.json`:

```json
    "@ag-ui/client": "^1.0.1",
    "@ag-ui/core": "^1.0.1",
```

- [ ] **Step 3: Update the lockfile surgically**

Run: `npm install --package-lock-only --no-audit --no-fund`
Then: `git diff --stat package-lock.json` and `git diff package-lock.json | grep -c '@next/swc'`
Expected: the swc grep prints `0` (no platform-binding churn). If it does not, run `git checkout package-lock.json` and instead edit the four `node_modules/@ag-ui/{client,core,encoder,proto}` entries by hand to `1.0.1` with the `resolved`/`integrity` values from `npm view @ag-ui/<pkg>@1.0.1 dist.tarball dist.integrity` (zod stays at 3.25.76, which already ships the `zod/v4` subpath the new packages import), and remove the `node_modules/@ag-ui/langgraph` and `node_modules/@ag-ui/a2ui-toolkit` entries if nothing else depends on them (`npm ls @ag-ui/a2ui-toolkit`).

- [ ] **Step 4: Install and confirm the resolved versions**

Run: `npm ci --no-audit --no-fund && node -e "console.log(require('@ag-ui/client/package.json').version, require('@ag-ui/core/package.json').version)"`
Expected: `1.0.1 1.0.1`

- [ ] **Step 5: Prove the compile break**

Run: `npx nx run ag-ui:type-tests`
Expected: FAIL with errors naming `InterruptSchema`, `MessageSchema`, `ResumeEntrySchema` in `libs/ag-ui/src/lib/interrupt-persistence.ts:1` and `interrupt-session.ts:1` (`Module '"@ag-ui/core"' has no exported member ...`). Record any other error; the census predicts none.

- [ ] **Step 6: Commit the manifests**

```bash
git add package.json package-lock.json libs/ag-ui/package.json examples/chat/smoke/template/package.json
git commit -m "chore(ag-ui): pin @ag-ui/client and @ag-ui/core at 1.0.1"
```

---

### Task 2: Move the validators to `@ag-ui/core/schemas`

**Files:**
- Modify: `libs/ag-ui/src/lib/interrupt-persistence.ts:1`
- Modify: `libs/ag-ui/src/lib/interrupt-session.ts:1`
- Test: `libs/ag-ui/src/lib/interrupt-persistence.spec.ts`, `interrupt-session.spec.ts` (existing)

- [ ] **Step 1: Change the two import lines**

`interrupt-persistence.ts` line 1:

```ts
import { InterruptSchema, MessageSchema, ResumeEntrySchema } from '@ag-ui/core/schemas';
```

`interrupt-session.ts` line 1:

```ts
import { InterruptSchema, ResumeEntrySchema } from '@ag-ui/core/schemas';
import type { Interrupt, ResumeEntry } from '@ag-ui/core';
```

- [ ] **Step 2: Type-check**

Run: `npx nx run ag-ui:type-tests && npx nx run ag-ui:runtime-type-tests`
Expected: both PASS.

- [ ] **Step 3: Run the two suites that exercise the validators**

Run: `npx nx test ag-ui -- src/lib/interrupt-persistence.spec.ts src/lib/interrupt-session.spec.ts`
Expected: PASS. The 1.0 validators are `looseObject`s; if a test that fed an extra key expected rejection, read the assertion and confirm the spec's contract is "preserve every entry verbatim" before changing anything.

- [ ] **Step 4: Run the whole adapter suite to find enforcement fallout**

Run: `npx nx test ag-ui 2>&1 | tee /tmp/ag-ui-1st-run.log | tail -40`
Expected: failures limited to the wire-body specs (`application-input-http`, `resume-http`) that Task 3 fixes, plus possibly `to-agent.http-lifecycle.spec.ts` and `runtime/*-http.spec.ts` warnings. Copy the failing spec names into the task notes; any failure outside Tasks 3 to 8 is investigated before proceeding (see memory: a "flake" is usually a real bug).

- [ ] **Step 5: Commit**

```bash
git add libs/ag-ui/src/lib/interrupt-persistence.ts libs/ag-ui/src/lib/interrupt-session.ts
git commit -m "fix(ag-ui): import protocol validators from @ag-ui/core/schemas"
```

---

### Task 3: Declare `protocolVersion` on both request paths

**Files:**
- Modify: `libs/ag-ui/src/runtime/create-session.ts:1-7, 128-141`
- Test: `libs/ag-ui/src/runtime/application-input-http.spec.ts:119,170,226`
- Test: `libs/ag-ui/src/runtime/resume-http.spec.ts:128,168,408`
- Test: `libs/react/src/use-agent.ag-ui.spec.tsx:48,178,249`
- Test: `libs/angular/src/observe-agent.ag-ui.spec.ts:61,180`
- Test: `libs/ag-ui/src/lib/to-agent.resume-wire.spec.ts:186-201`

- [ ] **Step 1: Update the exact-body expectations**

In each `toStrictEqual({ ... })` / `toEqual({ ... })` body assertion listed above, add the key directly after `runId`:

```ts
        protocolVersion: PROTOCOL_VERSION,
```

and add at the top of each of the five spec files:

```ts
import { PROTOCOL_VERSION } from '@ag-ui/core';
```

In `to-agent.resume-wire.spec.ts`, after `expect(body['threadId']).toBe(measured['threadId']);` add:

```ts
    // The 1.0 client declares itself in-band; the measured 0.x capture has no
    // version, which the spec's versioning rules treat as a pre-1.0 peer.
    expect(body['protocolVersion']).toBe(PROTOCOL_VERSION);
```

- [ ] **Step 2: Run the private-runtime and consumer specs to see them fail**

Run: `npx nx test ag-ui -- src/runtime/application-input-http.spec.ts src/runtime/resume-http.spec.ts && npx nx test react -- src/use-agent.ag-ui.spec.tsx && npx nx test angular -- src/observe-agent.ag-ui.spec.ts`
Expected: FAIL on the missing `protocolVersion` key (the private runtime does not stamp it yet). `to-agent.resume-wire.spec.ts` PASSES already because `runAgent` stamps it.

- [ ] **Step 3: Stamp the version in the private session's input**

`create-session.ts`: change the type-only import block so `PROTOCOL_VERSION` is a value import:

```ts
import { PROTOCOL_VERSION } from '@ag-ui/core';
import type {
  AGUIEvent,
  HttpAgentConfig,
  Message,
  RunAgentInput,
  ResumeEntry,
} from '@ag-ui/client';
```

In `dispatch`, build the input as:

```ts
      input = {
        threadId,
        runId: attempt.id,
        protocolVersion: PROTOCOL_VERSION,
        messages: requestMessages(value.transcript),
        state: requestState(value.state),
        tools: [],
        context: [],
        forwardedProps: {},
        ...(decision?.kind === 'native' &&
          decision.attempt?.runId === attempt.id && {
            resume: copyData(
              decision.attempt.responses,
              false
            ) as ResumeEntry[],
          }),
      };
```

- [ ] **Step 4: Re-run the specs**

Run the same command as Step 2.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/ag-ui/src/runtime/create-session.ts libs/ag-ui/src/runtime/application-input-http.spec.ts libs/ag-ui/src/runtime/resume-http.spec.ts libs/react/src/use-agent.ag-ui.spec.tsx libs/angular/src/observe-agent.ag-ui.spec.ts libs/ag-ui/src/lib/to-agent.resume-wire.spec.ts
git commit -m "feat(ag-ui): declare protocol version 1.0 on every outgoing run"
```

---

### Task 4: Give the private runtime path the 1.0 compatibility boundary and enforcement

**Files:**
- Modify: `libs/ag-ui/src/runtime/create-http-request.ts:1-8, 133-135`
- Test: `libs/ag-ui/src/runtime/create-http-request.spec.ts` (add one test)

- [ ] **Step 1: Confirm the middleware signature in the installed client**

Run: `grep -n "class CompatibilityBoundary" -A 12 node_modules/@ag-ui/client/dist/index.d.ts | grep -E "run\(|class"` and `grep -n "declare abstract class Middleware" -A 10 node_modules/@ag-ui/client/dist/index.d.ts | grep -E "run|runNext"`
Expected: `run(input: RunAgentInput, next: AbstractAgent): Observable<BaseEvent>;` on the boundary, and `protected runNext(input, next)` on `Middleware`. The boundary calls `next.run(input)`; nothing else on `next` is touched by it (verify: `grep -o "runNext(e,t){return t.run(e)[^}]*}" node_modules/@ag-ui/client/dist/index.mjs`).

- [ ] **Step 2: Write the failing spec**

Append to `create-http-request.spec.ts`, using the file's existing helpers for a scripted `fetch` that emits SSE frames (copy the pattern from the test nearest line 149 that spies `HttpAgent.prototype.run`):

```ts
  it('translates a pre-1.0 THINKING stream into REASONING events before verification', async () => {
    const frames = [
      { type: 'RUN_STARTED', threadId: 't', runId: 'r' },
      { type: 'THINKING_START' },
      { type: 'THINKING_TEXT_MESSAGE_START' },
      { type: 'THINKING_TEXT_MESSAGE_CONTENT', delta: 'because' },
      { type: 'THINKING_TEXT_MESSAGE_END' },
      { type: 'THINKING_END' },
      { type: 'RUN_FINISHED', threadId: 't', runId: 'r' },
    ];
    const seen: string[] = [];
    const handle = createHttpRequest(
      { url: 'http://agent.test/agent', fetch: sseFetch(frames) },
      { threadId: 't', runId: 'r', protocolVersion: '1.0', messages: [], tools: [], context: [], forwardedProps: {}, state: {} },
      (event) => { seen.push(event.type as string); },
    );
    await expect(handle.done).resolves.toEqual({ status: 'closed' });
    expect(seen).toEqual([
      'RUN_STARTED',
      'REASONING_START',
      'REASONING_MESSAGE_START',
      'REASONING_MESSAGE_CONTENT',
      'REASONING_MESSAGE_END',
      'REASONING_END',
      'RUN_FINISHED',
    ]);
  });
```

`sseFetch(frames)` is whatever helper the file already uses to return a `Response` whose body is `data: <json>\n\n` per frame; if the file has none, define it locally next to the other helpers:

```ts
function sseFetch(frames: unknown[]) {
  return async () => new Response(
    frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join(''),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}
```

Set `process.env['SUPPRESS_TRANSFORMATION_WARNINGS'] = 'true'` in a `beforeEach` for this describe block so the boundary's console warnings do not spam the run.

- [ ] **Step 3: Run it and watch it fail**

Run: `npx nx test ag-ui -- src/runtime/create-http-request.spec.ts -t "THINKING"`
Expected: FAIL. Either the outcome is `{ status: 'failed' }` (verification rejects the unknown type) or `seen` still contains `THINKING_*` names.

- [ ] **Step 4: Add the boundary and enforcement to the pipeline**

Imports at the top of `create-http-request.ts`:

```ts
import {
  CompatibilityBoundary,
  enforceEvents,
  HttpAgent,
  transformChunks,
  verifyEvents,
  type AbstractAgent,
  type BaseEvent,
  type HttpAgentConfig,
  type RunAgentInput,
} from '@ag-ui/client';
```

Replace lines 133-135:

```ts
        controller = source.abortController;
        // Same order as the SDK's own runAgent pipeline: boundary (translate
        // retired shapes), enforcement (drop/strip the unknown), chunk
        // expansion, verification. A bare HttpAgent.run() gets none of it.
        const boundary = new CompatibilityBoundary();
        const events = boundary
          .run(input, { run: (i: RunAgentInput) => source.run(i) } as unknown as AbstractAgent)
          .pipe(enforceEvents(), transformChunks(), verifyEvents());
```

- [ ] **Step 5: Run the file and the full runtime suites**

Run: `npx nx test ag-ui -- src/runtime/create-http-request.spec.ts && npx nx run ag-ui:runtime-quality`
Expected: PASS. If `runtime-quality` reports a spec whose fixture carries `parentMessageId: null` or `outcome: null`, that fixture is now normalized by the boundary; update the assertion to the absent field and cite `DEPRECATIONS.md` in a comment.

Then run the snapshot-order specs on their own: `npx nx run ag-ui:runtime-quality -- src/runtime/reconcile-transcript.spec.ts src/runtime/reconcile-transcript-http.spec.ts src/runtime/transcript-http.spec.ts`. `reconcile-transcript.ts` says it "mirrors locked @ag-ui/client 0.0.59 edit-based ordering". The 1.0 client applies `MESSAGES_SNAPSHOT` in snapshot order (existing messages replaced in place, new ones appended in snapshot order, consumer-held messages absent from the snapshot dropped except activity/reasoning). If a spec disagrees with that rule, change the reconciler to follow the client and update the spec's expectation with a comment citing the 1.0 processing rule; never bend the client's order back to 0.0.59's. Update the file's header comment to name 1.0.1.

- [ ] **Step 6: Mutation check**

Revert Step 4's pipeline change (keep the imports), run Step 3's command, confirm FAIL, restore.

- [ ] **Step 7: Commit**

```bash
git add libs/ag-ui/src/runtime/create-http-request.ts libs/ag-ui/src/runtime/create-http-request.spec.ts
git commit -m "feat(ag-ui): run the private request path through the 1.0 compatibility boundary"
```

---

### Task 5: Accept the `cancelled` run outcome

**Files:**
- Modify: `libs/ag-ui/src/lib/reducer.ts:147-171, 759-766`
- Modify: `libs/ag-ui/src/lib/to-agent.ts:1044-1052`
- Test: `libs/ag-ui/src/lib/reducer.spec.ts`, `libs/ag-ui/src/lib/to-agent.spec.ts`

- [ ] **Step 1: Write the reducer spec**

In `reducer.spec.ts`, inside the `describe` that covers `RUN_FINISHED` (search `'RUN_FINISHED'`), add:

```ts
  it('finalizes a cancelled outcome as aborted without an error', () => {
    const store = makeStore();
    reduceEvent({ type: 'RUN_STARTED', threadId: 't', runId: 'r' } as never, store);
    reduceEvent({ type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' } as never, store);
    reduceEvent({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'partial' } as never, store);
    reduceEvent(
      { type: 'RUN_FINISHED', threadId: 't', runId: 'r', outcome: { type: 'cancelled' } } as never,
      store,
    );
    expect(store.deliveryRun?.outcome).toBe('aborted');
    expect(store.status()).toBe('idle');
    expect(store.isLoading()).toBe(false);
    expect(store.error()).toBeUndefined();
    expect(store.messages()[0]?.delivery).toEqual(completeDelivery('run-generation-1', 'aborted'));
  });
```

- [ ] **Step 2: Write the adapter spec**

In `to-agent.spec.ts`, next to the existing test that drives a RUN_FINISHED interrupt outcome through a stub `AbstractAgent`, add a test that scripts `RUN_STARTED` then `RUN_FINISHED` with `outcome: { type: 'cancelled' }` and asserts:

```ts
    expect(agent.status()).toBe('idle');
    expect(agent.error()).toBeUndefined();
    expect(agent.isLoading()).toBe(false);
```

Reuse the file's stub-agent helper (the one that casts `as unknown as AbstractAgent` and calls the captured `onEvent` subscriber).

- [ ] **Step 3: Run both, expect failure**

Run: `npx nx test ag-ui -- src/lib/reducer.spec.ts src/lib/to-agent.spec.ts -t "cancelled"`
Expected: reducer test FAILS (outcome recorded as `success`); adapter test FAILS with the run failed on `Invalid run outcome`.

- [ ] **Step 4: Implement**

`reducer.ts`, the loose outcome type:

```ts
interface RunFinishedOutcome {
  type?: string;
  interrupts?: unknown;
  pendingToolCallIds?: unknown;
}
```

In the `RUN_FINISHED` case, before `if (!run || !finalizeDeliveryRun(store, run, 'success')) return;`:

```ts
      if (outcome?.type === 'cancelled') {
        // 1.0 RunFinishedCancelledOutcome: the producer stopped the run on
        // request. Neutral contract already has 'aborted' for exactly this.
        if (!run || !finalizeDeliveryRun(store, run, 'aborted')) return;
        store.status.set('idle');
        store.isLoading.set(false);
        return;
      }
```

Rewrite the comment above `RunFinishedOutcome` to:

```ts
/** Loosely-typed RUN_FINISHED outcome. The 1.0 validators are loose objects,
 *  but the reducer still keeps its own tolerant view: it must preserve every
 *  interrupt entry verbatim under `value.interrupts` for resume to address,
 *  and it must not depend on a validator to route on `type`. */
```

`to-agent.ts` `hasValidFinishedOutcome`:

```ts
  if (value['type'] === 'success' || value['type'] === 'cancelled') return true;
```

- [ ] **Step 5: Run, expect pass**

Run: `npx nx test ag-ui -- src/lib/reducer.spec.ts src/lib/to-agent.spec.ts`
Expected: PASS.

- [ ] **Step 6: Mutation check**

Revert the reducer `cancelled` branch only; the reducer test must fail. Restore.

- [ ] **Step 7: Commit**

```bash
git add libs/ag-ui/src/lib/reducer.ts libs/ag-ui/src/lib/to-agent.ts libs/ag-ui/src/lib/reducer.spec.ts libs/ag-ui/src/lib/to-agent.spec.ts
git commit -m "feat(ag-ui): treat a cancelled run outcome as aborted"
```

---

### Task 6: Token usage on the neutral contract

**Files:**
- Create: `libs/chat/src/lib/agent/agent-usage.ts`
- Modify: `libs/chat/src/lib/agent/agent.ts` (after `clientTools?`), `libs/chat/src/lib/agent/index.ts`, `libs/chat/src/public-api.ts`
- Modify: `libs/ag-ui/src/lib/reducer.ts` (store field, RUN_STARTED, RUN_FINISHED, RUN_ERROR), `libs/ag-ui/src/lib/to-agent.ts` (store creation and return object)
- Test: `libs/ag-ui/src/lib/reducer.spec.ts`

- [ ] **Step 1: Add the contract type**

`libs/chat/src/lib/agent/agent-usage.ts`:

```ts
/**
 * Token accounting for one run, as the runtime reported it. Every count is
 * optional: absent means the provider did not report it, which is distinct
 * from zero. Reasoning, cached, and cache-write counts are parts of the
 * input/output totals, never additions to them.
 */
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

/** Usage for the most recent finished or errored run, one entry per provider and model. */
export interface AgentUsage {
  entries: AgentUsageEntry[];
}
```

`agent.ts`, after the `clientTools?` member:

```ts
  /**
   * Optional token usage for the most recent completed or errored run.
   * Adapters whose runtime reports usage set it at the run boundary; it is
   * `undefined` while a run is in flight and after a run that reported none.
   */
  usage?: Signal<AgentUsage | undefined>;
```

with `import type { AgentUsage } from './agent-usage';` added to the file's imports.

`index.ts`: add `export type { AgentUsage, AgentUsageEntry } from './agent-usage';`
`public-api.ts`: add `AgentUsage,` and `AgentUsageEntry,` to the `export type { ... } from './lib/agent'` block.

- [ ] **Step 2: Type-check chat**

Run: `npx nx run chat:type-tests && npx nx build chat`
Expected: PASS.

- [ ] **Step 3: Write the reducer specs**

In `reducer.spec.ts`, extend `makeStore` with `usage: signal<AgentUsage | undefined>(undefined),` (import `AgentUsage` from `@threadplane/chat`) and add:

```ts
describe('usage', () => {
  const usage = [{ provider: 'openai', model: 'gpt-5', inputTokens: 12, outputTokens: 3, totalTokens: 15 }];

  it('records RUN_FINISHED usage for the run', () => {
    const store = makeStore();
    reduceEvent({ type: 'RUN_STARTED', threadId: 't', runId: 'r' } as never, store);
    reduceEvent({ type: 'RUN_FINISHED', threadId: 't', runId: 'r', usage } as never, store);
    expect(store.usage?.()).toEqual({ entries: usage });
  });

  it('records RUN_ERROR usage accrued before the failure', () => {
    const store = makeStore();
    reduceEvent({ type: 'RUN_STARTED', threadId: 't', runId: 'r' } as never, store);
    reduceEvent({ type: 'RUN_ERROR', message: 'boom', usage } as never, store);
    expect(store.usage?.()).toEqual({ entries: usage });
  });

  it('clears usage when a new run starts and leaves it undefined when none is reported', () => {
    const store = makeStore();
    store.usage?.set({ entries: usage });
    reduceEvent({ type: 'RUN_STARTED', threadId: 't', runId: 'r2' } as never, store);
    expect(store.usage?.()).toBeUndefined();
    reduceEvent({ type: 'RUN_FINISHED', threadId: 't', runId: 'r2' } as never, store);
    expect(store.usage?.()).toBeUndefined();
  });
});
```

- [ ] **Step 4: Run, expect failure**

Run: `npx nx test ag-ui -- src/lib/reducer.spec.ts -t "usage"`
Expected: FAIL (`store.usage` is undefined or never set).

- [ ] **Step 5: Implement in the reducer**

`ReducerStore` gains, after `activities`:

```ts
  /** Token usage for the latest finished/errored run. Optional so test
   *  stores built before 1.0 keep compiling; the adapter always provides it. */
  usage?: WritableSignal<AgentUsage | undefined>;
```

Add `AgentUsage` to the `import type { ... } from '@threadplane/chat'` list. Add a helper near `eventRunId`:

```ts
function usageFromEvent(event: BaseEvent): AgentUsage | undefined {
  const usage = (event as { usage?: unknown }).usage;
  if (!Array.isArray(usage) || usage.length === 0) return undefined;
  return { entries: usage.filter(isRecord) as AgentUsage['entries'] };
}
```

In `RUN_STARTED`, next to `store.argsBuffers?.clear();`: `store.usage?.set(undefined);`
In `RUN_FINISHED`, as the first statement after `const outcome = runFinishedOutcome(event);`: `store.usage?.set(usageFromEvent(event));`
In `RUN_ERROR`, after `if (!run || !finalizeDeliveryRun(store, run, 'error')) return;`: `store.usage?.set(usageFromEvent(event));`

- [ ] **Step 6: Expose it from the adapter**

In `to-agent.ts`, where the `ReducerStore` literal is built (search `activities: signal`), add `usage: signal<AgentUsage | undefined>(undefined),` and in the returned object after `state:     store.state,` add `usage:     store.usage,`. Import `AgentUsage` type from `@threadplane/chat`.

- [ ] **Step 7: Run and mutation-check**

Run: `npx nx test ag-ui -- src/lib/reducer.spec.ts && npx nx run ag-ui:type-tests`
Expected: PASS. Then revert the `RUN_FINISHED` `store.usage?.set(...)` line only, run `-t "usage"`, confirm one failure, restore.

- [ ] **Step 8: Commit**

```bash
git add libs/chat/src/lib/agent/agent-usage.ts libs/chat/src/lib/agent/agent.ts libs/chat/src/lib/agent/index.ts libs/chat/src/public-api.ts libs/ag-ui/src/lib/reducer.ts libs/ag-ui/src/lib/reducer.spec.ts libs/ag-ui/src/lib/to-agent.ts
git commit -m "feat(chat,ag-ui): expose per-run token usage on the agent contract"
```

---

### Task 7: Authoritative pending tool-call ids

**Files:**
- Modify: `libs/chat/src/lib/client-tools/select-pending-client-tool-calls.ts`
- Modify: `libs/ag-ui/src/lib/reducer.ts` (store field, RUN_STARTED, RUN_FINISHED)
- Modify: `libs/ag-ui/src/lib/client-tools.ts:118-125`
- Modify: `libs/ag-ui/src/lib/to-agent.ts` (store literal)
- Test: `libs/chat/src/lib/client-tools/select-pending-client-tool-calls.spec.ts`, `libs/ag-ui/src/lib/client-tools.spec.ts`

- [ ] **Step 1: Chat selector spec**

Append to `select-pending-client-tool-calls.spec.ts`:

```ts
  it('uses the producer-declared pending set when one is present', () => {
    // stockCall is in the catalog but the producer did not name it pending.
    const out = select({
      toolCalls: [weatherCall, stockCall],
      catalogNames: new Set(['get_weather', 'get_stock_price']),
      authoritativeIds: new Set(['c1']),
    });
    expect(out.map((tc) => tc.id)).toEqual(['c1']);
  });

  it('still hides resolved calls and non-catalog calls under an authoritative set', () => {
    const out = select({
      toolCalls: [weatherCall, stockCall],
      catalogNames: new Set(['get_weather']),
      authoritativeIds: new Set(['c1', 'c2']),
      resolvedIds: new Set(['c1']),
    });
    expect(out).toEqual([]);
  });
```

- [ ] **Step 2: Run, expect failure**

Run: `npx nx test chat -- src/lib/client-tools/select-pending-client-tool-calls.spec.ts`
Expected: FAIL (first new test returns both ids; the input type rejects `authoritativeIds` under type-check).

- [ ] **Step 3: Implement the selector**

```ts
export interface SelectPendingClientToolCallsInput {
  isLoading: boolean;
  toolCalls: readonly ToolCall[];
  catalogNames: ReadonlySet<string>;
  resolvedIds: ReadonlySet<string>;
  /**
   * Tool-call ids the runtime itself declared unanswered at the end of the
   * run (AG-UI 1.0 `outcome.pendingToolCallIds`). When present it is the
   * authority: a call outside it is not pending even if it has no result.
   */
  authoritativeIds?: ReadonlySet<string>;
}

export function selectPendingClientToolCalls(
  input: SelectPendingClientToolCallsInput,
): readonly ToolCall[] {
  if (input.isLoading) return [];
  return input.toolCalls.filter(
    (tc) =>
      input.catalogNames.has(tc.name) &&
      tc.result === undefined &&
      !input.resolvedIds.has(tc.id) &&
      (input.authoritativeIds === undefined || input.authoritativeIds.has(tc.id)),
  );
}
```

Run Step 2's command again. Expected: PASS.

- [ ] **Step 4: Adapter spec**

In `libs/ag-ui/src/lib/client-tools.spec.ts`, alongside the existing `pending` tests that build a store with `toolCalls` and `isLoading: false`, add:

```ts
  it('limits pending to the ids the run outcome declared', () => {
    const store = makeStore();
    store.toolCalls.set([
      { id: 'a', name: 'ask', args: {}, status: 'complete' },
      { id: 'b', name: 'ask', args: {}, status: 'complete' },
    ]);
    store.pendingClientToolCallIds?.set(new Set(['b']));
    const cap = createClientToolsCapability(source, store, continueRun);
    cap.setCatalog([{ name: 'ask', description: '', parameters: {} }]);
    expect(cap.pending().map((tc) => tc.id)).toEqual(['b']);
  });
```

Extend that file's `makeStore` with `pendingClientToolCallIds: signal<ReadonlySet<string> | undefined>(undefined),`.

- [ ] **Step 5: Run, expect failure**

Run: `npx nx test ag-ui -- src/lib/client-tools.spec.ts -t "declared"`
Expected: FAIL (both ids returned).

- [ ] **Step 6: Implement in the reducer and capability**

`ReducerStore`, after `usage?`:

```ts
  /** `outcome.pendingToolCallIds` from the latest successful RUN_FINISHED;
   *  undefined when the producer named none. Optional for the same reason as
   *  `usage`. */
  pendingClientToolCallIds?: WritableSignal<ReadonlySet<string> | undefined>;
```

`RUN_STARTED`: `store.pendingClientToolCallIds?.set(undefined);`
`RUN_FINISHED`, immediately before the final `if (!run || !finalizeDeliveryRun(store, run, 'success')) return;`:

```ts
      const pendingIds = Array.isArray(outcome?.pendingToolCallIds)
        ? new Set(outcome.pendingToolCallIds.filter((id): id is string => typeof id === 'string'))
        : undefined;
      store.pendingClientToolCallIds?.set(pendingIds && pendingIds.size > 0 ? pendingIds : undefined);
```

`client-tools.ts` `pending` computed:

```ts
      return selectPendingClientToolCalls({
        isLoading: store.isLoading(),
        toolCalls: store.toolCalls(),
        catalogNames: new Set(catalog().map((s) => s.name)),
        resolvedIds: resolvedIds(),
        authoritativeIds: store.pendingClientToolCallIds?.(),
      });
```

`to-agent.ts` store literal: `pendingClientToolCallIds: signal<ReadonlySet<string> | undefined>(undefined),`.

- [ ] **Step 7: Reducer spec for the wiring**

In `reducer.spec.ts` (`makeStore` gets `pendingClientToolCallIds: signal<ReadonlySet<string> | undefined>(undefined),`):

```ts
  it('records pendingToolCallIds from a success outcome and clears them on the next run', () => {
    const store = makeStore();
    reduceEvent({ type: 'RUN_STARTED', threadId: 't', runId: 'r' } as never, store);
    reduceEvent({ type: 'RUN_FINISHED', threadId: 't', runId: 'r', outcome: { type: 'success', pendingToolCallIds: ['x'] } } as never, store);
    expect(store.pendingClientToolCallIds?.()).toEqual(new Set(['x']));
    reduceEvent({ type: 'RUN_STARTED', threadId: 't', runId: 'r2' } as never, store);
    expect(store.pendingClientToolCallIds?.()).toBeUndefined();
  });
```

- [ ] **Step 8: Run all three files and mutation-check**

Run: `npx nx test ag-ui -- src/lib/client-tools.spec.ts src/lib/reducer.spec.ts && npx nx test chat -- src/lib/client-tools/select-pending-client-tool-calls.spec.ts`
Expected: PASS. Revert the `authoritativeIds:` line in `client-tools.ts`, confirm the "declared" test fails, restore.

- [ ] **Step 9: Commit**

```bash
git add libs/chat/src/lib/client-tools/select-pending-client-tool-calls.ts libs/chat/src/lib/client-tools/select-pending-client-tool-calls.spec.ts libs/ag-ui/src/lib/reducer.ts libs/ag-ui/src/lib/reducer.spec.ts libs/ag-ui/src/lib/client-tools.ts libs/ag-ui/src/lib/client-tools.spec.ts libs/ag-ui/src/lib/to-agent.ts
git commit -m "feat(chat,ag-ui): honor the run's declared pending tool-call ids"
```

---

### Task 8: Content-part tool results

**Files:**
- Create: `libs/ag-ui/src/lib/internal/content-parts.ts`, `content-parts.spec.ts`
- Modify: `libs/chat/src/lib/agent/tool-call.ts`
- Modify: `libs/ag-ui/src/lib/reducer.ts:320-329, 737-744, 371-388`
- Test: `libs/ag-ui/src/lib/reducer.spec.ts`

- [ ] **Step 1: Add `parts` to the neutral ToolCall**

`tool-call.ts`:

```ts
export interface ToolCall {
  id: string;
  name: string;
  /** Arguments. May be partial while streaming (`status !== 'complete'`). */
  args: unknown;
  status: ToolCallStatus;
  /** Present when status === 'complete' or 'error'. */
  result?: unknown;
  /** Optional error payload when status === 'error'. */
  error?: unknown;
  /**
   * Structured result parts when the runtime returned them (AG-UI 1.0
   * `ContentPart[]`). `result` then holds the concatenated text parts, which
   * may be empty for an all-media result. Runtime-specific shape.
   */
  parts?: readonly unknown[];
}
```

- [ ] **Step 2: Write the mapper spec**

`libs/ag-ui/src/lib/internal/content-parts.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { toolResultFromContent, messageContentFromParts } from './content-parts';

const text = { type: 'text', text: '{"hits":3}' };
const urlImage = { type: 'image', source: { type: 'url', value: 'https://x/y.png', mimeType: 'image/png' } };
const dataAudio = { type: 'audio', source: { type: 'data', value: 'AAAA', mimeType: 'audio/wav' } };

describe('toolResultFromContent', () => {
  it('parses a string result as JSON when possible', () => {
    expect(toolResultFromContent('{"hits":3}')).toEqual({ result: { hits: 3 } });
    expect(toolResultFromContent('plain')).toEqual({ result: 'plain' });
  });

  it('joins text parts and keeps every part', () => {
    expect(toolResultFromContent([text, urlImage])).toEqual({
      result: { hits: 3 },
      parts: [text, urlImage],
    });
  });

  it('yields an empty-string result for an all-media list', () => {
    expect(toolResultFromContent([dataAudio])).toEqual({ result: '', parts: [dataAudio] });
  });

  it('passes through non-string, non-array content untouched', () => {
    expect(toolResultFromContent({ hits: 3 })).toEqual({ result: { hits: 3 } });
  });
});

describe('messageContentFromParts', () => {
  it('maps text and url images to chat blocks and files the rest under extra', () => {
    expect(messageContentFromParts([text, urlImage, dataAudio])).toEqual({
      content: [
        { type: 'text', text: '{"hits":3}' },
        { type: 'image', url: 'https://x/y.png' },
      ],
      extra: { 'ag-ui': { parts: [dataAudio] } },
    });
  });

  it('returns no extra when every part mapped', () => {
    expect(messageContentFromParts([text])).toEqual({ content: [{ type: 'text', text: '{"hits":3}' }] });
  });
});
```

- [ ] **Step 3: Run, expect failure**

Run: `npx nx test ag-ui -- src/lib/internal/content-parts.spec.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement the mapper**

`libs/ag-ui/src/lib/internal/content-parts.ts`:

```ts
import type { ContentBlock } from '@threadplane/chat';

interface PartLike { type?: unknown; text?: unknown; source?: { type?: unknown; value?: unknown } }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function safeParseJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; }
}

function textOf(parts: readonly unknown[]): string {
  return parts
    .filter((p): p is PartLike & { text: string } => isRecord(p) && p['type'] === 'text' && typeof p['text'] === 'string')
    .map((p) => p.text)
    .join('');
}

/**
 * Normalize a TOOL_CALL_RESULT / ToolMessage `content` (string | ContentPart[]
 * in AG-UI 1.0) into the neutral ToolCall fields. Strings keep the pre-1.0
 * behavior (JSON parse with fallback). Part lists concatenate their text parts
 * into `result` and carry every part verbatim in `parts`; an all-media list
 * yields '' rather than an invented placeholder.
 */
export function toolResultFromContent(content: unknown): { result: unknown; parts?: readonly unknown[] } {
  if (typeof content === 'string') return { result: safeParseJson(content) };
  if (Array.isArray(content)) {
    const joined = textOf(content);
    return { result: joined.length > 0 ? safeParseJson(joined) : '', parts: content };
  }
  return { result: content };
}

/**
 * Map a tool message's part list to chat content blocks. Text and URL-sourced
 * images have neutral blocks; everything else is preserved under
 * `extra['ag-ui'].parts` so nothing the producer sent is dropped.
 */
export function messageContentFromParts(
  parts: readonly unknown[],
): { content: ContentBlock[]; extra?: Record<string, unknown> } {
  const content: ContentBlock[] = [];
  const rest: unknown[] = [];
  for (const part of parts) {
    if (!isRecord(part)) { rest.push(part); continue; }
    const source = isRecord(part['source']) ? part['source'] : undefined;
    if (part['type'] === 'text' && typeof part['text'] === 'string') {
      content.push({ type: 'text', text: part['text'] });
    } else if (part['type'] === 'image' && source?.['type'] === 'url' && typeof source['value'] === 'string') {
      content.push({ type: 'image', url: source['value'] });
    } else {
      rest.push(part);
    }
  }
  return rest.length > 0 ? { content, extra: { 'ag-ui': { parts: rest } } } : { content };
}
```

Run Step 3's command. Expected: PASS.

- [ ] **Step 5: Reducer specs for the two result handlers and the snapshot**

In `reducer.spec.ts`:

```ts
describe('content-part tool results', () => {
  const parts = [
    { type: 'text', text: '{"ok":true}' },
    { type: 'image', source: { type: 'url', value: 'https://x/y.png' } },
  ];

  it('TOOL_CALL_RESULT with parts sets result text and keeps parts', () => {
    const store = makeStore();
    reduceEvent({ type: 'RUN_STARTED', threadId: 't', runId: 'r' } as never, store);
    reduceEvent({ type: 'TOOL_CALL_START', toolCallId: 'c', toolCallName: 'look', parentMessageId: 'a' } as never, store);
    reduceEvent({ type: 'TOOL_CALL_END', toolCallId: 'c' } as never, store);
    reduceEvent({ type: 'TOOL_CALL_RESULT', messageId: 'tm', toolCallId: 'c', content: parts } as never, store);
    const call = store.toolCalls().find((t) => t.id === 'c');
    expect(call?.result).toEqual({ ok: true });
    expect(call?.parts).toEqual(parts);
  });

  it('MESSAGES_SNAPSHOT tool messages with parts become chat content blocks', () => {
    const store = makeStore();
    reduceEvent({ type: 'MESSAGES_SNAPSHOT', messages: [
      { id: 'u', role: 'user', content: 'hi' },
      { id: 'tm', role: 'tool', toolCallId: 'c', content: parts },
    ] } as never, store);
    const tool = store.messages().find((m) => m.id === 'tm');
    expect(tool?.content).toEqual([
      { type: 'text', text: '{"ok":true}' },
      { type: 'image', url: 'https://x/y.png' },
    ]);
  });
});
```

Add the same TOOL_CALL_RESULT-with-parts case to `reducer.subagent.spec.ts` for the routed (subagent-attributed) handler, asserting on the subagent activity entry's `toolCalls` the way the neighbouring tests do.

- [ ] **Step 6: Run, expect failure**

Run: `npx nx test ag-ui -- src/lib/reducer.spec.ts src/lib/reducer.subagent.spec.ts -t "content-part|parts"`
Expected: FAIL (`result` is the raw array; snapshot content is the raw parts).

- [ ] **Step 7: Wire the reducer**

Import at the top of `reducer.ts`: `import { toolResultFromContent, messageContentFromParts } from './internal/content-parts';`

Parent `TOOL_CALL_RESULT` handler (line ~320):

```ts
    case 'TOOL_CALL_RESULT': {
      const e = event as unknown as { toolCallId: string; content: unknown };
      const { result, parts } = toolResultFromContent(e.content);
      store.toolCalls.update((prev) =>
        prev.map((t) => t.id === e.toolCallId ? { ...t, result, ...(parts ? { parts } : {}) } : t),
      );
      return;
    }
```

Subagent-routed handler (line ~737):

```ts
      case 'TOOL_CALL_RESULT': {
        const { result, parts } = toolResultFromContent(e['content']);
        return { ...c, toolCalls: toolCalls.map((t) => (t['id'] === e['toolCallId'] ? { ...t, result, ...(parts ? { parts } : {}) } : t)) };
      }
```

`MESSAGES_SNAPSHOT` mapping, in the branch `if (m.role !== 'assistant' || !m.toolCalls || m.toolCalls.length === 0)`:

```ts
        if (m.role !== 'assistant' || !m.toolCalls || m.toolCalls.length === 0) {
          if (m.role === 'tool' && Array.isArray(m.content)) {
            const mapped = messageContentFromParts(m.content);
            snapshotMessage = {
              ...m,
              content: mapped.content,
              ...(mapped.extra ? { extra: { ...(isRecord(m['extra']) ? m['extra'] : {}), ...mapped.extra } } : {}),
            } as unknown as Omit<Message, 'delivery'>;
          } else {
            snapshotMessage = m as unknown as Omit<Message, 'delivery'>;
          }
        }
```

Change `AgUiSnapshotMessage.content` to `content?: string | unknown[];`. The `snapshotChanged` comparison at line ~391 compares `content` by reference; wrap both sides in `JSON.stringify` only when either is an array:

```ts
          const snapshotChanged = !sameContent(completedMessage.content, snapshotMessage.content)
            || !sameStringArray(completedMessage.toolCallIds, snapshotMessage.toolCallIds);
```

with, near `sameStringArray`:

```ts
function sameContent(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b);
  return false;
}
```

Delete the now-unused local `safeParseJson` from `reducer.ts` if `TOOL_CALL_RESULT` was its only caller (check with `grep -n safeParseJson libs/ag-ui/src/lib/reducer.ts`); keep it if `safeParseArgs` or another handler still uses it.

- [ ] **Step 8: Run the adapter suite and type checks; mutation-check**

Run: `npx nx test ag-ui && npx nx run ag-ui:type-tests && npx nx run chat:type-tests`
Expected: PASS. Revert the parent `TOOL_CALL_RESULT` change to the old two-liner, run `-t "parts"`, confirm the first new test fails, restore.

- [ ] **Step 9: Commit**

```bash
git add libs/chat/src/lib/agent/tool-call.ts libs/ag-ui/src/lib/internal/content-parts.ts libs/ag-ui/src/lib/internal/content-parts.spec.ts libs/ag-ui/src/lib/reducer.ts libs/ag-ui/src/lib/reducer.spec.ts libs/ag-ui/src/lib/reducer.subagent.spec.ts
git commit -m "feat(chat,ag-ui): carry content-part tool results through the neutral contract"
```

---

### Task 9: Mastra deployment on 1.0

**Files:**
- Modify: `deployments/ag-ui-mastra/package.json:15,24`, `deployments/ag-ui-mastra/package-lock.json`
- Modify: `deployments/ag-ui-mastra/test/service.test.mjs:167,193` (comments), `deployments/ag-ui-mastra/subagent-emitter.mjs:40-60` (comment), `deployments/ag-ui-mastra/README.md:65`

- [ ] **Step 1: Bump pins**

`package.json`: `"@ag-ui/mastra": "1.1.5"` and devDependency `"@ag-ui/client": "1.0.1"`.

- [ ] **Step 2: Regenerate the service lockfile (standalone package, no platform bindings concern)**

Run: `npm install --prefix deployments/ag-ui-mastra --package-lock-only --no-audit --no-fund && npm ci --prefix deployments/ag-ui-mastra --no-audit --no-fund`
Expected: exits 0; `grep -c '"@ag-ui/core": "1.0.1"' deployments/ag-ui-mastra/package-lock.json` is at least 1.

- [ ] **Step 3: Run the service tests**

Run: `npm test --prefix deployments/ag-ui-mastra`
Expected: PASS. If the round-trip test fails on `pendingInterrupts`, read the 1.0.1 release note (`connectAgent` coverage fix) and the test's comment at line 193; the adapter still clears the ledger before a `forwardedProps` resume, so the test's mirror of that stays.

- [ ] **Step 4: Update the version references in comments and README**

Replace `0.0.59` with `1.0.1` at `service.test.mjs:167` and `:193`, `subagent-emitter.mjs` header comment, and `README.md:65`.

- [ ] **Step 5: Commit**

```bash
git add deployments/ag-ui-mastra
git commit -m "chore(deployments): move ag-ui-mastra to @ag-ui/mastra 1.1.5 and client 1.0.1"
```

---

### Task 10: React-parity pins

**Files:**
- Modify: `scripts/react-parity/ag-ui-candidate-package.spec.mjs` (15 occurrences), `scripts/react-parity/verify-packages.spec.mjs:106`, `fixtures/react-parity/ag-ui-candidate/README.md:23`

- [ ] **Step 1: Replace the pins**

Run: `sed -i '' 's/0\.0\.59/1.0.1/g' scripts/react-parity/ag-ui-candidate-package.spec.mjs scripts/react-parity/verify-packages.spec.mjs fixtures/react-parity/ag-ui-candidate/README.md`
Then inspect `git diff scripts/react-parity/ag-ui-candidate-package.spec.mjs`: the `@ag-ui/proto`/`@ag-ui/encoder` nested pins and the `@bufbuild/protobuf@2.11.0` key must still match what `npm view @ag-ui/proto@1.0.1 dependencies` reports; adjust the protobuf version if it moved.

- [ ] **Step 2: Run the parity suites**

Run: `node --test scripts/react-parity/*.spec.mjs fixtures/react-parity/traces.spec.mjs`
Expected: PASS. `traces.spec.mjs` replays SSE through the real 1.0.1 `HttpAgent`; a failure there is a real behavior change, not a pin problem.

- [ ] **Step 3: Regenerate the parity evidence**

Run: `node scripts/react-parity/review-native-ag-ui.mjs --verify && node scripts/react-parity/verify-ag-ui-candidate.mjs`
Expected: both exit 0 and `fixtures/react-parity/baseline-evidence.json` now records `"node_modules/@ag-ui/client": "1.0.1"`. Commit whatever those scripts rewrote.

- [ ] **Step 4: Commit**

```bash
git add scripts/react-parity fixtures/react-parity
git commit -m "chore(react-parity): pin the AG-UI candidate on client 1.0.1"
```

---

### Task 11: Docs, changelog, generated context

**Files:**
- Modify: `README.md:66-67`, `libs/ag-ui/README.md:38`, `apps/website/content/docs/ag-ui/getting-started/installation.mdx:34-35`, `apps/website/content/docs/ag-ui/guides/interrupts.mdx:468`, `apps/website/content/docs/ag-ui/reference/event-mapping.mdx:79-81,105`, `CHANGELOG.md`, `apps/website/content/docs/chat/getting-started/changelog.mdx`

- [ ] **Step 1: Peer range copy**

`README.md` lines 66-67:

```
@ag-ui/client              ^1.0.1                          # @threadplane/ag-ui
@ag-ui/core                ^1.0.1                          # @threadplane/ag-ui
```

`libs/ag-ui/README.md:38`: `@ag-ui/client: ^1.0.1`, `@ag-ui/core: ^1.0.1`.

`installation.mdx` table rows: `` `^1.0.1` `` for both.

`interrupts.mdx` migration note, replace the first paragraph with:

```
Install `@ag-ui/client` and `@ag-ui/core` at `1.0.1` or later. The adapter declares `^1.0.1` peer dependencies: native interrupt validation now imports the protocol validators from `@ag-ui/core/schemas`, which the 0.0.x line does not ship. The 1.0 client translates streams from older servers itself, so the backend does not have to move at the same time.
```

- [ ] **Step 2: Event reference rows**

`event-mapping.mdx`, after the `RUN_FINISHED (outcome { type: 'interrupt' })` row:

```
| `RUN_FINISHED` (outcome `{ type: 'cancelled' }`) | `status`, `isLoading`, `messages` | Settles the run as `aborted`, returns to `idle`, and sets no error. The producer stopped the run on request. |
| `RUN_FINISHED` / `RUN_ERROR` with `usage` | `usage` | Replaces the optional `usage` signal with `{ entries }` for that run; cleared at the next `RUN_STARTED`. |
| `RUN_FINISHED` (success with `pendingToolCallIds`) | `clientTools.pending` | The listed ids become the authoritative pending set for client tools; absent means derive from the stream as before. |
```

Replace the `TOOL_CALL_RESULT` row:

```
| `TOOL_CALL_RESULT` | `toolCalls` | Stores the result on the matching call. A string is parsed as JSON when possible. A content-part list concatenates its text parts into `result` and keeps every part under `parts`. |
```

- [ ] **Step 3: Changelogs**

Prepend to `CHANGELOG.md` under a new heading for the upcoming version (the release tooling rewrites the number; keep the wording):

```
### 🚀 Features

- **ag-ui:** upgrade to AG-UI 1.0.1; the adapter now declares `^1.0.1` peers on `@ag-ui/client` and `@ag-ui/core`, imports validators from `@ag-ui/core/schemas`, declares `protocolVersion` on every run, and runs the private request path through the 1.0 compatibility boundary
- **chat:** `Agent.usage`, `ToolCall.parts`, and an `authoritativeIds` input to `selectPendingClientToolCalls`
- **ag-ui:** cancelled run outcomes settle as `aborted`; content-part tool results map to chat content blocks
```

Add a matching entry at the top of `changelog.mdx` under a new `## Next` heading with the same three bullets in prose form (no contractions, per the docs voice).

- [ ] **Step 4: Regenerate docs and agent context**

Run: `npm run generate-api-docs && npm run generate-agent-context`
Expected: both exit 0; `git status` shows changes under `apps/website/content/docs/*/api/api-docs.json` and `apps/website/public/`.

- [ ] **Step 5: Website build (test and lint do not type-check)**

Run: `npx nx build website`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add README.md libs/ag-ui/README.md apps/website/content apps/website/public CHANGELOG.md
git commit -m "docs(ag-ui): document the AG-UI 1.0.1 peer floor and the new contract fields"
```

---

### Task 12: Full verification and branch finish

- [ ] **Step 1: Library suites**

Run:

```bash
npx nx run-many -t test,lint,type-tests -p ag-ui chat react angular && npx nx run ag-ui:runtime-quality && npx nx run ag-ui:runtime-type-tests && npx nx build ag-ui && npx nx build chat
```

Expected: all PASS. Strip ANSI before grepping lint output for `error` (warnings are not failures).

- [ ] **Step 2: Revert the regenerated package version file if `nx test` touched it**

Run: `git status --short | grep package-version.ts` and `git checkout -- libs/*/src/lib/package-version.ts` if present (see memory: `nx test` rewrites it).

- [ ] **Step 3: Packaged consumer lane**

Run: `npx nx run-many -t build -p examples-chat-angular` then follow `.github/workflows/ci.yml` job `angular-compatibility` locally: `node examples/chat/smoke/consumer-package.mjs --angular 21` (read the script header for the exact flag). Expected: exits 0 for at least one Angular major; CI covers 20 and 22.

- [ ] **Step 4: Grep guards**

Run: `rg -n 'subAgents|SubAgentInfo|BackwardCompatibility_0_0_47|THINKING_' libs apps/website/content --glob '!*.json'`
Expected: no hits outside the spec added in Task 4.

- [ ] **Step 5: Live-LLM smoke**

With the deployed ag-ui runtimes (still on ag-ui-protocol 0.1.22 until PR 2), run the examples e2e against them per the live-smoke gate in memory; the new client must translate the old servers' streams without a visible change. Record the run URL in the PR body.

- [ ] **Step 6: Open the PR**

Follow `superpowers:finishing-a-development-branch`. PR body lists: the peer-floor break, the new contract fields, and that PR 2 (Python) follows.
