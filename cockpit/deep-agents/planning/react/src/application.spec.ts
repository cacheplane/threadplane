import { expect, it, vi } from 'vitest';
import {
  staticDelivery,
  type CompleteOutcome,
  type Message,
} from '@threadplane/core';
import { createPlanningApplication, type PlanningSession } from './application';
import type { PlanningSnapshot } from './terminal';

interface WireCall {
  id: string;
  name: string;
  args: { todos: { content: string; status: string }[] };
  type: string;
}
interface WireMessage {
  id: string;
  type: string;
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: WireCall[];
  status?: string;
}
interface Raw {
  values: {
    messages: WireMessage[];
    files?: Record<string, unknown>;
    todos?: { content: string; status: string }[];
  };
  checkpoint?: {
    thread_id: string;
    checkpoint_ns: string;
    checkpoint_id: string;
  };
  next: unknown[];
  tasks: unknown[];
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function setup() {
  let state: PlanningSnapshot = {
    status: 'idle',
    messages: [],
    toolCalls: [],
    interrupts: [],
    subgraphs: [],
  };
  let raw: Raw = { values: { messages: [] }, next: [], tasks: [] };
  let turn = 0;
  const listeners = new Set<() => void>();
  const emit = (next: PlanningSnapshot) => {
    state = next;
    for (const l of listeners) l();
  };
  const complete = (
    text: string,
    items = [{ content: 'Unfinished', status: 'in_progress' }],
    write = true
  ) => {
    const n = ++turn,
      prefix = raw.values.messages;
    const calls = write
      ? [
          {
            id: `call${n}`,
            name: 'write_todos',
            args: { todos: items },
            type: 'tool_call',
          },
        ]
      : [];
    const messages = [
      ...prefix,
      { id: `human${n}`, type: 'human', content: text },
      ...(write
        ? [
            { id: `ai${n}`, type: 'ai', content: '', tool_calls: calls },
            {
              id: `tool${n}`,
              type: 'tool',
              content: 'Result received',
              name: 'write_todos',
              tool_call_id: `call${n}`,
              status: 'success',
            },
          ]
        : []),
      {
        id: `answer${n}`,
        type: 'ai',
        content: 'Here is the response',
        tool_calls: [],
      },
    ];
    const checkpoint = {
      thread_id: 'thread',
      checkpoint_ns: '',
      checkpoint_id: `cp${n}`,
    };
    raw = {
      checkpoint,
      values: {
        messages,
        files: {},
        ...(write
          ? { todos: items }
          : raw.values.todos
          ? { todos: raw.values.todos }
          : {}),
      },
      next: [],
      tasks: [],
    };
    const projected = messages.map((m: WireMessage) => ({
      id: m.id,
      content: m.content,
      role:
        m.type === 'human' ? 'user' : m.type === 'ai' ? 'assistant' : 'tool',
      delivery: staticDelivery(m.id),
      ...(m.name ? { name: m.name } : {}),
      ...(m.tool_call_id ? { toolCallId: m.tool_call_id } : {}),
      ...(m.tool_calls
        ? { toolCallIds: m.tool_calls.map((c: WireCall) => c.id) }
        : {}),
    })) as Message[];
    const toolCalls = messages.flatMap((m: WireMessage) =>
      (m.tool_calls ?? []).map((c: WireCall) => ({
        id: c.id,
        name: c.name,
        args: c.args,
        result: 'Result received',
        status: 'complete' as const,
      }))
    );
    emit({
      status: 'idle',
      messages: projected,
      toolCalls,
      values: {
        files: {},
        ...(raw.values.todos ? { todos: raw.values.todos } : {}),
      },
      history: [{ checkpoint, next: [] }],
      interrupts: [],
      subgraphs: [],
    });
  };
  const session = {
    getSnapshot: () => state,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    submit: vi.fn(async (text: string): Promise<CompleteOutcome> => {
      complete(text);
      return 'success';
    }),
    load: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  } as unknown as PlanningSession;
  const client = {
    createThread: vi.fn(async () => 'thread'),
    sessionFactory: vi.fn(() => session),
    readCurrent: vi.fn(async () => raw),
    readCheckpoint: vi.fn(async () => raw),
  };
  return {
    app: createPlanningApplication(client),
    client,
    session,
    emit,
    complete,
    get raw() {
      return raw;
    },
    deferred,
  };
}
it('mount is inert and first send creates one lazy thread and confirms unfinished plan', async () => {
  const f = setup();
  expect(f.client.createThread).not.toHaveBeenCalled();
  expect(f.client.readCurrent).not.toHaveBeenCalled();
  expect(f.app.getSnapshot()).toMatchObject({
    phase: 'idle',
    rows: [],
    savedPlan: { kind: 'missing' },
  });
  await f.app.submit('Plan');
  expect(f.app.getSnapshot()).toMatchObject({
    phase: 'saved',
    busy: false,
    savedPlan: { kind: 'valid', items: [{ status: 'in_progress' }] },
  });
  expect(f.client.createThread).toHaveBeenCalledOnce();
  await f.app.dispose();
});
it('failed creation can retry without borrowing an unconfirmed id', async () => {
  const f = setup();
  f.client.createThread.mockRejectedValueOnce(Error('private'));
  await f.app.submit('Plan');
  expect(f.app.getSnapshot()).toMatchObject({
    phase: 'failed',
    canSubmit: true,
    threadId: null,
  });
  await f.app.submit('Plan');
  expect(f.app.getSnapshot().phase).toBe('saved');
  await f.app.dispose();
});
it('observed replacement appears live but saved authority waits for checkpoint', async () => {
  const f = setup(),
    held = deferred<Raw>();
  f.client.readCheckpoint.mockImplementation(() => held.promise);
  const pending = f.app.submit('Plan');
  await vi.waitFor(() => expect(f.app.getSnapshot().phase).toBe('confirming'));
  expect(f.app.getSnapshot().observedPlan.kind).toBe('valid');
  expect(f.app.getSnapshot().savedPlan.kind).toBe('missing');
  held.resolve(f.raw);
  await pending;
  expect(f.app.getSnapshot().phase).toBe('saved');
  await f.app.dispose();
});
for (const outcome of ['error', 'aborted', 'paused'] as const)
  it(`native ${outcome} cannot promote plan`, async () => {
    const f = setup();
    vi.mocked(f.session.submit).mockImplementation(async (text) => {
      f.complete(text as string);
      return outcome;
    });
    await f.app.submit('Plan');
    expect(f.app.getSnapshot().savedPlan.kind).toBe('missing');
    expect(f.client.readCheckpoint).not.toHaveBeenCalled();
    expect(f.app.getSnapshot().phase).toBe(
      outcome === 'aborted'
        ? 'stopped'
        : outcome === 'error'
        ? 'failed'
        : 'unconfirmed'
    );
    await f.app.dispose();
  });
it('uncertain checkpoint retains saved authority and later successful request recovers', async () => {
  const f = setup();
  await f.app.submit('Plan');
  const saved = f.app.getSnapshot().savedPlan;
  f.client.readCheckpoint.mockRejectedValueOnce(Error('private'));
  await f.app.submit('Again');
  expect(f.app.getSnapshot()).toMatchObject({
    phase: 'unconfirmed',
    savedPlan: saved,
  });
  await f.app.submit('Recover');
  expect(f.app.getSnapshot().phase).toBe('saved');
  expect(f.app.getSnapshot().messages).toHaveLength(12);
  await f.app.dispose();
});
it('invalid live values retain prior valid display and notice', async () => {
  const f = setup();
  await f.app.submit('Plan');
  const observed = f.app.getSnapshot().observedPlan;
  vi.mocked(f.session.submit).mockImplementation(async () => {
    f.emit({
      ...f.session.getSnapshot(),
      values: { todos: [{ content: 'bad', status: 'wrong' }] },
    });
    return 'error';
  });
  await f.app.submit('Bad');
  expect(f.app.getSnapshot().observedPlan).toEqual(observed);
  expect(f.app.getSnapshot().notice).toMatch(/50|2000/);
  await f.app.dispose();
});
it('New clears all state without creation and old checkpoint completion cannot republish', async () => {
  const f = setup(),
    held = deferred<Raw>();
  f.client.readCheckpoint.mockImplementation(() => held.promise);
  const pending = f.app.submit('Plan');
  await vi.waitFor(() => expect(f.app.getSnapshot().phase).toBe('confirming'));
  await f.app.newConversation();
  held.resolve(f.raw);
  await pending;
  expect(f.app.getSnapshot()).toMatchObject({
    threadId: null,
    rows: [],
    phase: 'idle',
    observedPlan: { kind: 'missing' },
    savedPlan: { kind: 'missing' },
  });
  expect(f.client.createThread).toHaveBeenCalledOnce();
  await f.app.dispose();
});
it('stop invalidates late streams and confirmation while retaining saved plan', async () => {
  const f = setup();
  await f.app.submit('Plan');
  const held = deferred<CompleteOutcome>();
  vi.mocked(f.session.submit).mockImplementation(() => held.promise);
  const pending = f.app.submit('Again');
  await vi.waitFor(() => expect(f.session.submit).toHaveBeenCalledTimes(2));
  await f.app.stop();
  const stopped = f.app.getSnapshot();
  f.complete('Again');
  held.resolve('success');
  await pending;
  expect(f.app.getSnapshot()).toBe(stopped);
  expect(stopped.phase).toBe('stopped');
  expect(stopped.savedPlan.kind).toBe('valid');
  await f.app.dispose();
});
it('dispose suppresses pending creation and late publications', async () => {
  const f = setup(),
    held = deferred<string>();
  f.client.createThread.mockImplementation(() => held.promise);
  const pending = f.app.submit('Plan');
  await f.app.dispose();
  const snapshot = f.app.getSnapshot();
  held.resolve('thread');
  await pending;
  expect(f.client.sessionFactory).not.toHaveBeenCalled();
  expect(f.app.getSnapshot()).toBe(snapshot);
});
it('double send is rejected while busy and empty text is inert', async () => {
  const f = setup(),
    held = deferred<string>();
  f.client.createThread.mockImplementation(() => held.promise);
  await f.app.submit(' ');
  expect(f.client.createThread).not.toHaveBeenCalled();
  const pending = f.app.submit('Plan');
  await f.app.submit('Other');
  expect(f.client.createThread).toHaveBeenCalledOnce();
  held.resolve('thread');
  await pending;
  await f.app.dispose();
});
it('a human first introduced by checkpoint load cannot attest native submit ownership', async () => {
  const f = setup();
  vi.mocked(f.session.submit).mockResolvedValue('success');
  vi.mocked(f.session.load).mockImplementation(async () => {
    f.complete('Plan');
  });
  await f.app.submit('Plan');
  expect(f.app.getSnapshot().phase).toBe('unconfirmed');
  expect(f.app.getSnapshot().savedPlan.kind).toBe('missing');
  await f.app.dispose();
});
it('rejects a foreign current-state checkpoint before another native submit', async () => {
  const f = setup();
  await f.app.submit('Plan');
  f.client.readCurrent.mockResolvedValueOnce({
    ...f.raw,
    checkpoint: {
      checkpoint_ns: '',
      checkpoint_id: 'foreign-cp',
      thread_id: 'foreign',
    },
  });
  await f.app.submit('Again');
  expect(f.session.submit).toHaveBeenCalledOnce();
  expect(f.app.getSnapshot().phase).toBe('failed');
  await f.app.dispose();
});
it('valid recovery clears the current invalid-update notice', async () => {
  const f = setup();
  await f.app.submit('Plan');
  vi.mocked(f.session.submit).mockImplementationOnce(async () => {
    f.emit({ ...f.session.getSnapshot(), values: { todos: 'bad' } });
    return 'error';
  });
  await f.app.submit('Bad');
  expect(f.app.getSnapshot().notice).toBeTruthy();
  await f.app.submit('Recover');
  expect(f.app.getSnapshot()).toMatchObject({ phase: 'saved', notice: null });
  await f.app.dispose();
});
it('New invalidates a pending current-prefix read before another native send', async () => {
  const f = setup();
  await f.app.submit('Plan');
  const held = deferred<Raw>();
  f.client.readCurrent.mockImplementation(() => held.promise);
  const pending = f.app.submit('Again');
  await vi.waitFor(() => expect(f.client.readCurrent).toHaveBeenCalledOnce());
  await f.app.newConversation();
  held.resolve(f.raw);
  await pending;
  expect(f.session.submit).toHaveBeenCalledOnce();
  expect(f.app.getSnapshot()).toMatchObject({
    threadId: null,
    rows: [],
    phase: 'idle',
  });
  await f.app.dispose();
});
it('native successful promise without live human cannot borrow a previously saved human', async () => {
  const f = setup();
  await f.app.submit('Plan');
  const saved = f.app.getSnapshot().savedPlan;
  vi.mocked(f.session.submit).mockResolvedValueOnce('success');
  await f.app.submit('Plan');
  expect(f.app.getSnapshot()).toMatchObject({
    phase: 'unconfirmed',
    savedPlan: saved,
  });
  await f.app.dispose();
});
it('read-only status changes preserve unfinished items after assistant completes', async () => {
  const f = setup();
  await f.app.submit('Plan');
  expect(f.app.getSnapshot().phase).toBe('saved');
  expect(f.app.getSnapshot().observedPlan).toEqual({
    kind: 'valid',
    items: [{ content: 'Unfinished', status: 'in_progress' }],
  });
  f.emit({
    ...f.session.getSnapshot(),
    status: 'running',
    values: { todos: [{ content: 'Late', status: 'completed' }] },
  });
  expect(f.app.getSnapshot().observedPlan).toEqual({
    kind: 'valid',
    items: [{ content: 'Unfinished', status: 'in_progress' }],
  });
  await f.app.dispose();
});
it('synchronous owner replacement during native subscription releases the rejected subscription', async () => {
  const f = setup(),
    release = vi.fn();
  let notifications = 0;
  vi.spyOn(f.session, 'subscribe').mockImplementation((notify) => {
    notify();
    return release;
  });
  f.app.subscribe(() => {
    if (++notifications === 2) void f.app.newConversation();
  });
  await f.app.submit('Plan');
  expect(release).toHaveBeenCalledOnce();
  expect(f.session.submit).not.toHaveBeenCalled();
  expect(f.app.getSnapshot()).toMatchObject({ phase: 'idle', threadId: null });
  await f.app.dispose();
});
