import type {
  AgentSession,
  AgentSnapshot,
  CompleteOutcome,
} from '@threadplane/core';
import {
  createMessageContent,
  type MessageRow,
} from '@threadplane/content/messages';

export interface InterruptSession extends Omit<AgentSession, 'getSnapshot'> {
  getSnapshot(): AgentSnapshot & {
    readonly interrupts: readonly { readonly value?: unknown }[];
  };
  resume(
    value: RefundResponse,
    options?: { readonly signal?: AbortSignal }
  ): Promise<CompleteOutcome>;
}
export interface Refund {
  readonly kind: 'refund_approval';
  readonly amount: number;
  readonly customer_id: string;
  readonly reason: string;
}
export interface RefundDecision {
  readonly refund: Refund;
}
export type RefundResponse =
  | { readonly approved: false }
  | { readonly approved: true; readonly amount?: number };
export interface InterruptsSnapshot {
  readonly creation: 'idle' | 'pending' | 'confirmed' | 'unconfirmed';
  readonly rows: readonly MessageRow[];
  readonly busy: boolean;
  readonly activity: 'message' | 'decision' | null;
  readonly canSubmit: boolean;
  readonly outcome: CompleteOutcome | null;
  readonly decision: RefundDecision | null;
  readonly error: string | null;
}

function ownData(
  value: unknown,
  keys: readonly string[]
): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return;
  const fields: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (!field || !Object.hasOwn(field, 'value')) return;
    fields[key] = field.value;
  }
  return fields;
}
function refundPayload(value: unknown): Refund | undefined {
  const data = ownData(value, ['kind', 'amount', 'customer_id', 'reason']);
  if (
    !data ||
    data['kind'] !== 'refund_approval' ||
    typeof data['amount'] !== 'number' ||
    !Number.isFinite(data['amount']) ||
    data['amount'] < 0 ||
    typeof data['customer_id'] !== 'string' ||
    typeof data['reason'] !== 'string'
  )
    return;
  return Object.freeze({
    kind: 'refund_approval',
    amount: data['amount'],
    customer_id: data['customer_id'],
    reason: data['reason'],
  });
}
function captureResponse(response: RefundResponse): RefundResponse | undefined {
  const data = ownData(response, ['approved']);
  if (!data || typeof data['approved'] !== 'boolean') return;
  const amount = Object.getOwnPropertyDescriptor(response, 'amount');
  if (!amount) return Object.freeze({ approved: data['approved'] });
  if (
    data['approved'] !== true ||
    !Object.hasOwn(amount, 'value') ||
    typeof amount.value !== 'number' ||
    !Number.isFinite(amount.value) ||
    amount.value < 0
  )
    return;
  return Object.freeze({ approved: true, amount: amount.value });
}

