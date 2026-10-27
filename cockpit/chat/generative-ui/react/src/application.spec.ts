import { expect, it, vi } from 'vitest';
import { createGenerativeUiApplication } from './application';
import { evidence } from './evidence.testing';
import type { GenerativeUiState } from './observation';
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};
function setup() {
  const e = evidence();
  let state: GenerativeUiState = {
    status: 'idle',
    messages: [],
    toolCalls: [],
    interrupts: [],
    subgraphs: [],
  };
  const listeners = new Set<() => void>();
  const emit = (next: GenerativeUiState) => {
    state = next;
    for (const l of listeners) l();
  };
  const session = {
    getSnapshot: () => state,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    submit: vi.fn(async () => {
      emit(e.before);
      emit(e.after);
      return 'success' as const;
    }),
    load: vi.fn(async () => {
      emit(e.saved);
    }),
    stop: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  };
  const options = {
    createThread: vi.fn(async () => 'thread'),
    sessionFactory: vi.fn(() => session),
    readCheckpoint: vi.fn(async () => e.raw),
  };
  return {
    e,
    session,
    options,
    emit,
    app: createGenerativeUiApplication(options),
  };
}
it('is inert until submission and publishes surfaces/data only after exact checkpoint confirmation', async () => {
  const f = setup(),
    hold = deferred();
  f.options.readCheckpoint.mockImplementation(async () => {
    await hold.promise;
    return f.e.raw;
  });
  expect(f.app.getSnapshot()).toMatchObject({
    threadId: null,
    canSubmit: true,
    dashboard: {},
    surfaces: [],
  });
  expect(f.options.createThread).not.toHaveBeenCalled();
  const pending = f.app.submit('Show dashboard');
  await vi.waitFor(() =>
    expect(f.options.readCheckpoint).toHaveBeenCalledOnce()
  );
  expect(f.app.getSnapshot()).toMatchObject({
    busy: true,
    surfaces: [],
    dashboard: {},
  });
  hold.resolve();
  await pending;
  expect(f.app.getSnapshot()).toMatchObject({
    busy: false,
    canSubmit: true,
    surfaces: [{ messageId: 'parent' }],
  });
  await f.app.dispose();
});
it('blocks double clicks and unsupported completion until New', async () => {
  const f = setup(),
    hold = deferred();
  f.session.submit.mockImplementation(async () => {
    await hold.promise;
    return 'success';
  });
  const pending = f.app.submit('Show dashboard');
  await vi.waitFor(() => expect(f.session.submit).toHaveBeenCalledOnce());
  await f.app.submit('duplicate');
  expect(f.session.submit).toHaveBeenCalledOnce();
  hold.resolve();
  await pending;
  expect(f.app.getSnapshot().canSubmit).toBe(false);
  await f.app.newConversation();
  expect(f.app.getSnapshot()).toMatchObject({
    canSubmit: true,
    threadId: null,
    surfaces: [],
  });
  await f.app.dispose();
});
it('New aborts in-flight confirmation and stale completion cannot repopulate the board', async () => {
  const f = setup(),
    hold = deferred();
  f.options.readCheckpoint.mockImplementation(async () => {
    await hold.promise;
    return f.e.raw;
  });
  const pending = f.app.submit('Show dashboard');
  await vi.waitFor(() =>
    expect(f.options.readCheckpoint).toHaveBeenCalledOnce()
  );
  await f.app.newConversation();
  hold.resolve();
  await pending;
  expect(f.app.getSnapshot()).toMatchObject({
    threadId: null,
    surfaces: [],
    canSubmit: true,
  });
  await f.app.dispose();
});
it('Stop preserves the last board and refuses continuation', async () => {
  const f = setup();
  await f.app.submit('Show dashboard');
  const previous = f.app.getSnapshot().surfaces;
  const hold = deferred();
  f.session.submit.mockImplementation(async () => {
    await hold.promise;
    return 'success';
  });
  const pending = f.app.submit('Next');
  await vi.waitFor(() => expect(f.session.submit).toHaveBeenCalledTimes(2));
  await f.app.stop();
  hold.resolve();
  await pending;
  expect(f.app.getSnapshot().surfaces).toBe(previous);
  expect(f.app.getSnapshot().canSubmit).toBe(false);
  await f.app.dispose();
});
it('handles reentrant New and late create/dispose without starting a session', async () => {
  const f = setup();
  f.app.subscribe(() => {
    if (f.app.getSnapshot().activity === 'creating')
      void f.app.newConversation();
  });
  await f.app.submit('Show dashboard');
  expect(f.options.sessionFactory).not.toHaveBeenCalled();
  await f.app.dispose();
  const g = setup(),
    hold = deferred();
  g.options.createThread.mockImplementation(async () => {
    await hold.promise;
    return 'thread';
  });
  const pending = g.app.submit('Show dashboard');
  await g.app.dispose();
  hold.resolve();
  await pending;
  expect(g.options.sessionFactory).not.toHaveBeenCalled();
});
it('quarantines failed create, missing saved state and an old prefix mutation', async () => {
  const f = setup();
  f.options.createThread.mockRejectedValue(new Error('create'));
  await f.app.submit('Show dashboard');
  expect(f.app.getSnapshot().canSubmit).toBe(false);
  await f.app.dispose();
  const g = setup();
  g.options.readCheckpoint.mockResolvedValue(undefined as never);
  await g.app.submit('Show dashboard');
  expect(g.app.getSnapshot()).toMatchObject({ canSubmit: false, surfaces: [] });
  await g.app.dispose();
  const h = setup();
  await h.app.submit('Show dashboard');
  h.emit({
    ...h.e.saved,
    messages: h.e.saved.messages.map((m) =>
      m.id === 'human' ? { ...m, content: 'changed' } : m
    ),
  });
  await h.app.submit('Next');
  expect(h.session.submit).toHaveBeenCalledOnce();
  expect(h.app.getSnapshot().canSubmit).toBe(false);
  await h.app.dispose();
});
it('a reentrant New from unsubscribe owns the reset even while Stop cleans up', async () => {
  const f = setup(),
    subscribe = f.session.subscribe;
  f.session.subscribe = (listener) => {
    const release = subscribe(listener);
    return () => {
      release();
      void f.app.newConversation();
    };
  };
  await f.app.submit('Show dashboard');
  const hold = deferred();
  f.session.submit.mockImplementation(async () => {
    await hold.promise;
    return 'success';
  });
  const pending = f.app.submit('Next');
  await vi.waitFor(() => expect(f.session.submit).toHaveBeenCalledTimes(2));
  await f.app.stop();
  hold.resolve();
  await pending;
  expect(f.app.getSnapshot()).toMatchObject({
    threadId: null,
    surfaces: [],
    dashboard: {},
    canSubmit: true,
    outcome: null,
  });
  await f.app.dispose();
});
