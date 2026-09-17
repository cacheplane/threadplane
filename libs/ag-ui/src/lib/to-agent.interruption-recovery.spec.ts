import { describe, it, expect, vi } from 'vitest';
import { Observable, Subject } from 'rxjs';
import type { AbstractAgent, BaseEvent } from '@ag-ui/client';
import type { RunAgentInput } from '@ag-ui/core';
import { AgentError } from '@threadplane/chat';
import { toAgent } from './to-agent';

vi.mock('@threadplane/telemetry/browser', async (importOriginal) => ({
  ...await importOriginal<object>(),
  createDevelopmentRuntime: () => ({
    touch: () => undefined,
    milestone: () => undefined,
    dispose: () => undefined,
  }),
}));

/** Minimal AbstractAgent stand-in; mirrors the stub in to-agent.spec.ts. */
class StubAgent {
  private readonly _events = new Subject<BaseEvent>();
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
  setMessages = vi.fn();

  run(_input: RunAgentInput): Observable<BaseEvent> {
    return this._events.asObservable();
  }
}

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
  it('settles a terminal event the reducer declined to attribute as success', async () => {
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
});
