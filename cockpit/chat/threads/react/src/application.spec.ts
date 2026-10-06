import { afterEach, expect, it, vi } from 'vitest';
import type { CompleteOutcome, Message } from '@threadplane/core';
import { createThreadsApplication } from './application';
import type { ThreadsSession } from './connection';
import type { ThreadsState } from './authority';
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}
async function tick() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}
const applications: ReturnType<typeof createThreadsApplication>[] = [];
afterEach(async () => {
  for (const app of applications.splice(0)) await app.dispose();
  vi.useRealTimers();
});
function setup() {
  let serial = 0;
  const creations: ReturnType<typeof deferred<string>>[] = [],
    sessions: ReturnType<typeof makeSession>[] = [],
    titles: {
      id: string;
      signal: AbortSignal;
      result: ReturnType<typeof deferred<unknown>>;
    }[] = [];
  const savedStates = new Map<string, ThreadsState>();
  function makeSession(id: string) {
    let state: ThreadsState = {
      status: 'idle',
      messages: [],
      toolCalls: [],
      interrupts: [],
      subgraphs: [],
      history: undefined,
    };
    const observers = new Set<() => void>(),
      release = vi.fn();
    const runs: {
        text: string;
        signal: AbortSignal | undefined;
        result: ReturnType<typeof deferred<CompleteOutcome>>;
      }[] = [],
      loads: {
        signal: AbortSignal | undefined;
        result: ReturnType<typeof deferred<void>>;
      }[] = [];
    const session: ThreadsSession = {
      getSnapshot: vi.fn(() => state),
      subscribe: vi.fn((notify) => {
        observers.add(notify);
        return () => {
          observers.delete(notify);
          release();
        };
      }),
      submit: vi.fn((text, options) => {
        const result = deferred<CompleteOutcome>();
        runs.push({ text, signal: options?.signal, result });
        return result.promise;
      }),
      load: vi.fn((options) => {
        const result = deferred<void>();
        loads.push({ signal: options?.signal, result });
        return result.promise;
      }),
      stop: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
    };
    function replace(patch: Partial<ThreadsState>, notify = true) {
      state = { ...state, ...patch };
      if (notify) for (const listener of observers) listener();
    }
    return { id, session, runs, loads, release, replace, state: () => state };
  }
  const createThread = vi.fn((signal: AbortSignal) => {
    const item = Object.assign(deferred<string>(), { signal });
    creations.push(item);
    return item.promise;
  });
  const sessionFactory = vi.fn((id: string) => {
    const selected = makeSession(id);
    sessions.push(selected);
    return selected.session;
  });
  const readTitle = vi.fn((id: string, signal: AbortSignal) => {
    const result = deferred<unknown>();
    titles.push({ id, signal, result });
    return result.promise;
  });
  const app = createThreadsApplication({
    createThread,
    sessionFactory,
    readTitle,
  });
  applications.push(app);
  async function start(text: string, id?: string) {
    const pending = app.submit(text);
    if (id) {
      expect(creations.length).toBeGreaterThan(0);
      creations[creations.length - 1].resolve(id);
      await tick();
    }
    const current = sessions[sessions.length - 1];
    expect(current).toBeDefined();
    expect(current.runs.length).toBeGreaterThan(0);
    const turn = ++serial,
      generation = 'run-' + turn;
    const message = (
      suffix: string,
      role: Message['role'],
      content: string
    ): Message => ({
      id: id + '-' + turn + suffix,
      role,
      content,
      delivery: { generation, phase: 'complete', outcome: 'success' },
    });
    const prefix = current.state().messages,
      human = message('h', 'user', text),
      answer = message('a', 'assistant', 'Answer ' + text);
    current.replace({ status: 'running', messages: [...prefix, human] });
    current.replace({ status: 'idle', messages: [...prefix, human, answer] });
    current.runs[current.runs.length - 1].result.resolve('success');
    await tick();
    expect(current.loads.length).toBeGreaterThan(0);
    return { pending, current, expected: [...prefix, human, answer] };
  }
  function confirm(
    current: ReturnType<typeof makeSession>,
    patch: Partial<ThreadsState> = {}
  ) {
    current.replace({
      status: 'idle',
      messages: current.state().messages.map((m) => ({
        ...m,
        delivery: { generation: m.id, phase: 'complete', outcome: 'success' },
      })),
      history: [
        {
          checkpoint: {
            thread_id: current.id,
            checkpoint_ns: '',
            checkpoint_id: 'saved-' + serial,
          },
          next: [],
        },
      ],
      ...patch,
    });
    savedStates.set(current.id, current.state());
    current.loads[current.loads.length - 1].result.resolve();
  }
  async function send(text: string, id?: string) {
    const turn = await start(text, id);
    confirm(turn.current);
    await turn.pending;
    return turn.current;
  }
  async function select(key: string) {
    const pending = app.select(key);
    await tick();
    const current = sessions[sessions.length - 1];
    expect(current.loads.length).toBeGreaterThan(0);
    const saved = savedStates.get(current.id);
    expect(saved).toBeDefined();
    current.replace(saved as ThreadsState);
    current.loads[current.loads.length - 1].result.resolve();
    await pending;
    return current;
  }
  return {
    app,
    creations,
    sessions,
    titles,
    createThread,
    sessionFactory,
    readTitle,
    start,
    confirm,
    send,
    select,
    savedStates,
  };
}
it('keeps mount, blank Send and New free of remote work', async () => {
  const h = setup(),
    initial = h.app.getSnapshot();
  h.app.subscribe(() => undefined);
  h.app.setDraft(initial.viewGeneration, 'draft');
  expect(h.app.getSnapshot().draft).toBe('draft');
  await h.app.submit(' ');
  await h.app.newConversation();
  expect(h.app.getSnapshot()).toMatchObject({
    threadId: null,
    draft: '',
    rows: [],
    conversations: [],
    canSubmit: true,
  });
  expect(h.app.getSnapshot().selectedKey).not.toBe(initial.selectedKey);
  expect(h.createThread).not.toHaveBeenCalled();
  expect(h.sessionFactory).not.toHaveBeenCalled();
  expect(h.readTitle).not.toHaveBeenCalled();
});
it('clears only the accepted draft synchronously and preserves text typed during creation', async () => {
  const h = setup(),
    initial = h.app.getSnapshot();
  h.app.setDraft(initial.viewGeneration, 'Question');
  const pending = h.app.submit('Question');
  expect(h.app.getSnapshot()).toMatchObject({
    draft: '',
    busy: true,
    activity: 'creating',
    selectedKey: initial.selectedKey,
  });
  h.app.setDraft(initial.viewGeneration, 'Next draft');
  await h.app.submit('Duplicate');
  expect(h.createThread).toHaveBeenCalledTimes(1);
  h.creations[0].resolve('A');
  await tick();
  const current = h.sessions[0];
  expect(h.app.getSnapshot().selectedKey).toBe(initial.selectedKey);
  current.runs[0].result.resolve('error');
  await pending;
  expect(h.app.getSnapshot().draft).toBe('Next draft');
});
it('waits for canonical history and does not clear newly typed text on completion', async () => {
  const h = setup(),
    turn = await h.start('Question', 'A');
  expect(h.app.getSnapshot()).toMatchObject({
    busy: true,
    canSubmit: false,
    activity: 'confirming',
  });
  h.app.setDraft(h.app.getSnapshot().viewGeneration, 'Follow up draft');
  h.confirm(turn.current);
  await turn.pending;
  expect(h.app.getSnapshot()).toMatchObject({
    draft: 'Follow up draft',
    canSubmit: true,
    outcome: 'success',
    busy: false,
  });
  expect(h.titles).toHaveLength(1);
});
it('restores A/B/A through fresh sessions and preserves independent drafts and prefixes', async () => {
  const h = setup();
  const a = await h.send('A question', 'A'),
    aKey = h.app.getSnapshot().selectedKey,
    oldView = h.app.getSnapshot().viewGeneration;
  h.app.setDraft(oldView, 'A draft');
  await h.app.newConversation();
  const b = await h.send('B question', 'B'),
    bKey = h.app.getSnapshot().selectedKey;
  h.app.setDraft(h.app.getSnapshot().viewGeneration, 'B draft');
  const aAgain = await h.select(aKey);
  expect(aAgain).not.toBe(a);
  expect(h.app.getSnapshot().draft).toBe('A draft');
  h.app.setDraft(oldView, 'stale callback');
  expect(h.app.getSnapshot().draft).toBe('A draft');
  const prefix = h.savedStates.get('A')?.messages;
  await h.send('A follow up');
  expect(h.savedStates.get('A')?.messages.slice(0, 2)).toEqual(prefix);
  expect(h.savedStates.get('A')?.messages).toHaveLength(4);
  const bAgain = await h.select(bKey);
  expect(bAgain).not.toBe(b);
  expect(h.app.getSnapshot().draft).toBe('B draft');
  expect(h.app.getSnapshot().rows.map((row) => row.id)).toEqual(
    h.savedStates.get('B')?.messages.map((m) => m.id)
  );
  expect(h.createThread).toHaveBeenCalledTimes(2);
  expect(h.sessions.flatMap((s) => s.runs)).toHaveLength(3);
  expect(h.sessions.flatMap((s) => s.loads)).toHaveLength(5);
  expect(a.release).toHaveBeenCalledTimes(1);
  expect(b.release).toHaveBeenCalledTimes(1);
});
it('cannot treat a fulfilled empty selection load as saved authority', async () => {
  const h = setup();
  await h.send('A question', 'A');
  const key = h.app.getSnapshot().selectedKey;
  await h.app.newConversation();
  await h.send('B question', 'B');
  const pending = h.app.select(key);
  await tick();
  const current = h.sessions[h.sessions.length - 1];
  current.loads[0].result.resolve();
  await pending;
  expect(h.app.getSnapshot().canSubmit).toBe(false);
  expect(
    h.app.getSnapshot().conversations.find((c) => c.key === key)?.availability
  ).toBe('unavailable');
  await h.app.submit('Replay');
  expect(current.runs).toHaveLength(0);
});
it('keeps title requests nonblocking and ignores a late title after New', async () => {
  const h = setup();
  await h.send('A question', 'A');
  const key = h.app.getSnapshot().selectedKey;
  expect(h.app.getSnapshot().canSubmit).toBe(true);
  expect(h.titles).toHaveLength(1);
  await h.app.newConversation();
  expect(h.titles[0].signal.aborted).toBe(true);
  h.titles[0].result.resolve({ thread_id: 'A', metadata: { title: 'Late' } });
  await tick();
  expect(
    h.app.getSnapshot().conversations.find((c) => c.key === key)?.label
  ).toBe('Conversation 1');
});
it('applies a literal current title without changing continuation authority', async () => {
  const h = setup();
  await h.send('Question', 'A');
  h.titles[0].result.resolve({
    thread_id: 'A',
    metadata: { title: ' <b>Literal</b> ' },
  });
  await tick();
  expect(h.app.getSnapshot().conversations[0].label).toBe('<b>Literal</b>');
  expect(h.app.getSnapshot().canSubmit).toBe(true);
});
it('detaches Stop during creation and never dispatches the late confirmed ID', async () => {
  const h = setup(),
    pending = h.app.submit('Question');
  expect(h.createThread).toHaveBeenCalledTimes(1);
  await h.app.stop();
  h.creations[0].resolve('late');
  await pending;
  expect(h.sessionFactory).not.toHaveBeenCalled();
  expect(h.app.getSnapshot().canSubmit).toBe(false);
  await h.app.newConversation();
  expect(h.app.getSnapshot().canSubmit).toBe(true);
});

