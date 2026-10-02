import { expect, it, vi } from 'vitest';
import type { CompleteOutcome } from '@threadplane/core';
import {
  createPersistenceApplication,
  type PersistenceSession,
} from './application';

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
  for (let n = 0; n < 8; n++) await Promise.resolve();
}
function setup() {
  const creations: ReturnType<typeof deferred<string>>[] = [];
  const sessions: ReturnType<typeof fakeSession>[] = [];
  function fakeSession(id: string) {
    let state: ReturnType<PersistenceSession['getSnapshot']> = {
      status: 'idle',
      messages: [],
      toolCalls: [],
      interrupts: [],
    };
    const observers = new Set<() => void>();
    const release = vi.fn();
    const run = deferred<CompleteOutcome>(),
      history = deferred<void>();
    const session: PersistenceSession = {
      getSnapshot: () => state,
      subscribe: vi.fn((notify) => {
        observers.add(notify);
        return () => {
          observers.delete(notify);
          release();
        };
      }),
      submit: vi.fn(() => run.promise),
      load: vi.fn(() => history.promise),
      stop: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
    };
    function replace(update: Partial<typeof state>, notify = true) {
      state = { ...state, ...update };
      if (notify) for (const observer of observers) observer();
    }
    function text(content: string) {
      replace({
        messages: [
          {
            id: 'reply-' + id,
            role: 'assistant',
            content,
            delivery: {
              generation: 'run',
              phase: 'complete',
              outcome: 'success',
            },
          },
        ],
      });
    }
    return { id, session, run, history, replace, text, release };
  }
  const createThread = vi.fn((_signal: AbortSignal) => {
    const creation = deferred<string>();
    creations.push(creation);
    return creation.promise;
  });
  const sessionFactory = vi.fn((id: string) => {
    const session = fakeSession(id);
    sessions.push(session);
    return session.session;
  });
  const application = createPersistenceApplication({
    createThread,
    sessionFactory,
  });
  async function create(id: string, content: string) {
    const pending = application.submit('Remember ' + content);
    creations.at(-1)!.resolve(id);
    await tick();
    const current = sessions.at(-1)!;
    current.text(content);
    current.run.resolve('success');
    await pending;
    return current;
  }
  async function two() {
    const a = await create('A', 'Avery likes teal');
    await application.newConversation();
    const b = await create('B', 'Blair likes violet');
    return { a, b };
  }
  return {
    application,
    creations,
    sessions,
    createThread,
    sessionFactory,
    create,
    two,
  };
}

