import { expect, it, vi } from 'vitest';
import type { Message, CompleteOutcome } from '@threadplane/core';
import { createThemingApplication, type ThemingSession } from './application';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function tick() {
  for (let i = 0; i < 24; i++) await Promise.resolve();
}
function message(
  id: string,
  role: Message['role'],
  content: string,
  generation = 'live'
): Message {
  return {
    id,
    role,
    content,
    delivery: { generation, phase: 'complete', outcome: 'success' },
  };
}
function setup() {
  const creation = deferred<string>(),
    run = deferred<CompleteOutcome>(),
    load = deferred<void>();
  let state: ReturnType<ThemingSession['getSnapshot']> = {
    status: 'idle',
    messages: [],
    toolCalls: [],
    interrupts: [],
    subgraphs: [],
    history: undefined,
  };
  const observers = new Set<() => void>();
  const session: ThemingSession = {
    getSnapshot: vi.fn(() => state),
    subscribe: vi.fn((notify) => {
      observers.add(notify);
      return () => observers.delete(notify);
    }),
    submit: vi.fn(() => run.promise),
    load: vi.fn(() => load.promise),
    stop: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  };
  const createThread = vi.fn(() => creation.promise),
    sessionFactory = vi.fn<() => ThemingSession | Promise<ThemingSession>>(
      () => session
    );
  const options = { createThread, sessionFactory };
  const app = createThemingApplication(options);
  function update(patch: Partial<typeof state>, notify = true) {
    state = { ...state, ...patch };
    if (notify) for (const observer of observers) observer();
  }
  const human = message('human', 'user', 'Question'),
    answer = message('answer', 'assistant', 'Answer');
  async function start() {
    const pending = app.submit('Question');
    creation.resolve('confirmed-thread');
    await tick();
    update({ status: 'running', messages: [human] });
    update({ status: 'idle', messages: [human, answer] });
    run.resolve('success');
    await tick();
    return { pending };
  }
  function saved(messages = [human, answer], next: readonly string[] = []) {
    update({
      messages: messages.map((m) => ({
        ...m,
        delivery: { generation: m.id, phase: 'complete', outcome: 'success' },
      })),
      history: [
        {
          next,
          checkpoint: { thread_id: 'confirmed-thread', checkpoint_ns: '' },
        },
      ],
    });
    load.resolve();
  }
  return {
    app,
    options,
    session,
    creation,
    run,
    load,
    createThread,
    sessionFactory,
    update,
    start,
    saved,
    human,
    answer,
  };
}

async function runningTurn(turnNumber: number) {
  const h = setup();
  if (turnNumber === 2) {
    const { pending } = await h.start();
    h.saved();
    await pending;
  }
  const prefix = h.session.getSnapshot().messages;
  const run = deferred<CompleteOutcome>(),
    load = deferred<void>();
  vi.mocked(h.session.submit).mockImplementationOnce(() => run.promise);
  vi.mocked(h.session.load).mockImplementationOnce(() => load.promise);
  const pending = h.app.submit('Question');
  h.creation.resolve('confirmed-thread');
  await tick();
  const human = message(
    `human-${turnNumber}`,
    'user',
    'Question',
    `turn-${turnNumber}`
  );
  const answer = message(
    `answer-${turnNumber}`,
    'assistant',
    'Final answer',
    `turn-${turnNumber}`
  );
  return {
    ...h,
    prefix,
    run,
    load,
    pending,
    human,
    answer,
    saved(messages = [...prefix, human, answer]) {
      h.saved(messages);
      load.resolve();
    },
  };
}