it('rechecks state after publishing confirmation before issuing the canonical read', async () => {
  const h = setup(),
    pending = h.app.submit('Question');
  h.creations[0].resolve('A');
  await tick();
  const current = h.sessions[0];
  let changed = false;
  h.app.subscribe(() => {
    if (!changed && h.app.getSnapshot().activity === 'confirming') {
      changed = true;
      current.replace(
        { error: { message: 'PRIVATE changed before load' } as never },
        false
      );
    }
  });
  const messages: Message[] = [
    {
      id: 'human',
      role: 'user',
      content: 'Question',
      delivery: { generation: 'run', phase: 'complete', outcome: 'success' },
    },
    {
      id: 'answer',
      role: 'assistant',
      content: 'Answer',
      delivery: { generation: 'run', phase: 'complete', outcome: 'success' },
    },
  ];
  current.replace({ status: 'idle', messages });
  current.runs[0].result.resolve('success');
  await tick();
  expect(changed).toBe(true);
  expect(current.loads).toHaveLength(0);
  expect(h.app.getSnapshot().canSubmit).toBe(false);
  await pending;
});
it.each(['missing', 'extra', 'changed', 'foreign', 'pending', 'failed'])(
  'quarantines %s canonical history without retry or repair',
  async (mode) => {
    const h = setup(),
      turn = await h.start('Question', 'A'),
      key = h.app.getSnapshot().selectedKey;
    if (mode === 'failed')
      turn.current.loads[0].result.reject(new Error('PRIVATE history failure'));
    else {
      const patch: Partial<ThreadsState> =
        mode === 'missing'
          ? { messages: [] }
          : mode === 'extra'
          ? { messages: [...turn.expected, turn.expected[0]] }
          : mode === 'changed'
          ? {
              messages: turn.expected.map((m) => ({
                ...m,
                content: 'Changed',
              })),
            }
          : mode === 'foreign'
          ? {
              history: [
                {
                  checkpoint: {
                    thread_id: 'other',
                    checkpoint_ns: '',
                    checkpoint_id: 'saved',
                  },
                  next: [],
                },
              ],
            }
          : {
              history: [
                {
                  checkpoint: {
                    thread_id: 'A',
                    checkpoint_ns: '',
                    checkpoint_id: 'saved',
                  },
                  next: ['generate'],
                },
              ],
            };
      h.confirm(turn.current, patch);
    }
    await turn.pending;
    expect(h.app.getSnapshot().canSubmit).toBe(false);
    expect(
      h.app.getSnapshot().conversations.find((c) => c.key === key)?.availability
    ).toBe('unavailable');
    await h.app.submit('Retry');
    expect(turn.current.runs).toHaveLength(1);
    expect(JSON.stringify(h.app.getSnapshot())).not.toContain('PRIVATE');
  }
);
it.each(['stop', 'dispose'] as const)(
  'ignores a fulfilled canonical read after %s',
  async (action) => {
    const h = setup(),
      turn = await h.start('Question', 'A');
    await h.app[action]();
    const before = h.app.getSnapshot();
    h.confirm(turn.current);
    await turn.pending;
    expect(h.app.getSnapshot()).toBe(before);
    expect(turn.current.release).toHaveBeenCalledTimes(1);
    expect(turn.current.session.dispose).toHaveBeenCalledTimes(1);
  }
);
it('keeps another saved record usable after aborting a selection load', async () => {
  const h = setup();
  await h.send('A question', 'A');
  const aKey = h.app.getSnapshot().selectedKey;
  await h.app.newConversation();
  await h.send('B question', 'B');
  const bKey = h.app.getSnapshot().selectedKey;
  const pending = h.app.select(aKey);
  await tick();
  const loading = h.sessions[h.sessions.length - 1];
  await h.app.stop();
  expect(loading.loads[0].signal?.aborted).toBe(true);
  const before = h.app.getSnapshot();
  loading.replace(h.savedStates.get('A') as ThreadsState);
  loading.loads[0].result.resolve();
  await pending;
  expect(h.app.getSnapshot()).toBe(before);
  expect(before.conversations.find((c) => c.key === aKey)?.availability).toBe(
    'unavailable'
  );
  await h.select(bKey);
  expect(h.app.getSnapshot().canSubmit).toBe(true);
});
it('bounds a never-settling Stop and disposal, releasing observation immediately', async () => {
  vi.useFakeTimers();
  const h = setup(),
    turn = await h.start('Question', 'A');
  vi.mocked(turn.current.session.dispose).mockImplementation(
    () => new Promise(() => undefined)
  );
  vi.mocked(turn.current.session.stop).mockImplementation(
    () => new Promise(() => undefined)
  );
  const stopped = h.app.stop();
  expect(turn.current.release).toHaveBeenCalledTimes(1);
  expect(h.app.getSnapshot().canSubmit).toBe(false);
  await vi.advanceTimersByTimeAsync(2000);
  await stopped;
  await h.app.newConversation();
  expect(h.app.getSnapshot().canSubmit).toBe(true);
  h.confirm(turn.current);
  await turn.pending;
});
it('cancels optional title reads after five seconds without blocking the saved conversation', async () => {
  vi.useFakeTimers();
  const h = setup();
  await h.send('Question', 'A');
  expect(h.app.getSnapshot().canSubmit).toBe(true);
  await vi.advanceTimersByTimeAsync(5000);
  expect(h.titles[0].signal.aborted).toBe(true);
  h.titles[0].result.resolve({
    thread_id: 'A',
    metadata: { title: 'Too late' },
  });
  await tick();
  expect(h.app.getSnapshot().conversations[0].label).toBe('Conversation 1');
  expect(h.app.getSnapshot().canSubmit).toBe(true);
});
it.each([
  undefined,
  { thread_id: 'B', metadata: { title: 'Foreign' } },
  { thread_id: 'A', metadata: { title: 42 } },
  { thread_id: 'A', metadata: { title: '' } },
])('ignores optional malformed metadata %#', async (raw) => {
  const h = setup();
  await h.send('Question', 'A');
  h.titles[0].result.resolve(raw);
  await tick();
  expect(h.app.getSnapshot().canSubmit).toBe(true);
  expect(h.app.getSnapshot().conversations[0].label).toBe('Conversation 1');
});
it('fences cancellation triggered during metadata capture', async () => {
  const h = setup();
  await h.send('Question', 'A');
  const raw = new Proxy(
    { thread_id: 'A', metadata: { title: 'Cancelled' } },
    {
      ownKeys(target) {
        void h.app.stop();
        return Reflect.ownKeys(target);
      },
    }
  );
  h.titles[0].result.resolve(raw);
  await tick();
  expect(h.app.getSnapshot().conversations[0].label).toBe('Conversation 1');
  expect(h.app.getSnapshot().canSubmit).toBe(true);
});
it('fences Stop triggered during canonical data capture', async () => {
  const h = setup(),
    turn = await h.start('Question', 'A');
  let stopped: Promise<void> | undefined;
  const raw = new Proxy(turn.current.state(), {
    ownKeys(target) {
      stopped = h.app.stop();
      return Reflect.ownKeys(target);
    },
  });
  vi.mocked(turn.current.session.getSnapshot).mockReturnValueOnce(raw);
  h.confirm(turn.current);
  await stopped;
  await turn.pending;
  expect(h.app.getSnapshot().canSubmit).toBe(false);
  expect(h.app.getSnapshot().confirmation).toBeNull();
});
it('keeps failed optional metadata separate from saved authority', async () => {
  const h = setup();
  await h.send('Question', 'A');
  h.titles[0].result.reject(new Error('PRIVATE metadata failure'));
  await tick();
  expect(h.app.getSnapshot().canSubmit).toBe(true);
  expect(h.app.getSnapshot().error).toBeNull();
});

