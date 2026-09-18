# Stream Interruption Detection and Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Report an agent stream that closes without terminal evidence as an interruption, and offer only the recovery action the adapter can justify.

**Architecture:** Three layers. The shared `@threadplane/chat` layer gains two optional fields on `AgentError` (`recovery`, `detail`) and one optional `checkStatus` action on the `Agent` contract; the shared error component renders one of three branches from those. The AG-UI adapter stops settling an evidence-free close as `success`, classifies recovery from what it dispatched, and uses its optional interrupt reconciler as the read-only check. The LangGraph adapter stops inferring `success` from "no assistant chunk seen" and reads back the thread history it already refreshes on close. Neither adapter ever resubmits, and no timeout or polling is introduced.

**Tech Stack:** TypeScript, Angular signals, RxJS, Vitest, Nx. Libraries `libs/chat`, `libs/ag-ui`, `libs/langgraph`.

**Design spec:** `docs/superpowers/specs/2026-09-17-stream-interruption-recovery-design.md`

---

## File Structure

**Created:**
- `libs/ag-ui/src/lib/to-agent.interruption-recovery.spec.ts` — every AG-UI close-classification case, kept out of the already-large `to-agent.spec.ts`.

**Modified:**
- `libs/chat/src/lib/agent/agent-error.ts` — `recovery` / `detail` fields; `AGENT_RECOVERY_MESSAGES` record.
- `libs/chat/src/lib/agent/agent.ts` — optional `checkStatus` member on `Agent`.
- `libs/chat/src/lib/agent/index.ts` — export the new symbols.
- `libs/chat/src/lib/primitives/chat-error/chat-error.component.ts` — three render branches.
- `libs/chat/src/lib/primitives/chat-error/chat-error.component.spec.ts` — branch coverage.
- `libs/chat/src/lib/testing/mock-agent.ts` — optional `checkStatus` on the test double.
- `libs/ag-ui/src/lib/to-agent.ts` — `settleTransportClose`, recovery classification, `checkStatus`.
- `libs/langgraph/src/lib/internals/stream-manager.bridge.ts` — `finishOutcome`, `finalizeClosedAttempt`, `checkStatus` on the bridge surface.
- `libs/langgraph/src/lib/internals/stream-manager.bridge.spec.ts` — close-outcome coverage.
- `libs/langgraph/src/lib/agent.fn.ts` — expose `checkStatus` on the returned agent.
- `libs/langgraph/src/lib/agent.types.ts` — bridge surface type.
- `apps/website/content/docs/**` — the `retryable` semantics change.

**Responsibility boundaries.** `agent-error.ts` owns classification vocabulary and copy and knows nothing about either protocol. Each adapter owns its own evidence rules and never imports the other's. The error component reads only the shared contract, so neither adapter's protocol leaks into shared UI.

---

### Task 1: `AgentError` carries a recovery action and a detail sentence

**Files:**
- Modify: `libs/chat/src/lib/agent/agent-error.ts`
- Modify: `libs/chat/src/lib/agent/index.ts`
- Test: `libs/chat/src/lib/agent/to-agent-error.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `libs/chat/src/lib/agent/to-agent-error.spec.ts`:

```ts
import { AGENT_RECOVERY_MESSAGES, type AgentRecovery } from './agent-error';