it('starts as an empty draft without I/O and ignores blank messages', async () => {
  const h = setup();
  await h.application.submit('  ');
  expect(h.application.getSnapshot()).toMatchObject({
    selectedId: null,
    conversations: [],
    rows: [],
    busy: false,
    canSubmit: true,
    activity: 'idle',
  });
  expect(h.createThread).not.toHaveBeenCalled();
  expect(h.sessionFactory).not.toHaveBeenCalled();
});
it('admits one creation synchronously and records only the confirmed ID', async () => {
  const h = setup();
  const pending = h.application.submit('Remember Avery');
  expect(h.application.getSnapshot()).toMatchObject({
    busy: true,
    canSubmit: false,
    activity: 'creating',
    conversations: [],
  });
  await h.application.submit('Duplicate');
  await h.application.newConversation();
  expect(h.createThread).toHaveBeenCalledTimes(1);
  h.creations[0].resolve('A');
  await tick();
  expect(h.sessionFactory).toHaveBeenCalledWith('A');
  expect(h.application.getSnapshot().conversations).toEqual([
    { id: 'A', label: 'Conversation 1', availability: 'available' },
  ]);
  h.sessions[0].run.resolve('success');
  await pending;
});
it('new conversation clears rows but preserves safe entries without creating a thread', async () => {
  const h = setup();
  const a = await h.create('A', 'Avery');
  await h.application.newConversation();
  expect(h.application.getSnapshot()).toMatchObject({
    selectedId: null,
    rows: [],
    canSubmit: true,
    outcome: null,
  });
  expect(h.application.getSnapshot().conversations).toHaveLength(1);
  expect(a.release).toHaveBeenCalledTimes(1);
  expect(a.session.dispose).toHaveBeenCalledTimes(1);
  expect(h.createThread).toHaveBeenCalledTimes(1);
});
it('selects a known successful thread through a fresh session and authoritative server load', async () => {
  const h = setup();
  const { b } = await h.two();
  const entry = h.application.getSnapshot().conversations[0];
  const pending = h.application.select(entry);
  await tick();
  const loaded = h.sessions[2];
  expect(h.application.getSnapshot()).toMatchObject({
    selectedId: 'A',
    rows: [],
    busy: true,
    canSubmit: false,
    activity: 'loading',
  });
  expect(b.release).toHaveBeenCalledTimes(1);
  expect(loaded.session.load).toHaveBeenCalledTimes(1);
  expect(loaded.session.submit).not.toHaveBeenCalled();
  loaded.text('Authoritative new server text');
  loaded.history.resolve();
  await pending;
  expect(h.application.getSnapshot().rows).toHaveLength(1);
  expect(JSON.stringify(h.application.getSnapshot().rows)).toContain(
    'Authoritative new server text'
  );
  expect(h.application.getSnapshot()).toMatchObject({
    busy: false,
    canSubmit: true,
  });
  expect(h.createThread).toHaveBeenCalledTimes(2);
});
it('ignores cloned or unknown entries and selecting the current conversation', async () => {
  const h = setup();
  await h.create('A', 'Avery');
  const entry = h.application.getSnapshot().conversations[0];
  await h.application.select(entry);
  await h.application.select({ ...entry });
  await h.application.select({
    id: 'unknown',
    label: 'Unknown',
    availability: 'available',
  });
  expect(h.sessionFactory).toHaveBeenCalledTimes(1);
});

it('rejects unowned entry accessors without reading them', async () => {
  const h = setup();
  await h.create('A', 'Avery');
  const getter = vi.fn(() => 'unknown');
  const entry = Object.defineProperty(
    { label: 'Unknown', availability: 'available' as const },
    'id',
    { get: getter }
  );
  await h.application.select(entry as never);
  expect(getter).not.toHaveBeenCalled();
  expect(h.sessionFactory).toHaveBeenCalledTimes(1);
});

it('keeps conversation metadata owned, immutable and stable through selection', async () => {
  const h = setup();
  await h.two();
  const conversations = h.application.getSnapshot().conversations;
  expect(Object.isFrozen(conversations)).toBe(true);
  expect(conversations.every(Object.isFrozen)).toBe(true);
  const pending = h.application.select(conversations[0]);
  await tick();
  h.sessions[2].history.resolve();
  await pending;
  expect(h.application.getSnapshot().conversations).toBe(conversations);
});

it('disposal releases rows and reads before asynchronous SDK cleanup completes', async () => {
  const h = setup();
  await h.two();
  const pending = h.application.select(
    h.application.getSnapshot().conversations[0]
  );
  await tick();
  const loaded = h.sessions[2];
  const cleanup = deferred<void>();
  vi.mocked(loaded.session.dispose).mockImplementation(() => cleanup.promise);
  const disposal = h.application.dispose();
  const before = h.application.getSnapshot();
  expect(loaded.release).toHaveBeenCalledTimes(1);
  loaded.text('Late read');
  loaded.history.resolve();
  await pending;
  expect(h.application.getSnapshot()).toBe(before);
  expect(h.application.dispose()).toBe(disposal);
  cleanup.resolve();
  await disposal;
});

