import { expect, it, vi } from 'vitest';
import type {
  AgentSnapshot,
  CompleteOutcome,
  Message,
} from '@threadplane/core';
import { createDurableApplication } from './application';

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
  interrupts: readonly { value?: unknown }[];
};
function setup() {
  const creations: ReturnType<typeof deferred<string>>[] = [];
  const sessions: ReturnType<typeof fake>[] = [];
  let sequence = 0;
  function fake(id: string) {
    let state: State = {
      status: 'idle',
      messages: [],
      toolCalls: [],
      interrupts: [],
    };
    const observers = new Set<() => void>(),
      release = vi.fn();
    const runs: ReturnType<typeof deferred<CompleteOutcome>>[] = [],
      checks: ReturnType<typeof deferred<void>>[] = [];
    let human: Message | undefined;
    const session = {
      getSnapshot: () => state,
      subscribe: vi.fn((notify: () => void) => {
        observers.add(notify);
        return () => {
          observers.delete(notify);
          release();
        };
      }),
      submit: vi.fn(async (text: string) => {
        const turn = ++sequence;
        human = {
          id: 'human-' + turn,
          role: 'user',
          content: text,
          delivery: {
            generation: 'turn-' + turn,
            phase: 'complete',
            outcome: 'success',
          },
        };
        const run = deferred<CompleteOutcome>();
        runs.push(run);
        replace({
          status: 'running',
          error: undefined,
          messages: [...state.messages, human],
        });
        return run.promise;
      }),
      checkStatus: vi.fn(async () => {
        const check = deferred<void>();
        checks.push(check);
        return check.promise;
      }),
      stop: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
    };
    function replace(update: Partial<State>, notify = true) {
      state = { ...state, ...update };
      if (notify) for (const observer of observers) observer();
    }
    function assistant(
      content: string,
      outcome: CompleteOutcome = 'success'
    ): Message {
      return {
        id: content + '-' + human!.id,
        role: 'assistant',
        content,
        delivery: {
          generation: human!.delivery.generation,
          phase: 'complete',
          outcome,
        },
      };
    }
    function step(value: string) {
      replace({
        values: { ...state.values, step: value },
        messages: [...state.messages, assistant(value)],
      });
    }
    function final(update: Partial<State> = {}, notify = true) {
      replace(
        {
          status: 'idle',
          error: undefined,
          values: {
            step: 'generate',
            completed_turn_id: human!.id,
            completed_answer_id: assistant('Final answer').id,
          },
          messages: [human!, assistant('Final answer')],
          ...update,
        },
        notify
      );
    }
    function interrupted(recovery: 'check' | 'none' = 'check') {
      replace({
        status: 'error',
        error: {
          kind: 'interrupted',
          message: 'PRIVATE interrupted response',
          retryable: false,
          recovery,
        },
        messages: [human!, assistant('Partial analysis', 'interrupted')],
      });
      runs.at(-1)!.resolve('interrupted');
    }
    return {
      id,
      session,
      runs,
      checks,
      replace,
      step,
      final,
      interrupted,
      release,
      human: () => human!,
    };
  }
  const createThread = vi.fn((_signal: AbortSignal) => {
    const request = deferred<string>();
    creations.push(request);
    return request.promise;
  });
  const sessionFactory = vi.fn((id: string) => {
    const selected = fake(id);
    sessions.push(selected);
    return selected.session;
  });
  const application = createDurableApplication({
    createThread,
    sessionFactory,
  });
  async function start(text = 'A fictional project') {
    const pending = application.submit(text);
    if (creations.length > sessions.length)
      creations.at(-1)!.resolve('thread-' + creations.length);
    await tick();
    return { pending, selected: sessions.at(-1)! };
  }
  async function complete() {
    const active = await start();
    active.selected.final();
    active.selected.runs.at(-1)!.resolve('success');
    await active.pending;
    return active.selected;
  }
  async function uncertain() {
    const active = await start();
    active.selected.interrupted();
    await active.pending;
    return active.selected;
  }
  return {
    application,
    createThread,
    sessionFactory,
    creations,
    sessions,
    start,
    complete,
    uncertain,
  };
}
const pendingSteps = ['pending', 'pending', 'pending'];
const steps = (h: ReturnType<typeof setup>) =>
  h.application
    .getSnapshot()
    .checkpoints.map((step: { status: string }) => step.status);