it.each([
  'tools',
  'children',
  'interrupt',
  'duplicate',
  'changed-input',
  'foreign-generation',
  'failed-delivery',
  'changed-complete',
  'vanished-message',
  'accessor',
])('retains unsafe live evidence: %s', async (mode) => {
  const h = setup(),
    pending = h.app.submit('Question');
  h.creations[0].resolve('A');
  await tick();
  const current = h.sessions[0];
  const human: Message = {
      id: 'human',
      role: 'user',
      content: 'Question',
      delivery: { generation: 'run', phase: 'complete', outcome: 'success' },
    },
    answer: Message = {
      id: 'answer',
      role: 'assistant',
      content: 'Answer',
      delivery: { generation: 'run', phase: 'complete', outcome: 'success' },
    };
  const pair = [human, answer];
  let patch: Partial<ThreadsState> = { status: 'running', messages: pair };
  const getter = vi.fn(() => 'Hidden');
  if (mode === 'tools')
    patch = { ...patch, toolCalls: [{ id: 'unsupported' }] as never };
  if (mode === 'children') patch = { ...patch, subgraphs: [{}] };
  if (mode === 'interrupt') patch = { ...patch, interrupts: [{}] };
  if (mode === 'duplicate')
    patch = { ...patch, messages: [human, { ...answer, id: 'human' }] };
  if (mode === 'changed-input')
    patch = { ...patch, messages: [{ ...human, content: 'Other' }, answer] };
  if (mode === 'foreign-generation')
    patch = {
      ...patch,
      messages: [
        human,
        {
          ...answer,
          delivery: {
            generation: 'foreign',
            phase: 'complete',
            outcome: 'success',
          },
        },
      ],
    };
  if (mode === 'failed-delivery')
    patch = {
      ...patch,
      messages: [
        human,
        {
          ...answer,
          delivery: { generation: 'run', phase: 'complete', outcome: 'error' },
        },
      ],
    };
  if (mode === 'changed-complete') {
    current.replace({ status: 'running', messages: pair });
    patch = { ...patch, messages: [human, { ...answer, content: 'Changed' }] };
  }
  if (mode === 'vanished-message') {
    current.replace({ status: 'running', messages: pair });
    patch = { ...patch, messages: [human] };
  }
  if (mode === 'accessor')
    patch = {
      ...patch,
      messages: [
        human,
        Object.defineProperty({ ...answer }, 'content', { get: getter }),
      ],
    };
  current.replace(patch);
  current.replace({
    status: 'idle',
    messages: pair,
    toolCalls: [],
    subgraphs: [],
    interrupts: [],
    error: undefined,
  });
  current.runs[0].result.resolve('success');
  await pending;
  expect(h.app.getSnapshot().canSubmit).toBe(false);
  expect(h.app.getSnapshot().conversations[0].availability).toBe('unavailable');
  expect(current.loads).toHaveLength(0);
  expect(getter).not.toHaveBeenCalled();
});
it('does not retry creation failures or expose private diagnostics', async () => {
  const h = setup(),
    pending = h.app.submit('Question');
  h.creations[0].reject(new Error('PRIVATE create failure'));
  await pending;
  await h.app.submit('Retry');
  expect(h.createThread).toHaveBeenCalledTimes(1);
  expect(h.sessionFactory).not.toHaveBeenCalled();
  expect(JSON.stringify(h.app.getSnapshot())).not.toContain('PRIVATE');
  await h.app.newConversation();
  expect(h.app.getSnapshot().canSubmit).toBe(true);
});
it('releases a session exactly once when Stop reenters subscription installation', async () => {
  const h = setup(),
    factory = h.sessionFactory.getMockImplementation();
  if (!factory) throw new Error('Missing fixture factory');
  let stopped: Promise<void> | undefined;
  h.sessionFactory.mockImplementationOnce((id) => {
    const session = factory(id),
      subscribe = vi.mocked(session.subscribe).getMockImplementation();
    if (!subscribe) throw new Error('Missing fixture subscription');
    vi.mocked(session.subscribe).mockImplementationOnce((notify) => {
      const release = subscribe(notify);
      stopped = h.app.stop();
      return release;
    });
    return session;
  });
  const pending = h.app.submit('Question');
  h.creations[0].resolve('A');
  await tick();
  await stopped;
  await pending;
  expect(h.sessions[0].session.submit).not.toHaveBeenCalled();
  expect(h.sessions[0].release).toHaveBeenCalledTimes(1);
  expect(h.sessions[0].session.dispose).toHaveBeenCalledTimes(1);
  expect(h.app.getSnapshot().canSubmit).toBe(false);
});
it('ignores unknown and already selected keys without additional history reads', async () => {
  const h = setup();
  await h.send('Question', 'A');
  const key = h.app.getSnapshot().selectedKey;
  await h.app.select('foreign');
  await h.app.select(key);
  expect(h.sessionFactory).toHaveBeenCalledTimes(1);
  expect(h.sessions[0].loads).toHaveLength(1);
});
it('preserves the last valid title when a later optional read fails', async () => {
  const h = setup();
  await h.send('Question', 'A');
  h.titles[0].result.resolve({
    thread_id: 'A',
    metadata: { title: 'First title' },
  });
  await tick();
  await h.send('Follow up');
  h.titles[1].result.reject(new Error('PRIVATE metadata'));
  await tick();
  expect(h.app.getSnapshot().conversations[0].label).toBe('First title');
  expect(h.app.getSnapshot().canSubmit).toBe(true);
});
it('cancels a prior title read on a new explicit turn', async () => {
  const h = setup();
  await h.send('Question', 'A');
  await h.send('Follow up');
  expect(h.titles[0].signal.aborted).toBe(true);
  h.titles[0].result.resolve({ thread_id: 'A', metadata: { title: 'Stale' } });
  h.titles[1].result.resolve({
    thread_id: 'A',
    metadata: { title: 'Current' },
  });
  await tick();
  expect(h.app.getSnapshot().conversations[0].label).toBe('Current');
});