describe('AgentError recovery', () => {
  it('defaults recovery and detail to undefined', () => {
    const err = new AgentError({ kind: 'server', message: 'boom', retryable: true });
    expect(err.recovery).toBeUndefined();
    expect(err.detail).toBeUndefined();
  });

  it('carries an explicit recovery and detail', () => {
    const err = new AgentError({
      kind: 'interrupted',
      message: AGENT_RECOVERY_MESSAGES.check,
      retryable: false,
      recovery: 'check',
      detail: 'The reservation may already exist.',
    });
    expect(err.recovery).toBe('check');
    expect(err.detail).toBe('The reservation may already exist.');
    expect(err.retryable).toBe(false);
  });

  it('has distinct copy for each recovery value', () => {
    const values: AgentRecovery[] = ['retry', 'check', 'none'];
    const copy = values.map(value => AGENT_RECOVERY_MESSAGES[value]);
    expect(new Set(copy).size).toBe(3);
    for (const line of copy) expect(line.length).toBeGreaterThan(0);
  });

  it('leaves toAgentError classification untouched', () => {
    expect(toAgentError(new Error('HTTP 500')).recovery).toBeUndefined();
    expect(toAgentError(new Error('HTTP 401')).recovery).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
npx nx test chat --testFile=libs/chat/src/lib/agent/to-agent-error.spec.ts --skip-nx-cache
```

Expected: FAIL. `AGENT_RECOVERY_MESSAGES` is not exported from `./agent-error`.

- [ ] **Step 3: Add the type, fields and copy**

In `libs/chat/src/lib/agent/agent-error.ts`, add above the `AgentError` class:

```ts
/**
 * What the adapter can safely offer after an unexpectedly closed stream:
 *
 * - `retry` — the request is known not to have been dispatched. Re-running it
 *   cannot duplicate server-side work.
 * - `check` — the outcome is uncertain and the backend supports a read-only
 *   status check. The adapter has already made one automatic check.
 * - `none` — the outcome is uncertain and nothing can verify it. Explain, and
 *   offer no action.
 */
export type AgentRecovery = 'retry' | 'check' | 'none';

/** Human-facing copy per {@link AgentRecovery}, used for `interrupted` errors. */
export const AGENT_RECOVERY_MESSAGES: Record<AgentRecovery, string> = {
  retry: 'The response was interrupted before it started. Try again.',
  check: 'The connection dropped. The request may still have completed on the server.',
  none: 'The connection dropped. We could not confirm whether the request completed.',
};
```

Add two readonly members to the class, after `status`:

```ts
  /**
   * The recovery action the adapter can justify. Only set on `interrupted`
   * errors; always `undefined` for every other {@link AgentErrorKind}.
   */
  readonly recovery?: AgentRecovery;
  /** A short sentence explaining uncertainty. Set only when `recovery` is `check` or `none`. */
  readonly detail?: string;
```

Widen the constructor init type and assign them:

```ts
  constructor(init: {
    kind: AgentErrorKind;
    message: string;
    retryable: boolean;
    status?: number;
    cause?: unknown;
    recovery?: AgentRecovery;
    detail?: string;
  }) {
    super(init.message);
    this.name = 'AgentError';
    this.kind = init.kind;
    this.retryable = init.retryable;
    this.status = init.status;
    this.cause = init.cause;
    this.recovery = init.recovery;
    this.detail = init.detail;
  }
```

Update the `retryable` doc comment on the class member to:

```ts
  /** Whether retrying the same request could plausibly succeed:
   *  `connection` | `server` (5xx) → true; `auth` | `aborted` | non-auth `4xx` → false.
   *  For `interrupted`, this tracks {@link AgentRecovery}: true only when `recovery`
   *  is `retry`, because a dispatched request may already have run on the server. */
```

Update the `interrupted` line in the `AgentErrorKind` doc block to:

```
 * - `interrupted` — the stream closed mid-response after a run had started. Retryable only
 *   when `recovery` is `retry`; see {@link AgentRecovery}.
```

- [ ] **Step 4: Export the new symbols**

In `libs/chat/src/lib/agent/index.ts`, replace the two `agent-error` lines with:

```ts
export { AgentError, AGENT_ERROR_MESSAGES, AGENT_RECOVERY_MESSAGES } from './agent-error';
export type { AgentErrorKind, AgentRecovery } from './agent-error';
```

- [ ] **Step 5: Run the test and verify it passes**

```bash
npx nx test chat --testFile=libs/chat/src/lib/agent/to-agent-error.spec.ts --skip-nx-cache
```

Expected: PASS, including the four new cases.

- [ ] **Step 6: Commit**

```bash
git add libs/chat/src/lib/agent/agent-error.ts libs/chat/src/lib/agent/index.ts libs/chat/src/lib/agent/to-agent-error.spec.ts
git commit -m "feat(chat): AgentError carries a recovery action and detail

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The `Agent` contract gains an optional `checkStatus`

**Files:**
- Modify: `libs/chat/src/lib/agent/agent.ts`
- Modify: `libs/chat/src/lib/testing/mock-agent.ts`
- Test: `libs/chat/src/lib/agent/agent.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `libs/chat/src/lib/agent/agent.spec.ts`:

`agent.spec.ts` builds agents as bare object literals typed as `Agent`, and imports only `signal` from Angular and the `Agent` type. Follow that existing pattern rather than introducing the mock helper:

```ts
describe('Agent.checkStatus', () => {
  const base = (): Agent => ({
    messages: signal([]),
    status: signal('idle'),
    isLoading: signal(false),
    error: signal(undefined),
    toolCalls: signal([]),
    state: signal({}),
    submit: async () => Promise.resolve(),
    stop: async () => Promise.resolve(),
    retry: async () => Promise.resolve(),
  });

  it('is optional — an agent without it still satisfies the contract', () => {
    expect(base().checkStatus).toBeUndefined();
  });

  it('is callable when a runtime provides one', async () => {
    let calls = 0;
    const agent: Agent = { ...base(), checkStatus: async () => { calls++; } };
    await agent.checkStatus?.();
    expect(calls).toBe(1);
  });
});
```

The existing file may already declare a helper equivalent to `base()`; reuse it if so rather than adding a second one.

- [ ] **Step 2: Run the test and verify it fails**

```bash
npx nx test chat --testFile=libs/chat/src/lib/agent/agent.spec.ts --skip-nx-cache
```

Expected: FAIL. `checkStatus` does not exist on type `Agent`.

- [ ] **Step 3: Add the member to the contract**

In `libs/chat/src/lib/agent/agent.ts`, add directly after the `clientTools` member in the "Extended (optional…)" block:

```ts
  /**
   * Optional read-only reconciliation of an uncertain run outcome, offered when
   * `error().recovery === 'check'`. Asks the backend what happened; never
   * resubmits the operation and never appends a message. Rejects while a
   * request is in flight. A result that arrives after a newer request has
   * started is discarded.
   */
  checkStatus?: () => Promise<void>;
```

- [ ] **Step 4: Confirm the mock does not need a stub**

`libs/chat/src/lib/testing/mock-agent.ts` declares `MockAgent extends Agent`, so an optional member needs no stub there. Leave that file untouched: `mockAgent()` must NOT define a `checkStatus`, because later component tests attach one only for the branch that requires it.

- [ ] **Step 5: Guard the contract in the type-tests target**

Vitest runs through esbuild and does not type-check, so neither runtime test above can fail if `checkStatus` is removed from the interface. The real guard is the `type-tests` target, which runs `tsc --noEmit` over the `*.type-spec.ts` files.

`libs/chat/src/lib/agent/agent-error.type-spec.ts` is already the de-facto Agent contract type-spec: it asserts `Agent['error']` and `Agent['retry']` despite its name. Add one line there in the same style:

```ts
type _checkStatus = Expect<Equal<Agent['checkStatus'], (() => Promise<void>) | undefined>>;
```

Do not create a new file. Run:

```bash
npx nx type-tests chat --skip-nx-cache
```

Expected: PASS. Then prove it is load-bearing: temporarily delete the `checkStatus` member from `agent.ts`, re-run, confirm it FAILS, and restore. Use the Nx target or `node ./node_modules/typescript/bin/tsc`; bare `npx tsc` resolves to a different, older compiler in this repo.

- [ ] **Step 6: Run the test and verify it passes**

```bash
npx nx test chat --testFile=libs/chat/src/lib/agent/agent.spec.ts --skip-nx-cache
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add libs/chat/src/lib/agent/agent.ts libs/chat/src/lib/agent/agent.spec.ts libs/chat/src/lib/agent/agent-error.type-spec.ts
git commit -m "feat(chat): add an optional checkStatus action to the Agent contract

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The error component renders three recovery branches

**Files:**
- Modify: `libs/chat/src/lib/primitives/chat-error/chat-error.component.ts`
- Test: `libs/chat/src/lib/primitives/chat-error/chat-error.component.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `libs/chat/src/lib/primitives/chat-error/chat-error.component.spec.ts`, inside a new `describe`:

```ts
describe('ChatErrorComponent — interruption recovery', () => {
  function render(error: AgentError, checkStatus?: () => Promise<void>) {
    const fixture = TestBed.createComponent(HostComponent);
    const agent = mockAgent();
    agent.error.set(error);
    if (checkStatus) (agent as { checkStatus?: () => Promise<void> }).checkStatus = checkStatus;
    fixture.componentInstance.agent = agent;
    fixture.detectChanges();
    return { fixture, agent, el: fixture.nativeElement as HTMLElement };
  }

  const interrupted = (recovery: 'retry' | 'check' | 'none', detail?: string) =>
    new AgentError({
      kind: 'interrupted',
      message: `interrupted-${recovery}`,
      retryable: recovery === 'retry',
      recovery,
      detail,
    });

  it('renders Retry when recovery is retry', () => {
    const { el } = render(interrupted('retry'));
    expect(el.querySelector('.chat-error__retry')?.textContent).toContain('Retry');
    expect(el.querySelector('.chat-error__check')).toBeNull();
  });

  it('renders Check status when recovery is check and the agent supports it', () => {
    const checkStatus = vi.fn(async () => undefined);
    const { el } = render(interrupted('check'), checkStatus);
    const button = el.querySelector('.chat-error__check') as HTMLButtonElement | null;
    expect(button?.textContent).toContain('Check status');
    expect(el.querySelector('.chat-error__retry')).toBeNull();
    button?.click();
    expect(checkStatus).toHaveBeenCalledOnce();
  });

  it('renders no button when recovery is check but the agent cannot verify', () => {
    const { el } = render(interrupted('check'));
    expect(el.querySelector('.chat-error__check')).toBeNull();
    expect(el.querySelector('.chat-error__retry')).toBeNull();
  });

  it('renders the detail sentence and no button when recovery is none', () => {
    const { el } = render(interrupted('none', 'We could not confirm the booking.'));
    expect(el.querySelector('.chat-error__detail')?.textContent).toContain('We could not confirm the booking.');
    expect(el.querySelector('.chat-error__retry')).toBeNull();
    expect(el.querySelector('.chat-error__check')).toBeNull();
  });

  it('still renders Retry for a retryable non-interrupted error', () => {
    const { el } = render(new AgentError({ kind: 'server', message: 'boom', retryable: true }));
    expect(el.querySelector('.chat-error__retry')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
npx nx test chat --testFile=libs/chat/src/lib/primitives/chat-error/chat-error.component.spec.ts --skip-nx-cache
```

Expected: FAIL. No element matches `.chat-error__check`, and the retry button renders for the `check` case because `retryable` is false but the template has no `recovery` branch.

- [ ] **Step 3: Add the branches to the template**

In `libs/chat/src/lib/primitives/chat-error/chat-error.component.ts`, replace the single `@if (err.retryable)` block with:

```html
        @if (err.detail) {
          <span class="chat-error__detail">{{ err.detail }}</span>
        }
        @if (err.recovery === 'check') {
          @if (agent().checkStatus; as check) {
            <button type="button" class="chat-error__check" (click)="check()">Check status</button>
          }
        } @else if (err.retryable) {
          <button type="button" class="chat-error__retry" (click)="agent().retry()">Retry</button>
        }
```

Note the ordering: the `check` branch is tested first so an interrupted error with `recovery: 'check'` never falls through to Retry even if a caller constructed it with `retryable: true`.

- [ ] **Step 4: Add the two new style rules**

In `libs/chat/src/lib/styles/chat-error.styles.ts`, make three edits.

First, the `.chat-error` container is a `display: flex` row with no wrapping, so a full-width detail line would be squeezed onto the same row. Add wrapping to it:

```css
    flex-wrap: wrap;
```

Second, the three button rules are declared as `.chat-error__retry`, `.chat-error__retry:hover` and `.chat-error__retry:focus-visible`. Add the check button to each selector so both buttons share one appearance, without duplicating any declarations:

```css
  .chat-error__retry, .chat-error__check { /* existing declarations unchanged */ }
  .chat-error__retry:hover, .chat-error__check:hover { /* unchanged */ }
  .chat-error__retry:focus-visible, .chat-error__check:focus-visible { /* unchanged */ }
```

Third, add a detail rule after `.chat-error__msg`:

```css
  .chat-error__detail {
    flex-basis: 100%;
    margin-left: 24px;
    font-size: var(--tplane-chat-font-size-sm);
    opacity: 0.85;
  }
```

The `margin-left` aligns the detail under the message text rather than under the 16px icon plus its 0.5rem gap.

- [ ] **Step 5: Run the test and verify it passes**

```bash
npx nx test chat --testFile=libs/chat/src/lib/primitives/chat-error/chat-error.component.spec.ts --skip-nx-cache
```

Expected: PASS, all five new cases plus the existing suite.

- [ ] **Step 6: Commit**

```bash
git add libs/chat/src/lib/primitives/chat-error libs/chat/src/lib/styles/chat-error.styles.ts
git commit -m "feat(chat): chat-error renders retry, check status, or an explanation

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: AG-UI treats an evidence-free close as an interruption

**Files:**
- Modify: `libs/ag-ui/src/lib/to-agent.ts:389-405` (`settleTransportClose`)
- Create: `libs/ag-ui/src/lib/to-agent.interruption-recovery.spec.ts`

Read `libs/ag-ui/src/lib/to-agent.spec.ts` lines 1-200 first. Reuse its `StubAgent` class and its telemetry `vi.mock` block verbatim in the new file; the mock is required because the module under test calls `createDevelopmentRuntime` at construction.

- [ ] **Step 1: Write the failing test**

Create `libs/ag-ui/src/lib/to-agent.interruption-recovery.spec.ts` with the copied mock and `StubAgent`, then:

```ts
describe('AG-UI unexpected close', () => {
  it('reports a stream that closed with no events as an interruption', async () => {
    const stub = new StubAgent();
    const agent = toAgent(stub as unknown as AbstractAgent);
    stub.runAgent.mockImplementationOnce(async () => ({ result: undefined, newMessages: [] }));

    await agent.submit({ content: 'hello' });

    const err = agent.error();
    expect(err).toBeInstanceOf(AgentError);
    expect(err?.kind).toBe('interrupted');
    expect(agent.status()).toBe('error');
    expect(agent.isLoading()).toBe(false);
  });

  it('reports a stream truncated after RUN_STARTED as an interruption and keeps partial text', async () => {
    const stub = new StubAgent();
    const agent = toAgent(stub as unknown as AbstractAgent);
    stub.runAgent.mockImplementationOnce(async () => {
      stub.emit({ type: 'RUN_STARTED', runId: 'r1' } as BaseEvent);
      stub.emit({ type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' } as unknown as BaseEvent);
      stub.emit({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'partial' } as unknown as BaseEvent);
      return { result: undefined, newMessages: [] };
    });

    await agent.submit({ content: 'hello' });

    expect(agent.error()?.kind).toBe('interrupted');
    expect(agent.messages().some(m => String(m.content).includes('partial'))).toBe(true);
  });

  it('does not report an interruption for a valid RUN_FINISHED', async () => {
    const stub = new StubAgent();
    const agent = toAgent(stub as unknown as AbstractAgent);
    stub.runAgent.mockImplementationOnce(async () => {
      stub.emit({ type: 'RUN_STARTED', runId: 'r1' } as BaseEvent);
      stub.emit({ type: 'RUN_FINISHED', runId: 'r1' } as BaseEvent);
      return { result: undefined, newMessages: [] };
    });

    await agent.submit({ content: 'hello' });

    expect(agent.error()).toBeUndefined();
    expect(agent.status()).toBe('idle');
  });

  it('does not report an interruption for a valid approval pause', async () => {
    const stub = new StubAgent();
    const agent = toAgent(stub as unknown as AbstractAgent);
    stub.runAgent.mockImplementationOnce(async () => {
      stub.emit({ type: 'RUN_STARTED', runId: 'r1' } as BaseEvent);
      stub.emit({
        type: 'RUN_FINISHED',
        runId: 'r1',
        outcome: { type: 'interrupt', interrupts: [{ id: 'i1', value: { question: 'ok?' }, reason: '' }] },
      } as unknown as BaseEvent);
      return { result: undefined, newMessages: [] };
    });

    await agent.submit({ content: 'book it' });

    expect(agent.error()).toBeUndefined();
    expect(agent.interrupt()).toBeDefined();
  });

  it('keeps an explicit RUN_ERROR classified as an error, not an interruption', async () => {
    const stub = new StubAgent();
    const agent = toAgent(stub as unknown as AbstractAgent);
    stub.runAgent.mockImplementationOnce(async () => {
      stub.emit({ type: 'RUN_STARTED', runId: 'r1' } as BaseEvent);
      stub.emit({ type: 'RUN_ERROR', runId: 'r1', message: 'HTTP 500' } as unknown as BaseEvent);
      return { result: undefined, newMessages: [] };
    });

    await agent.submit({ content: 'hello' });

    expect(agent.error()?.kind).toBe('server');
    expect(agent.error()?.recovery).toBeUndefined();
  });

  it('does not report an interruption when the user stops', async () => {
    const stub = new StubAgent();
    const agent = toAgent(stub as unknown as AbstractAgent);
    stub.runAgent.mockImplementationOnce(async () => {
      stub.emit({ type: 'RUN_STARTED', runId: 'r1' } as BaseEvent);
      await agent.stop();
      return { result: undefined, newMessages: [] };
    });

    await agent.submit({ content: 'hello' });

    expect(agent.error()).toBeUndefined();
    expect(agent.status()).toBe('idle');
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
npx nx test ag-ui --testFile=libs/ag-ui/src/lib/to-agent.interruption-recovery.spec.ts --skip-nx-cache
```

Expected: the first two cases FAIL — `agent.error()` is `undefined` and status is `'idle'`, because `settleTransportClose` clears the error. The last two cases PASS already.

- [ ] **Step 3: Rewrite `settleTransportClose`**

Replace the body of `settleTransportClose` in `libs/ag-ui/src/lib/to-agent.ts` with:

```ts
  function settleTransportClose(run: AdapterRun): void {
    if (run.outcome === undefined) {
      if (run.terminalReceived) {
        // A valid RUN_FINISHED / RUN_ERROR already settled the protocol.
        finalizeDeliveryRun(store, run, 'success');
        if (activeRun === run) {
          store.status.set('idle');
          store.isLoading.set(false);
          store.error.set(undefined);
        }
        finishRunTelemetry(run);
        return;
      }
      // No terminal evidence and no user stop: the stream closed unexpectedly.
      if (run.resumeAttempt) {
        rollbackState();
        interrupts.fail(run.resumeAttempt.id, false);
        publishInterrupt();
        void persistCurrent().catch(() => undefined);
      }
      finalizeDeliveryRun(store, run, 'interrupted');
      if (activeRun === run) {
        store.status.set('error');
        store.isLoading.set(false);
        store.error.set(interruptionError(run));
      }
    }
    finishRunTelemetry(run);
  }
```

Add a temporary classifier above it; Task 5 replaces its body:

```ts
  function interruptionError(_run: AdapterRun): AgentError {
    return new AgentError({
      kind: 'interrupted',
      message: AGENT_RECOVERY_MESSAGES.none,
      retryable: false,
      recovery: 'none',
    });
  }
```

Add `AGENT_RECOVERY_MESSAGES` to the existing `@threadplane/chat` import at the top of the file.

- [ ] **Step 4: Run the test and verify it passes**

```bash
npx nx test ag-ui --testFile=libs/ag-ui/src/lib/to-agent.interruption-recovery.spec.ts --skip-nx-cache
```

Expected: PASS, all four cases.

- [ ] **Step 5: Run the whole AG-UI suite and fix fallout**

```bash
npx nx test ag-ui --skip-nx-cache
```

Expected: some existing cases FAIL because they asserted `status === 'idle'` or `error() === undefined` after a silent close. For each failure, decide from the event sequence whether the close carried terminal evidence. If it did not, the new expectation is `status === 'error'` and an `interrupted` error — update the assertion. Do NOT weaken the new behavior to keep an old assertion green.

- [ ] **Step 6: Commit**

```bash
git add libs/ag-ui/src/lib
git commit -m "fix(ag-ui): a stream that closes without terminal evidence is an interruption

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: AG-UI classifies the recovery action

**Files:**
- Modify: `libs/ag-ui/src/lib/to-agent.ts` (`interruptionError`, `AdapterRun`, `beginRun`)
- Test: `libs/ag-ui/src/lib/to-agent.interruption-recovery.spec.ts`

Recovery is `retry` only when nothing was dispatched: an ordinary submit whose stream produced no event at all. Anything after `RUN_STARTED`, and every resume attempt or client-tool continuation, may already have run server-side.

`check` is narrower than it first looks, so read `libs/ag-ui/src/lib/interrupt-persistence.ts` before writing the classifier. The reconciler's entire vocabulary is the interrupt session: its statuses are `pending`, `acknowledged`, `completed` and `unknown`, each tied by validation to a session phase and a correlated resume attempt. It has nothing authoritative to say about an ordinary turn, and `InterruptPersistence.reconcile()` returns `null` without calling the backend at all when no record has been persisted for the thread. So `check` requires BOTH a configured reconciler AND a resume attempt on the run. Everything else that was dispatched gets `none`.

| Close happened | Reconciler | Recovery |
| --- | --- | --- |
| No event at all, ordinary submit | either | `retry` |
| After `RUN_STARTED`, ordinary submit | either | `none` |
| Client-tool continuation | either | `none` |
| Resume attempt | yes | `check` |
| Resume attempt | no | `none` |

- [ ] **Step 1: Write the failing test**

Append to `libs/ag-ui/src/lib/to-agent.interruption-recovery.spec.ts`:

```ts
describe('AG-UI recovery classification', () => {
  it('offers retry when the stream produced no event on an ordinary submit', async () => {
    const stub = new StubAgent();
    const agent = toAgent(stub as unknown as AbstractAgent);
    stub.runAgent.mockImplementationOnce(async () => ({ result: undefined, newMessages: [] }));

    await agent.submit({ content: 'hello' });

    expect(agent.error()?.recovery).toBe('retry');
    expect(agent.error()?.retryable).toBe(true);
    expect(agent.error()?.message).toBe(AGENT_RECOVERY_MESSAGES.retry);
  });

  it('offers no check for an ordinary submit, even with a reconciler configured', async () => {
    const stub = new StubAgent();
    const reconcile = vi.fn(async () => ({ status: 'unknown' as const }));
    const agent = toAgent(stub as unknown as AbstractAgent, {
      persistence: memoryPersistence(reconcile) as never,
    });
    stub.runAgent.mockImplementationOnce(async () => {
      stub.emit({ type: 'RUN_STARTED', runId: 'r1' } as BaseEvent);
      return { result: undefined, newMessages: [] };
    });

    await agent.submit({ content: 'hello' });

    // The reconciler describes interrupt sessions. An ordinary turn carries no
    // correlated attempt, so there is nothing for it to answer.
    expect(agent.error()?.recovery).toBe('none');
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('does not offer retry once RUN_STARTED arrived without a reconciler', async () => {
    const stub = new StubAgent();
    const agent = toAgent(stub as unknown as AbstractAgent);
    stub.runAgent.mockImplementationOnce(async () => {
      stub.emit({ type: 'RUN_STARTED', runId: 'r1' } as BaseEvent);
      return { result: undefined, newMessages: [] };
    });

    await agent.submit({ content: 'hello' });

    expect(agent.error()?.recovery).toBe('none');
    expect(agent.error()?.retryable).toBe(false);
    expect(agent.error()?.detail).toBeTruthy();
  });

  it('does not offer retry after a tool call started', async () => {
    const stub = new StubAgent();
    const agent = toAgent(stub as unknown as AbstractAgent);
    stub.runAgent.mockImplementationOnce(async () => {
      stub.emit({ type: 'RUN_STARTED', runId: 'r1' } as BaseEvent);
      stub.emit({ type: 'TOOL_CALL_START', toolCallId: 't1', toolCallName: 'book' } as unknown as BaseEvent);
      return { result: undefined, newMessages: [] };
    });

    await agent.submit({ content: 'book it' });

    expect(agent.error()?.recovery).not.toBe('retry');
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
npx nx test ag-ui --testFile=libs/ag-ui/src/lib/to-agent.interruption-recovery.spec.ts --skip-nx-cache
```

Expected: the first case FAILS with `recovery` `'none'` instead of `'retry'`; the second FAILS on the missing `detail`.

- [ ] **Step 3: Track what the run was and whether anything was received**

Add two fields to the `AdapterRun` interface at `libs/ag-ui/src/lib/to-agent.ts:268`:

```ts
    requestType: string;
    sawAnyEvent?: boolean;
```

`beginRun(requestType, ...)` already receives the request type but discards it. Store it on the run it builds, alongside `startedAt`:

```ts
      requestType,
```

Set `sawAnyEvent` in the `onEvent` subscriber, immediately after the `if (run !== activeRun)` block and before the outcome guards:

```ts
      run.sawAnyEvent = true;
```

The request type matters because `executeRun` is called with six different ones. `submit`, `retry` and `regenerate` are ordinary turns whose input `retry()` can safely re-send. `resume` carries an interrupt decision and `client-tool-continuation` carries tool results, and neither may be replayed on a guess.

- [ ] **Step 4: Replace the classifier**

Replace `interruptionError` with:

```ts
  /**
   * Classify what recovery is safe after an unexpected close. `retry` requires
   * proof that nothing was dispatched: an ordinary submit whose stream produced
   * no event at all. A resume attempt or a client-tool continuation may have
   * committed server-side work, so it is never retryable here.
   */
  const REPLAYABLE_REQUEST_TYPES = new Set(['submit', 'retry', 'regenerate']);

  function interruptionError(run: AdapterRun): AgentError {
    const neverDispatched = !run.sawAnyEvent
      && !run.resumeAttempt
      && REPLAYABLE_REQUEST_TYPES.has(run.requestType);
    if (neverDispatched) {
      return new AgentError({
        kind: 'interrupted',
        message: AGENT_RECOVERY_MESSAGES.retry,
        retryable: true,
        recovery: 'retry',
      });
    }
    // The reconciler speaks only about interrupt sessions, so it can answer for
    // a resume attempt and for nothing else.
    const canVerify = persistence !== undefined && run.resumeAttempt !== undefined;
    const recovery = canVerify ? 'check' : 'none';
    return new AgentError({
      kind: 'interrupted',
      message: AGENT_RECOVERY_MESSAGES[recovery],
      retryable: false,
      recovery,
      detail: canVerify
        ? 'Checking will tell you whether it did.'
        : 'There is no way to confirm whether it did. Trying again could repeat it.',
    });
  }
```

- [ ] **Step 5: Run the test and verify it passes**

```bash
npx nx test ag-ui --testFile=libs/ag-ui/src/lib/to-agent.interruption-recovery.spec.ts --skip-nx-cache
```

Expected: PASS, all seven cases.

- [ ] **Step 6: Commit**

```bash
git add libs/ag-ui/src/lib
git commit -m "feat(ag-ui): classify interruption recovery from what was dispatched

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: AG-UI checks the reconciler once, automatically, and exposes `checkStatus`

**Files:**
- Modify: `libs/ag-ui/src/lib/to-agent.ts` (`settleTransportClose`, returned agent object at line ~640)
- Test: `libs/ag-ui/src/lib/to-agent.interruption-recovery.spec.ts`

Read `libs/ag-ui/src/lib/interrupt-persistence.ts` first. The adapter does not call the user's `reconcile` callback directly — it calls `InterruptPersistence.reconcile()`, which takes no arguments, validates the authoritative answer, writes it, and returns the updated `AgUiThreadRecord`. It **throws** when the backend answers `{ status: 'unknown' }` or when validation fails. The raw status is therefore invisible to the caller, so the outcome is read from `record.session.phase`:

| Session phase after reconcile | Outcome |
| --- | --- |
| `none` | success — clear the error, return to idle |
| `pending` | paused — a pending interrupt batch; the existing interrupt panel renders it |
| `acknowledged` or anything else | stays interrupted, `recovery: 'check'` |
| the call threw | stays interrupted, `recovery: 'check'` |

- [ ] **Step 1: Write the failing test**

Append to `libs/ag-ui/src/lib/to-agent.interruption-recovery.spec.ts`:

```ts
function memoryPersistence(reconcile?: () => Promise<unknown>) {
  const saved = new Map<string, unknown>();
  return {
    namespace: 'test',
    store: {
      load: async (key: string) => (saved.get(key) ?? null) as never,
      compareAndSwap: async (key: string, _rev: number | null, next: unknown) => {
        saved.set(key, next);
        return true;
      },
    },
    ...(reconcile ? { reconcile: reconcile as never } : {}),
  };
}

describe('AG-UI automatic status check', () => {
  it('offers check, not none, when a reconciler is configured', async () => {
    const stub = new StubAgent();
    const reconcile = vi.fn(async () => ({ status: 'unknown' as const }));
    const agent = toAgent(stub as unknown as AbstractAgent, {
      persistence: memoryPersistence(reconcile) as never,
    });
    stub.runAgent.mockImplementationOnce(async () => {
      stub.emit({ type: 'RUN_STARTED', runId: 'r1' } as BaseEvent);
      return { result: undefined, newMessages: [] };
    });

    await agent.submit({ content: 'hello' });

    expect(agent.error()?.recovery).toBe('check');
    expect(reconcile).toHaveBeenCalledOnce();
  });

  it('settles as success when reconciliation lands on a settled session', async () => {
    const stub = new StubAgent();
    const reconcile = vi.fn(async () => ({
      status: 'completed' as const,
      committed: { state: {}, messages: [] },
      session: { phase: 'none', generation: 0, interrupts: [] },
    }));
    const agent = toAgent(stub as unknown as AbstractAgent, {
      persistence: memoryPersistence(reconcile) as never,
    });
    stub.runAgent.mockImplementationOnce(async () => {
      stub.emit({ type: 'RUN_STARTED', runId: 'r1' } as BaseEvent);
      return { result: undefined, newMessages: [] };
    });

    await agent.submit({ content: 'hello' });

    expect(agent.error()).toBeUndefined();
    expect(agent.status()).toBe('idle');
  });

  it('stays uncertain when reconciliation lands on an acknowledged session', async () => {
    const stub = new StubAgent();
    const reconcile = vi.fn(async () => ({
      status: 'acknowledged' as const,
      committed: { state: {}, messages: [] },
      session: {
        phase: 'acknowledged',
        generation: 1,
        interrupts: [],
        attempt: { id: 'a1', runId: 'r1', input: { resume: 'yes' }, parameters: {}, generation: 1 },
      },
    }));
    const agent = toAgent(stub as unknown as AbstractAgent, {
      persistence: memoryPersistence(reconcile) as never,
    });
    stub.runAgent.mockImplementationOnce(async () => {
      stub.emit({ type: 'RUN_STARTED', runId: 'r1' } as BaseEvent);
      return { result: undefined, newMessages: [] };
    });

    await agent.submit({ content: 'hello' });

    expect(agent.error()?.recovery).toBe('check');
  });

  it('keeps recovery at check when the reconciler throws', async () => {
    const stub = new StubAgent();
    const reconcile = vi.fn(async () => { throw new Error('offline'); });
    const agent = toAgent(stub as unknown as AbstractAgent, {
      persistence: memoryPersistence(reconcile) as never,
    });
    stub.runAgent.mockImplementationOnce(async () => {
      stub.emit({ type: 'RUN_STARTED', runId: 'r1' } as BaseEvent);
      return { result: undefined, newMessages: [] };
    });

    await agent.submit({ content: 'hello' });

    expect(agent.error()?.recovery).toBe('check');
    expect(agent.error()?.kind).toBe('interrupted');
  });

  it('never offers retry when a resume attempt was truncated', async () => {
    const stub = new StubAgent();
    const agent = toAgent(stub as unknown as AbstractAgent);
    stub.runAgent.mockImplementationOnce(async () => {
      stub.emit({ type: 'RUN_STARTED', runId: 'r1' } as BaseEvent);
      stub.emit({
        type: 'RUN_FINISHED',
        runId: 'r1',
        outcome: { type: 'interrupt', interrupts: [{ id: 'i1', value: { question: 'ok?' }, reason: '' }] },
      } as unknown as BaseEvent);
      return { result: undefined, newMessages: [] };
    });
    await agent.submit({ content: 'book it' });
    expect(agent.interrupt()).toBeDefined();

    // Resume, then let the stream die before any event arrives.
    stub.runAgent.mockImplementationOnce(async () => ({ result: undefined, newMessages: [] }));
    await agent.submit({ resume: 'yes' });

    expect(agent.error()?.kind).toBe('interrupted');
    expect(agent.error()?.recovery).not.toBe('retry');
    expect(agent.error()?.retryable).toBe(false);
  });

  it('exposes checkStatus only when a reconciler is configured', () => {
    const plain = toAgent(new StubAgent() as unknown as AbstractAgent);
    expect(plain.checkStatus).toBeUndefined();
    const verifiable = toAgent(new StubAgent() as unknown as AbstractAgent, {
      persistence: memoryPersistence(async () => ({ status: 'unknown' as const })) as never,
    });
    expect(typeof verifiable.checkStatus).toBe('function');
  });

  it('discards a stale check that resolves after a newer submit', async () => {
    const stub = new StubAgent();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const reconcile = vi.fn(async () => {
      await gate;
      return {
        status: 'completed' as const,
        committed: { state: {}, messages: [] },
        session: { phase: 'none', generation: 0, interrupts: [] },
      };
    });
    const agent = toAgent(stub as unknown as AbstractAgent, {
      persistence: memoryPersistence(reconcile) as never,
    });
    stub.runAgent.mockImplementationOnce(async () => {
      stub.emit({ type: 'RUN_STARTED', runId: 'r1' } as BaseEvent);
      return { result: undefined, newMessages: [] };
    });
    const first = agent.submit({ content: 'one' });

    stub.runAgent.mockImplementationOnce(async () => {
      stub.emit({ type: 'RUN_STARTED', runId: 'r2' } as BaseEvent);
      stub.emit({ type: 'RUN_FINISHED', runId: 'r2' } as BaseEvent);
      return { result: undefined, newMessages: [] };
    });
    await agent.submit({ content: 'two' });
    const statusAfterSecond = agent.status();

    release();
    await first;

    expect(agent.status()).toBe(statusAfterSecond);
    expect(agent.error()).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
npx nx test ag-ui --testFile=libs/ag-ui/src/lib/to-agent.interruption-recovery.spec.ts --skip-nx-cache
```

Expected: FAIL. `reconcile` is never called on close, and `agent.checkStatus` is undefined.

- [ ] **Step 3: Make the close path run one automatic check**

In `libs/ag-ui/src/lib/to-agent.ts`, add above `settleTransportClose`:

```ts
  /**
   * One read-only reconciliation after an unexpected close. Never resubmits and
   * never repeats. Applies its result only while `run` is still the active run,
   * so a late answer cannot overwrite a newer request. A throw leaves the error
   * in place with `recovery: 'check'`, so the user can ask again later.
   */
  async function verifyClosedRun(run: AdapterRun): Promise<void> {
    if (!persistence || disposed || reconciling()) return;
    reconciling.set(true);
    let record: Awaited<ReturnType<typeof persistence.reconcile>> = null;
    try {
      await persistenceWrites.catch(() => undefined);
      record = await persistence.reconcile();
    } catch {
      return;
    } finally {
      reconciling.set(false);
    }
    if (disposed || activeRun !== run || !record) return;

    // `reconcile()` throws on an unauthoritative answer, so reaching here means
    // the record is authoritative. Its session phase says what happened.
    const phase = record.session.phase;
    if (phase !== 'none' && phase !== 'pending') return; // still uncertain

    hydrate(record);
    persistenceFault = undefined;
    persistenceWrites = Promise.resolve();
    store.status.set('idle');
    store.isLoading.set(false);
    store.error.set(undefined);
  }
```

`hydrate(record: AgUiThreadRecord)` at `to-agent.ts:212` commits the snapshot, restores the interrupt session, and republishes. When the phase is `pending`, that republish is what makes the interrupt panel render the pending batch, which is why `pending` clears the error rather than keeping it.

In `settleTransportClose`, after `store.error.set(interruptionError(run))`, add:

```ts
        void verifyClosedRun(run);
```

- [ ] **Step 4: Expose `checkStatus` on the returned agent**

In the returned object at `libs/ag-ui/src/lib/to-agent.ts:640`, add beside `reconcileInterrupt`:

```ts
    ...(persistence
      ? {
          checkStatus: async (): Promise<void> => {
            if (disposed) throw new Error('Agent has been disposed');
            if (activeRun && activeRun.outcome === undefined) {
              throw new Error('Stop the active request before checking status');
            }
            const run = activeRun;
            if (!run) return;
            await verifyClosedRun(run);
          },
        }
      : {}),
```

- [ ] **Step 5: Run the test and verify it passes**

```bash
npx nx test ag-ui --testFile=libs/ag-ui/src/lib/to-agent.interruption-recovery.spec.ts --skip-nx-cache
```

Expected: PASS, all thirteen cases.

- [ ] **Step 6: Run the whole AG-UI suite**

```bash
npx nx test ag-ui --skip-nx-cache
```

Expected: PASS. If an interrupt-lifecycle spec fails, read the sequence before changing it; the reconciler is now called on close and some suites assert call counts.

- [ ] **Step 7: Commit**

```bash
git add libs/ag-ui/src/lib
git commit -m "feat(ag-ui): reconcile an unexpectedly closed run once, and expose checkStatus

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: LangGraph stops inferring success from a chunkless close

**Files:**
- Modify: `libs/langgraph/src/lib/internals/stream-manager.bridge.ts:322-325` (`finishOutcome`)
- Test: `libs/langgraph/src/lib/internals/stream-manager.bridge.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `libs/langgraph/src/lib/internals/stream-manager.bridge.spec.ts`:

```ts
describe('LangGraph unexpected close', () => {
  function setup() {
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport },
      subjects,
      threadId$: of('thread-1'),
      destroy$,
    });
    return { transport, subjects, destroy$, bridge };
  }

  it('reports a close with no events as interrupted, not success', async () => {
    const { transport, bridge, destroy$ } = setup();
    const run = bridge.submit({});
    transport.close();
    expect(await run).toBe('interrupted');
    destroy$.next();
  });

  it('reports a close after a partial chunk as interrupted', async () => {
    const { transport, bridge, destroy$ } = setup();
    const run = bridge.submit({});
    transport.emit([{ type: 'messages/partial', data: [{ id: 'ai', type: 'ai', content: 'half' }] }]);
    transport.close();
    expect(await run).toBe('interrupted');
    destroy$.next();
  });

  it('still reports success when terminal evidence arrived', async () => {
    const { transport, bridge, destroy$ } = setup();
    const run = bridge.submit({});
    transport.emit([{ type: 'values', data: { done: true } }]);
    transport.close();
    expect(await run).toBe('success');
    destroy$.next();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
npx nx test langgraph --testFile=libs/langgraph/src/lib/internals/stream-manager.bridge.spec.ts --skip-nx-cache
```

Expected: the first case FAILS, returning `'success'` because `!attempt.sawAssistantChunk` short-circuits to success.

- [ ] **Step 3: Drop the chunkless-success inference**

Replace `finishOutcome`:

```ts
  /**
   * The outcome for a stream that ended. A recorded terminal outcome always
   * wins. Otherwise only root terminal evidence proves completion — a close
   * with no evidence is an interruption whether or not a chunk arrived, because
   * a stream that dies before its first chunk has not completed anything.
   */
  function finishOutcome(attempt: DeliveryAttempt): CompleteOutcome {
    return attempt.terminalOutcome
      ?? (attempt.currentStepHasTerminalEvidence ? 'success' : 'interrupted');
  }
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
npx nx test langgraph --testFile=libs/langgraph/src/lib/internals/stream-manager.bridge.spec.ts --skip-nx-cache
```

Expected: the three new cases PASS.

- [ ] **Step 5: Run the whole LangGraph suite and fix fallout**

```bash
npx nx test langgraph --skip-nx-cache
```

Expected: several existing cases FAIL where a test closed the transport without emitting terminal evidence and asserted `'success'`. For each, read the emitted events. If the sequence carries no root terminal evidence, the correct expectation is now `'interrupted'` — update it. Where a test meant to model a completed run, add the `{ type: 'values', data: {...} }` event it was missing rather than weakening the assertion.

- [ ] **Step 6: Commit**

```bash
git add libs/langgraph/src/lib
git commit -m "fix(langgraph): a chunkless close is an interruption, not a completed run

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: LangGraph reads the refreshed history and exposes `checkStatus`

**Files:**
- Modify: `libs/langgraph/src/lib/internals/stream-manager.bridge.ts:327-354` (`finalizeClosedAttempt`), bridge return at line ~1223
- Modify: `libs/langgraph/src/lib/agent.types.ts` (bridge surface type)
- Modify: `libs/langgraph/src/lib/agent.fn.ts:497-560` (returned agent)
- Test: `libs/langgraph/src/lib/internals/stream-manager.bridge.spec.ts`

`finalizeClosedAttempt` already calls `refreshHistory` on close. Today it computes the outcome before that call. Move the decision after it, and read what the refresh produced.

- [ ] **Step 1: Write the failing test**

Append to the `LangGraph unexpected close` describe from Task 7:

```ts
  it('settles as success when the refreshed history shows a completed turn', async () => {
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    transport.getHistory = async () => ([
      { values: { messages: [{ id: 'ai', type: 'ai', content: 'done' }] }, tasks: [] },
    ] as unknown as ThreadState[]);
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport },
      subjects,
      threadId$: of('thread-1'),
      destroy$,
    });

    const run = bridge.submit({});
    transport.emit([{ type: 'messages/partial', data: [{ id: 'ai', type: 'ai', content: 'do' }] }]);
    transport.close();

    expect(await run).toBe('success');
    destroy$.next();
  });

  it('stays interrupted when the refreshed history shows nothing new', async () => {
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    transport.getHistory = async () => ([] as unknown as ThreadState[]);
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport },
      subjects,
      threadId$: of('thread-1'),
      destroy$,
    });

    const run = bridge.submit({});
    transport.close();

    expect(await run).toBe('interrupted');
    expect(subjects.error$.value?.recovery).toBe('check');
    destroy$.next();
  });

  it('stays interrupted with recovery check when the history refresh throws', async () => {
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    transport.getHistory = async () => { throw new Error('offline'); };
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport },
      subjects,
      threadId$: of('thread-1'),
      destroy$,
    });

    const run = bridge.submit({});
    transport.close();

    expect(await run).toBe('interrupted');
    expect(subjects.error$.value?.recovery).toBe('check');
    destroy$.next();
  });

  it('applies the same rule on the join path', async () => {
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    transport.getHistory = async () => ([] as unknown as ThreadState[]);
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport },
      subjects,
      threadId$: of('thread-1'),
      destroy$,
    });

    const joined = bridge.joinStream('run-1');
    transport.close();
    await joined;

    expect(subjects.error$.value?.kind).toBe('interrupted');
    expect(subjects.error$.value?.recovery).toBe('check');
    destroy$.next();
  });

  it('settles as paused when the refreshed history carries an interrupt', async () => {
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    transport.getHistory = async () => ([
      { values: { messages: [] }, tasks: [{ interrupts: [{ id: 'i1', value: {}, reason: '' }] }] },
    ] as unknown as ThreadState[]);
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport },
      subjects,
      threadId$: of('thread-1'),
      destroy$,
    });

    const run = bridge.submit({});
    transport.close();
    await run;

    expect(subjects.interrupts$.value.length).toBeGreaterThan(0);
    expect(subjects.error$.value).toBeUndefined();
    destroy$.next();
  });
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
npx nx test langgraph --testFile=libs/langgraph/src/lib/internals/stream-manager.bridge.spec.ts --skip-nx-cache
```

Expected: FAIL. The outcome is computed before the refresh, and no `interrupted` error with a `recovery` value is published on a silent close.

- [ ] **Step 3: Decide the outcome after the refresh**

Replace `finalizeClosedAttempt`:

```ts
  async function finalizeClosedAttempt(
    controller: AbortController,
    attempt: DeliveryAttempt,
  ): Promise<CompleteOutcome | null> {
    if (attempt.terminalOutcome) return attempt.terminalOutcome;

    const evidenceOutcome = finishOutcome(attempt);
    const messagesBefore = subjects.messages$.value.length;
    let refreshFailed = false;
    attempt.awaitingFinalSync = true;
    try {
      await refreshHistory(
        true,
        () => isCurrentExecution(controller, attempt) && !attempt.terminalOutcome,
      );
    } catch {
      refreshFailed = true;
    } finally {
      attempt.awaitingFinalSync = false;
    }

    if (!isCurrentExecution(controller, attempt)) return null;

    // The refresh is the read-only status check: a pending interrupt means the
    // run paused, and new server-side messages mean it completed after the
    // stream died. Neither is provable from the closed stream alone.
    const paused = !!subjects.interrupt$.value || subjects.interrupts$.value.length > 0;
    const historyAdvanced = !refreshFailed && subjects.messages$.value.length > messagesBefore;
    const outcome: CompleteOutcome = evidenceOutcome !== 'interrupted'
      ? evidenceOutcome
      : paused || historyAdvanced
        ? 'success'
        : 'interrupted';

    if (!attempt.terminalOutcome) finalizeAttempt(attempt, outcome);

    if (attempt.terminalOutcome === 'interrupted' && !subjects.error$.value && !paused) {
      subjects.error$.next(new AgentError({
        kind: 'interrupted',
        message: AGENT_RECOVERY_MESSAGES.check,
        retryable: false,
        recovery: 'check',
        detail: 'Checking will tell you whether it did.',
      }));
      subjects.status$.next(ResourceStatus.Error);
    }

    if (attempt.terminalOutcome === 'success' && attempt.rootTerminalEvidence
      && !controller.signal.aborted && !attempt.externalSignal?.aborted
      && !subjects.error$.value && !subjects.interrupt$.value && subjects.interrupts$.value.length === 0) {
      developmentRuntime.milestone('runtime.first_stream_completed', Date.now() - attempt.startedAt);
      if (attempt.resumedInterrupt) developmentRuntime.milestone('interrupt.handled');
    }
    return attempt.terminalOutcome ?? outcome;
  }