it('disposal during creation fences its fulfilled promise', async () => {
  const h = setup();
  const pending = h.application.submit('Avery');
  await h.application.dispose();
  h.creations[0].resolve('Late');
  await pending;
  expect(h.sessionFactory).not.toHaveBeenCalled();
  expect(h.application.getSnapshot().conversations).toEqual([]);
});

it('disposal during selection publication prevents fresh session construction', async () => {
  const h = setup();
  await h.two();
  h.application.subscribe(() => {
    if (h.application.getSnapshot().selectedId === 'A')
      void h.application.dispose();
  });
  await h.application.select(h.application.getSnapshot().conversations[0]);
  expect(h.sessionFactory).toHaveBeenCalledTimes(2);
});

it('a pause published after confirmation is rechecked before the first message', async () => {
  const h = setup();
  h.application.subscribe(() => {
    if (h.application.getSnapshot().selectedId === 'A')
      h.sessions[0].replace({ interrupts: [{ value: null }] }, false);
  });
  const pending = h.application.submit('Avery');
  h.creations[0].resolve('A');
  await pending;
  expect(h.sessions[0].session.submit).not.toHaveBeenCalled();
  expect(h.application.getSnapshot().canSubmit).toBe(false);
});
it('held history blocks every competing command and fences the released old observer', async () => {
  const h = setup();
  const { b } = await h.two();
  const pending = h.application.select(
    h.application.getSnapshot().conversations[0]
  );
  await tick();
  const before = h.application.getSnapshot();
  b.text('Late old observer');
  expect(h.application.getSnapshot()).toBe(before);
  await h.application.submit('No dispatch');
  await h.application.newConversation();
  await h.application.select(h.application.getSnapshot().conversations[1]);
  expect(h.createThread).toHaveBeenCalledTimes(2);
  expect(h.sessionFactory).toHaveBeenCalledTimes(3);
  h.sessions[2].history.resolve();
  await pending;
});
it.each(['stop', 'dispose'] as const)(
  'fulfilled detached history after %s never authorizes text or late rows',
  async (action) => {
    const h = setup();
    await h.two();
    const pending = h.application.select(
      h.application.getSnapshot().conversations[0]
    );
    await tick();
    const loaded = h.sessions[2];
    await h.application[action]();
    const before = h.application.getSnapshot();
    loaded.text('Late history');
    loaded.history.resolve();
    await pending;
    expect(h.application.getSnapshot()).toBe(before);
    await h.application.submit('Never replay');
    expect(loaded.session.submit).not.toHaveBeenCalled();
    if (action === 'stop')
      expect(before).toMatchObject({
        busy: false,
        canSubmit: false,
        outcome: 'aborted',
      });
  }
);
it('Stop during creation never adds a late confirmed thread or constructs its session', async () => {
  const h = setup();
  const pending = h.application.submit('Remember Avery');
  await h.application.stop();
  h.creations[0].resolve('Late');
  await pending;
  expect(h.sessionFactory).not.toHaveBeenCalled();
  expect(h.application.getSnapshot().conversations).toEqual([]);
  expect(h.application.getSnapshot()).toMatchObject({
    canSubmit: false,
    busy: false,
    outcome: 'aborted',
  });
});
it('creation failure protects diagnostics and is not retried', async () => {
  const h = setup();
  const pending = h.application.submit('Remember Avery');
  h.creations[0].reject(new Error('PRIVATE failure'));
  await pending;
  await h.application.submit('No retry');
  expect(h.createThread).toHaveBeenCalledTimes(1);
  expect(h.sessionFactory).not.toHaveBeenCalled();
  expect(h.application.getSnapshot()).toMatchObject({
    canSubmit: false,
    outcome: 'error',
    error: 'The LangGraph request failed.',
  });
});
it.each(['paused', 'error', 'aborted', 'interrupted'] as const)(
  'quarantines a confirmed thread after %s',
  async (outcome) => {
    const h = setup();
    const pending = h.application.submit('Remember Avery');
    h.creations[0].resolve('A');
    await tick();
    const stale = h.application.getSnapshot().conversations[0];
    h.sessions[0].run.resolve(outcome);
    await pending;
    expect(h.application.getSnapshot().conversations[0].availability).toBe(
      'unavailable'
    );
    await h.application.newConversation();
    await h.application.select(stale);
    expect(h.sessionFactory).toHaveBeenCalledTimes(1);
    expect(h.application.getSnapshot().selectedId).toBeNull();
  }
);
it('failed history never authorizes writing and leaves other safe conversations usable', async () => {
  const h = setup();
  await h.two();
  const pending = h.application.select(
    h.application.getSnapshot().conversations[0]
  );
  await tick();
  h.sessions[2].history.reject(new Error('PRIVATE history'));
  await pending;
  expect(h.application.getSnapshot()).toMatchObject({
    canSubmit: false,
    outcome: 'error',
    error: 'The LangGraph request failed.',
  });
  expect(
    h.application.getSnapshot().conversations.map((entry) => entry.availability)
  ).toEqual(['unavailable', 'available']);
  const next = h.application.select(
    h.application.getSnapshot().conversations[1]
  );
  await tick();
  h.sessions[3].history.resolve();
  await next;
  expect(h.application.getSnapshot()).toMatchObject({
    selectedId: 'B',
    canSubmit: true,
  });
});
it.each([
  { interrupts: [{ value: null }] },
  {
    toolCalls: [
      {
        id: 'x',
        name: 'unknown',
        args: {},
        status: 'complete' as const,
        result: {},
      },
    ],
  },
  {
    messages: [
      {
        id: 'x',
        role: 'assistant' as const,
        content: '',
        toolCallIds: ['unknown'],
        delivery: {
          generation: 'history',
          phase: 'complete' as const,
          outcome: 'success' as const,
        },
      },
    ],
  },
])(
  'unsafe loaded root observations cannot authorize a new message: %j',
  async (update) => {
    const h = setup();
    await h.two();
    const pending = h.application.select(
      h.application.getSnapshot().conversations[0]
    );
    await tick();
    const loaded = h.sessions[2];
    loaded.replace(update);
    loaded.history.resolve();
    await pending;
    await h.application.submit('No inference');
    expect(loaded.session.submit).not.toHaveBeenCalled();
    expect(h.application.getSnapshot().canSubmit).toBe(false);
  }
);
it('rechecks a missed pause notification before sending', async () => {
  const h = setup();
  const a = await h.create('A', 'Avery');
  a.replace({ interrupts: [{ value: null }] }, false);
  await h.application.submit('No resume');
  expect(a.session.submit).toHaveBeenCalledTimes(1);
  expect(h.application.getSnapshot().canSubmit).toBe(false);
});

