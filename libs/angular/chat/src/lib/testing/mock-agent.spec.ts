import { computed, isSignal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { mockAgent, type MockAgent } from './mock-agent';
import type { Agent, AgentError, AgentSessionCustomEvent } from '../agent';

const failure: AgentError = { kind: 'server', message: 'The server ran into an error.', retryable: true };

describe('mockAgent', () => {
  it('is assignable to the injected Agent', () => {
    const mock: MockAgent = mockAgent();
    const agent: Agent = mock;
    expect(agent.status()).toBe('idle');
  });

  it('starts idle and empty', () => {
    const agent = mockAgent();
    expect(agent.status()).toBe('idle');
    expect(agent.messages()).toEqual([]);
    expect(agent.toolCalls()).toEqual([]);
    expect(agent.error()).toBeUndefined();
    expect(agent.errorDiagnostic()).toBeUndefined();
    expect(agent.state()).toBeUndefined();
    expect(agent.plan()).toBeUndefined();
    expect(agent.usage()).toBeUndefined();
    expect(agent.interrupts()).toBeUndefined();
    expect(agent.subagents()).toBeUndefined();
    expect(agent.streamingToolCalls()).toBeUndefined();
    expect(agent.pendingClientTools()).toBeUndefined();
    expect(agent.checkpoints()).toBeUndefined();
    expect(agent.messageCheckpoints()).toBeUndefined();
    expect(agent.inputBlocked()).toBeUndefined();
    expect(agent.threadId()).toBeNull();
    expect(agent.isThreadLoading()).toBe(false);
    expect(agent.customEvents()).toEqual([]);
    expect(agent.submitCalls).toEqual([]);
    expect(agent.stopCount).toBe(0);
    expect(agent.switchThreadCalls).toEqual([]);
  });

  it('accepts initial values', () => {
    const agent = mockAgent({
      status: 'running',
      messages: [{ id: '1', role: 'user', content: 'hi' }],
      toolCalls: [{ id: 't1', name: 'search', args: {}, status: 'running' }],
      state: { count: 2 },
      plan: [{ label: 'Compare', status: 'pending' }],
      interrupts: [{ id: 'i1', value: 'Confirm?' }],
      threadId: 'thread-1',
      isThreadLoading: true,
    });
    expect(agent.status()).toBe('running');
    expect(agent.messages()).toEqual([
      { id: '1', role: 'user', content: 'hi', delivery: { generation: '1', phase: 'complete', outcome: 'success' } },
    ]);
    expect(agent.toolCalls()).toEqual([{ id: 't1', name: 'search', args: {}, status: 'running' }]);
    expect(agent.state()).toEqual({ count: 2 });
    expect(agent.plan()).toEqual([{ label: 'Compare', status: 'pending' }]);
    expect(agent.interrupts()).toEqual([{ id: 'i1', value: 'Confirm?' }]);
    expect(agent.threadId()).toBe('thread-1');
    expect(agent.isThreadLoading()).toBe(true);
  });

  it('exposes every field as a signal a test can set', () => {
    const agent = mockAgent();
    for (const field of [
      agent.status, agent.messages, agent.toolCalls, agent.error, agent.errorDiagnostic, agent.plan, agent.usage,
      agent.state, agent.interrupts, agent.subagents, agent.streamingToolCalls, agent.pendingClientTools,
      agent.checkpoints, agent.messageCheckpoints, agent.inputBlocked, agent.threadId, agent.isThreadLoading,
      agent.customEvents,
    ]) {
      expect(isSignal(field)).toBe(true);
      expect(typeof field.set).toBe('function');
    }

    agent.status.set('running');
    expect(agent.status()).toBe('running');
    agent.messages.set([{ id: '1', role: 'user', content: 'hi' }]);
    expect(agent.messages().map((m) => m.content)).toEqual(['hi']);
    agent.toolCalls.set([{ id: 't1', name: 'search', args: { q: 'x' }, status: 'complete', result: 'ok' }]);
    expect(agent.toolCalls()).toEqual([{ id: 't1', name: 'search', args: { q: 'x' }, status: 'complete', result: 'ok' }]);
    agent.plan.set([{ label: 'Compare', status: 'in_progress' }]);
    expect(agent.plan()).toEqual([{ label: 'Compare', status: 'in_progress' }]);
    agent.usage.set({ entries: [{ model: 'm', inputTokens: 3 }] });
    expect(agent.usage()).toEqual({ entries: [{ model: 'm', inputTokens: 3 }] });
    agent.state.set({ count: 1 });
    expect(agent.state()).toEqual({ count: 1 });
    agent.interrupts.set([{ id: 'i1', value: 'Confirm?' }]);
    expect(agent.interrupts()).toEqual([{ id: 'i1', value: 'Confirm?' }]);
    agent.streamingToolCalls.set([{ id: 't2', name: 'search', argsText: '{"q":' }]);
    expect(agent.streamingToolCalls()).toEqual([{ id: 't2', name: 'search', argsText: '{"q":' }]);
    agent.pendingClientTools.set([{ id: 't3', name: 'ask', args: {}, status: 'pending' }]);
    expect(agent.pendingClientTools()).toEqual([{ id: 't3', name: 'ask', args: {}, status: 'pending' }]);
    agent.messageCheckpoints.set({ m1: 'c1' });
    expect(agent.messageCheckpoints()).toEqual({ m1: 'c1' });
    agent.inputBlocked.set({ reason: 'interrupt' });
    expect(agent.inputBlocked()).toEqual({ reason: 'interrupt' });
    agent.threadId.set('thread-2');
    expect(agent.threadId()).toBe('thread-2');
    agent.isThreadLoading.set(true);
    expect(agent.isThreadLoading()).toBe(true);

    // An optional field is removed again with undefined.
    agent.plan.set(undefined);
    agent.inputBlocked.set(undefined);
    expect(agent.plan()).toBeUndefined();
    expect(agent.inputBlocked()).toBeUndefined();
  });

  it('updates a field from its current value, and notifies readers', () => {
    const agent = mockAgent({ messages: [{ id: '1', role: 'user', content: 'hi' }] });
    const count = computed(() => agent.messages().length);
    expect(count()).toBe(1);
    agent.messages.update((messages) => [...messages, { id: '2', role: 'assistant', content: 'hello' }]);
    expect(count()).toBe(2);
    // Unchanged messages keep their reference across an update.
    const first = agent.messages()[0];
    agent.messages.update((messages) => [...messages, { id: '3', role: 'user', content: 'again' }]);
    expect(agent.messages()[0]).toBe(first);
    expect(agent.messages.asReadonly()()).toBe(agent.messages());
  });

  it('publishes frozen copies, as a session does', () => {
    const agent = mockAgent();
    const message = { id: '1', role: 'user' as const, content: 'hi' };
    agent.messages.set([message]);
    expect(agent.messages()[0]).not.toBe(message);
    expect(Object.isFrozen(agent.messages()[0])).toBe(true);
    expect(Object.isFrozen(agent.messages())).toBe(true);
  });

  it('setting an error moves the status to error, and clearing it returns to idle', () => {
    const agent = mockAgent();
    agent.error.set(failure);
    expect(agent.error()).toEqual(failure);
    expect(agent.status()).toBe('error');
    agent.error.set(undefined);
    expect(agent.error()).toBeUndefined();
    expect(agent.status()).toBe('idle');
  });

  it('holds a list of child agents with defaults filled in', () => {
    const agent = mockAgent();
    agent.subagents.set([{ id: 'child-1', toolCallId: 't1', name: 'Research', status: 'running' }]);
    expect(agent.subagents()).toEqual([
      { id: 'child-1', toolCallId: 't1', name: 'Research', status: 'running', messages: [], toolCalls: [] },
    ]);
  });

  it('holds the loaded history in checkpoints', () => {
    const agent = mockAgent({ checkpoints: [{ id: 'c1', label: 'start', values: {} }] });
    expect(agent.checkpoints()).toEqual([{ id: 'c1', label: 'start', values: {} }]);
    agent.checkpoints.set([
      { id: 'c1', label: 'start', values: {} },
      { id: 'c2', label: 'next', values: { foo: 2 } },
    ]);
    expect(agent.checkpoints()?.[1].values).toEqual({ foo: 2 });
    agent.checkpoints.set(undefined);
    expect(agent.checkpoints()).toBeUndefined();
  });

  it('records submit calls and appends the user message', async () => {
    const agent = mockAgent();
    const controller = new AbortController();
    await expect(agent.submit({ message: 'hello' })).resolves.toBe('success');
    await agent.submit('again', { signal: controller.signal });
    expect(agent.submitCalls).toEqual([
      { input: { message: 'hello' } },
      { input: 'again', opts: { signal: controller.signal } },
    ]);
    expect(agent.messages().map((m) => [m.role, m.content])).toEqual([
      ['user', 'hello'],
      ['user', 'again'],
    ]);
    expect(agent.fake.submits).toHaveLength(2);
  });

  it('runs an onSubmit handler, so a test can stream a reply', async () => {
    const agent = mockAgent({
      onSubmit: (_input, fake) => {
        const reply = fake.stream({ id: 'a1' });
        reply.append('Hi');
        expect(agent.status()).toBe('running');
        reply.complete();
      },
    });
    await agent.submit({ message: 'hello' });
    expect(agent.status()).toBe('idle');
    expect(agent.messages().at(-1)).toMatchObject({ id: 'a1', role: 'assistant', content: 'Hi' });
  });

  it('counts stop calls and ends a running stream', async () => {
    const agent = mockAgent();
    agent.fake.stream({ id: 'a1', text: 'partial' });
    expect(agent.status()).toBe('running');
    await agent.stop();
    expect(agent.stopCount).toBe(1);
    expect(agent.status()).toBe('idle');
    expect(agent.messages()[0].delivery).toEqual({ generation: 'a1', phase: 'complete', outcome: 'aborted' });
  });

  it('regenerate removes that answer and what followed, and records the call', async () => {
    const agent = mockAgent({
      messages: [
        { id: 'u1', role: 'user', content: 'q' },
        { id: 'a1', role: 'assistant', content: 'first' },
        { id: 'u2', role: 'user', content: 'q2' },
        { id: 'a2', role: 'assistant', content: 'second' },
      ],
    });
    await expect(agent.regenerate?.('a1')).resolves.toBe('success');
    expect(agent.messages().map((m) => m.id)).toEqual(['u1']);
    expect(agent.fake.regenerates).toEqual([{ messageId: 'a1' }]);
    await expect(agent.regenerate?.('u1')).rejects.toThrow(/No assistant message/);
  });

  it('resume removes the answered interrupts and records the call', async () => {
    const agent = mockAgent({
      interrupts: [
        { id: 'i1', value: 'A?' },
        { id: 'i2', value: 'B?' },
      ],
    });
    await expect(agent.resume?.([{ interruptId: 'i1', status: 'resolved', value: true }])).resolves.toBe('paused');
    expect(agent.interrupts()).toEqual([{ id: 'i2', value: 'B?' }]);
    await expect(agent.resume?.([{ interruptId: 'i2', status: 'cancelled' }])).resolves.toBe('success');
    expect(agent.interrupts()).toEqual([]);
    expect(agent.fake.resumes).toEqual([
      { responses: [{ interruptId: 'i1', status: 'resolved', value: true }] },
      { responses: [{ interruptId: 'i2', status: 'cancelled' }] },
    ]);
    await expect(agent.resume?.([{ interruptId: 'gone', status: 'resolved' }])).rejects.toThrow(/No pending interrupt/);
  });

  it('retry sends the failed submission again', async () => {
    let fail = true;
    const agent = mockAgent({
      onSubmit: () => {
        if (fail) throw new Error('offline');
      },
    });
    await expect(agent.submit({ message: 'hello' })).rejects.toThrow('offline');
    agent.error.set({ ...failure, recovery: 'retry' });
    fail = false;
    await expect(agent.retry?.()).resolves.toBe('success');
    expect(agent.fake.retryCount).toBe(1);
    expect(agent.error()).toBeUndefined();
    expect(agent.status()).toBe('idle');
    // No second user message is appended.
    expect(agent.messages()).toHaveLength(1);
  });

  it('carries regenerate, retry, onCustomEvent and resume by default, and nothing else optional', () => {
    const agent = mockAgent();
    expect(typeof agent.submit).toBe('function');
    expect(typeof agent.stop).toBe('function');
    expect(typeof agent.resume).toBe('function');
    expect(typeof agent.regenerate).toBe('function');
    expect(typeof agent.retry).toBe('function');
    expect(typeof agent.onCustomEvent).toBe('function');
    expect(agent.checkStatus).toBeUndefined();
    expect(agent.runWithoutMessage).toBeUndefined();
    expect(agent.clientTools).toBeUndefined();
  });

  it('carries exactly the commands a test lists', async () => {
    const bare = mockAgent({ commands: [] });
    expect(bare.retry).toBeUndefined();
    expect(bare.regenerate).toBeUndefined();
    expect(bare.onCustomEvent).toBeUndefined();
    // resume is always present.
    expect(typeof bare.resume).toBe('function');

    const full = mockAgent({
      commands: ['checkStatus', 'runWithoutMessage', 'clientTools'],
      pendingClientTools: [{ id: 't1', name: 'ask', args: {}, status: 'pending' }],
      toolCalls: [{ id: 't1', name: 'ask', args: {}, status: 'pending' }],
    });
    expect(full.retry).toBeUndefined();
    await full.checkStatus?.();
    expect(full.fake.checkStatusCount).toBe(1);
    await expect(full.runWithoutMessage?.({ state: { step: 1 } })).resolves.toBe('success');
    expect(full.state()).toEqual({ step: 1 });
    full.clientTools?.setCatalog([{ name: 'ask', description: 'Ask', parameters: {} }]);
    expect(full.fake.catalogs).toEqual([[{ name: 'ask', description: 'Ask', parameters: {} }]]);
    full.clientTools?.resolve('t1', { ok: true, value: 'yes' });
    expect(full.pendingClientTools()).toEqual([]);
    expect(full.toolCalls()).toEqual([{ id: 't1', name: 'ask', args: {}, status: 'complete', result: 'yes' }]);
    expect(full.fake.clientToolResults).toEqual([
      { kind: 'resolve', toolCallId: 't1', result: { ok: true, value: 'yes' } },
    ]);
  });

  it('makes a command present when its handler is given', async () => {
    const onCheckStatus = vi.fn();
    const agent = mockAgent({ onCheckStatus });
    await agent.checkStatus?.();
    expect(onCheckStatus).toHaveBeenCalledTimes(1);
    // The defaults still apply beside it.
    expect(typeof agent.retry).toBe('function');
  });

  it('switchThread records the call, moves threadId and empties the custom events', () => {
    const agent = mockAgent();
    agent.emitCustomEvent('progress', { step: 1 });
    expect(agent.customEvents()).toHaveLength(1);
    agent.switchThread('thread-9');
    expect(agent.threadId()).toBe('thread-9');
    expect(agent.customEvents()).toEqual([]);
    agent.switchThread(null);
    expect(agent.threadId()).toBeNull();
    expect(agent.switchThreadCalls).toEqual(['thread-9', null]);
  });

  it('delivers custom events to listeners and retains them in customEvents', () => {
    const agent = mockAgent();
    const seen: AgentSessionCustomEvent[] = [];
    const release = agent.onCustomEvent?.((event) => seen.push(event));
    agent.emitCustomEvent('state_update', { '/count': 1 });
    agent.emitCustomEvent('progress');
    expect(seen).toEqual([
      { name: 'state_update', data: { '/count': 1 } },
      { name: 'progress' },
    ]);
    expect(agent.customEvents()).toEqual(seen);
    release?.();
    agent.emitCustomEvent('late');
    expect(seen).toHaveLength(2);
    expect(agent.customEvents()).toHaveLength(3);
    // A test may also replace the retained list directly.
    agent.customEvents.set([]);
    expect(agent.customEvents()).toEqual([]);
  });

  it('has writable lifecycle marks that start null', () => {
    const agent = mockAgent();
    const marks = agent.lifecycle;
    for (const mark of [
      marks.streamStartedAt, marks.streamErrorAt, marks.interruptReceivedAt, marks.interruptResolvedAt,
      marks.threadCreatedAt, marks.threadPersistedAt, marks.toolCallStartedAt, marks.toolCallCompletedAt,
    ]) {
      expect(isSignal(mark)).toBe(true);
      expect(mark()).toBeNull();
    }
    marks.streamStartedAt.set(123);
    expect(agent.lifecycle.streamStartedAt()).toBe(123);
    marks.streamErrorAt.set({ at: 5, kind: 'server' });
    expect(agent.lifecycle.streamErrorAt()).toEqual({ at: 5, kind: 'server' });
    marks.streamStartedAt.set(null);
    expect(agent.lifecycle.streamStartedAt()).toBeNull();
  });

  it('needs no injection context and keeps agents independent', () => {
    const a = mockAgent();
    const b = mockAgent();
    a.messages.set([{ id: '1', role: 'user', content: 'hi' }]);
    expect(b.messages()).toEqual([]);
    expect(a.fake).not.toBe(b.fake);
  });
});