```

Add `AGENT_RECOVERY_MESSAGES` to the existing `@threadplane/chat` import in this file.

- [ ] **Step 4: Stop the callers from clobbering the interrupted status**

Both callers of `finalizeClosedAttempt` currently resolve any non-error outcome. Left alone they overwrite the `Error` status set in Step 3, and the new tests fail with a status of `Resolved`.

In `runStream` (around line 798) and in `joinQueuedRun` (around line 690), change each occurrence of:

```ts
        if (outcome !== 'error') {
          subjects.status$.next(ResourceStatus.Resolved);
        }
```

to:

```ts
        if (outcome !== 'error' && outcome !== 'interrupted') {
          subjects.status$.next(ResourceStatus.Resolved);
        }
```

Verify there are exactly two occurrences before editing:

```bash
grep -n "outcome !== 'error'" libs/langgraph/src/lib/internals/stream-manager.bridge.ts
```

Expected: two lines. If there are more, update every one of them.

- [ ] **Step 5: Expose `checkStatus` on the bridge**

In the bridge's returned object at line ~1223, add after `stop`:

```ts
    checkStatus: async (): Promise<void> => {
      if (disposed) return;
      if (subjects.status$.value === ResourceStatus.Loading) {
        throw new Error('Stop the active request before checking status');
      }
      const messagesBefore = subjects.messages$.value.length;
      await refreshHistory(true);
      const paused = !!subjects.interrupt$.value || subjects.interrupts$.value.length > 0;
      if (paused || subjects.messages$.value.length > messagesBefore) {
        subjects.error$.next(undefined);
        subjects.status$.next(ResourceStatus.Idle);
      }
    },
