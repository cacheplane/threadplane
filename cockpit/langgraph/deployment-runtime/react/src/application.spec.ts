import { expect, it, vi } from 'vitest';
import type {
  AgentSnapshot,
  CompleteOutcome,
  Message,
} from '@threadplane/core';
import { createDeploymentApplication } from './application';

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
type State = AgentSnapshot & {
  values?: Readonly<Record<string, unknown>>;
  interrupts: readonly unknown[];
};
function setup() {
  let sequence = 0;
  const creations: ReturnType<typeof deferred<string>>[] = [],
    signals: AbortSignal[] = [];
  const sessions: ReturnType<typeof fake>[] = [];
  function fake(id: string) {
    let state: State = {
      status: 'idle',
      messages: [],
      toolCalls: [],
      interrupts: [],
    };
    let canonical: readonly Message[] = [],
      human: Message | undefined;
    const observers = new Set<() => void>(),
      release = vi.fn();
    const runs: ReturnType<typeof deferred<CompleteOutcome>>[] = [];
    function replace(update: Partial<State>, notify = true) {
      state = { ...state, ...update };
      if (notify) for (const notify of observers) notify();
    }
    const session = {
      getSnapshot: () => state,
      subscribe: vi.fn((notify: () => void) => {
        observers.add(notify);
        return () => {
          observers.delete(notify);
          release();
        };
      }),
      submit: vi.fn(
        async (text: string, options?: { signal?: AbortSignal }) => {
          human = {
            id: 'human-' + ++sequence,
            role: 'user',
            content: text,
            delivery: {
              generation: 'turn-' + sequence,
              phase: 'complete',
              outcome: 'success',
            },
          };
          const run = deferred<CompleteOutcome>();
          runs.push(run);
          if (options?.signal) signals.push(options.signal);
          replace({ status: 'running', messages: [...state.messages, human] });
          return run.promise;
        }
      ),
      stop: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
    };
    function final(update: Partial<State> = {}, notify = true) {
      const answer: Message = {
        id: 'answer-' + human!.id,
        role: 'assistant',
        content: 'Fictional final ' + human!.content,
        delivery: {
          generation: human!.delivery.generation,
          phase: 'complete',
          outcome: 'success',
        },
      };
      canonical = [...canonical, human!, answer];
      replace(
        {
          status: 'idle',
          error: undefined,
          interrupts: [],
          toolCalls: [],
          messages: canonical,
          values: {
            completed_turn_id: human!.id,
            completed_answer_id: answer.id,
            completed_message_ids: canonical.map((row) => row.id),
          },
          ...update,
        },
        notify
      );
    }
    return { id, session, runs, replace, final, release, human: () => human! };
  }
  const factory = vi.fn((id: string) => {
    const selected = fake(id);
    sessions.push(selected);
    return selected.session;
  });
  const application = createDeploymentApplication({
    createThread: vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      const creation = deferred<string>();
      creations.push(creation);
      return creation.promise;
    }),
    sessionFactory: factory,
  });
  async function start(text = 'A') {
    const pending = application.submit(text);
    expect(creations).toHaveLength(1);
    creations[0].resolve('thread-1');
    await tick();
    expect(sessions).toHaveLength(1);
    return { pending, selected: sessions[0] };
  }
  async function healthy() {
    const running = await start();
    running.selected.final();
    running.selected.runs[0].resolve('success');
    await running.pending;
    return running.selected;
  }
  return {
    application,
    creations,
    sessions,
    signals,
    factory,
    start,
    healthy,
    fake,
  };
}