it('reentrant Stop while capturing a fulfilled history snapshot cannot restore readiness', async () => {
  const h = setup();
  await h.two();
  const pending = h.application.select(
    h.application.getSnapshot().conversations[0]
  );
  await tick();
  const loaded = h.sessions[2],
    state = loaded.session.getSnapshot();
  let revoked: ReturnType<typeof h.application.getSnapshot> | undefined;
  vi.spyOn(loaded.session, 'getSnapshot').mockImplementationOnce(() => {
    void h.application.stop();
    revoked = h.application.getSnapshot();
    return state;
  });
  loaded.history.resolve();
  await pending;
  expect(h.application.getSnapshot()).toBe(revoked);
  expect(h.application.getSnapshot()).toMatchObject({
    canSubmit: false,
    outcome: 'aborted',
  });
});

it('reentrant Stop while capturing final run state cannot overwrite its result', async () => {
  const h = setup();
  const pending = h.application.submit('Avery');
  h.creations[0].resolve('A');
  await tick();
  const selected = h.sessions[0],
    state = selected.session.getSnapshot();
  let revoked: ReturnType<typeof h.application.getSnapshot> | undefined;
  vi.spyOn(selected.session, 'getSnapshot').mockImplementationOnce(() => {
    void h.application.stop();
    revoked = h.application.getSnapshot();
    return state;
  });
  selected.run.resolve('success');
  await pending;
  expect(h.application.getSnapshot()).toBe(revoked);
  expect(h.application.getSnapshot().outcome).toBe('aborted');
});