```

Add the matching member to the bridge surface type in `libs/langgraph/src/lib/agent.types.ts`, beside `joinStream` at line ~448:

```ts
  checkStatus: () => Promise<void>;
```

- [ ] **Step 6: Expose it on the agent**

In `libs/langgraph/src/lib/agent.fn.ts`, add after `stop: () => manager.stop(),`:

```ts
    checkStatus: () => manager.checkStatus(),
```

- [ ] **Step 7: Run the tests and verify they pass**

```bash
npx nx test langgraph --testFile=libs/langgraph/src/lib/internals/stream-manager.bridge.spec.ts --skip-nx-cache
```

Expected: PASS, all seven new cases.

- [ ] **Step 8: Run the whole LangGraph suite**

```bash
npx nx test langgraph --skip-nx-cache
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add libs/langgraph/src/lib
git commit -m "feat(langgraph): read the refreshed history to settle a closed stream

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Staleness guards on both adapters

> **Absorbed during execution.** The AG-UI half was settled by Task 6, which established that a staleness comparison is not the guard there: the automatic check holds the `reconciling` signal and every entry point that could start a newer run throws while it is set, so a newer request is refused rather than racing. The LangGraph half was written and mutation-proved inside Task 8, including a second case for the window between the refresh writing and the check settling, which the first test did not reach. Nothing remains here.