it.each(
  ([1, 2] as const).flatMap((turnNumber) => [
    ...(['error', 'aborted', 'interrupted', 'paused'] as const).flatMap(
      (outcome) =>
        [false, true].map((priorSuccess) => ({
          turnNumber,
          outcome,
          priorSuccess,
        }))
    ),
    { turnNumber, outcome: 'reopened' as const, priorSuccess: true },
  ])
)(
  'retains terminal $outcome in turn $turnNumber (priorSuccess=$priorSuccess) despite successful restoration',
  async ({ turnNumber, outcome, priorSuccess }) => {
    const h = await runningTurn(turnNumber);
    h.update({ status: 'running', messages: [...h.prefix, h.human] });
    if (priorSuccess) h.update({ messages: [...h.prefix, h.human, h.answer] });
    const delivery: Message['delivery'] =
      outcome === 'reopened'
        ? { generation: h.human.delivery.generation, phase: 'streaming' }
        : {
            generation: h.human.delivery.generation,
            phase: 'complete',
            outcome,
          };
    h.update({ messages: [...h.prefix, h.human, { ...h.answer, delivery }] });
    h.update({ status: 'idle', messages: [...h.prefix, h.human, h.answer] });
    h.run.resolve('success');
    await tick();
    h.saved();
    await h.pending;
    const afterTerminalFailure = h.app.getSnapshot();
    vi.mocked(h.session.submit).mockResolvedValueOnce('paused');
    await h.app.submit('Next');
    expect(h.session.submit).toHaveBeenCalledTimes(turnNumber);
    expect(afterTerminalFailure.canSubmit).toBe(false);
    expect(afterTerminalFailure.outcome).not.toBe('success');
    expect(h.app.getSnapshot().canSubmit).toBe(false);
    await h.app.newConversation();
    expect(h.app.getSnapshot().canSubmit).toBe(true);
    await h.app.dispose();
  }
);
it.each([1, 2])(
  'permits complete-success content and metadata revision followed by static saved delivery in turn %s',
  async (turnNumber) => {
    const h = await runningTurn(turnNumber);
    const completed = {
      ...h.answer,
      content: 'Initial complete content',
      reasoning: 'Initial complete reasoning',
      citations: [{ id: 'initial', index: 0 }],
    };
    h.update({
      status: 'running',
      messages: [...h.prefix, h.human, completed],
    });
    h.update({
      messages: [
        ...h.prefix,
        h.human,
        { ...completed, content: 'Revised', reasoning: '', citations: [] },
      ],
    });
    const final = {
      ...h.answer,
      reasoning: 'Final reasoning',
      citations: [{ id: 'final', index: 0 }],
    };
    h.update({ status: 'idle', messages: [...h.prefix, h.human, final] });
    h.run.resolve('success');
    await tick();
    expect(h.session.load).toHaveBeenCalledTimes(turnNumber);
    h.saved([...h.prefix, h.human, final]);
    await h.pending;
    expect(h.app.getSnapshot()).toMatchObject({
      outcome: 'success',
      canSubmit: true,
    });
    expect(h.session.getSnapshot().messages.at(-1)?.delivery).toEqual({
      generation: final.id,
      phase: 'complete',
      outcome: 'success',
    });
    expect(h.createThread).toHaveBeenCalledTimes(1);
    expect(h.sessionFactory).toHaveBeenCalledTimes(1);
    await h.app.dispose();
  }
);

it.each(
  ([1, 2] as const).flatMap((turnNumber) =>
    (['human-disappears', 'answer-disappears', 'both-disappear'] as const).map(
      (kind) => ({ turnNumber, kind })
    )
  )
)(
  'retains observed turn $turnNumber membership when $kind and the clean pair returns',
  async ({ turnNumber, kind }) => {
    const h = await runningTurn(turnNumber);
    h.update({ status: 'running', messages: h.prefix });
    h.update({ messages: [...h.prefix, h.human] });
    if (kind === 'human-disappears') h.update({ messages: h.prefix });
    h.update({ messages: [...h.prefix, h.human, h.answer] });
    if (kind !== 'human-disappears')
      h.update({
        messages: kind === 'both-disappear' ? h.prefix : [...h.prefix, h.human],
      });
    h.update({ status: 'idle', messages: [...h.prefix, h.human, h.answer] });
    h.run.resolve('success');
    await tick();
    h.saved();
    await h.pending;
    const canContinueAfterObservedRemoval = h.app.getSnapshot().canSubmit;
    vi.mocked(h.session.submit).mockResolvedValueOnce('paused');
    await h.app.submit('Next');
    expect(h.session.submit).toHaveBeenCalledTimes(turnNumber);
    expect(canContinueAfterObservedRemoval).toBe(false);
    expect(h.app.getSnapshot().canSubmit).toBe(false);
    expect(h.app.getSnapshot().outcome).not.toBe('success');
    await h.app.newConversation();
    expect(h.app.getSnapshot().canSubmit).toBe(true);
    await h.app.dispose();
  }
);
it.each([1, 2])(
  'permits empty pre-observation suffix and revised streaming text/metadata in turn %s',
  async (turnNumber) => {
    const h = await runningTurn(turnNumber);
    h.update({ status: 'running', messages: h.prefix });
    h.update({ messages: [...h.prefix, h.human] });
    const draft: Message = {
      ...h.answer,
      content: 'A growing provisional answer',
      reasoning: 'Provisional reasoning',
      citations: [{ id: 'draft-source', index: 0, title: 'Draft' }],
      delivery: { generation: h.human.delivery.generation, phase: 'streaming' },
    };
    h.update({ messages: [...h.prefix, h.human, draft] });
    h.update({
      messages: [
        ...h.prefix,
        h.human,
        { ...draft, content: 'Revised', reasoning: '', citations: [] },
      ],
    });
    const answer = {
      ...h.answer,
      reasoning: 'Final reasoning',
      citations: [{ id: 'final-source', index: 0, title: 'Final' }],
    };
    h.update({ status: 'idle', messages: [...h.prefix, h.human, answer] });
    h.run.resolve('success');
    await tick();
    expect(h.session.load).toHaveBeenCalledTimes(turnNumber);
    expect(h.app.getSnapshot().canSubmit).toBe(false);
    h.saved([...h.prefix, h.human, answer]);
    await h.pending;
    expect(h.app.getSnapshot()).toMatchObject({
      outcome: 'success',
      canSubmit: true,
    });
    expect(h.createThread).toHaveBeenCalledTimes(1);
    expect(h.sessionFactory).toHaveBeenCalledTimes(1);
    await h.app.dispose();
  }
);

