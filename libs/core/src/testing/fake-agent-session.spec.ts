import { describe, expect, it, vi } from 'vitest';
import { completeDelivery, staticDelivery, streamingDelivery } from '../index';
import { createFakeAgentSession } from './index';

describe('createFakeAgentSession', () => {
  it('publishes a frozen initial snapshot that stays stable until a change', () => {
    const toolCalls = [
      {
        id: 'c',
        name: 'lookup',
        args: { query: 'x' },
        status: 'pending' as const,
      },
    ];
    const fake = createFakeAgentSession({
      messages: [{ id: 'm', role: 'assistant', content: 'Hi' }],
      toolCalls,
    });
    const snapshot = fake.session.getSnapshot();
    expect(snapshot).toEqual({
      status: 'idle',
      messages: [
        {
          id: 'm',
          role: 'assistant',
          content: 'Hi',
          delivery: staticDelivery('m'),
        },
      ],
      toolCalls,
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.messages)).toBe(true);
    expect(Object.isFrozen(snapshot.messages[0])).toBe(true);
    expect(Object.isFrozen(snapshot.messages[0].delivery)).toBe(true);
    expect(Object.isFrozen(snapshot.toolCalls[0].args)).toBe(true);
    expect(fake.session.getSnapshot()).toBe(snapshot);
    // Later caller mutation does not reach the owned copy.
    toolCalls[0].args.query = 'changed';
    expect(snapshot.toolCalls[0].args).toEqual({ query: 'x' });
  });

  it('notifies subscribers of changes only and keeps unchanged messages by reference', () => {
    const fake = createFakeAgentSession({
      messages: [{ id: 'a', role: 'user', content: 'Hello' }],
    });
    const notify = vi.fn();
    const release = fake.session.subscribe(notify);
    expect(notify).not.toHaveBeenCalled();
    const first = fake.session.getSnapshot().messages[0];
    const pushed = fake.push({ role: 'assistant', content: 'Hi' });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(pushed.id).toMatch(/^fake-assistant-/);
    expect(fake.session.getSnapshot().messages).toEqual([first, pushed]);
    expect(fake.session.getSnapshot().messages[0]).toBe(first);
    release();
    fake.setStatus('running');
    expect(notify).toHaveBeenCalledTimes(1);
    expect(fake.session.getSnapshot().status).toBe('running');
  });

  it('records submissions, appends the user message, and resolves success by default', async () => {
    const fake = createFakeAgentSession();
    const controller = new AbortController();
    await expect(
      fake.session.submit('Hello', { signal: controller.signal })
    ).resolves.toBe('success');
    expect(fake.submits).toEqual([
      { input: 'Hello', options: { signal: controller.signal } },
    ]);
    expect(fake.session.getSnapshot().messages).toMatchObject([
      {
        role: 'user',
        content: 'Hello',
        delivery: { phase: 'complete', outcome: 'success' },
      },
    ]);
  });

  it('streams a reply from a submit handler and returns to idle', async () => {
    const seen: string[] = [];
    const fake = createFakeAgentSession({
      onSubmit: (input, session) => {
        const reply = session.stream({ id: 'r' });
        seen.push(session.session.getSnapshot().status);
        reply.append('You said ');
        expect(session.session.getSnapshot().messages[1]).toEqual({
          id: 'r',
          role: 'assistant',
          content: 'You said ',
          delivery: streamingDelivery('r'),
        });
        reply.append(input);
        reply.complete();
        reply.append(' ignored');
      },
    });
    await fake.session.submit('hi');
    expect(seen).toEqual(['running']);
    const snapshot = fake.session.getSnapshot();
    expect(snapshot.status).toBe('idle');
    expect(snapshot.messages[1]).toEqual({
      id: 'r',
      role: 'assistant',
      content: 'You said hi',
      delivery: completeDelivery('r', 'success'),
    });
  });

  it('uses the handler outcome and propagates handler failures', async () => {
    const fake = createFakeAgentSession({ onSubmit: () => 'interrupted' });
    await expect(fake.session.submit('a')).resolves.toBe('interrupted');
    fake.onSubmit(() => {
      throw new Error('boom');
    });
    await expect(fake.session.submit('b')).rejects.toThrow('boom');
    fake.onSubmit(undefined);
    await expect(fake.session.submit('c')).resolves.toBe('success');
    expect(fake.submits.map((call) => call.input)).toEqual(['a', 'b', 'c']);
  });

  it('stop aborts open streams and counts calls', async () => {
    const fake = createFakeAgentSession();
    const reply = fake.stream({ text: 'Partial' });
    await fake.session.stop();
    expect(fake.stopCount).toBe(1);
    const snapshot = fake.session.getSnapshot();
    expect(snapshot.status).toBe('idle');
    expect(snapshot.messages[0]).toMatchObject({
      content: 'Partial',
      delivery: completeDelivery(reply.id, 'aborted'),
    });
  });

  it('sets and clears projected errors with the error status', () => {
    const fake = createFakeAgentSession();
    const cause = Object.assign(new Error('raw'), {
      kind: 'connection' as const,
      retryable: true,
    });
    fake.setError(cause);
    const snapshot = fake.session.getSnapshot();
    expect(snapshot.status).toBe('error');
    expect(snapshot.error).toEqual({
      kind: 'connection',
      message: 'raw',
      retryable: true,
      status: undefined,
      recovery: undefined,
      detail: undefined,
    });
    expect(snapshot.error).not.toBe(cause);
    expect(Object.isFrozen(snapshot.error)).toBe(true);
    fake.push({ role: 'assistant', content: 'Later' });
    expect(fake.session.getSnapshot().error).toBe(snapshot.error);
    fake.setError(undefined);
    expect(fake.session.getSnapshot().status).toBe('idle');
    expect('error' in fake.session.getSnapshot()).toBe(false);
  });

  it('replaces tool calls, plans, and whole message lists', () => {
    const fake = createFakeAgentSession();
    fake.setToolCalls([
      { id: 'c', name: 'lookup', args: {}, status: 'complete', result: 'ok' },
    ]);
    fake.set({
      messages: [{ id: 'x', role: 'system', content: 'Reset' }],
      plan: [{ label: 'Read', status: 'in_progress' }],
    });
    const snapshot = fake.session.getSnapshot();
    expect(snapshot.toolCalls).toHaveLength(1);
    expect(snapshot.messages.map((m) => m.id)).toEqual(['x']);
    expect(snapshot.plan).toEqual([{ label: 'Read', status: 'in_progress' }]);
    fake.set({ plan: undefined });
    expect('plan' in fake.session.getSnapshot()).toBe(false);
  });

  it('dispose releases subscribers and rejects later submissions', async () => {
    const fake = createFakeAgentSession();
    const notify = vi.fn();
    fake.session.subscribe(notify);
    await fake.session.dispose();
    expect(fake.disposed).toBe(true);
    fake.setStatus('running');
    expect(notify).not.toHaveBeenCalled();
    await expect(fake.session.submit('late')).rejects.toThrow(/disposed/);
  });

  it('accepts authored tool catalogs', () => {
    interface Catalog {
      weather: { args: { city: string }; result: { temp: number } };
    }
    const fake = createFakeAgentSession<Catalog>({
      toolCalls: [
        {
          id: 'w',
          name: 'weather',
          args: { city: 'Oslo' },
          status: 'complete',
          result: { temp: 3 },
        },
      ],
    });
    const call = fake.session.getSnapshot().toolCalls[0];
    expect(call.name === 'weather' && call.args.city).toBe('Oslo');
  });
});