it('reentrant Stop during observer capture cannot publish revoked rows', async () => {
  const h = setup();
  const a = await h.create('A', 'Avery'),
    state = a.session.getSnapshot();
  const secondRun = deferred<CompleteOutcome>();
  vi.mocked(a.session.submit).mockImplementationOnce(() => secondRun.promise);
  const pending = h.application.submit('Another message');
  await tick();
  let revoked: ReturnType<typeof h.application.getSnapshot> | undefined;
  vi.spyOn(a.session, 'getSnapshot').mockImplementationOnce(() => {
    void h.application.stop();
    revoked = h.application.getSnapshot();
    return state;
  });
  a.text('Revoked row');
  secondRun.resolve('success');
  await pending;
  expect(h.application.getSnapshot()).toBe(revoked);
});

it('a pause observed during history cannot be cleared into command authority by a later safe snapshot', async () => {
  const h = setup();
  await h.two();
  const pending = h.application.select(
    h.application.getSnapshot().conversations[0]
  );
  await tick();
  const loaded = h.sessions[2];
  loaded.replace({ interrupts: [{ value: null }] });
  loaded.replace({ interrupts: [] });
  loaded.history.resolve();
  await pending;
  expect(h.application.getSnapshot().canSubmit).toBe(false);
  expect(h.application.getSnapshot().conversations[0].availability).toBe(
    'unavailable'
  );
});
it('reentrant disposal during admission prevents creation', async () => {
  const h = setup();
  h.application.subscribe(() => void h.application.dispose());
  await h.application.submit('Avery');
  expect(h.createThread).not.toHaveBeenCalled();
});
it('reentrant Stop after confirmed publication prevents dispatch', async () => {
  const h = setup();
  h.application.subscribe(() => {
    if (h.application.getSnapshot().selectedId) void h.application.stop();
  });
  const pending = h.application.submit('Avery');
  h.creations[0].resolve('A');
  await pending;
  expect(h.sessions[0].session.submit).not.toHaveBeenCalled();
});

it('reentrant Stop during selection admission cannot publish a late selection', async () => {
  const h = setup();
  await h.two();
  h.application.subscribe(() => {
    if (h.application.getSnapshot().activity === 'loading')
      void h.application.stop();
  });
  await h.application.select(h.application.getSnapshot().conversations[0]);
  expect(h.application.getSnapshot()).toMatchObject({
    selectedId: 'B',
    busy: false,
    canSubmit: false,
    outcome: 'aborted',
  });
  expect(h.sessionFactory).toHaveBeenCalledTimes(2);
});

it('reentrant Stop during replacement admission cannot publish a late empty draft', async () => {
  const h = setup();
  await h.create('A', 'Avery');
  h.application.subscribe(() => {
    if (h.application.getSnapshot().activity === 'replacing')
      void h.application.stop();
  });
  await h.application.newConversation();
  expect(h.application.getSnapshot()).toMatchObject({
    selectedId: 'A',
    busy: false,
    canSubmit: false,
    outcome: 'aborted',
  });
});
it('releasing a borrowed observer never cancels execution', async () => {
  const h = setup();
  const release = h.application.subscribe(vi.fn());
  const pending = h.application.submit('Avery');
  release();
  h.creations[0].resolve('A');
  await tick();
  h.sessions[0].run.resolve('success');
  await pending;
  expect(h.sessions[0].session.stop).not.toHaveBeenCalled();
  expect(h.sessions[0].session.dispose).not.toHaveBeenCalled();
});