it.each(['pending', 'foreign', 'changed-checkpoint', 'generation'])(
  'quarantines conflicting idle %s evidence before another submit',
  async (mode) => {
    const h = setup(),
      current = await h.send('Question', 'A'),
      saved = current.state();
    if (mode === 'generation')
      current.replace({
        messages: saved.messages.map((m, i) =>
          i
            ? {
                ...m,
                delivery: {
                  generation: 'foreign',
                  phase: 'complete',
                  outcome: 'success',
                },
              }
            : m
        ),
      });
    else
      current.replace({
        history: [
          {
            checkpoint: {
              thread_id: mode === 'foreign' ? 'foreign' : 'A',
              checkpoint_ns: '',
              checkpoint_id:
                mode === 'changed-checkpoint' ? 'different' : 'saved-1',
            },
            next: mode === 'pending' ? ['generate'] : [],
          },
        ],
      });
    expect(h.app.getSnapshot().canSubmit).toBe(false);
    expect(h.app.getSnapshot().conversations[0].availability).toBe(
      'unavailable'
    );
    current.replace(saved);
    await h.app.submit('Must not dispatch');
    expect(current.runs).toHaveLength(1);
    expect(h.app.getSnapshot().canSubmit).toBe(false);
  }
);
it('allows optional idle display metadata without changing execution authority', async () => {
  const h = setup(),
    current = await h.send('Question', 'A');
  current.replace({
    messages: current
      .state()
      .messages.map((m) => ({ ...m, reasoning: 'Optional display metadata' })),
  });
  expect(h.app.getSnapshot().canSubmit).toBe(true);
  expect(h.app.getSnapshot().conversations[0].availability).toBe('available');
});