it('does no remote work for mount, blank input or disposal', async () => {
  const h = setup();
  await h.app.submit(' ');
  await h.app.dispose();
  expect(h.createThread).not.toHaveBeenCalled();
  expect(h.sessionFactory).not.toHaveBeenCalled();
});
it('admits creation once and holds continuation until terminal canonical confirmation', async () => {
  const h = setup();
  const { pending } = await h.start();
  expect(h.session.load).toHaveBeenCalledTimes(1);
  expect(h.app.getSnapshot()).toMatchObject({
    busy: true,
    canSubmit: false,
    activity: 'confirming',
  });
  await h.app.submit('Duplicate');
  expect(h.session.submit).toHaveBeenCalledTimes(1);
  h.saved();
  await pending;
  expect(h.app.getSnapshot()).toMatchObject({
    busy: false,
    canSubmit: true,
    outcome: 'success',
  });
  expect(h.createThread).toHaveBeenCalledTimes(1);
});
it.each(
  (['pending', 'missing', 'empty'] as const).flatMap((kind) =>
    [false, true].map((restore) => ({ kind, restore }))
  )
)(
  'revokes continuation for established $kind history (restored=$restore)',
  async ({ kind, restore }) => {
    const h = setup();
    const { pending } = await h.start();
    h.saved();
    await pending;
    expect(h.app.getSnapshot().canSubmit).toBe(true);
    const terminal = h.session.getSnapshot().history;
    if (!terminal) throw Error('Expected confirmed history.');
    h.update({
      history:
        kind === 'missing'
          ? undefined
          : kind === 'empty'
          ? []
          : [{ ...terminal[0], next: ['generate'] }],
    });
    const afterObservation = h.app.getSnapshot().canSubmit;
    if (restore) h.update({ history: terminal });
    await h.app.submit('Next');
    expect(
      h.session.submit,
      `${kind}; restored=${restore}`
    ).toHaveBeenCalledTimes(1);
    expect(afterObservation).toBe(false);
    expect(h.app.getSnapshot().canSubmit).toBe(false);
    expect(h.createThread).toHaveBeenCalledTimes(1);
    await h.app.newConversation();
    expect(h.app.getSnapshot().canSubmit).toBe(true);
    await h.app.dispose();
  }
);
it.each(['pending', 'missing', 'empty'] as const)(
  'rechecks established %s history before Send even without a native callback',
  async (kind) => {
    const h = setup();
    const { pending } = await h.start();
    h.saved();
    await pending;
    const terminal = h.session.getSnapshot().history;
    if (!terminal) throw Error('Expected confirmed history.');
    h.update(
      {
        history:
          kind === 'missing'
            ? undefined
            : kind === 'empty'
            ? []
            : [{ ...terminal[0], next: ['generate'] }],
      },
      false
    );
    await h.app.submit('Next');
    expect(h.session.submit).toHaveBeenCalledTimes(1);
    expect(h.app.getSnapshot().canSubmit).toBe(false);
    h.update({ history: terminal });
    await h.app.submit('Restored');
    expect(h.session.submit).toHaveBeenCalledTimes(1);
    expect(h.app.getSnapshot().canSubmit).toBe(false);
    await h.app.dispose();
  }
);
it.each(['unloaded', 'empty'] as const)(
  'permits a first explicit Send before saved history exists: %s',
  async (kind) => {
    const h = setup();
    h.update({ history: kind === 'unloaded' ? undefined : [] });
    const { pending } = await h.start();
    expect(h.session.submit).toHaveBeenCalledTimes(1);
    h.saved();
    await pending;
    expect(h.app.getSnapshot().canSubmit).toBe(true);
    await h.app.dispose();
  }
);
it.each(
  (['extra-user', 'extra-assistant', 'running'] as const).flatMap((kind) =>
    [false, true].map((restore) => ({ kind, restore }))
  )
)(
  'revokes idle authority for $kind evidence (restored=$restore)',
  async ({ kind, restore }) => {
    const h = setup();
    const { pending } = await h.start();
    h.saved();
    await pending;
    const saved = h.session.getSnapshot().messages;
    h.update(
      kind === 'running'
        ? { status: 'running' }
        : {
            messages: [
              ...saved,
              message(
                'foreign',
                kind === 'extra-user' ? 'user' : 'assistant',
                'Unowned',
                'foreign'
              ),
            ],
          }
    );
    const afterObservation = h.app.getSnapshot().canSubmit;
    if (restore) h.update({ status: 'idle', messages: saved });
    await h.app.submit('Next');
    expect(h.session.submit).toHaveBeenCalledTimes(1);
    expect(afterObservation).toBe(false);
    expect(h.app.getSnapshot().canSubmit).toBe(false);
    await h.app.newConversation();
    expect(h.app.getSnapshot().canSubmit).toBe(true);
    await h.app.dispose();
  }
);
it.each(['extra-user', 'extra-assistant', 'running'] as const)(
  'rechecks idle authority for silent %s evidence before Send',
  async (kind) => {
    const h = setup();
    const { pending } = await h.start();
    h.saved();
    await pending;
    const saved = h.session.getSnapshot().messages;
    h.update(
      kind === 'running'
        ? { status: 'running' }
        : {
            messages: [
              ...saved,
              message(
                'foreign',
                kind === 'extra-user' ? 'user' : 'assistant',
                'Unowned',
                'foreign'
              ),
            ],
          },
      false
    );
    await h.app.submit('Next');
    expect(h.session.submit).toHaveBeenCalledTimes(1);
    expect(h.app.getSnapshot().canSubmit).toBe(false);
    h.update({ status: 'idle', messages: saved });
    await h.app.submit('Restored');
    expect(h.session.submit).toHaveBeenCalledTimes(1);
    expect(h.app.getSnapshot().canSubmit).toBe(false);
    await h.app.dispose();
  }
);
it.each(['extra-user', 'extra-assistant', 'running'] as const)(
  'immediately revokes idle authority for %s mutated during row publication',
  async (kind) => {
    const h = setup();
    const { pending } = await h.start();
    h.saved();
    await pending;
    const saved = [...h.session.getSnapshot().messages];
    let changed = false;
    h.app.subscribe(() => {
      if (changed) return;
      changed = true;
      const native = h.session.getSnapshot();
      if (kind === 'running') (native as { status: string }).status = 'running';
      else
        (native.messages as Message[]).push(
          message(
            'foreign',
            kind === 'extra-user' ? 'user' : 'assistant',
            'Unowned',
            'foreign'
          )
        );
    });
    h.update({});
    const afterObservation = h.app.getSnapshot().canSubmit;
    h.update({ status: 'idle', messages: saved });
    await h.app.submit('Next');
    expect(changed).toBe(true);
    expect(h.session.submit).toHaveBeenCalledTimes(1);
    expect(afterObservation).toBe(false);
    expect(h.app.getSnapshot().canSubmit).toBe(false);
    await h.app.dispose();
  }
);
it.each(['extra-user', 'extra-assistant', 'running'] as const)(
  'retains unowned %s evidence observed before the first owned turn',
  async (kind) => {
    const h = setup();
    let changed = false;
    h.app.subscribe(() => {
      if (changed || !h.app.getSnapshot().threadId) return;
      changed = true;
      h.update(
        kind === 'running'
          ? { status: 'running' }
          : {
              messages: [
                message(
                  'foreign',
                  kind === 'extra-user' ? 'user' : 'assistant',
                  'Unowned',
                  'foreign'
                ),
              ],
            }
      );
      h.update({ status: 'idle', messages: [] });
    });
    const pending = h.app.submit('Question');
    h.creation.resolve('thread');
    await tick();
    h.run.resolve('paused');
    await pending;
    expect(changed).toBe(true);
    expect(h.session.submit).not.toHaveBeenCalled();
    expect(h.app.getSnapshot().canSubmit).toBe(false);
    await h.app.dispose();
  }
);
it.each(['missing', 'extra', 'changed', 'pending', 'failed'])(
  'blocks continuation for %s canonical history without replay',
  async (kind) => {
    const h = setup();
    const { pending } = await h.start();
    if (kind === 'failed') h.load.reject(new Error('PRIVATE history error'));
    else
      h.saved(
        kind === 'missing'
          ? [h.human]
          : kind === 'extra'
          ? [h.human, h.answer, message('extra', 'assistant', 'Extra')]
          : kind === 'changed'
          ? [h.human, { ...h.answer, content: 'Changed' }]
          : undefined,
        kind === 'pending' ? ['generate'] : []
      );
    await pending;
    await h.app.submit('Replay');
    expect(h.app.getSnapshot().canSubmit).toBe(false);
    expect(h.session.submit).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(h.app.getSnapshot())).not.toContain('PRIVATE');
  }
);