it('starts as an empty draft without I/O and ignores blank messages', async () => {
  const h = setup();
  await h.application.submit(' ');
  expect(h.application.getSnapshot()).toMatchObject({
    threadId: null,
    rows: [],
    busy: false,
    canSubmit: true,
    canCheck: false,
    latestCheckpoint: null,
  });
  expect(steps(h)).toEqual(pendingSteps);
  expect(h.createThread).not.toHaveBeenCalled();
});
it('admits one confirmed creation before dispatch and blocks competing commands', async () => {
  const h = setup();
  const pending = h.application.submit('First');
  await h.application.submit('Duplicate');
  await h.application.newConversation();
  await h.application.checkStatus();
  expect(h.createThread).toHaveBeenCalledTimes(1);
  expect(h.sessionFactory).not.toHaveBeenCalled();
  h.creations[0].resolve('confirmed-thread');
  await tick();
  const selected = h.sessions[0];
  expect(selected.session.submit).toHaveBeenCalledTimes(1);
  expect(h.application.getSnapshot()).toMatchObject({
    threadId: 'confirmed-thread',
    busy: true,
    canSubmit: false,
  });
  selected.final();
  selected.runs[0].resolve('success');
  await pending;
});
it('displays completed checkpoints and final root replacement removes drafts', async () => {
  const h = setup(),
    { pending, selected } = await h.start();
  selected.step('analyze');
  expect(steps(h)).toEqual(['complete', 'pending', 'pending']);
  selected.step('plan');
  expect(steps(h)).toEqual(['complete', 'complete', 'pending']);
  expect(h.application.getSnapshot().canSubmit).toBe(false);
  selected.final();
  selected.runs[0].resolve('success');
  await pending;
  expect(steps(h)).toEqual(['complete', 'complete', 'complete']);
  expect(h.application.getSnapshot()).toMatchObject({
    canSubmit: true,
    canCheck: false,
    outcome: 'success',
  });
  expect(
    h.application
      .getSnapshot()
      .rows.map((row: { message: Message }) => row.message.content)
  ).toEqual(['A fictional project', 'Final answer']);
});
it('a new turn clears the previous generate checkpoint until current-turn evidence arrives', async () => {
  const h = setup(),
    selected = await h.complete();
  const pending = h.application.submit('Second turn');
  await tick();
  expect(steps(h)).toEqual(pendingSteps);
  expect(h.application.getSnapshot().latestCheckpoint).toBeNull();
  expect(h.createThread).toHaveBeenCalledTimes(1);
  selected.step('analyze');
  expect(steps(h)).toEqual(['complete', 'pending', 'pending']);
  selected.final();
  selected.runs[1].resolve('success');
  await pending;
});
it('a terminal checkpoint can skip intermediate observations only with the exact current marker', async () => {
  const h = setup();
  await h.complete();
  const { pending, selected } = await h.start('Second');
  selected.final();
  selected.runs.at(-1)!.resolve('success');
  await pending;
  expect(h.application.getSnapshot().canSubmit).toBe(true);
  expect(steps(h)).toEqual(['complete', 'complete', 'complete']);
});
it.each([undefined, 'previous-turn', 'wrong-turn'])(
  'a missing or stale terminal marker grants no authority: %j',
  async (marker) => {
    const h = setup();
    const { pending, selected } = await h.start();
    selected.final({
      values: {
        step: 'generate',
        completed_answer_id: 'Final answer-' + selected.human().id,
        ...(marker ? { completed_turn_id: marker } : {}),
      },
    });
    selected.runs[0].resolve('success');
    await pending;
    expect(h.application.getSnapshot().canSubmit).toBe(false);
    expect(steps(h)).not.toEqual(['complete', 'complete', 'complete']);
  }
);
it('old generate values and a newly success-stamped analysis cannot claim final completion', async () => {
  const h = setup(),
    selected = await h.complete(),
    oldValues = selected.session.getSnapshot().values;
  const pending = h.application.submit('Second');
  await tick();
  selected.final({
    values: oldValues,
    messages: [
      selected.human(),
      {
        id: 'analysis',
        role: 'assistant',
        content: 'Analysis only',
        delivery: {
          generation: selected.human().delivery.generation,
          phase: 'complete',
          outcome: 'success',
        },
      },
    ],
  });
  selected.runs[1].resolve('success');
  await pending;
  expect(h.application.getSnapshot().canSubmit).toBe(false);
  expect(steps(h)).toEqual(pendingSteps);
});
it('an exact answer binding with wrong-generation delivery is not a final proof', async () => {
  const h = setup(),
    { pending, selected } = await h.start();
  selected.final({
    values: {
      step: 'generate',
      completed_turn_id: selected.human().id,
      completed_answer_id: 'old',
    },
    messages: [
      selected.human(),
      {
        id: 'old',
        role: 'assistant',
        content: 'Old result',
        delivery: {
          generation: 'previous-turn',
          phase: 'complete',
          outcome: 'success',
        },
      },
    ],
  });
  selected.runs[0].resolve('success');
  await pending;
  expect(h.application.getSnapshot().canSubmit).toBe(false);
});
it('New conversation clears rows and checkpoints without creating a thread', async () => {
  const h = setup(),
    selected = await h.complete();
  await h.application.newConversation();
  expect(h.application.getSnapshot()).toMatchObject({
    threadId: null,
    rows: [],
    canSubmit: true,
    canCheck: false,
    latestCheckpoint: null,
  });
  expect(steps(h)).toEqual(pendingSteps);
  expect(selected.release).toHaveBeenCalledTimes(1);
  expect(selected.session.dispose).toHaveBeenCalledTimes(1);
  expect(h.createThread).toHaveBeenCalledTimes(1);
});
it('uncertain creation is protected and never replayed', async () => {
  const h = setup(),
    pending = h.application.submit('First');
  h.creations[0].reject(new Error('PRIVATE create'));
  await pending;
  await h.application.submit('Retry');
  expect(h.createThread).toHaveBeenCalledTimes(1);
  expect(h.application.getSnapshot()).toMatchObject({
    canSubmit: false,
    canCheck: false,
    error: 'The LangGraph request failed.',
  });
});
it('Stop during creation fences a later confirmed ID', async () => {
  const h = setup(),
    pending = h.application.submit('First');
  await h.application.stop();
  const stopped = h.application.getSnapshot();
  h.creations[0].resolve('late');
  await pending;
  expect(h.application.getSnapshot()).toBe(stopped);
  expect(h.sessionFactory).not.toHaveBeenCalled();
});
it('only explicit adapter check recovery offers a read; known unsafe interruption does not', async () => {
  const h = setup(),
    selected = await h.uncertain();
  expect(h.application.getSnapshot()).toMatchObject({
    canSubmit: false,
    canCheck: true,
  });
  expect(selected.session.checkStatus).not.toHaveBeenCalled();
  selected.replace({
    error: {
      kind: 'interrupted',
      message: 'PRIVATE',
      retryable: false,
      recovery: 'none',
    },
  });
  await h.application.checkStatus();
  expect(selected.session.checkStatus).not.toHaveBeenCalled();
  expect(h.application.getSnapshot().canCheck).toBe(false);
});
it('an explicit read confirms the retained turn without creating or dispatching work', async () => {
  const h = setup(),
    selected = await h.uncertain(),
    pending = h.application.checkStatus();
  await tick();
  expect(h.application.getSnapshot()).toMatchObject({
    busy: true,
    canSubmit: false,
    canCheck: false,
    activity: 'checking',
  });
  await h.application.checkStatus();
  await h.application.submit('Replay');
  await h.application.newConversation();
  expect(selected.session.checkStatus).toHaveBeenCalledTimes(1);
  selected.final();
  selected.checks[0].resolve();
  await pending;
  expect(h.application.getSnapshot()).toMatchObject({
    canSubmit: true,
    canCheck: false,
    outcome: 'success',
  });
  expect(selected.session.submit).toHaveBeenCalledTimes(1);
  expect(h.createThread).toHaveBeenCalledTimes(1);
});
it('a fulfilled inconclusive status read stays blocked and permits only another explicit check', async () => {
  const h = setup(),
    selected = await h.uncertain(),
    pending = h.application.checkStatus();
  await tick();
  selected.checks[0].resolve();
  await pending;
  expect(h.application.getSnapshot()).toMatchObject({
    canSubmit: false,
    canCheck: true,
  });
  expect(selected.session.checkStatus).toHaveBeenCalledTimes(1);
  expect(selected.session.submit).toHaveBeenCalledTimes(1);
});
it.each([undefined, 'unrelated-turn'])(
  'fulfilled reads with missing or unrelated completion markers cannot enable text: %j',
  async (marker) => {
    const h = setup(),
      selected = await h.uncertain(),
      pending = h.application.checkStatus();
    await tick();
    selected.final({
      values: {
        step: 'generate',
        completed_turn_id: marker,
        completed_answer_id: 'Final answer-' + selected.human().id,
      },
    });
    selected.checks[0].resolve();
    await pending;
    expect(h.application.getSnapshot()).toMatchObject({
      canSubmit: false,
      canCheck: false,
    });
  }
);
it('a rejected status read protects diagnostics and dispatches nothing', async () => {
  const h = setup(),
    selected = await h.uncertain(),
    pending = h.application.checkStatus();
  await tick();
  selected.checks[0].reject(new Error('PRIVATE history'));
  await pending;
  expect(h.application.getSnapshot()).toMatchObject({
    canSubmit: false,
    error: 'The saved outcome could not be confirmed.',
  });
  expect(selected.session.submit).toHaveBeenCalledTimes(1);
});
it('Stop during status checking fences fulfilled late final history', async () => {
  const h = setup(),
    selected = await h.uncertain(),
    pending = h.application.checkStatus();
  await tick();
  await h.application.stop();
  const stopped = h.application.getSnapshot();
  selected.final();
  selected.checks[0].resolve();
  await pending;
  expect(h.application.getSnapshot()).toBe(stopped);
  expect(stopped).toMatchObject({
    canSubmit: false,
    canCheck: false,
    outcome: 'aborted',
  });
});
it.each([
  { role: 'tool' as const },
  { toolCallId: 'unbound-tool-result' },
  { toolCallId: '' },
  { toolCallIds: ['unbound-tool-call'] },
])(
  'message tool evidence remains blocked after a later clean root: %j',
  async (evidence) => {
    const h = setup(),
      { pending, selected } = await h.start();
    selected.replace({
      messages: [
        selected.human(),
        {
          id: 'unsupported-tool-evidence',
          role: 'assistant',
          content: 'Tool evidence',
          delivery: {
            generation: selected.human().delivery.generation,
            phase: 'complete',
            outcome: 'success',
          },
          ...evidence,
        },
      ],
    });
    selected.final();
    selected.runs[0].resolve('success');
    await pending;
    expect(h.application.getSnapshot()).toMatchObject({
      canSubmit: false,
      canCheck: false,
    });
    await h.application.submit('Must remain blocked');
    expect(selected.session.submit).toHaveBeenCalledTimes(1);
  }
);
it.each([
  { interrupts: [{ value: null }] },
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
  'unsafe root observations are sticky even if later cleared: %j',
  async (update) => {
    const h = setup(),
      { pending, selected } = await h.start();
    selected.replace(update as Partial<State>);
    selected.final({ interrupts: [], toolCalls: [] });
    selected.runs[0].resolve('success');
    await pending;
    expect(h.application.getSnapshot()).toMatchObject({
      canSubmit: false,
      canCheck: false,
    });
  }
);
it('reentrant Stop while capturing final state cannot overwrite cancellation', async () => {
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
it('reentrant Stop while capturing fulfilled history cannot restore readiness', async () => {
  const h = setup(),
    selected = await h.uncertain(),
    pending = h.application.checkStatus();
  await tick();
  selected.final({}, false);
  const state = selected.session.getSnapshot();
  let revoked: unknown;
  vi.spyOn(selected.session, 'getSnapshot').mockImplementationOnce(() => {
    void h.application.stop();
    revoked = h.application.getSnapshot();
    return state;
  });
  selected.checks[0].resolve();
  await pending;
  expect(h.application.getSnapshot()).toBe(revoked);
});
it('disposal detaches subscriptions immediately and fences pending history', async () => {
  const h = setup(),
    selected = await h.uncertain(),
    pending = h.application.checkStatus();
  await tick();
  const stopped = h.application.getSnapshot(),
    disposal = h.application.dispose();
  expect(selected.release).toHaveBeenCalledTimes(1);
  selected.final();
  selected.checks[0].resolve();
  await pending;
  await disposal;
  expect(h.application.getSnapshot()).toBe(stopped);
  expect(selected.session.dispose).toHaveBeenCalledTimes(1);
});

it('reentrant New during the initial safety read cannot admit a second thread', async () => {
  const h = setup(),
    selected = await h.complete();
  const state = selected.session.getSnapshot();
  let replacement: Promise<void> | undefined;
  const guarded = new Proxy(state, {
    get(target, key, receiver) {
      if (key === 'interrupts') replacement = h.application.newConversation();
      return Reflect.get(target, key, receiver);
    },
  });
  vi.spyOn(selected.session, 'getSnapshot').mockReturnValueOnce(guarded);
  const pending = h.application.submit('Must not run after replacement');
  expect(h.createThread).toHaveBeenCalledTimes(1);
  await replacement;
  await pending;
  expect(h.application.getSnapshot()).toMatchObject({
    threadId: null,
    rows: [],
    canSubmit: true,
  });
  expect(selected.session.submit).toHaveBeenCalledTimes(1);
});
it('inherited checkpoint fields cannot display completed pipeline nodes', async () => {
  const h = setup(),
    { selected } = await h.start();
  selected.replace({ values: Object.create({ step: 'analyze' }) });
  expect(steps(h)).toEqual(pendingSteps);
  expect(h.application.getSnapshot().latestCheckpoint).toBeNull();
  await h.application.stop();
});
it('an inherited completion marker grants no final authority', async () => {
  const h = setup(),
    { pending, selected } = await h.start();
  selected.final({
    values: Object.assign(
      Object.create({ completed_turn_id: selected.human().id }),
      {
        step: 'generate',
        completed_answer_id: 'Final answer-' + selected.human().id,
      }
    ),
  });
  selected.runs[0].resolve('success');
  await pending;
  expect(h.application.getSnapshot().canSubmit).toBe(false);
});
it('the explicit final pair filters SDK-retained intermediate drafts', async () => {
  const h = setup(),
    { pending, selected } = await h.start();
  selected.step('analyze');
  const draft = selected.session.getSnapshot().messages.at(-1)!;
  selected.final();
  selected.replace({
    messages: [
      selected.human(),
      draft,
      selected.session.getSnapshot().messages.at(-1)!,
    ],
  });
  selected.runs[0].resolve('success');
  await pending;
  expect(h.application.getSnapshot().canSubmit).toBe(true);
  expect(
    h.application.getSnapshot().rows.map((row) => row.message.content)
  ).toEqual(['A fictional project', 'Final answer']);
});
for (const fault of [
  'missing',
  'stale',
  'same-as-human',
  'duplicate-answer',
  'duplicate-human',
  'inherited',
]) {
  it(`an ${fault} answer binding grants no final authority`, async () => {
    const h = setup(),
      { pending, selected } = await h.start();
    selected.final();
    const state = selected.session.getSnapshot();
    const values = { ...state.values };
    if (fault === 'missing') delete values.completed_answer_id;
    if (fault === 'stale') values.completed_answer_id = 'previous-answer';
    if (fault === 'same-as-human')
      values.completed_answer_id = selected.human().id;
    if (fault === 'inherited') {
      delete values.completed_answer_id;
      Object.setPrototypeOf(values, {
        completed_answer_id: state.messages[1].id,
      });
    }
    selected.replace({
      values,
      messages: [
        ...state.messages,
        ...(fault === 'duplicate-answer'
          ? [state.messages[1]]
          : fault === 'duplicate-human'
          ? [state.messages[0]]
          : []),
      ],
    });
    selected.runs[0].resolve('success');
    await pending;
    expect(h.application.getSnapshot().canSubmit).toBe(false);
  });
}
it('an unbound completed generate chunk cannot replace the bound final answer', async () => {
  const h = setup(),
    { pending, selected } = await h.start();
  selected.final();
  const state = selected.session.getSnapshot();
  selected.replace({
    messages: [
      state.messages[0],
      {
        ...state.messages[1],
        id: 'generate-chunk',
        content: 'Streaming draft',
      },
      state.messages[1],
    ],
  });
  selected.runs[0].resolve('success');
  await pending;
  expect(h.application.getSnapshot().canSubmit).toBe(true);
  expect(
    h.application.getSnapshot().rows.map((row) => row.message.content)
  ).toEqual(['A fictional project', 'Final answer']);
});
