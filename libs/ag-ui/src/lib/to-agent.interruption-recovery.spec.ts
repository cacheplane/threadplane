import { describe, it, expect, vi } from 'vitest';
import type { AbstractAgent, BaseEvent } from '@ag-ui/client';
import { AgentError, AGENT_RECOVERY_MESSAGES, type AgentRuntimeTelemetryPayload } from '@threadplane/chat';
import { toAgent } from './to-agent';
import type { AgUiInterruptPersistence, AgUiThreadRecord } from './interrupt-persistence';

vi.mock('@threadplane/telemetry/browser', async (importOriginal) => ({
  ...await importOriginal<object>(),
  createDevelopmentRuntime: () => ({
    touch: () => undefined,
    milestone: () => undefined,
    dispose: () => undefined,
  }),
}));

/** Minimal AbstractAgent stand-in; mirrors the stub in to-agent.spec.ts,
 *  trimmed to the members toAgent() actually calls. */
class StubAgent {
  threadId = 't1';
  state: Record<string, unknown> = {};
  private readonly _subscribers: Array<{
    onRunInitialized?: (p: { input: { runId?: string } }) => void;
    onEvent?: (p: { event: BaseEvent; input: { runId?: string } }) => void;
    onRunFailed?: (p: { error: Error; input: { runId?: string } }) => void;
  }> = [];

  subscribe(sub: {
    onRunInitialized?: (p: { input: { runId?: string } }) => void;
    onEvent?: (p: { event: BaseEvent; input: { runId?: string } }) => void;
    onRunFailed?: (p: { error: Error; input: { runId?: string } }) => void;
  }) {
    this._subscribers.push(sub);
    return { unsubscribe: () => { /* no-op for tests */ } };
  }

  emit(event: BaseEvent, callbackRunId?: string): void {
    for (const sub of this._subscribers) sub.onEvent?.({ event, input: { runId: callbackRunId } });
  }

  runAgent = vi.fn(async () => ({ result: undefined, newMessages: [] }));
  abortRun = vi.fn();
  addMessage = vi.fn();
}

