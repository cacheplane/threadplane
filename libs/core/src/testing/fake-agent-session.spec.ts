import { describe, expect, it, vi } from 'vitest';
import {
  completeDelivery,
  staticDelivery,
  streamingDelivery,
  type,
  type StandardSchemaV1,
} from '../index';
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
        reply.append(typeof input === 'string' ? input : input.message);
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

  it('holds no state until one is set, then publishes an owned frozen copy', () => {
    const fake = createFakeAgentSession({
      stateType: type<{ todos: string[]; draft?: string }>(),
    });
    expect('state' in fake.session.getSnapshot()).toBe(false);
    const notify = vi.fn();
    fake.session.subscribe(notify);
    const authored = { todos: ['a'] };
    fake.setState(authored);
    const state = fake.session.getSnapshot().state;
    expect(state).toEqual({ todos: ['a'] });
    expect(state).not.toBe(authored);
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state?.todos)).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
    fake.push({ role: 'assistant', content: 'Later' });
    expect(fake.session.getSnapshot().state).toBe(state);
    fake.setState(undefined);
    expect('state' in fake.session.getSnapshot()).toBe(false);
  });

  it('starts with an initial state and replaces it whole through set', () => {
    const fake = createFakeAgentSession({
      stateType: type<{ count: number; label?: string }>(),
      state: { count: 1, label: 'one' },
    });
    expect(fake.session.getSnapshot().state).toEqual({
      count: 1,
      label: 'one',
    });
    fake.set({ state: { count: 2 } });
    expect(fake.session.getSnapshot().state).toEqual({ count: 2 });
  });

  it('merges submitted state into the snapshot and records the input as passed', async () => {
    const inputs: unknown[] = [];
    const fake = createFakeAgentSession({
      stateType: type<{ count: number; label?: string }>(),
      state: { count: 1 },
      onSubmit: (input, session) => {
        inputs.push(input, session.session.getSnapshot().state);
      },
    });
    await fake.session.submit({ message: 'Go', state: { label: 'one' } });
    const snapshot = fake.session.getSnapshot();
    expect(snapshot.state).toEqual({ count: 1, label: 'one' });
    expect(snapshot.messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'Go'],
    ]);
    expect(fake.submits).toEqual([
      { input: { message: 'Go', state: { label: 'one' } } },
    ]);
    expect(inputs).toEqual([
      { message: 'Go', state: { label: 'one' } },
      { count: 1, label: 'one' },
    ]);
    const before = snapshot.state;
    await fake.session.submit({ message: 'Again' });
    await fake.session.submit('Text');
    expect(fake.session.getSnapshot().state).toBe(before);
  });

  it('creates state from a submission when none was held', async () => {
    const fake = createFakeAgentSession();
    await fake.session.submit({ message: 'Go', state: { topic: 'x' } });
    expect(fake.session.getSnapshot().state).toEqual({ topic: 'x' });
  });

  it('checks every state against a schema declaration', async () => {
    const stateType: StandardSchemaV1<unknown, { count: number }> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: (value) =>
          typeof (value as { count?: unknown } | null)?.count === 'number'
            ? { value: { count: (value as { count: number }).count } }
            : { issues: [{ message: 'count must be a number' }] },
      },
    };
    expect(() =>
      createFakeAgentSession({ stateType, state: { count: 'x' } as never })
    ).toThrow(/does not match its schema: count must be a number/);
    const fake = createFakeAgentSession({ stateType, state: { count: 1 } });
    const notify = vi.fn();
    fake.session.subscribe(notify);
    expect(() => fake.setState({ count: 'x' } as never)).toThrow(TypeError);
    expect(fake.session.getSnapshot().state).toEqual({ count: 1 });
    expect(notify).not.toHaveBeenCalled();
    // The schema's output is what the snapshot holds: extra keys it drops are gone.
    fake.setState({ count: 2, stray: true } as never);
    expect(fake.session.getSnapshot().state).toEqual({ count: 2 });
    await expect(
      fake.session.submit({ message: 'Go', state: { count: 'x' } as never })
    ).rejects.toThrow(/does not match its schema/);
    expect(fake.session.getSnapshot().messages).toHaveLength(0);
  });

  it('publishes interrupts and removes the ones a resume answers', async () => {
    const fake = createFakeAgentSession();
    expect('interrupts' in fake.session.getSnapshot()).toBe(false);
    const value = { tool: 'send_email', args: { to: 'ada@example.com' } };
    fake.setInterrupts([
      { id: 'i1', value, reason: 'tool_approval', toolCallId: 'c1' },
      { id: 'i2', message: 'Which account?' },
    ]);
    const pending = fake.session.getSnapshot().interrupts;
    expect(pending).toEqual([
      { id: 'i1', value, reason: 'tool_approval', toolCallId: 'c1' },
      { id: 'i2', message: 'Which account?' },
    ]);
    expect(Object.isFrozen(pending)).toBe(true);
    expect(pending?.[0].value).not.toBe(value);
    expect(Object.isFrozen(pending?.[0].value)).toBe(true);

    const notify = vi.fn();
    fake.session.subscribe(notify);
    const signal = new AbortController().signal;
    await expect(
      fake.session.resume?.(
        [{ interruptId: 'i1', status: 'resolved', value: { approved: true } }],
        { signal }
      )
    ).resolves.toBe('paused');
    expect(notify).toHaveBeenCalledTimes(1);
    expect(fake.session.getSnapshot().interrupts).toEqual([
      { id: 'i2', message: 'Which account?' },
    ]);
    await expect(
      fake.session.resume?.([{ interruptId: 'i2', status: 'cancelled' }])
    ).resolves.toBe('success');
    expect(fake.session.getSnapshot().interrupts).toEqual([]);
    expect(fake.resumes).toEqual([
      {
        responses: [
          { interruptId: 'i1', status: 'resolved', value: { approved: true } },
        ],
        options: { signal },
      },
      { responses: [{ interruptId: 'i2', status: 'cancelled' }] },
    ]);
    fake.setInterrupts(undefined);
    expect('interrupts' in fake.session.getSnapshot()).toBe(false);
  });

  it('rejects a resume that names no pending interrupt, or one twice', async () => {
    const fake = createFakeAgentSession({ interrupts: [{ id: 'i1' }] });
    const before = fake.session.getSnapshot();
    await expect(
      fake.session.resume?.([{ interruptId: 'other', status: 'resolved' }])
    ).rejects.toThrow('No pending interrupt has the id "other".');
    await expect(
      fake.session.resume?.([
        { interruptId: 'i1', status: 'resolved' },
        { interruptId: 'i1', status: 'cancelled' },
      ])
    ).rejects.toThrow('The interrupt "i1" is answered twice.');
    expect(fake.session.getSnapshot()).toBe(before);
    expect(fake.resumes).toHaveLength(2);
    await fake.session.dispose();
    await expect(
      fake.session.resume?.([{ interruptId: 'i1', status: 'resolved' }])
    ).rejects.toThrow(/disposed/);
  });

  it('lets a resume handler continue the run and choose the outcome', async () => {
    const fake = createFakeAgentSession({
      interrupts: [{ id: 'i1' }],
      onResume: (responses, controls) => {
        controls.push({ role: 'assistant', content: responses[0].status });
        return 'error';
      },
    });
    await expect(
      fake.session.resume?.([{ interruptId: 'i1', status: 'resolved' }])
    ).resolves.toBe('error');
    expect(fake.session.getSnapshot().messages.at(-1)?.content).toBe(
      'resolved'
    );
    fake.setInterrupts([{ id: 'i2' }]);
    fake.onResume(() => {
      throw new Error('refused');
    });
    await expect(
      fake.session.resume?.([{ interruptId: 'i2', status: 'resolved' }])
    ).rejects.toThrow('refused');
    fake.setInterrupts([{ id: 'i3' }]);
    fake.onResume(undefined);
    await expect(
      fake.session.resume?.([{ interruptId: 'i3', status: 'resolved' }])
    ).resolves.toBe('success');
  });

  it('publishes child agents with owned transcripts', () => {
    const fake = createFakeAgentSession();
    expect('subagents' in fake.session.getSnapshot()).toBe(false);
    fake.setSubagents([
      {
        id: 'child-1',
        name: 'researcher',
        description: 'Find three sources',
        toolCallId: 'c1',
        status: 'running',
        messages: [
          { role: 'assistant', content: 'Searching', toolCallIds: ['s1'] },
        ],
        toolCalls: [
          { id: 's1', name: 'search', args: { q: 'tides' }, status: 'running' },
        ],
      },
      { id: 'child-2', parentId: 'child-1' },
    ]);
    const [first, second] = fake.session.getSnapshot().subagents ?? [];
    expect(first).toMatchObject({
      id: 'child-1',
      name: 'researcher',
      description: 'Find three sources',
      toolCallId: 'c1',
      status: 'running',
    });
    expect(first.messages).toEqual([
      {
        id: 'fake-assistant-1',
        role: 'assistant',
        content: 'Searching',
        toolCallIds: ['s1'],
        delivery: {
          generation: 'fake-assistant-1',
          phase: 'complete',
          outcome: 'success',
        },
      },
    ]);
    expect(first.toolCalls).toEqual([
      { id: 's1', name: 'search', args: { q: 'tides' }, status: 'running' },
    ]);
    expect(second).toEqual({
      id: 'child-2',
      parentId: 'child-1',
      status: 'complete',
      messages: [],
      toolCalls: [],
    });
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.messages)).toBe(true);
    // Root changes keep the children by reference.
    fake.push({ role: 'assistant', content: 'Done' });
    expect(fake.session.getSnapshot().subagents?.[0]).toBe(first);
    expect(fake.session.getSnapshot().messages).toHaveLength(1);
    fake.set({ subagents: undefined });
    expect('subagents' in fake.session.getSnapshot()).toBe(false);
  });
});
