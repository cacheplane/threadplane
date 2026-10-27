import { expect, it, vi } from 'vitest';
import type { Message } from '@threadplane/core';
import { createTimelineApplication } from './application';
import type { TimelineSession, TimelineState } from './connection';
const source = {
  thread_id: 'thread',
  checkpoint_ns: '',
  checkpoint_id: 'cp',
} as const;
const message = (
  id: string,
  role: 'user' | 'assistant',
  content: string,
  generation = id
): Message => ({
  id,
  role,
  content,
  delivery: { generation, phase: 'complete', outcome: 'success' },
});
const prefix = [
  message('old-u', 'user', 'Old'),
  message('old-a', 'assistant', 'Old answer'),
];
const raw = () => ({
  checkpoint: source,
  next: [],
  tasks: [],
  values: {
    messages: prefix.map((m) => ({
      id: m.id,
      type: m.role === 'user' ? 'human' : 'ai',
      content: m.content,
    })),
  },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
function fixture() {
  const sessions: ReturnType<typeof session>[] = [];
  function session() {
    let state = {
      status: 'idle',
      messages: [],
      toolCalls: [],
      interrupts: [],
      subgraphs: [],
      values: {},
      history: undefined,
    } as TimelineState;
    const listeners = new Set<() => void>();
    let sequence = 0;
    const emit = (update: Partial<TimelineState>) => {
      state = { ...state, ...update };
      for (const listener of listeners) listener();
    };
    const execute = async (text: string, base: readonly Message[]) => {
      const id = `u${++sequence}`,
        generation = `g${sequence}`;
      const human = message(id, 'user', text, generation);
      emit({ status: 'running', messages: [...base, human] });
      const answer = message(
        `a${sequence}`,
        'assistant',
        `Answer ${text}`,
        generation
      );
      emit({
        status: 'idle',
        messages: [...base, human, answer],
        values: {
          completed_turn_id: id,
          completed_answer_id: answer.id,
          completed_message_ids: [...base, human, answer].map((m) => m.id),
        },
      });
      return 'success' as const;
    };
    return {
      getSnapshot: () => state,
      emit,
      listeners,
      subscribe: vi.fn((fn: () => void) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      }),
      submit: vi.fn((text: string) => execute(text, state.messages)),
      fork: vi.fn((_source: unknown, text: string) => execute(text, prefix)),
      load: vi.fn(async () => {
        emit({ history: [raw()] });
      }),
      stop: vi.fn(async (): Promise<void> => undefined),
      dispose: vi.fn(async (): Promise<void> => undefined),
    };
  }
  const createThread = vi.fn(async () => 'thread'),
    readCheckpoint = vi.fn(async () => raw());
  const sessionFactory = vi.fn(() => {
    const s = session();
    sessions.push(s);
    return s as unknown as TimelineSession;
  });
  const app = createTimelineApplication({
    createThread,
    sessionFactory,
    readCheckpoint,
  });
  return { app, sessions, createThread, sessionFactory, readCheckpoint };
}
it('mount and New stay lazy; a successful send owns confirmed current content', async () => {
  const f = fixture();
  await f.app.newConversation();
  expect(f.createThread).not.toHaveBeenCalled();
  await f.app.submit('First');
  expect(f.createThread).toHaveBeenCalledTimes(1);
  expect(f.app.getSnapshot()).toMatchObject({
    threadId: 'thread',
    canSubmit: true,
    outcome: 'success',
  });
  expect(f.app.getSnapshot().rows).toHaveLength(2);
  await f.app.submit('Second');
  expect(f.createThread).toHaveBeenCalledTimes(1);
  expect(f.app.getSnapshot().rows).toHaveLength(4);
});
it('history has a disposable owner and selection is read-only; ordinary Send retains preview', async () => {
  const f = fixture();
  await f.app.submit('Current');
  await f.app.refreshHistory();
  expect(f.sessions).toHaveLength(2);
  expect(f.sessions[1].dispose).toHaveBeenCalledTimes(1);
  expect(f.sessions[0].load).not.toHaveBeenCalled();
  await f.app.selectCheckpoint(0);
  const preview = f.app.getSnapshot().previewRows;
  expect(preview).toHaveLength(2);
  expect(f.sessions[0].fork).not.toHaveBeenCalled();
  await f.app.submit('Continue');
  expect(f.sessions[0].submit).toHaveBeenCalledTimes(2);
  expect(f.app.getSnapshot().previewRows).toBe(preview);
  expect(f.app.getSnapshot().selectedSource).toEqual(source);
});
it('explicit Fork captures source prefix and draft once and becomes ordinary continuation', async () => {
  const f = fixture();
  await f.app.submit('Current');
  await f.app.refreshHistory();
  await f.app.selectCheckpoint(0);
  f.app.setDraft('Branch');
  await Promise.all([f.app.forkSelected(), f.app.forkSelected()]);
  expect(f.sessions[0].fork).toHaveBeenCalledTimes(1);
  expect(f.sessions[0].fork.mock.calls[0].slice(0, 2)).toEqual([
    source,
    'Branch',
  ]);
  expect(f.app.getSnapshot()).toMatchObject({
    canSubmit: true,
    selectedSource: null,
    previewRows: [],
    draft: '',
  });
  expect(f.sessions).toHaveLength(2);
  await f.app.submit('Next');
  expect(f.app.getSnapshot().rows).toHaveLength(6);
});
it('cancelPreview aborts only the preview read, never primary execution', async () => {
  const f = fixture();
  await f.app.submit('Current');
  await f.app.refreshHistory();
  const d = deferred<ReturnType<typeof raw>>();
  f.readCheckpoint.mockReturnValue(d.promise);
  const pending = f.app.selectCheckpoint(0);
  f.app.cancelPreview();
  d.resolve(raw());
  await pending;
  expect(f.app.getSnapshot().previewRows).toEqual([]);
  expect(f.app.getSnapshot().canSubmit).toBe(true);
  expect(f.sessions[0].stop).not.toHaveBeenCalled();
});
it('New fences late preview and resets local authority without creating a thread', async () => {
  const f = fixture();
  await f.app.submit('Current');
  await f.app.refreshHistory();
  const d = deferred<ReturnType<typeof raw>>();
  f.readCheckpoint.mockReturnValue(d.promise);
  const pending = f.app.selectCheckpoint(0);
  await f.app.newConversation();
  d.resolve(raw());
  await pending;
  expect(f.app.getSnapshot()).toMatchObject({
    threadId: null,
    rows: [],
    previewRows: [],
    historyPage: undefined,
    canSubmit: true,
  });
  expect(f.createThread).toHaveBeenCalledTimes(1);
  expect(f.sessions[0].dispose).toHaveBeenCalledTimes(1);
  expect(f.sessions[0].listeners.size).toBe(0);
});
it('failed reads leave primary usable', async () => {
  const f = fixture();
  await f.app.submit('Current');
  await f.app.refreshHistory();
  f.readCheckpoint.mockRejectedValue(new Error('secret'));
  await f.app.selectCheckpoint(0);
  expect(f.app.getSnapshot()).toMatchObject({
    canSubmit: true,
    canFork: false,
  });
  expect(f.app.getSnapshot().previewError).not.toContain('secret');
  await f.app.submit('Continue');
  expect(f.app.getSnapshot().canSubmit).toBe(true);
});
it.each(['error', 'paused', 'aborted'] as const)(
  'uncertain %s execution blocks replay until New',
  async (outcome) => {
    const f = fixture();
    await f.app.submit('Current');
    f.sessions[0].submit.mockResolvedValue(outcome as 'success');
    await f.app.submit('Uncertain');
    await f.app.submit('Replay');
    expect(f.sessions[0].submit).toHaveBeenCalledTimes(2);
    expect(f.app.getSnapshot().canSubmit).toBe(false);
    await f.app.newConversation();
    expect(f.app.getSnapshot().canSubmit).toBe(true);
  }
);
it('Stop aborts execution and requires New even if the late result says success', async () => {
  const f = fixture();
  await f.app.submit('Current');
  const d = deferred<'success'>();
  f.sessions[0].submit.mockReturnValue(d.promise);
  const pending = f.app.submit('Slow');
  await f.app.stop();
  d.resolve('success');
  await pending;
  expect(f.sessions[0].stop).toHaveBeenCalledTimes(1);
  expect(f.app.getSnapshot()).toMatchObject({
    canSubmit: false,
    outcome: 'aborted',
    busy: false,
  });
});
it.each([
  { toolCalls: [{}] },
  { interrupts: [{}] },
  { subgraphs: [{}] },
  { error: { message: 'secret' } },
  { status: 'running' },
])('rejects unsafe terminal state %j', async (update) => {
  const f = fixture();
  await f.app.submit('Current');
  const original = f.sessions[0].submit.getMockImplementation()!;
  f.sessions[0].submit.mockImplementation(async (text) => {
    await original(text);
    f.sessions[0].emit(update as Partial<TimelineState>);
    return 'success';
  });
  await f.app.submit('Next');
  expect(f.app.getSnapshot().canSubmit).toBe(false);
});
it('disposal fences late creation and later commands', async () => {
  const f = fixture(),
    d = deferred<string>();
  f.createThread.mockReturnValue(d.promise);
  const pending = f.app.submit('First');
  await f.app.dispose();
  d.resolve('thread');
  await pending;
  await f.app.submit('Again');
  expect(f.sessionFactory).not.toHaveBeenCalled();
  expect(f.createThread).toHaveBeenCalledTimes(1);
});
it('refresh revokes old selection immediately and denies stale row selection until replacement settles', async () => {
  const f = fixture();
  await f.app.submit('Current');
  await f.app.refreshHistory();
  await f.app.selectCheckpoint(0);
  const d = deferred<void>();
  const factory = f.sessionFactory.getMockImplementation()!;
  f.sessionFactory.mockImplementation(() => {
    const s = factory();
    s.load = () => d.promise;
    return s;
  });
  const pending = f.app.refreshHistory();
  await f.app.selectCheckpoint(0);
  expect(f.app.getSnapshot()).toMatchObject({
    selectedSource: null,
    previewRows: [],
    canFork: false,
  });
  expect(f.readCheckpoint).toHaveBeenCalledTimes(1);
  d.resolve();
  await pending;
});
it('shows canonical branch rows when runtime retains later-tip transient messages', async () => {
  const f = fixture();
  await f.app.submit('Current');
  await f.app.refreshHistory();
  await f.app.selectCheckpoint(0);
  const s = f.sessions[0],
    original = s.fork.getMockImplementation()!;
  s.fork.mockImplementation(async (source, text) => {
    await original(source, text);
    s.emit({
      messages: [
        ...s.getSnapshot().messages,
        message('stale-u', 'user', 'Discarded', 'stale'),
        message('stale-a', 'assistant', 'Discarded answer', 'stale'),
      ],
    });
    return 'success';
  });
  await f.app.forkSelected('Branch');
  expect(f.app.getSnapshot().canSubmit).toBe(true);
  expect(f.app.getSnapshot().rows).toHaveLength(4);
  // The real runtime may retain display messages, but graph completion projects only owned IDs.
  const originalSubmit = s.submit.getMockImplementation()!;
  s.submit.mockImplementation(async (text) => {
    s.emit({
      messages: s
        .getSnapshot()
        .messages.filter((m) => !m.id.startsWith('stale')),
    });
    return originalSubmit(text);
  });
  await f.app.submit('Next');
  expect(f.app.getSnapshot().canSubmit).toBe(true);
  expect(f.app.getSnapshot().rows).toHaveLength(6);
});
it('superseded previews cannot publish, even when transport ignores abort', async () => {
  const f = fixture();
  await f.app.submit('Current');
  await f.app.refreshHistory();
  const first = deferred<ReturnType<typeof raw>>();
  f.readCheckpoint.mockReturnValueOnce(first.promise);
  const a = f.app.selectCheckpoint(0);
  await f.app.selectCheckpoint(0);
  const current = f.app.getSnapshot().previewRows;
  first.resolve({ ...raw(), values: { messages: [] } });
  await a;
  expect(f.app.getSnapshot().previewRows).toBe(current);
  expect(f.app.getSnapshot().canFork).toBe(true);
});
it('New fences late history and serialization rejects overlapping sends', async () => {
  const f = fixture(),
    create = deferred<string>();
  f.createThread.mockReturnValueOnce(create.promise);
  const first = f.app.submit('First');
  await f.app.submit('Overlap');
  expect(f.createThread).toHaveBeenCalledTimes(1);
  await f.app.newConversation();
  create.resolve('thread');
  await first;
  expect(f.sessionFactory).not.toHaveBeenCalled();
  await f.app.submit('Current');
  const d = deferred<void>();
  const factory = f.sessionFactory.getMockImplementation()!;
  f.sessionFactory.mockImplementation(() => {
    const s = factory();
    s.load = () => d.promise;
    return s;
  });
  const read = f.app.refreshHistory();
  await f.app.newConversation();
  d.resolve();
  await read;
  expect(f.app.getSnapshot().historyPage).toBeUndefined();
  expect(f.sessions.at(-1)!.dispose).toHaveBeenCalledTimes(1);
});
it('rejects stale graph completion evidence even when submit reports success', async () => {
  const f = fixture();
  await f.app.submit('Current');
  f.sessions[0].submit.mockResolvedValue('success');
  await f.app.submit('Next');
  expect(f.app.getSnapshot().canSubmit).toBe(false);
});
it('disposes a primary subscription and prevents late callbacks from publishing', async () => {
  const f = fixture();
  await f.app.submit('Current');
  const notify = vi.fn();
  f.app.subscribe(notify);
  const snapshot = f.app.getSnapshot();
  await f.app.dispose();
  f.sessions[0].emit({ status: 'error' });
  expect(f.app.getSnapshot()).toBe(snapshot);
  expect(notify).not.toHaveBeenCalled();
  expect(f.sessions[0].dispose).toHaveBeenCalledTimes(1);
  expect(f.sessions[0].listeners.size).toBe(0);
});
it('overlapping New commands wait for the retired primary before admitting another run', async () => {
  const f = fixture();
  await f.app.submit('Current');
  const cleanup = deferred<void>();
  f.sessions[0].dispose.mockReturnValue(cleanup.promise);
  const first = f.app.newConversation(),
    second = f.app.newConversation();
  await f.app.submit('Too early');
  expect(f.createThread).toHaveBeenCalledTimes(1);
  cleanup.resolve();
  await Promise.all([first, second]);
  await f.app.submit('New');
  expect(f.createThread).toHaveBeenCalledTimes(2);
});
it('strict history capture does not invoke snapshot data accessors', async () => {
  const f = fixture();
  await f.app.submit('Current');
  const getter = vi.fn(() => []);
  const factory = f.sessionFactory.getMockImplementation()!;
  f.sessionFactory.mockImplementation(() => {
    const s = factory();
    s.getSnapshot = () =>
      Object.defineProperty({}, 'history', {
        enumerable: true,
        get: getter,
      }) as TimelineState;
    return s;
  });
  await f.app.refreshHistory();
  expect(getter).not.toHaveBeenCalled();
  expect(f.app.getSnapshot()).toMatchObject({
    canSubmit: true,
    historyError: 'Checkpoint history is unavailable.',
  });
});
it('publishes only graph-confirmed canonical rows after same-generation transient output', async () => {
  const f = fixture();
  await f.app.submit('Current');
  const s = f.sessions[0],
    original = s.submit.getMockImplementation()!;
  s.submit.mockImplementation(async (text) => {
    await original(text);
    const state = s.getSnapshot();
    s.emit({
      messages: [
        ...state.messages,
        message(
          'transient',
          'assistant',
          'Unconfirmed output',
          state.messages.at(-1)!.delivery.generation
        ),
      ],
    });
    return 'success';
  });
  await f.app.submit('Next');
  expect(f.app.getSnapshot().canSubmit).toBe(true);
  expect(f.app.getSnapshot().rows.map((row) => row.id)).toEqual([
    'u1',
    'a1',
    'u2',
    'a2',
  ]);
});
it('New blocks a reentrant submit before its first notification', async () => {
  const f = fixture();
  await f.app.submit('Current');
  const release = f.app.subscribe(() => {
    release();
    void f.app.submit('Reentrant');
  });
  await f.app.newConversation();
  expect(f.createThread).toHaveBeenCalledTimes(1);
  expect(f.app.getSnapshot()).toMatchObject({
    threadId: null,
    canSubmit: true,
  });
});
it.each(['select', 'refresh'] as const)(
  'execution admitted during %s notification supersedes the read',
  async (command) => {
    const f = fixture();
    await f.app.submit('Current');
    await f.app.refreshHistory();
    const release = f.app.subscribe(() => {
      release();
      void f.app.submit('Reentrant');
    });
    if (command === 'select') await f.app.selectCheckpoint(0);
    else await f.app.refreshHistory();
    expect(f.readCheckpoint).not.toHaveBeenCalled();
    expect(f.sessions).toHaveLength(2);
  }
);
it('Stop registers disposal and stop cleanup before a reentrant New can admit a run', async () => {
  const f = fixture();
  await f.app.submit('Current');
  const execution = deferred<'success'>(),
    disposal = deferred<void>(),
    stopping = deferred<void>();
  f.sessions[0].submit.mockReturnValue(execution.promise);
  f.sessions[0].dispose.mockReturnValue(disposal.promise);
  f.sessions[0].stop.mockImplementation(async () => {
    await stopping.promise;
  });
  const run = f.app.submit('Slow');
  let replacement: Promise<void> | undefined;
  const release = f.app.subscribe(() => {
    release();
    replacement = f.app.newConversation();
  });
  const stop = f.app.stop();
  await Promise.resolve();
  await f.app.submit('Too early');
  expect(f.createThread).toHaveBeenCalledTimes(1);
  disposal.resolve();
  await Promise.resolve();
  await f.app.submit('Still too early');
  expect(f.createThread).toHaveBeenCalledTimes(1);
  stopping.resolve();
  execution.resolve('success');
  await Promise.all([run, stop, replacement]);
  await f.app.submit('New');
  expect(f.createThread).toHaveBeenCalledTimes(2);
});