it('creates lazily, admits once synchronously and confirms the actual current pair', async () => {
  const h = setup();
  expect(h.creations).toHaveLength(0);
  expect(h.application.getSnapshot()).toMatchObject({
    threadId: null,
    rows: [],
    busy: false,
    canSubmit: true,
  });
  const pending = h.application.submit('A');
  expect(h.application.getSnapshot()).toMatchObject({
    busy: true,
    canSubmit: false,
  });
  await h.application.submit('Competing');
  await h.application.newConversation();
  expect(h.creations).toHaveLength(1);
  h.creations[0].resolve('thread-1');
  await tick();
  const selected = h.sessions[0];
  selected.final();
  selected.runs[0].resolve('success');
  await pending;
  expect(h.application.getSnapshot()).toMatchObject({
    threadId: 'thread-1',
    busy: false,
    canSubmit: true,
    outcome: 'success',
    error: null,
  });
  expect(h.application.getSnapshot().rows).toHaveLength(2);
  expect(selected.session.submit).toHaveBeenCalledTimes(1);
});
it('ordinary turns preserve full canonical history on one confirmed UUID', async () => {
  const h = setup(),
    selected = await h.healthy();
  const pending = h.application.submit('B');
  await tick();
  selected.final();
  selected.runs[1].resolve('success');
  await pending;
  expect(h.creations).toHaveLength(1);
  expect(h.application.getSnapshot().rows).toHaveLength(4);
  expect(h.application.getSnapshot().canSubmit).toBe(true);
});
it('New clears synchronously, closes the old lifetime and creates only on the next Send', async () => {
  const h = setup(),
    selected = await h.healthy();
  await h.application.newConversation();
  expect(h.application.getSnapshot()).toMatchObject({
    threadId: null,
    rows: [],
    canSubmit: true,
    outcome: null,
    error: null,
    viewGeneration: 1,
  });
  expect(selected.release).toHaveBeenCalledTimes(1);
  expect(selected.session.dispose).toHaveBeenCalledTimes(1);
  expect(h.creations).toHaveLength(1);
  const pending = h.application.submit('New');
  h.creations[1].resolve('thread-2');
  await tick();
  h.sessions[1].final();
  h.sessions[1].runs[0].resolve('success');
  await pending;
  expect(h.application.getSnapshot()).toMatchObject({
    threadId: 'thread-2',
    canSubmit: true,
  });
  expect(h.application.getSnapshot().rows).toHaveLength(2);
});
it.each(['error', 'paused', 'aborted', 'interrupted'] as const)(
  'non-success result %s never permits replay',
  async (outcome) => {
    const h = setup(),
      { pending, selected } = await h.start();
    selected.final();
    selected.runs[0].resolve(outcome);
    await pending;
    expect(h.application.getSnapshot()).toMatchObject({
      canSubmit: false,
      outcome,
    });
    await h.application.submit('Replay');
    expect(selected.session.submit).toHaveBeenCalledTimes(1);
  }
);
it.each([
  { values: undefined },
  {
    values: {
      completed_turn_id: 'old',
      completed_answer_id: 'old-answer',
      completed_message_ids: ['old', 'old-answer'],
    },
  },
  {
    values: {
      completed_turn_id: 'human-1',
      completed_answer_id: 'answer-human-1',
      completed_message_ids: ['answer-human-1', 'human-1'],
    },
  },
])(
  'stream success cannot authorize malformed current canonical metadata: %j',
  async (update) => {
    const h = setup(),
      { pending, selected } = await h.start();
    selected.final(update);
    selected.runs[0].resolve('success');
    await pending;
    expect(h.application.getSnapshot().canSubmit).toBe(false);
    await h.application.submit('Replay');
    expect(selected.session.submit).toHaveBeenCalledTimes(1);
  }
);
it('a correct current pair cannot hide a missing older canonical prefix', async () => {
  const h = setup(),
    selected = await h.healthy(),
    pending = h.application.submit('B');
  await tick();
  selected.final({
    values: {
      completed_turn_id: 'human-2',
      completed_answer_id: 'answer-human-2',
      completed_message_ids: ['human-2', 'answer-human-2'],
    },
  });
  selected.runs[1].resolve('success');
  await pending;
  expect(h.application.getSnapshot().canSubmit).toBe(false);
});
it.each([
  { interrupts: [{ value: null }] },
  {
    error: {
      kind: 'server',
      message: 'PRIVATE root failure',
      retryable: false,
    },
  },
  {
    toolCalls: [
      {
        id: 'unknown',
        name: 'unknown',
        args: {},
        status: 'complete',
        result: {},
      },
    ],
  },
])(
  'unsafe root observations remain sticky after a later clean result: %j',
  async (update) => {
    const h = setup(),
      { pending, selected } = await h.start();
    selected.replace(update as Partial<State>);
    selected.final();
    selected.runs[0].resolve('success');
    await pending;
    expect(h.application.getSnapshot().canSubmit).toBe(false);
    expect(JSON.stringify(h.application.getSnapshot())).not.toContain(
      'PRIVATE'
    );
  }
);
it.each([
  { role: 'tool' as const },
  { toolCallId: '' },
  { toolCallId: 'unbound' },
  { toolCallIds: ['unbound'] },
])(
  'unsupported message evidence remains sticky after clearing: %j',
  async (evidence) => {
    const h = setup(),
      { pending, selected } = await h.start();
    selected.replace({
      messages: [
        selected.human(),
        {
          ...selected.human(),
          id: 'unsupported',
          role: 'assistant',
          ...evidence,
        },
      ],
    });
    selected.final();
    selected.runs[0].resolve('success');
    await pending;
    expect(h.application.getSnapshot().canSubmit).toBe(false);
    await h.application.submit('Replay');
    expect(selected.session.submit).toHaveBeenCalledTimes(1);
  }
);
it('creation rejection is protected and never replayed before New', async () => {
  const h = setup(),
    pending = h.application.submit('A');
  h.creations[0].reject(new Error('PRIVATE creation response'));
  await pending;
  expect(h.application.getSnapshot()).toMatchObject({
    busy: false,
    canSubmit: false,
    threadId: null,
  });
  expect(JSON.stringify(h.application.getSnapshot())).not.toContain('PRIVATE');
  await h.application.submit('Replay');
  expect(h.creations).toHaveLength(1);
  await h.application.newConversation();
  expect(h.application.getSnapshot().canSubmit).toBe(true);
});
it('Stop during creation aborts authority and ignores the late confirmed UUID', async () => {
  const h = setup(),
    pending = h.application.submit('A');
  await h.application.stop();
  const stopped = h.application.getSnapshot();
  expect(h.signals[0].aborted).toBe(true);
  h.creations[0].resolve('late-thread');
  await pending;
  expect(h.application.getSnapshot()).toBe(stopped);
  expect(h.factory).not.toHaveBeenCalled();
});
it('Stop detaches running observation before late final rows or completion', async () => {
  const h = setup(),
    { pending, selected } = await h.start();
  await h.application.stop();
  const stopped = h.application.getSnapshot();
  selected.final();
  selected.runs[0].resolve('success');
  await pending;
  expect(h.application.getSnapshot()).toBe(stopped);
  expect(stopped).toMatchObject({ canSubmit: false, outcome: 'aborted' });
  expect(selected.release).toHaveBeenCalledTimes(1);
  expect(selected.session.stop).toHaveBeenCalledTimes(1);
});
it('New replacement admission blocks a reentrant unsubscribe submission', async () => {
  const h = setup(),
    selected = await h.healthy();
  selected.release.mockImplementation(() => {
    void h.application.submit('Reentrant cleanup');
  });
  await h.application.newConversation();
  await tick();
  expect(h.creations).toHaveLength(1);
  expect(h.application.getSnapshot().threadId).toBeNull();
});
it('reentrant observers cannot compete with the admitted creation', async () => {
  const h = setup();
  h.application.subscribe(() => {
    void h.application.submit('Observer');
  });
  const pending = h.application.submit('A');
  expect(h.creations).toHaveLength(1);
  await h.application.stop();
  h.creations[0].resolve('late');
  await pending;
});
it('factory revocation disposes the returned session without installing it', async () => {
  const h = setup(),
    candidate = h.fake('thread-1');
  h.factory.mockImplementationOnce(() => {
    void h.application.dispose();
    return candidate.session;
  });
  const pending = h.application.submit('A');
  h.creations[0].resolve('thread-1');
  await pending;
  await tick();
  expect(candidate.session.dispose).toHaveBeenCalledTimes(1);
  expect(candidate.session.subscribe).not.toHaveBeenCalled();
});
it('reentrant Stop during final snapshot capture cannot overwrite cancellation', async () => {
  const h = setup(),
    { pending, selected } = await h.start();
  selected.final({}, false);
  const state = selected.session.getSnapshot();
  let revoked: unknown;
  vi.spyOn(selected.session, 'getSnapshot').mockImplementationOnce(() => {
    void h.application.stop();
    revoked = h.application.getSnapshot();
    return state;
  });
  selected.runs[0].resolve('success');
  await pending;
  expect(h.application.getSnapshot()).toBe(revoked);
});
it('dispose synchronously revokes authority, detaches observation and is idempotent', async () => {
  const h = setup(),
    { pending, selected } = await h.start();
  const before = h.application.getSnapshot(),
    disposal = h.application.dispose();
  expect(h.application.dispose()).toBe(disposal);
  expect(selected.release).toHaveBeenCalledTimes(1);
  selected.final();
  selected.runs[0].resolve('success');
  await pending;
  await disposal;
  expect(h.application.getSnapshot()).toBe(before);
  expect(selected.session.dispose).toHaveBeenCalledTimes(1);
  await h.application.submit('After disposal');
  expect(h.creations).toHaveLength(1);
});
it('a missed unsafe root notification blocks a subsequent Send', async () => {
  const h = setup(),
    selected = await h.healthy();
  selected.replace({ interrupts: [{ value: null }] }, false);
  await h.application.submit('Must not dispatch');
  expect(selected.session.submit).toHaveBeenCalledTimes(1);
  expect(h.application.getSnapshot().canSubmit).toBe(false);
});