it.each(['createThread', 'sessionFactory'] as const)(
  'rechecks authority after a reentrant %s option getter',
  async (name) => {
    const h = setup();
    const factory = h.options[name];
    let stopping: Promise<void> | undefined;
    Object.defineProperty(h.options, name, {
      get() {
        stopping = h.app.stop();
        return factory;
      },
    });
    const pending = h.app.submit('Question');
    h.creation.resolve('thread');
    await pending;
    await stopping;
    expect(
      name === 'createThread' ? h.createThread : h.sessionFactory
    ).not.toHaveBeenCalled();
  }
);
it('does not authorize a saved snapshot mutated in place during row publication', async () => {
  const h = setup();
  const { pending } = await h.start();
  h.saved();
  let changed = false;
  h.app.subscribe(() => {
    if (!changed && h.app.getSnapshot().activity === 'confirming') {
      changed = true;
      const native = h.session.getSnapshot();
      (native.messages[1] as { content: string }).content = 'Changed in place';
    }
  });
  await pending;
  expect(changed).toBe(true);
  expect(h.app.getSnapshot().canSubmit).toBe(false);
});
it.each(['missing', 'wrong-thread', 'child-namespace', 'missing-namespace'])(
  'rejects a saved %s checkpoint without admitting another run',
  async (kind) => {
    const h = setup();
    const { pending } = await h.start();
    h.saved();
    h.update({
      history: [
        {
          next: [],
          ...(kind === 'missing'
            ? {}
            : {
                checkpoint: {
                  thread_id:
                    kind === 'wrong-thread'
                      ? 'another-thread'
                      : 'confirmed-thread',
                  ...(kind === 'missing-namespace'
                    ? {}
                    : {
                        checkpoint_ns:
                          kind === 'child-namespace' ? 'child' : '',
                      }),
                },
              }),
        },
      ],
    } as never);
    await pending;
    await h.app.submit('Next');
    expect(h.app.getSnapshot().canSubmit).toBe(false);
    expect(h.session.submit).toHaveBeenCalledTimes(1);
  }
);
it.each(['stop', 'dispose'] as const)(
  'fences fulfilled canonical reads after %s',
  async (action) => {
    const h = setup();
    const { pending } = await h.start();
    await h.app[action]();
    const before = h.app.getSnapshot();
    h.saved();
    await pending;
    expect(h.app.getSnapshot()).toBe(before);
    expect(h.session.dispose).toHaveBeenCalledTimes(1);
  }
);
it('does not retry unconfirmed creation and permits only explicit local reset', async () => {
  const h = setup();
  const pending = h.app.submit('Question');
  h.creation.reject(new Error('PRIVATE creation'));
  await pending;
  await h.app.submit('Retry');
  expect(h.createThread).toHaveBeenCalledTimes(1);
  expect(h.sessionFactory).not.toHaveBeenCalled();
  await h.app.newConversation();
  expect(h.app.getSnapshot().canSubmit).toBe(true);
  expect(h.createThread).toHaveBeenCalledTimes(1);
});
it('never dispatches after a late creation following Stop', async () => {
  const h = setup();
  const pending = h.app.submit('Question');
  const stopping = h.app.stop();
  h.creation.resolve('late');
  await Promise.all([pending, stopping]);
  expect(h.sessionFactory).not.toHaveBeenCalled();
});
it.each([
  { interrupts: [{}] },
  { subgraphs: [{ namespace: ['child'] }] },
  { toolCalls: [{ id: 'call' }] },
  {
    messages: [
      message('human', 'user', 'Question'),
      { ...message('answer', 'assistant', 'Answer'), toolCallIds: ['unknown'] },
    ],
  },
])(
  'retains unsafe live evidence even when later reads look safe: %j',
  async (unsafe) => {
    const h = setup();
    const pending = h.app.submit('Question');
    h.creation.resolve('thread');
    await tick();
    h.update({ status: 'running', messages: [h.human] });
    h.update(unsafe as never);
    h.update({
      status: 'idle',
      messages: [h.human, h.answer],
      interrupts: [],
      subgraphs: [],
      toolCalls: [],
    });
    h.run.resolve('success');
    await pending;
    expect(h.session.load).not.toHaveBeenCalled();
    expect(h.app.getSnapshot().canSubmit).toBe(false);
  }
);
it('does not trust success without current admitted human and answer evidence', async () => {
  const h = setup();
  const pending = h.app.submit('Question');
  h.creation.resolve('thread');
  await tick();
  h.run.resolve('success');
  await pending;
  expect(h.session.load).not.toHaveBeenCalled();
  expect(h.app.getSnapshot().canSubmit).toBe(false);
});
it('continues only on the same thread with a fresh turn and preserves the confirmed prefix', async () => {
  const h = setup();
  const { pending } = await h.start();
  h.saved();
  await pending;
  const prefix = h.session.getSnapshot().messages;
  const run = deferred<CompleteOutcome>(),
    load = deferred<void>();
  vi.mocked(h.session.submit).mockImplementationOnce(() => run.promise);
  vi.mocked(h.session.load).mockImplementationOnce(() => load.promise);
  const second = h.app.submit('Next');
  const human = message('human-2', 'user', 'Next', 'second'),
    answer = message('answer-2', 'assistant', 'Second answer', 'second');
  h.update({ status: 'running', messages: [...prefix, human] });
  h.update({ status: 'idle', messages: [...prefix, human, answer] });
  run.resolve('success');
  await tick();
  expect(h.session.load).toHaveBeenCalledTimes(2);
  expect(h.app.getSnapshot().canSubmit).toBe(false);
  h.update({
    messages: [...prefix, human, answer].map((m) => ({
      ...m,
      delivery: { generation: m.id, phase: 'complete', outcome: 'success' },
    })),
    history: [
      {
        next: [],
        checkpoint: { thread_id: 'confirmed-thread', checkpoint_ns: '' },
      },
    ],
  });
  load.resolve();
  await second;
  expect(h.app.getSnapshot().canSubmit).toBe(true);
  expect(h.createThread).toHaveBeenCalledTimes(1);
  expect(h.sessionFactory).toHaveBeenCalledTimes(1);
});
it('keeps an observed answer identity conflict sticky across later safe snapshots', async () => {
  const h = setup();
  const pending = h.app.submit('Question');
  h.creation.resolve('thread');
  await tick();
  h.update({ status: 'running', messages: [h.human, h.answer] });
  h.update({ messages: [h.human, { ...h.answer, id: 'conflicting-answer' }] });
  h.update({ status: 'idle', messages: [h.human, h.answer] });
  h.run.resolve('success');
  await pending;
  expect(h.session.load).not.toHaveBeenCalled();
  expect(h.app.getSnapshot().canSubmit).toBe(false);
});
it('rejects a loaded transcript without static delivery identity', async () => {
  const h = setup();
  const { pending } = await h.start();
  h.update({
    history: [
      {
        next: [],
        checkpoint: { thread_id: 'confirmed-thread', checkpoint_ns: '' },
      },
    ],
    messages: [h.human, h.answer],
  });
  h.load.resolve();
  await pending;
  expect(h.app.getSnapshot().canSubmit).toBe(false);
});
it('retains an empty singular tool reference as unsafe evidence', async () => {
  const h = setup();
  const pending = h.app.submit('Question');
  h.creation.resolve('thread');
  await tick();
  h.update({
    status: 'running',
    messages: [h.human, { ...h.answer, toolCallId: '' }],
  });
  h.update({ status: 'idle', messages: [h.human, h.answer] });
  h.run.resolve('success');
  await tick();
  h.saved();
  await pending;
  expect(h.app.getSnapshot().canSubmit).toBe(false);
});
it('cannot authorize a saved answer replaced during canonical row publication', async () => {
  const h = setup();
  const { pending } = await h.start();
  h.saved();
  let replaced = false;
  h.app.subscribe(() => {
    if (!replaced && h.app.getSnapshot().activity === 'confirming') {
      replaced = true;
      h.update({
        messages: [
          {
            ...h.human,
            delivery: {
              generation: h.human.id,
              phase: 'complete',
              outcome: 'success',
            },
          },
          {
            ...h.answer,
            content: 'CHANGED',
            delivery: {
              generation: h.answer.id,
              phase: 'complete',
              outcome: 'success',
            },
          },
        ],
      });
    }
  });
  await pending;
  expect(replaced).toBe(true);
  expect(h.app.getSnapshot().canSubmit).toBe(false);
});
it('retains a conflicting answer observed while entering confirmation despite a later clean load', async () => {
  const h = setup();
  let replaced = false;
  h.app.subscribe(() => {
    if (!replaced && h.app.getSnapshot().activity === 'confirming') {
      replaced = true;
      h.update({
        messages: [
          h.human,
          { ...h.answer, id: 'conflicting-confirmation-answer' },
        ],
      });
    }
  });
  const { pending } = await h.start();
  h.saved();
  await pending;
  expect(replaced).toBe(true);
  expect(h.app.getSnapshot().canSubmit).toBe(false);
});
it('Stop reentrantly during snapshot capture cannot restore continuation or rows', async () => {
  const h = setup();
  const { pending } = await h.start();
  const state = h.session.getSnapshot();
  let stopping: Promise<void> | undefined;
  vi.mocked(h.session.getSnapshot).mockImplementationOnce(() => {
    stopping = h.app.stop();
    return state;
  });
  h.saved();
  await pending;
  await stopping;
  expect(h.app.getSnapshot()).toMatchObject({
    canSubmit: false,
    outcome: 'aborted',
    busy: false,
  });
});