**Files:**
- Test: `libs/ag-ui/src/lib/to-agent.interruption-recovery.spec.ts`
- Test: `libs/langgraph/src/lib/internals/stream-manager.bridge.spec.ts`

The AG-UI half is already settled by Task 6 and does NOT need redoing here. Implementation established that AG-UI delivers the guarantee through a stronger mechanism than a staleness comparison: the automatic check holds the `reconciling` signal, and every entry point that could start a newer run goes through `assertAvailable()`, which throws while it is set. A newer request is refused rather than racing, so `activeRun` cannot change across the check. Task 6 asserts that refusal. The `activeRun !== run` comparison survives mutation because it is unreachable defence, which Task 6 records honestly rather than papering over.

This task therefore covers the LangGraph twin only, where no such gate exists and the staleness comparison really is the guard.

- [ ] **Step 1: Write the failing test**

Append to the `LangGraph unexpected close` describe:

```ts
  it('discards a history refresh that resolves after a newer request', async () => {
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    transport.getHistory = async () => {
      await gate;
      return [
        { values: { messages: [{ id: 'stale', type: 'ai', content: 'stale' }] }, tasks: [] },
      ] as unknown as ThreadState[];
    };
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport },
      subjects,
      threadId$: of('thread-1'),
      destroy$,
    });

    const first = bridge.submit({});
    transport.close();

    const second = bridge.submit({});
    transport.emit([{ type: 'values', data: { done: true } }]);
    transport.close();
    await second;
    const errorAfterSecond = subjects.error$.value;

    release();
    await first;

    expect(subjects.error$.value).toBe(errorAfterSecond);
    expect(subjects.messages$.value.some(m => (m as { id?: string }).id === 'stale')).toBe(false);
    destroy$.next();
  });
```

