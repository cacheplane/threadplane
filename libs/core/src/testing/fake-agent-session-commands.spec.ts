import { describe, expect, it, vi } from 'vitest';
import { onAgentStateUpdate, type AgentError } from '../index';
import { createFakeAgentSession } from './index';

const retryable: AgentError = {
  kind: 'connection',
  message: 'Offline',
  retryable: true,
  recovery: 'retry',
};

describe('createFakeAgentSession optional members', () => {
  it('carries none of the optional commands unless asked', () => {
    const { session } = createFakeAgentSession();
    expect(session.run).toBeUndefined();
    expect(session.regenerate).toBeUndefined();
    expect(session.retry).toBeUndefined();
    expect(session.checkStatus).toBeUndefined();
    expect(session.onCustomEvent).toBeUndefined();
    expect(session.clientTools).toBeUndefined();
    expect(session.resume).toBeTypeOf('function');
  });

  it('makes a command present when listed or when its handler is given', () => {
    const listed = createFakeAgentSession({
      commands: ['run', 'regenerate', 'retry', 'checkStatus'],
    }).session;
    const handled = createFakeAgentSession({
      onRun: () => undefined,
      onRegenerate: () => undefined,
      onRetry: () => undefined,
      onCheckStatus: () => undefined,
    }).session;
    for (const session of [listed, handled]) {
      expect(session.run).toBeTypeOf('function');
      expect(session.regenerate).toBeTypeOf('function');
      expect(session.retry).toBeTypeOf('function');
      expect(session.checkStatus).toBeTypeOf('function');
    }
  });

  it('publishes usage, history, streaming tool calls and an input block', () => {
    const fake = createFakeAgentSession({
      usage: { entries: [{ model: 'm', inputTokens: 3 }] },
      inputBlocked: { reason: 'interrupt' },
    });
    expect(fake.session.getSnapshot().usage).toEqual({
      entries: [{ model: 'm', inputTokens: 3 }],
    });
    expect(fake.session.getSnapshot().inputBlocked).toEqual({
      reason: 'interrupt',
    });
    fake.setUsage(undefined);
    fake.set({ inputBlocked: undefined });
    expect(fake.session.getSnapshot()).not.toHaveProperty('usage');
    expect(fake.session.getSnapshot()).not.toHaveProperty('inputBlocked');

    const values = { todos: ['a'] };
    fake.setCheckpoints([{ id: 'c1', label: 'agent', values }], { m1: 'c1' });
    const { checkpoints, messageCheckpoints } = fake.session.getSnapshot();
    expect(checkpoints).toEqual([{ id: 'c1', label: 'agent', values }]);
    expect(messageCheckpoints).toEqual({ m1: 'c1' });
    expect(Object.isFrozen(checkpoints?.[0].values)).toBe(true);
    expect(checkpoints?.[0].values).not.toBe(values);
    fake.setCheckpoints(undefined);
    expect(fake.session.getSnapshot()).not.toHaveProperty('checkpoints');
    expect(fake.session.getSnapshot()).not.toHaveProperty('messageCheckpoints');

    fake.set({
      streamingToolCalls: [
        { id: 't', name: 'lookup', argsText: '{"q":"x', args: { q: 'x' } },
      ],
    });
    expect(fake.session.getSnapshot().streamingToolCalls).toEqual([
      { id: 't', name: 'lookup', argsText: '{"q":"x', args: { q: 'x' } },
    ]);
    expect(fake.session.getSnapshot().toolCalls).toEqual([]);
  });

  it('publishes a described cause beside the error and drops it with the error', () => {
    const fake = createFakeAgentSession();
    const thrown = new TypeError('socket closed');
    fake.setError(retryable, thrown);
    const snapshot = fake.session.getSnapshot();
    expect(snapshot.error).toEqual(retryable);
    expect(snapshot.error).not.toHaveProperty('diagnostic');
    expect(snapshot.errorDiagnostic).toEqual({
      name: 'TypeError',
      message: 'socket closed',
      stack: thrown.stack,
    });
    expect(Object.isFrozen(snapshot.errorDiagnostic)).toBe(true);
    fake.setError({ ...retryable, message: 'Again' });
    expect(fake.session.getSnapshot()).not.toHaveProperty('errorDiagnostic');
    fake.setError(retryable, thrown);
    fake.setError(undefined);
    expect(fake.session.getSnapshot()).not.toHaveProperty('errorDiagnostic');
    // A diagnostic without an error is not published.
    fake.set({ errorDiagnostic: { message: 'orphan' } });
    expect(fake.session.getSnapshot()).not.toHaveProperty('errorDiagnostic');
  });

  it('publishes message blocks and extras, tool result parts, and child state', () => {
    const fake = createFakeAgentSession({
      messages: [
        {
          id: 'm',
          role: 'assistant',
          content: 'A chart',
          blocks: [
            { type: 'text', text: 'A chart' },
            { type: 'image', url: 'https://example.test/c.png' },
          ],
          extra: { tool_calls: [{ name: 'lookup' }] },
        },
      ],
      toolCalls: [
        {
          id: 't',
          name: 'lookup',
          args: {},
          status: 'complete',
          result: 'done',
          parts: [{ type: 'text', text: 'done' }],
        },
      ],
      subagents: [{ id: 's', state: { step: 2 } }],
    });
    const snapshot = fake.session.getSnapshot();
    expect(snapshot.messages[0].blocks).toHaveLength(2);
    expect(Object.isFrozen(snapshot.messages[0].blocks)).toBe(true);
    expect(snapshot.messages[0].extra).toEqual({
      tool_calls: [{ name: 'lookup' }],
    });
    expect(snapshot.toolCalls[0]).toMatchObject({
      parts: [{ type: 'text', text: 'done' }],
    });
    expect(snapshot.subagents?.[0].state).toEqual({ step: 2 });
  });

  it('submits blocks as a user message that keeps its text', async () => {
    const fake = createFakeAgentSession();
    await fake.session.submit({
      message: 'Look',
      blocks: [
        { type: 'text', text: 'Look' },
        { type: 'image', url: 'https://example.test/a.png', alt: 'A' },
      ],
    });
    expect(fake.session.getSnapshot().messages[0]).toMatchObject({
      role: 'user',
      content: 'Look',
      blocks: [
        { type: 'text', text: 'Look' },
        { type: 'image', url: 'https://example.test/a.png', alt: 'A' },
      ],
    });
  });

  it('runs without appending a message and merges the state it is given', async () => {
    const onRun = vi.fn(() => 'paused' as const);
    const fake = createFakeAgentSession({ state: { a: 1 }, onRun });
    await expect(fake.session.run?.({ state: { b: 2 } })).resolves.toBe(
      'paused'
    );
    await expect(fake.session.run?.()).resolves.toBe('paused');
    expect(fake.session.getSnapshot().messages).toEqual([]);
    expect(fake.session.getSnapshot().state).toEqual({ a: 1, b: 2 });
    expect(fake.runs).toEqual([{ input: { state: { b: 2 } } }, {}]);
    expect(onRun).toHaveBeenCalledTimes(2);
  });

  it('regenerates by removing the answer and everything after it', async () => {
    const fake = createFakeAgentSession({
      commands: ['regenerate'],
      messages: [
        { id: 'u1', role: 'user', content: 'Hi' },
        { id: 'a1', role: 'assistant', content: 'Hello' },
        { id: 'u2', role: 'user', content: 'More' },
      ],
    });
    await expect(fake.session.regenerate?.('u1')).rejects.toThrow(
      'No assistant message'
    );
    await expect(fake.session.regenerate?.('missing')).rejects.toThrow(
      'No assistant message'
    );
    fake.setStatus('running');
    await expect(fake.session.regenerate?.('a1')).rejects.toThrow(
      'during a run'
    );
    fake.setStatus('idle');
    await expect(fake.session.regenerate?.('a1')).resolves.toBe('success');
    expect(fake.session.getSnapshot().messages.map(({ id }) => id)).toEqual([
      'u1',
    ]);
    expect(fake.regenerates.map(({ messageId }) => messageId)).toEqual([
      'u1',
      'missing',
      'a1',
      'a1',
    ]);
  });

  it('lets a regenerate handler stream the new answer', async () => {
    const fake = createFakeAgentSession({
      messages: [
        { id: 'u1', role: 'user', content: 'Hi' },
        { id: 'a1', role: 'assistant', content: 'Hello' },
      ],
      onRegenerate: (session) => {
        const reply = session.stream({ id: 'a2', text: 'Hello again' });
        reply.complete();
      },
    });
    await fake.session.regenerate?.('a1');
    expect(
      fake.session
        .getSnapshot()
        .messages.map(({ id, content }) => [id, content])
    ).toEqual([
      ['u1', 'Hi'],
      ['a2', 'Hello again'],
    ]);
  });

  it('retries the submission that failed without a second user message', async () => {
    let fail = true;
    const onSubmit = vi.fn((_input, session) => {
      if (!fail) return;
      fail = false;
      session.setError(retryable);
      throw new Error('offline');
    });
    const fake = createFakeAgentSession({ commands: ['retry'], onSubmit });
    await expect(fake.session.retry?.()).resolves.toBe('aborted');
    await expect(fake.session.submit('Hello')).rejects.toThrow('offline');
    expect(fake.session.getSnapshot().status).toBe('error');
    await expect(fake.session.retry?.()).resolves.toBe('success');
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[1][0]).toBe('Hello');
    const snapshot = fake.session.getSnapshot();
    expect(snapshot.messages.map(({ content }) => content)).toEqual(['Hello']);
    expect(snapshot.error).toBeUndefined();
    expect(snapshot.status).toBe('idle');
    expect(fake.retryCount).toBe(2);
  });

  it('refuses to retry a failure that cannot be retried, and never during a run', async () => {
    const fake = createFakeAgentSession({ commands: ['retry'] });
    fake.setError({ ...retryable, recovery: 'check', retryable: false });
    await expect(fake.session.retry?.()).rejects.toThrow('cannot be retried');
    fake.setError({ kind: 'auth', message: 'No', retryable: false });
    await expect(fake.session.retry?.()).rejects.toThrow('cannot be retried');
    expect(fake.session.getSnapshot().error).toBeDefined();
    fake.setError(retryable);
    fake.setStatus('running');
    await expect(fake.session.retry?.()).resolves.toBe('aborted');
  });

  it('uses a retry handler in place of the failed call', async () => {
    const onRetry = vi.fn(() => 'paused' as const);
    const fake = createFakeAgentSession({ onRetry });
    fake.setError(retryable);
    await expect(fake.session.retry?.()).resolves.toBe('paused');
    expect(onRetry).toHaveBeenCalledWith(fake);
  });

  it('checks status through its handler and rejects during a run', async () => {
    const fake = createFakeAgentSession({
      onCheckStatus: (session) => session.setError(undefined),
    });
    fake.setError({ ...retryable, recovery: 'check', retryable: false });
    await fake.session.checkStatus?.();
    expect(fake.session.getSnapshot().status).toBe('idle');
    fake.setStatus('running');
    await expect(fake.session.checkStatus?.()).rejects.toThrow('during a run');
    expect(fake.checkStatusCount).toBe(2);
  });

  it('delivers custom events to listeners, isolates a throwing one, and stops at disposal', async () => {
    const fake = createFakeAgentSession({ commands: ['onCustomEvent'] });
    const seen = vi.fn();
    const release = fake.session.onCustomEvent?.(() => {
      throw new Error('listener');
    });
    fake.session.onCustomEvent?.(seen);
    const data = { step: 1 };
    fake.emitCustomEvent('progress', data);
    expect(seen).toHaveBeenCalledWith({ name: 'progress', data: { step: 1 } });
    expect(Object.isFrozen(seen.mock.calls[0][0].data)).toBe(true);
    expect(seen.mock.calls[0][0].data).not.toBe(data);
    release?.();
    release?.();
    await fake.session.dispose();
    fake.emitCustomEvent('progress', { step: 2 });
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('feeds render-store updates from state_update events', () => {
    const fake = createFakeAgentSession({ commands: ['onCustomEvent'] });
    const updates = vi.fn();
    const release = onAgentStateUpdate(fake.session, updates);
    fake.emitCustomEvent('progress', { step: 1 });
    fake.emitCustomEvent('state_update', ['not', 'a', 'record']);
    fake.emitCustomEvent('state_update', { '/chart/title': 'Sales' });
    expect(updates.mock.calls).toEqual([[{ '/chart/title': 'Sales' }]]);
    release();
    fake.emitCustomEvent('state_update', { '/chart/title': 'Later' });
    expect(updates).toHaveBeenCalledTimes(1);
    // A session without custom events yields an inert release.
    expect(
      onAgentStateUpdate(createFakeAgentSession().session, updates)()
    ).toBeUndefined();
  });

  it('records client tool catalogs and settles pending calls', async () => {
    const call = {
      id: 't1',
      name: 'locate',
      args: {},
      status: 'pending',
    } as const;
    const other = { ...call, id: 't2' };
    const fake = createFakeAgentSession({
      commands: ['clientTools'],
      toolCalls: [call, other],
      pendingClientTools: [call, other],
    });
    const tools = fake.session.clientTools;
    const spec = {
      name: 'locate',
      description: 'Finds the user.',
      parameters: { type: 'object', properties: {} },
    };
    tools?.setCatalog([spec]);
    tools?.setCatalog([]);
    expect(fake.catalogs).toEqual([[spec], []]);

    expect(() => tools?.resolve('missing', { ok: true, value: 1 })).toThrow(
      'No pending client tool call'
    );
    tools?.settle?.('t1', { ok: true, value: { city: 'Oslo' } });
    expect(fake.session.getSnapshot().pendingClientTools).toEqual([other]);
    tools?.resolve('t2', { ok: false, error: 'Denied' });
    await tools?.flush?.();
    const snapshot = fake.session.getSnapshot();
    expect(snapshot.pendingClientTools).toEqual([]);
    expect(snapshot.toolCalls).toEqual([
      { ...call, status: 'complete', result: { city: 'Oslo' } },
      { ...other, status: 'error', error: 'Denied' },
    ]);
    expect(fake.clientToolResults).toEqual([
      {
        kind: 'settle',
        toolCallId: 't1',
        result: { ok: true, value: { city: 'Oslo' } },
      },
      {
        kind: 'resolve',
        toolCallId: 't2',
        result: { ok: false, error: 'Denied' },
      },
    ]);
    expect(fake.flushCount).toBe(1);
  });

  it('applies a message and state sent with a resume', async () => {
    const onResume = vi.fn();
    const fake = createFakeAgentSession({
      interrupts: [{ id: 'i' }],
      state: { a: 1 },
      onResume,
    });
    const options = { message: 'Go on', state: { b: 2 } };
    await fake.session.resume?.(
      [{ interruptId: 'i', status: 'resolved' }],
      options
    );
    const snapshot = fake.session.getSnapshot();
    expect(snapshot.messages.map(({ content }) => content)).toEqual(['Go on']);
    expect(snapshot.state).toEqual({ a: 1, b: 2 });
    expect(snapshot.interrupts).toEqual([]);
    expect(onResume.mock.calls[0][2]).toBe(options);
    expect(fake.resumes[0].options).toBe(options);
  });

  it('times reasoning from its first text to the first answer text', () => {
    vi.useFakeTimers();
    try {
      const fake = createFakeAgentSession();
      const reply = fake.stream({ id: 'r' });
      reply.appendReasoning('Thinking ');
      vi.advanceTimersByTime(40);
      reply.appendReasoning('hard.');
      vi.advanceTimersByTime(10);
      reply.append('Done');
      vi.advanceTimersByTime(500);
      reply.complete();
      expect(fake.session.getSnapshot().messages[0]).toMatchObject({
        content: 'Done',
        reasoning: 'Thinking hard.',
        reasoningDurationMs: 50,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