/** Owns one confirmed conversation and one complete root approval batch. */
export function createInterruptsApplication(options: {
  readonly createThread: (signal: AbortSignal) => Promise<string>;
  readonly sessionFactory: (threadId: string) => InterruptSession;
}) {
  const content = createMessageContent();
  const listeners = new Set<() => void>();
  let snapshot: InterruptsSnapshot = Object.freeze({
    creation: 'idle',
    rows: Object.freeze([]),
    busy: false,
    activity: null,
    canSubmit: true,
    outcome: null,
    decision: null,
    error: null,
  });
  let session: InterruptSession | undefined;
  let release: (() => void) | undefined;
  let capturedBatch:
    | ReturnType<InterruptSession['getSnapshot']>['interrupts']
    | undefined;
  let operation: AbortController | undefined;
  let disposed = false;
  let disposal: Promise<void> | undefined;
  function publish(update: Partial<InterruptsSnapshot>) {
    if (disposed) return;
    snapshot = Object.freeze({ ...snapshot, ...update });
    for (const notify of listeners) notify();
  }
  function projectDecision() {
    if (!session || snapshot.busy || snapshot.outcome !== 'paused') return;
    const interrupts = session.getSnapshot().interrupts;
    if (interrupts === capturedBatch) return;
    capturedBatch = interrupts;
    const root =
      interrupts.length === 1 ? ownData(interrupts[0], ['value']) : undefined;
    const refund = root && refundPayload(root['value']);
    publish({
      decision: refund ? Object.freeze({ refund }) : null,
      canSubmit: false,
    });
  }
  function observe() {
    if (!disposed && session) {
      publish({ rows: content.project(session.getSnapshot()) });
      projectDecision();
    }
  }
  async function perform(
    activity: 'message' | 'decision',
    command: (
      owned: InterruptSession,
      signal: AbortSignal
    ) => Promise<CompleteOutcome>
  ) {
    const admitted = new AbortController();
    operation = admitted;
    capturedBatch = undefined;
    publish({
      busy: true,
      activity,
      canSubmit: false,
      decision: null,
      outcome: null,
      error: null,
    });
    const current = () =>
      !disposed && operation === admitted && !admitted.signal.aborted;
    try {
      if (!current()) return;
      if (!session) {
        publish({ creation: 'pending' });
        if (!current()) return;
        const threadId = await options.createThread(admitted.signal);
        if (!current()) return;
        session = options.sessionFactory(threadId);
        release = session.subscribe(observe);
        publish({
          creation: 'confirmed',
          rows: content.project(session.getSnapshot()),
        });
      }
      if (!current()) return;
      const outcome = await command(session, admitted.signal);
      if (!current()) return;
      publish({
        rows: content.project(session.getSnapshot()),
        outcome,
        canSubmit:
          outcome === 'success' &&
          session.getSnapshot().interrupts.length === 0,
        error: outcome === 'error' ? 'The LangGraph request failed.' : null,
      });
    } catch {
      if (!current()) return;
      publish({
        creation: session ? 'confirmed' : 'unconfirmed',
        outcome: 'error',
        canSubmit: false,
        error: 'The LangGraph request failed.',
      });
    } finally {
      if (!disposed && operation === admitted) {
        operation = undefined;
        publish({ busy: false, activity: null });
        projectDecision();
      }
    }
  }
  async function submit(text: string) {
    if (disposed || snapshot.busy || !snapshot.canSubmit || !text.trim())
      return;
    await perform('message', (owned, signal) => owned.submit(text, { signal }));
  }
  async function decide(decision: RefundDecision, response: RefundResponse) {
    if (disposed || snapshot.busy || snapshot.outcome !== 'paused' || !session)
      return;
    projectDecision();
    if (
      decision !== snapshot.decision ||
      !decision ||
      session.getSnapshot().interrupts !== capturedBatch
    )
      return;
    const captured = captureResponse(response);
    if (
      !captured ||
      disposed ||
      snapshot.busy ||
      snapshot.outcome !== 'paused' ||
      !session
    )
      return;
    projectDecision();
    if (
      disposed ||
      snapshot.busy ||
      snapshot.outcome !== 'paused' ||
      decision !== snapshot.decision ||
      session.getSnapshot().interrupts !== capturedBatch
    )
      return;
    const admittedBatch = capturedBatch;
    await perform('decision', (owned, signal) => {
      // Publishing pending state can synchronously replace the observed batch.
      // Reproject that pause without dispatching the superseded decision.
      if (owned.getSnapshot().interrupts !== admittedBatch)
        return Promise.resolve('paused');
      return owned.resume(captured, { signal });
    });
  }
  async function stop() {
    const admitted = operation;
    if (disposed || !admitted) return;
    admitted.abort();
    operation = undefined;
    capturedBatch = undefined;
    publish({
      busy: false,
      activity: null,
      canSubmit: false,
      decision: null,
      outcome: 'aborted',
      creation: session ? 'confirmed' : 'unconfirmed',
    });
    try {
      await session?.stop();
    } catch {
      /* Recovery still requires a new conversation. */
    }
  }
  function dispose(): Promise<void> {
    if (disposal) return disposal;
    disposed = true;
    operation?.abort();
    operation = undefined;
    release?.();
    content.dispose();
    listeners.clear();
    disposal = Promise.resolve()
      .then(() => session?.dispose())
      .then(() => undefined);
    return disposal;
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(notify: () => void) {
      if (disposed) return () => undefined;
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    submit,
    decide,
    stop,
    dispose,
  };
}