describe('AG-UI unexpected close', () => {
  it('reports a stream that closed with no events as an interruption', async () => {
    const stub = new StubAgent();
    const seen: AgentRuntimeTelemetryPayload[] = [];
    const agent = toAgent(stub as unknown as AbstractAgent, { telemetry: payload => { seen.push(payload); } });
    // Emitting nothing is the point: the run resolves having sent no events.
    stub.runAgent.mockImplementationOnce(async () => ({ result: undefined, newMessages: [] }));

    await agent.submit({ content: 'hello' });

    const err = agent.error();
    expect(err).toBeInstanceOf(AgentError);
    expect(err?.kind).toBe('interrupted');
    expect(agent.status()).toBe('error');
    expect(agent.isLoading()).toBe(false);
    // An operator counting truncated streams must see exactly one errored
    // stream, and no clean end for the same run.
    expect(seen.filter(payload =>
      payload.event === 'tplane:stream_ended' || payload.event === 'tplane:stream_errored',
    )).toEqual([
      expect.objectContaining({
        event: 'tplane:stream_errored',
        properties: expect.objectContaining({ errorClass: 'Error' }),
      }),
    ]);
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
      stub.emit({ type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' } as unknown as BaseEvent);
      stub.emit({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'answered' } as unknown as BaseEvent);
      stub.emit({ type: 'TEXT_MESSAGE_END', messageId: 'm1' } as unknown as BaseEvent);
      stub.emit({ type: 'RUN_FINISHED', runId: 'r1' } as BaseEvent);
      return { result: undefined, newMessages: [] };
    });

    await agent.submit({ content: 'hello' });

    // Guards against a vacuous pass: the run really did stream and finish.
    expect(agent.messages().some(m => String(m.content).includes('answered'))).toBe(true);
    expect(agent.error()).toBeUndefined();
    expect(agent.status()).toBe('idle');
    expect(agent.isLoading()).toBe(false);
  });

  it('does not report an interruption for a valid approval pause', async () => {
    const stub = new StubAgent();
    const agent = toAgent(stub as unknown as AbstractAgent);
    stub.runAgent.mockImplementationOnce(async () => {
      stub.emit({ type: 'RUN_STARTED', runId: 'r1' } as BaseEvent);
      stub.emit({
        type: 'RUN_FINISHED',
        runId: 'r1',
        outcome: { type: 'interrupt', interrupts: [{ id: 'i1', value: { question: 'ok?' } }] },
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

    // Guards against a vacuous pass: idle with no error is also the initial state.
    expect(stub.runAgent).toHaveBeenCalled();
    expect(agent.error()).toBeUndefined();
    expect(agent.status()).toBe('idle');
  });

  // Exercises the `terminalReceived` escape hatch in settleTransportClose.
  // `resolveCallbackRun` keys off the SDK callback envelope's runId, while the
  // reducer's `bindRunId` keys off the runId in the event body. A server whose
  // body carries a different runId than the envelope makes them disagree: the
  // adapter attributes RUN_FINISHED to the active run and sets terminalReceived,
  // but the reducer declines it, so `outcome` stays undefined. The protocol did
  // settle, so this must not be reported as an interruption.
  it('settles as success a terminal event the reducer declined to attribute', async () => {
    const stub = new StubAgent();
    const agent = toAgent(stub as unknown as AbstractAgent);
    stub.runAgent.mockImplementationOnce(async () => {
      stub.emit({ type: 'RUN_STARTED', runId: 'envelope' } as BaseEvent, 'envelope');
      stub.emit({ type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' } as unknown as BaseEvent, 'envelope');
      stub.emit({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'answered' } as unknown as BaseEvent, 'envelope');
      // Same envelope runId, different runId in the event body.
      stub.emit({ type: 'RUN_FINISHED', runId: 'body' } as BaseEvent, 'envelope');
      return { result: undefined, newMessages: [] };
    });

    await agent.submit({ content: 'hello' });

    expect(agent.messages().find(m => m.id === 'm1')?.delivery.outcome).toBe('success');
    expect(agent.error()).toBeUndefined();
    expect(agent.status()).toBe('idle');
    expect(agent.isLoading()).toBe(false);
  });

  // The same body/envelope runId mismatch, but for RUN_ERROR. The reducer
  // declines it identically and sets no error of its own, so the escape hatch
  // must not catch this: the server said the run failed, and reporting a clean
  // success here would be worse than the bug this task fixes.
  it('does not settle as success an error the reducer declined to attribute', async () => {
    const stub = new StubAgent();
    const agent = toAgent(stub as unknown as AbstractAgent);
    stub.runAgent.mockImplementationOnce(async () => {
      stub.emit({ type: 'RUN_STARTED', runId: 'envelope' } as BaseEvent, 'envelope');
      stub.emit({ type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' } as unknown as BaseEvent, 'envelope');
      stub.emit({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'partial' } as unknown as BaseEvent, 'envelope');
      // Same envelope runId, different runId in the event body.
      stub.emit({ type: 'RUN_ERROR', runId: 'body', message: 'HTTP 500' } as unknown as BaseEvent, 'envelope');
      return { result: undefined, newMessages: [] };
    });

    await agent.submit({ content: 'hello' });

    expect(agent.messages().find(m => m.id === 'm1')?.delivery.outcome).toBe('interrupted');
    expect(agent.error()?.kind).toBe('interrupted');
    expect(agent.status()).toBe('error');
    expect(agent.isLoading()).toBe(false);
  });
});

/** In-memory persistence, optionally with an authoritative reconciler. Typed
 *  against the real contract so a bogus reconcile shape is a build error. */
function memoryPersistence(
  reconcile?: AgUiInterruptPersistence['reconcile'],
): AgUiInterruptPersistence {
  const saved = new Map<string, AgUiThreadRecord>();
  return {
    namespace: 'test',
    store: {
      load: async (key: string) => saved.get(key) ?? null,
      compareAndSwap: async (key: string, _rev: number | null, next: AgUiThreadRecord) => {
        saved.set(key, next);
        return true;
      },
    },
    ...(reconcile ? { reconcile } : {}),
  };
}

describe('AG-UI unexpected close — recovery classification', () => {
  /** Drive a real approval pause, so a following submit({ resume }) is a
   *  genuine resume attempt rather than a hand-built one. */
  async function pausedAgent(persistence?: AgUiInterruptPersistence) {
    const stub = new StubAgent();
    const agent = toAgent(stub as unknown as AbstractAgent, {
      telemetry: false,
      ...(persistence ? { persistence } : {}),
    });
    await agent.ready;
    stub.runAgent.mockImplementationOnce(async () => {
      stub.emit({ type: 'RUN_STARTED', runId: 'r1' } as BaseEvent);
      stub.emit({
        type: 'RUN_FINISHED',
        runId: 'r1',
        outcome: { type: 'interrupt', interrupts: [{ id: 'i1', value: { question: 'ok?' } }] },
      } as unknown as BaseEvent);
      return { result: undefined, newMessages: [] };
    });
    await agent.submit({ content: 'book it' });
    // Guards the rest of the case: without a real pause there is nothing to resume.
    expect(agent.interrupt()).toBeDefined();
    return { stub, agent };
  }

  it('offers a retry when an ordinary turn produced no event at all', async () => {
    const stub = new StubAgent();
    const agent = toAgent(stub as unknown as AbstractAgent, { telemetry: false });
    stub.runAgent.mockImplementationOnce(async () => ({ result: undefined, newMessages: [] }));

    await agent.submit({ content: 'hello' });

    const err = agent.error();
    expect(err?.kind).toBe('interrupted');
    expect(err?.recovery).toBe('retry');
    expect(err?.retryable).toBe(true);
    expect(err?.message).toBe(AGENT_RECOVERY_MESSAGES.retry);
  });

  it('offers no action when an ordinary turn was truncated after RUN_STARTED', async () => {
    const stub = new StubAgent();
    const agent = toAgent(stub as unknown as AbstractAgent, { telemetry: false });
    stub.runAgent.mockImplementationOnce(async () => {
      stub.emit({ type: 'RUN_STARTED', runId: 'r1' } as BaseEvent);
      return { result: undefined, newMessages: [] };
    });

    await agent.submit({ content: 'hello' });

    const err = agent.error();
    expect(err?.recovery).toBe('none');
    expect(err?.retryable).toBe(false);
    expect(err?.message).toBe(AGENT_RECOVERY_MESSAGES.none);
    expect(typeof err?.detail).toBe('string');
    expect(err?.detail?.length).toBeGreaterThan(0);
  });

  it('does not offer a status check for an ordinary turn, even with a reconciler', async () => {
    const reconcile = vi.fn(async () => ({ status: 'unknown' as const }));
    const stub = new StubAgent();
    const agent = toAgent(stub as unknown as AbstractAgent, {
      telemetry: false,
      persistence: memoryPersistence(reconcile),
    });
    await agent.ready;
    stub.runAgent.mockImplementationOnce(async () => {
      stub.emit({ type: 'RUN_STARTED', runId: 'r1' } as BaseEvent);
      return { result: undefined, newMessages: [] };
    });

    await agent.submit({ content: 'hello' });

    // The reconciler's vocabulary is the interrupt session. An ordinary turn has
    // no correlated attempt for it to answer about, so offering a check would
    // either ask an unanswerable question or make no call at all.
    expect(agent.error()?.recovery).toBe('none');
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('does not offer a retry once a tool call has started', async () => {
    const stub = new StubAgent();
    const agent = toAgent(stub as unknown as AbstractAgent, { telemetry: false });
    stub.runAgent.mockImplementationOnce(async () => {
      stub.emit({ type: 'RUN_STARTED', runId: 'r1' } as BaseEvent);
      stub.emit({
        type: 'TOOL_CALL_START',
        toolCallId: 'call-1',
        toolCallName: 'book_flight',
        parentMessageId: 'tool-parent',
      } as unknown as BaseEvent);
      stub.emit({ type: 'TOOL_CALL_ARGS', toolCallId: 'call-1', delta: '{}' } as unknown as BaseEvent);
      return { result: undefined, newMessages: [] };
    });

    await agent.submit({ content: 'book it' });

    // Guards against a vacuous pass: the tool call really did reach the store.
    expect(agent.toolCalls().map(call => call.id)).toContain('call-1');
    expect(agent.error()?.kind).toBe('interrupted');
    expect(agent.error()?.recovery).toBe('none');
    expect(agent.error()?.retryable).toBe(false);
  });

  it('offers no action for a truncated resume when nothing is persisted', async () => {
    const { stub, agent } = await pausedAgent();
    stub.runAgent.mockImplementationOnce(async () => ({ result: undefined, newMessages: [] }));

    await agent.submit({ resume: { approved: true } });

    const err = agent.error();
    expect(err?.kind).toBe('interrupted');
    expect(err?.recovery).toBe('none');
    expect(err?.retryable).toBe(false);
  });

  it('offers no action for a truncated resume when persistence has no reconciler', async () => {
    const { stub, agent } = await pausedAgent(memoryPersistence());
    stub.runAgent.mockImplementationOnce(async () => ({ result: undefined, newMessages: [] }));

    await agent.submit({ resume: { approved: true } });

    const err = agent.error();
    expect(err?.kind).toBe('interrupted');
    // A store without a reconciler has no authoritative answer to give:
    // InterruptPersistence.reconcile() throws outright when it is absent.
    expect(err?.recovery).toBe('none');
    expect(err?.retryable).toBe(false);
  });

  it('offers a status check for a truncated resume when a reconciler is configured', async () => {
    const reconcile = vi.fn(async () => ({ status: 'unknown' as const }));
    const { stub, agent } = await pausedAgent(memoryPersistence(reconcile));
    stub.runAgent.mockImplementationOnce(async () => ({ result: undefined, newMessages: [] }));

    await agent.submit({ resume: { approved: true } });

    const err = agent.error();
    expect(err?.kind).toBe('interrupted');
    expect(err?.recovery).toBe('check');
    expect(err?.retryable).toBe(false);
    expect(err?.message).toBe(AGENT_RECOVERY_MESSAGES.check);
    expect(typeof err?.detail).toBe('string');
  });

  it('does not offer a retry for a truncated client-tool continuation', async () => {
    const stub = new StubAgent();
    const agent = toAgent(stub as unknown as AbstractAgent, { telemetry: false });
    agent.clientTools.setCatalog([{
      name: 'confirm_action',
      description: 'Confirm an action.',
      parameters: { type: 'object', properties: {} },
    }]);
    stub.runAgent.mockImplementationOnce(async () => {
      stub.emit({ type: 'RUN_STARTED', runId: 'r1' } as BaseEvent);
      stub.emit({
        type: 'TOOL_CALL_START',
        toolCallId: 'confirmation-1',
        toolCallName: 'confirm_action',
        parentMessageId: 'tool-parent',
      } as unknown as BaseEvent);
      stub.emit({ type: 'TOOL_CALL_ARGS', toolCallId: 'confirmation-1', delta: '{}' } as unknown as BaseEvent);
      stub.emit({ type: 'TOOL_CALL_END', toolCallId: 'confirmation-1' } as unknown as BaseEvent);
      stub.emit({ type: 'RUN_FINISHED', runId: 'r1' } as BaseEvent);
      return { result: undefined, newMessages: [] };
    });

    await agent.submit({ content: 'confirm?' });
    // Guards the rest of the case: without a pending client tool there is no
    // continuation run to truncate.
    expect(agent.clientTools.pending().map(call => call.id)).toEqual(['confirmation-1']);
    expect(agent.error()).toBeUndefined();

    // The continuation run carries the tool result, so it emits no event of its
    // own before closing — the same shape as case one, but NOT replayable.
    stub.runAgent.mockImplementationOnce(async () => ({ result: undefined, newMessages: [] }));
    agent.clientTools.resolve('confirmation-1', { ok: true, value: { confirmed: true } });
    await vi.waitFor(() => expect(agent.error()).toBeDefined());

    const err = agent.error();
    expect(err?.kind).toBe('interrupted');
    expect(err?.recovery).toBe('none');
    expect(err?.retryable).toBe(false);
  });
});