- [ ] **Step 2: Run the test**

```bash
npx nx test langgraph --testFile=libs/langgraph/src/lib/internals/stream-manager.bridge.spec.ts --skip-nx-cache
```

Expected: PASS if `isCurrentExecution` already guards this path; FAIL if the late refresh writes through.

- [ ] **Step 3: Fix only if it failed**

If the test failed, the late write came through `refreshHistory`'s own `isRelevant()` callback. Tighten the callback passed from `finalizeClosedAttempt` so it also requires `currentThreadId` to be unchanged, and re-run. If it passed, make no production change and move to Step 4.

- [ ] **Step 4: Mutation-check the LangGraph staleness guard**

Prove the test is not vacuous. In `libs/langgraph/src/lib/internals/stream-manager.bridge.ts`, temporarily change the `isCurrentExecution` guard in `finalizeClosedAttempt` to `if (false) return null;` and run:

```bash
npx nx test langgraph --testFile=libs/langgraph/src/lib/internals/stream-manager.bridge.spec.ts --skip-nx-cache
```

Expected: the staleness test FAILS. Revert the mutation.

If it leaves the suite green, the test is not exercising the guard. Fix the test before continuing — a guard with no failing mutation is untested. Do NOT run the AG-UI equivalent: Task 6 established that `activeRun !== run` there is unreachable defence behind the `reconciling` gate, and it correctly survives mutation.