it('New is inert on mount and revokes a retained Send generation', async () => {
  const h = setup();
  const generation = h.app.getSnapshot().viewGeneration;
  const retainedSend = () => h.app.submit('Old view', generation);
  await h.app.newConversation();
  await retainedSend();
  expect(h.createThread).not.toHaveBeenCalled();
  expect(h.sessionFactory).not.toHaveBeenCalled();
});
it.each(['stop', 'newConversation', 'dispose'] as const)(
  '%s revokes a pending creation before a late response can call the factory',
  async (action) => {
    const h = setup();
    const pending = h.app.submit('Question');
    await tick();
    const revoked = h.app[action]();
    const before = h.app.getSnapshot();
    h.creation.resolve('late-thread');
    await Promise.all([pending, revoked]);
    expect(h.sessionFactory).not.toHaveBeenCalled();
    if (action !== 'newConversation')
      expect(h.app.getSnapshot().rows).toBe(before.rows);
  }
);
it('disposal owns an asynchronously returned late candidate and waits for its cleanup', async () => {
  const h = setup();
  const candidate = deferred<ThemingSession>(),
    cleanup = deferred<void>();
  h.sessionFactory.mockReturnValue(candidate.promise);
  vi.mocked(h.session.dispose).mockReturnValue(cleanup.promise);
  const pending = h.app.submit('Question');
  h.creation.resolve('thread');
  await tick();
  let settled = false;
  const disposal = h.app.dispose().then(() => {
    settled = true;
  });
  candidate.resolve(h.session);
  await tick();
  expect(h.session.submit).not.toHaveBeenCalled();
  expect(h.session.dispose).toHaveBeenCalledTimes(1);
  expect(settled).toBe(false);
  cleanup.resolve();
  await Promise.all([pending, disposal]);
  expect(settled).toBe(true);
});
it.each(['release', 'dispose', 'dispose-getter', 'stop-getter', 'stop'])(
  'retains lifetime revocation after %s fails even if another cleanup succeeds',
  async (kind) => {
    const h = setup();
    if (kind === 'release')
      vi.mocked(h.session.subscribe).mockReturnValue(() => {
        throw Error('PRIVATE release');
      });
    if (kind === 'dispose' || kind === 'stop')
      vi.mocked(h.session.dispose).mockRejectedValue(Error('PRIVATE dispose'));
    if (kind === 'stop')
      vi.mocked(h.session.stop).mockRejectedValue(Error('PRIVATE stop'));
    if (kind.endsWith('getter'))
      Object.defineProperty(
        h.session,
        kind === 'dispose-getter' ? 'dispose' : 'stop',
        {
          get() {
            throw Error('PRIVATE getter');
          },
        }
      );
    const pending = h.app.submit('Question');
    h.creation.resolve('thread');
    await tick();
    const replacement = h.app.newConversation();
    h.run.resolve('aborted');
    await Promise.all([pending, replacement]);
    await h.app.newConversation();
    await h.app.submit('Retry');
    expect(h.app.getSnapshot()).toMatchObject({
      canSubmit: false,
      activity: 'cleanup-failed',
    });
    expect(h.createThread).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(h.app.getSnapshot())).not.toContain('PRIVATE');
    await h.app.dispose();
  }
);
it('ordinary rejected admission with successful disposal can recover through New', async () => {
  const h = setup();
  vi.mocked(h.session.subscribe).mockImplementation(() => {
    throw Error('PRIVATE admission');
  });
  const pending = h.app.submit('Question');
  h.creation.resolve('thread');
  await pending;
  await h.app.newConversation();
  expect(h.session.dispose).toHaveBeenCalledTimes(1);
  expect(h.app.getSnapshot().canSubmit).toBe(true);
});
it.each(['snapshot', 'release'])(
  'cleans rejected %s admission immediately and permits New after successful cleanup',
  async (kind) => {
    const h = setup();
    if (kind === 'snapshot')
      vi.mocked(h.session.getSnapshot).mockImplementation(() => {
        throw Error('PRIVATE snapshot');
      });
    else vi.mocked(h.session.subscribe).mockReturnValue(undefined as never);
    const pending = h.app.submit('Question');
    h.creation.resolve('thread');
    await pending;
    expect(h.session.dispose).toHaveBeenCalledTimes(1);
    expect(h.session.submit).not.toHaveBeenCalled();
    await h.app.newConversation();
    expect(h.app.getSnapshot().canSubmit).toBe(true);
    await h.app.dispose();
  }
);
it('registers held cleanup before a reentrant observer disposes during New', async () => {
  const h = setup(),
    cleanup = deferred<void>();
  vi.mocked(h.session.dispose).mockReturnValue(cleanup.promise);
  const pending = h.app.submit('Question');
  h.creation.resolve('thread');
  await tick();
  let disposal: Promise<void> | undefined,
    settled = false;
  h.app.subscribe(() => {
    if (h.app.getSnapshot().activity === 'replacing')
      disposal = h.app.dispose().then(() => {
        settled = true;
      });
    throw Error('observer');
  });
  const replacement = h.app.newConversation();
  await tick();
  expect(disposal).toBeDefined();
  expect(h.session.dispose).toHaveBeenCalledTimes(1);
  expect(settled).toBe(false);
  cleanup.resolve();
  h.run.resolve('aborted');
  await Promise.all([replacement, pending, disposal]);
});
it('revokes before release can synchronously reenter Send or publish a stale callback', async () => {
  const h = setup();
  let callback: () => void = () => undefined;
  vi.mocked(h.session.subscribe).mockImplementation((notify) => {
    callback = notify;
    return () => {
      callback();
      void h.app.submit('Reentrant');
    };
  });
  const pending = h.app.submit('Question');
  h.creation.resolve('thread');
  await tick();
  await h.app.stop();
  const before = h.app.getSnapshot();
  callback();
  h.run.resolve('success');
  await pending;
  expect(h.app.getSnapshot()).toBe(before);
  expect(h.session.submit).toHaveBeenCalledTimes(1);
});
it.each(['duplicate', 'reordered', 'changed-prefix', 'changed-delivery'])(
  'rejects %s messages after a confirmed turn',
  async (kind) => {
    const h = setup();
    const { pending } = await h.start();
    h.saved();
    await pending;
    const saved = h.session.getSnapshot().messages;
    h.update({
      messages:
        kind === 'duplicate'
          ? [saved[0], saved[0]]
          : kind === 'reordered'
          ? [saved[1], saved[0]]
          : kind === 'changed-delivery'
          ? [
              {
                ...saved[0],
                delivery: { ...saved[0].delivery, generation: 'changed' },
              },
              saved[1],
            ]
          : [{ ...saved[0], content: 'changed' }, saved[1]],
    });
    await h.app.submit('Next');
    expect(h.app.getSnapshot().canSubmit).toBe(false);
    expect(h.session.submit).toHaveBeenCalledTimes(1);
  }
);