- [ ] **Step 5: Verify the working tree is clean of mutations**

```bash
git diff --stat
```

Expected: only the two spec files changed. No production file appears.

- [ ] **Step 6: Commit**

```bash
git add libs/langgraph/src/lib/internals/stream-manager.bridge.spec.ts
git commit -m "test: prove the LangGraph interruption staleness guard is load-bearing

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Mutation-check the new assertions

> **Absorbed during execution.** Every task mutation-checked its own branches as it landed, with a grep proving the mutation was applied and the original gone, after three separate silent no-op mutations produced meaningless results early on. Surviving mutants were each resolved rather than noted: two AG-UI guards were kept as documented unreachable defence, and three LangGraph survivors turned out to be test defects that were fixed. Nothing remains here beyond the consolidated run in Task 12.

**Files:** no production changes; this task validates Tasks 4 through 8.

The repository has a documented history of interrupt tests that pass vacuously. Every new assertion gets inverted once.

- [ ] **Step 1: Mutate the AG-UI close classification**

In `libs/ag-ui/src/lib/to-agent.ts`, change `finalizeDeliveryRun(store, run, 'interrupted');` inside `settleTransportClose` back to `finalizeDeliveryRun(store, run, 'success');` and remove the `store.error.set(interruptionError(run))` line. Run:

```bash
npx nx test ag-ui --testFile=libs/ag-ui/src/lib/to-agent.interruption-recovery.spec.ts --skip-nx-cache
```

Expected: FAIL, at minimum the first two cases of Task 4. Revert.

- [ ] **Step 2: Mutate the AG-UI recovery classifier**

Change `const neverDispatched = !run.sawAnyEvent && !run.resumeAttempt && !run.resumedInterrupt;` to `const neverDispatched = true;`. Run the same command.

Expected: FAIL, the "does not offer retry once RUN_STARTED arrived" case. Revert.

- [ ] **Step 3: Mutate the LangGraph outcome**

In `finishOutcome`, change `? 'success' : 'interrupted'` to `? 'success' : 'success'`. Run:

```bash
npx nx test langgraph --testFile=libs/langgraph/src/lib/internals/stream-manager.bridge.spec.ts --skip-nx-cache
```

Expected: FAIL, the chunkless and partial-chunk cases. Revert.

- [ ] **Step 4: Mutate the LangGraph history read**

Change `const historyAdvanced = !refreshFailed && subjects.messages$.value.length > messagesBefore;` to `const historyAdvanced = false;`. Run the same command.

Expected: FAIL, the "settles as success when the refreshed history shows a completed turn" case. Revert.

- [ ] **Step 5: Confirm the tree is clean**

```bash
git status --porcelain
```

Expected: empty. Every mutation reverted.

- [ ] **Step 6: Run all three suites green**

```bash
npx nx run-many -t test -p chat,ag-ui,langgraph --skip-nx-cache
```

Expected: PASS. Record the case counts; they are the evidence for the completion claim.

---

### Task 11: Documentation and API surface

**Files:**
- Modify: `apps/website/content/docs/ag-ui/api/to-agent.mdx`
- Modify: `apps/website/content/docs/ag-ui/guides/interrupts.mdx`
- Modify: `apps/website/content/docs/langgraph/guides/interrupts.mdx`
- Modify: `apps/website/content/docs/chat/components/chat-interrupt-panel.mdx`

- [ ] **Step 1: Find every claim the change invalidates**

```bash
grep -rn "retryable\|was interrupted\|Try again" apps/website/content/docs | grep -v api-docs.json
```

Read each hit. Any sentence stating that an interrupted error is retryable, or that Retry always appears after an interruption, is now wrong.

- [ ] **Step 2: Correct the prose**

For each wrong claim, state the new rule: after an unexpectedly closed stream the adapter offers Retry only when it can prove the request was never dispatched; otherwise it offers a read-only status check where the backend supports one, or explains that the outcome could not be confirmed. Do not add links. Follow the existing page voice, which uses no contractions.

- [ ] **Step 3: Regenerate API docs**

```bash
npm run generate-api-docs
```

Expected: `apps/website/content/docs/ag-ui/api/api-docs.json` and its siblings pick up `AgentRecovery`, `AGENT_RECOVERY_MESSAGES`, and `checkStatus`. New exports without regenerated docs fail the libraries check.

- [ ] **Step 4: Verify the website still builds**

```bash
npx nx build website --skip-nx-cache
```

Expected: PASS. The website test and lint targets do not typecheck, so only the build proves the content compiles.

- [ ] **Step 5: Commit**

```bash
git add apps/website/content
git commit -m "docs: interruption recovery offers retry only when nothing was dispatched

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Full verification and pull request

**Files:** none modified.

- [ ] **Step 1: Lint the changed libraries**

```bash
npx nx run-many -t lint -p chat,ag-ui,langgraph --skip-nx-cache 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "error|Error" | head -20
```

Expected: no `error` lines. Warnings are pre-existing and acceptable; strip ANSI before grepping or the match silently misses.

- [ ] **Step 2: Build the three libraries**

```bash
npx nx run-many -t build -p chat,ag-ui,langgraph --skip-nx-cache
```

Expected: PASS. This is the only step that typechecks the public surface.

- [ ] **Step 3: Run the type-test targets**

```bash
npx nx run-many -t type-tests -p chat,ag-ui,langgraph --skip-nx-cache
```

Expected: PASS. A `@ts-expect-error` in a vitest spec is inert; only `*.type-spec.ts` files under this target assert types.

- [ ] **Step 4: Verify in a real browser**

Start the canonical demo and induce a truncated stream. Using Chrome MCP, confirm on both the AG-UI and LangGraph demos that after a mid-stream close the error appears, the correct control renders, and partial assistant text stays on screen. Confirm an ordinary completed turn still shows no error, and an approval pause still shows the interrupt panel and no error.

Also check the error banner layout, which jsdom cannot verify. Task 3 added `flex-wrap: wrap` to the `.chat-error` container, which previously could not wrap. Narrow the viewport and confirm that a long error message alongside a Retry button still looks right, and that the detail sentence takes its own row aligned under the message rather than under the icon. A Retry button wrapping onto its own line at narrow width is acceptable; overlapping or misaligned text is not.

- [ ] **Step 5: Run the live production smoke canaries**

```bash
PRODUCTION_SMOKE=true BASE_URL=https://threadplane.ai NX_DAEMON=false npx nx e2e website --testFiles=apps/website/e2e/platform-production-smoke.spec.ts --workers=2 --skip-nx-cache
```

Expected: the five live canaries pass. They prove legitimate approval and cancellation flows still complete against deployed credentials. Do not replace this with a mock.

- [ ] **Step 6: Open the pull request**

```bash
git push -u origin blove/stream-interruptions-recovery-e6e202
gh pr create --title "feat: detect unexpectedly closed streams and offer only safe recovery" --body "$(cat <<'EOF'
An agent stream that closes without terminal evidence is now reported as an interruption instead of a completed turn, and the recovery offered depends on what the adapter can prove.

AG-UI previously settled an evidence-free close as success whenever the run owned no messages, so a truncated HTTP 200 stream carrying only RUN_STARTED was indistinguishable from a clean finish. LangGraph inferred success whenever no assistant chunk had arrived, so a stream that died before its first chunk was reported as a completed turn. Both now settle as interrupted.

Recovery is classified rather than assumed. Retry appears only when the request is known not to have been dispatched. Where the backend supports a read-only check, the adapter makes one automatic check and offers Check status. Where nothing can verify the outcome, the error explains the uncertainty and offers no action. Nothing is ever resubmitted automatically.

This changes `retryable` for interrupted errors: it is now true only when recovery is retry. Partial content, approval state, and server-side effects are preserved in every case.

Design: docs/superpowers/specs/2026-09-17-stream-interruption-recovery-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 7: Report results honestly**

State the passing case counts from Task 10 Step 6, the lint and build results, and the live canary result. If any step was skipped or failed, say so explicitly with the output rather than claiming completion.

---

## Deferred

Not in this plan, per the design spec:

- Connections that stay open but stop producing events, and any timeout rule.
- Polling or repeated status checks.
- A universal run-status API for AG-UI.
- Any rollback of server-side effects on a local connection failure.
