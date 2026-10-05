import { expect, it, vi } from 'vitest';

it('withdraws saved success when a later observed transcript is replaced', async () => {
  const h = setup();
  const { pending } = await h.start();
  h.saved();
  await pending;
  const state = h.session.getSnapshot();
  h.update({
    messages: state.messages.map((m) =>
      m.role === 'assistant' ? { ...m, content: 'Changed' } : m
    ),
  });
  expect(h.app.getSnapshot()).toMatchObject({
    canSubmit: false,
    outcome: 'error',
  });
  expect(h.app.getSnapshot().error).toBeTruthy();
});
it('keeps a foreign run generation during confirmation sticky after restoration', async () => {
  const h = setup();
  const { pending } = await h.start();
  h.update({
    messages: [
      h.human,
      {
        ...h.answer,
        delivery: {
          generation: 'foreign',
          phase: 'complete',
          outcome: 'success',
        },
      },
    ],
  });
  h.saved();
  await pending;
  expect(h.app.getSnapshot().canSubmit).toBe(false);
});
it.each(['stop', 'dispose', 'newConversation'] as const)(
  'bounds an unsettled session cleanup during %s',
  async (action) => {
    vi.useFakeTimers();
    try {
      const h = setup();
      const { pending } = await h.start();
      if (action === 'newConversation') {
        h.saved();
        await pending;
      }
      const cleanup = deferred<void>();
      vi.mocked(h.session.dispose).mockReturnValue(cleanup.promise);
      vi.mocked(h.session.stop).mockReturnValue(cleanup.promise);
      const finishing = h.app[action]();
      await tick();
      if (action !== 'dispose') expect(h.app.getSnapshot().busy).toBe(true);
      await vi.advanceTimersByTimeAsync(2000);
      await finishing;
      if (action !== 'newConversation') {
        h.saved();
        await pending;
        expect(h.app.getSnapshot().canSubmit).toBe(false);
      } else
        expect(h.app.getSnapshot()).toMatchObject({
          busy: false,
          canSubmit: true,
          threadId: null,
        });
      expect(h.session.dispose).toHaveBeenCalledOnce();
      await h.app.dispose();
      cleanup.resolve();
    } finally {
      vi.useRealTimers();
    }
  }
);
import type { Message, CompleteOutcome } from '@threadplane/core';
import {
  createSubagentsApplication,
  type SubagentsSession,
} from './application';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function tick() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
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
  let state: ReturnType<SubagentsSession['getSnapshot']> = {
    status: 'idle',
    messages: [],
    toolCalls: [],
    interrupts: [],
    subgraphs: [],
    history: undefined,
  };
  const observers = new Set<() => void>();
  const session: SubagentsSession = {
    getSnapshot: () => state,
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
    sessionFactory = vi.fn(() => session);
  const app = createSubagentsApplication({ createThread, sessionFactory });
  function update(patch: Partial<typeof state>) {
    state = { ...state, ...patch };
    for (const observer of observers) observer();
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
      subgraphs: [],
      messages: messages.map((m) => ({
        ...m,
        delivery: { generation: m.id, phase: 'complete', outcome: 'success' },
      })),
      history: [
        {
          next,
          checkpoint: {
            thread_id: 'confirmed-thread',
            checkpoint_ns: '',
            checkpoint_id: 'saved',
          },
        },
      ],
    });
    load.resolve();
  }
  return {
    app,
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

it.each(['single', 'parallel', 'sequential'])(
  'confirms %s calls and exposes cards only on requesting assistants',
  async (kind) => {
    const h = setup();
    const pending = h.app.submit('Question');
    h.creation.resolve('confirmed-thread');
    await tick();
    const tools = (kind === 'single' ? ['LAX'] : ['LAX', 'JFK']).map((id) => ({
      id,
      name: 'task',
      args: { subagent_type: 'research', task_description: id },
      status: 'pending' as const,
    }));
    const callers =
      kind === 'sequential'
        ? tools.map((tool) => ({
            ...message(`call-${tool.id}`, 'assistant', ''),
            toolCallIds: [tool.id],
          }))
        : [
            {
              ...message('calls', 'assistant', ''),
              toolCallIds: tools.map((tool) => tool.id),
            },
          ];
    h.update({ status: 'running', messages: [h.human] });
    h.update({
      messages: [h.human, callers[0]],
      toolCalls: kind === 'sequential' ? tools.slice(0, 1) : tools,
    });
    expect(h.app.getSnapshot().observations.get(callers[0].id)?.length).toBe(
      kind === 'parallel' ? 2 : 1
    );
    const results = tools.map((tool) => ({
      ...message(`result-${tool.id}`, 'tool', tool.id),
      name: tool.name,
      toolCallId: tool.id,
    }));
    const messages =
      kind === 'sequential'
        ? [h.human, callers[0], results[0], callers[1], results[1], h.answer]
        : [h.human, callers[0], ...results.reverse(), h.answer];
    const completed = tools.map((tool) => ({
      ...tool,
      status: 'complete' as const,
      result: tool.id,
    }));
    h.update({ status: 'idle', messages, toolCalls: completed });
    h.run.resolve('success');
    await tick();
    expect(h.session.load).toHaveBeenCalledOnce();
    expect(h.app.getSnapshot().canSubmit).toBe(false);
    h.saved(messages);
    await pending;
    expect(h.app.getSnapshot().canSubmit).toBe(true);
    expect([...h.app.getSnapshot().observations.keys()]).toEqual(
      callers.map((caller) => caller.id)
    );
    await h.app.dispose();
  }
);
it.each(['args', 'name', 'result', 'missing', 'invalid'])(
  'keeps observed tool conflict %s sticky after a later clean restore',
  async (mode) => {
    const h = setup();
    const pending = h.app.submit('Question');
    h.creation.resolve('confirmed-thread');
    await tick();
    const caller = {
      ...message('caller', 'assistant', ''),
      toolCallIds: ['lookup'],
    };
    const tool = {
      id: 'lookup',
      name: 'task',
      args: { subagent_type: 'research', task_description: 'Plan UA123' },
      status: 'complete' as const,
      result: 'UA123',
    };
    const result = {
      ...message('result', 'tool', 'UA123'),
      name: tool.name,
      toolCallId: tool.id,
    };
    const messages = [h.human, caller, result, h.answer];
    h.update({ status: 'running', messages: [h.human] });
    h.update({ messages, toolCalls: [tool] });
    const changed =
      mode === 'args'
        ? {
            ...tool,
            args: { subagent_type: 'research', task_description: 'Plan AA404' },
          }
        : mode === 'invalid'
        ? {
            ...tool,
            args: { subagent_type: 'research', task_description: 123 },
          }
        : mode === 'name'
        ? { ...tool, name: 'get_airport_info' }
        : { ...tool, result: 'Changed' };
    h.update({ toolCalls: mode === 'missing' ? [] : [changed] });
    h.update({ status: 'idle', messages, toolCalls: [tool] });
    h.run.resolve('success');
    await tick();
    h.saved(messages);
    await pending;
    expect(h.app.getSnapshot().canSubmit).toBe(false);
    expect(h.session.load).not.toHaveBeenCalled();
  }
);

it('holds local replacement until disposal settles, blocks competing work, and changes the view once', async () => {
  const h = setup();
  const { pending } = await h.start();
  h.saved();
  await pending;
  const cleanup = deferred<void>();
  vi.mocked(h.session.dispose).mockReturnValue(cleanup.promise);
  const replacement = h.app.newConversation();
  expect(h.app.getSnapshot()).toMatchObject({
    busy: true,
    canSubmit: false,
    activity: 'replacing',
    viewGeneration: 0,
  });
  await h.app.newConversation();
  await h.app.submit('Competing draft');
  await tick();
  expect(h.session.dispose).toHaveBeenCalledOnce();
  expect(h.session.submit).toHaveBeenCalledOnce();
  expect(h.createThread).toHaveBeenCalledOnce();
  cleanup.resolve();
  await replacement;
  expect(h.app.getSnapshot()).toMatchObject({
    busy: false,
    canSubmit: true,
    activity: 'idle',
    viewGeneration: 1,
    threadId: null,
    rows: [],
  });
  expect(h.sessionFactory).toHaveBeenCalledOnce();
  await h.app.dispose();
});

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
  await h.app.stop();
  h.creation.resolve('late');
  await pending;
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
  const run = deferred<CompleteOutcome>(),
    load = deferred<void>();
  vi.mocked(h.session.submit).mockImplementationOnce(() => run.promise);
  vi.mocked(h.session.load).mockImplementationOnce(() => load.promise);
  const second = h.app.submit('Next');
  const human = message('human-2', 'user', 'Next', 'second'),
    answer = message('answer-2', 'assistant', 'Second answer', 'second');
  h.update({ status: 'running', messages: [h.human, h.answer, human] });
  h.update({ status: 'idle', messages: [h.human, h.answer, human, answer] });
  run.resolve('success');
  await tick();
  expect(h.session.load).toHaveBeenCalledTimes(2);
  expect(h.app.getSnapshot().canSubmit).toBe(false);
  h.update({
    messages: [h.human, h.answer, human, answer].map((m) => ({
      ...m,
      delivery: { generation: m.id, phase: 'complete', outcome: 'success' },
    })),
    history: [
      {
        next: [],
        checkpoint: {
          thread_id: 'confirmed-thread',
          checkpoint_ns: '',
          checkpoint_id: 'saved',
        },
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
        checkpoint: {
          thread_id: 'confirmed-thread',
          checkpoint_ns: '',
          checkpoint_id: 'saved',
        },
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
  h.creation.resolve('confirmed-thread');
  await tick();
  h.update({
    status: 'running',
    messages: [
      h.human,
      {
        ...h.answer,
        toolCallId: '',
        delivery: { generation: 'live', phase: 'streaming' },
      },
    ],
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

it('keeps a failed delivery during confirmation sticky across a healthy saved restore', async () => {
  const h = setup();
  const { pending } = await h.start();
  h.update({
    messages: [
      h.human,
      {
        ...h.answer,
        delivery: { generation: 'live', phase: 'complete', outcome: 'error' },
      },
    ],
  });
  h.saved();
  await pending;
  expect(h.app.getSnapshot().canSubmit).toBe(false);
});
it('Stop reentrantly during snapshot capture cannot restore continuation or rows', async () => {
  const h = setup();
  const { pending } = await h.start();
  const state = h.session.getSnapshot();
  let stopping: Promise<void> | undefined;
  vi.spyOn(h.session, 'getSnapshot').mockImplementationOnce(() => {
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

const childState = (
  namespace = 'child-namespace',
  content = 'Research suggestion',
  generation = 'live'
) => ({
  namespace: [namespace],
  values: { subagent_type: 'research', task_description: 'Plan' },
  interrupts: [],
  messages: [message('child-answer', 'assistant', content, generation)],
});
it('does not publish confirmation after Stop reenters final child capture', async () => {
  const h = setup();
  const pending = h.app.submit('Question');
  h.creation.resolve('confirmed-thread');
  await tick();
  const cleanup = deferred<void>();
  vi.mocked(h.session.dispose).mockReturnValue(cleanup.promise);
  let armed = false,
    captures = 0,
    stopping: Promise<void> | undefined;
  const child = new Proxy(childState(), {
    getPrototypeOf(target) {
      // The two guarded read captures precede the independent terminal child capture.
      if (armed && ++captures === 3) stopping = h.app.stop();
      return Reflect.getPrototypeOf(target);
    },
  });
  h.update({ status: 'running', messages: [h.human], subgraphs: [child] });
  h.update({ status: 'idle', messages: [h.human, h.answer] });
  armed = true;
  h.run.resolve('success');
  await tick();
  try {
    expect(stopping).toBeDefined();
    expect(h.app.getSnapshot()).toMatchObject({
      activity: 'replacing',
      outcome: 'aborted',
      canSubmit: false,
    });
    expect(h.session.load).not.toHaveBeenCalled();
  } finally {
    cleanup.resolve();
    await stopping;
    await pending;
    await h.app.dispose();
  }
});
it('retains local child text when canonical load clears child snapshots and New clears it locally', async () => {
  const h = setup();
  const pending = h.app.submit('Question');
  h.creation.resolve('confirmed-thread');
  await tick();
  h.update({
    status: 'running',
    messages: [h.human],
    subgraphs: [childState()],
  });
  expect(h.app.getSnapshot().childObservations).toMatchObject([
    { role: 'research', text: 'Research suggestion', status: 'Receiving' },
  ]);
  h.update({ status: 'idle', messages: [h.human, h.answer] });
  h.run.resolve('success');
  await tick();
  expect(h.session.load).toHaveBeenCalledOnce();
  h.saved();
  await pending;
  expect(h.app.getSnapshot().canSubmit).toBe(true);
  expect(h.app.getSnapshot().childObservations).toMatchObject([
    { text: 'Research suggestion', status: 'Observed response' },
  ]);
  expect(h.app.getSnapshot().rows.map((row) => row.id)).not.toContain(
    'child-answer'
  );
  await h.app.newConversation();
  expect(h.app.getSnapshot().childObservations).toEqual([]);
  expect(h.createThread).toHaveBeenCalledOnce();
});
it('retains separate local observations across a same-thread followup', async () => {
  const h = setup();
  const pending = h.app.submit('Question');
  h.creation.resolve('confirmed-thread');
  await tick();
  h.update({
    status: 'running',
    messages: [h.human],
    subgraphs: [childState()],
  });
  h.update({ status: 'idle', messages: [h.human, h.answer] });
  h.run.resolve('success');
  await tick();
  h.saved();
  await pending;
  const prior = h.session.getSnapshot().messages;
  const run = deferred<CompleteOutcome>(),
    load = deferred<void>();
  vi.mocked(h.session.submit).mockReturnValueOnce(run.promise);
  vi.mocked(h.session.load).mockReturnValueOnce(load.promise);
  const second = h.app.submit('Next');
  const human = message('human2', 'user', 'Next', 'run2'),
    answer = message('answer2', 'assistant', 'Next answer', 'run2');
  h.update({
    status: 'running',
    messages: [...prior, human],
    subgraphs: [childState('child-namespace', 'Second suggestion', 'run2')],
  });
  h.update({ status: 'idle', messages: [...prior, human, answer] });
  run.resolve('success');
  await tick();
  h.saved([...prior, human, answer]);
  load.resolve();
  await second;
  expect(h.app.getSnapshot().canSubmit).toBe(true);
  expect(h.app.getSnapshot().childObservations.map((row) => row.text)).toEqual([
    'Research suggestion',
    'Second suggestion',
  ]);
  expect(
    new Set(h.app.getSnapshot().childObservations.map((row) => row.key)).size
  ).toBe(2);
  expect(h.createThread).toHaveBeenCalledOnce();
});
it.each(['changed', 'late-after-clear', 'unfinished', 'error', 'foreign'])(
  'keeps unsafe child %s evidence sticky after canonical clearing',
  async (mode) => {
    const h = setup();
    const pending = h.app.submit('Question');
    h.creation.resolve('confirmed-thread');
    await tick();
    h.update({
      status: 'running',
      messages: [h.human],
      subgraphs: [childState()],
    });
    if (mode === 'changed')
      h.update({ subgraphs: [childState('child-namespace', 'Changed')] });
    if (mode === 'unfinished') {
      const a = childState();
      a.messages[0] = {
        ...a.messages[0],
        delivery: { generation: 'live', phase: 'streaming' },
      };
      h.update({ subgraphs: [a] });
    }
    if (mode === 'error')
      h.update({
        subgraphs: [{ ...childState(), error: { message: 'PRIVATE' } }],
      });
    if (mode === 'foreign')
      h.update({
        subgraphs: [
          childState('child-namespace', 'Research suggestion', 'foreign'),
        ],
      });
    h.update({ status: 'idle', messages: [h.human, h.answer] });
    h.run.resolve('success');
    await tick();
    if (mode === 'late-after-clear') {
      h.update({ subgraphs: [] });
      h.update({ subgraphs: [childState('late')] });
    }
    h.saved();
    await pending;
    expect(h.app.getSnapshot().canSubmit).toBe(false);
    expect(JSON.stringify(h.app.getSnapshot())).not.toContain('PRIVATE');
    expect(
      h.app
        .getSnapshot()
        .childObservations.every((row) => row.status === 'Incomplete')
    ).toBe(true);
  }
);
it('valid completed empty child permits root confirmation with no invented observation', async () => {
  const h = setup();
  const pending = h.app.submit('Question');
  h.creation.resolve('confirmed-thread');
  await tick();
  h.update({
    status: 'running',
    messages: [h.human],
    subgraphs: [childState('empty', '')],
  });
  h.update({ status: 'idle', messages: [h.human, h.answer] });
  h.run.resolve('success');
  await tick();
  h.saved();
  await pending;
  expect(h.app.getSnapshot().canSubmit).toBe(true);
  expect(h.app.getSnapshot().childObservations).toEqual([]);
});
it('Stop preserves partial child text as stopped and ignores a fulfilled late load', async () => {
  const h = setup();
  const pending = h.app.submit('Question');
  h.creation.resolve('confirmed-thread');
  await tick();
  h.update({
    status: 'running',
    messages: [h.human],
    subgraphs: [childState()],
  });
  h.update({ status: 'idle', messages: [h.human, h.answer] });
  h.run.resolve('success');
  await tick();
  await h.app.stop();
  const stopped = h.app.getSnapshot();
  h.saved();
  await pending;
  expect(h.app.getSnapshot()).toBe(stopped);
  expect(stopped.childObservations).toMatchObject([
    { status: 'Stopped', text: 'Research suggestion' },
  ]);
});
it('does not publish confirmation after Stop reenters final root capture', async () => {
  const h = setup();
  const pending = h.app.submit('Question');
  h.creation.resolve('confirmed-thread');
  await tick();
  const cleanup = deferred<void>();
  vi.mocked(h.session.dispose).mockReturnValue(cleanup.promise);
  let armed = false,
    captures = 0,
    stopping: Promise<void> | undefined;
  const answer = new Proxy(h.answer, {
    getPrototypeOf(target) {
      if (armed && ++captures === 3) stopping = h.app.stop();
      return Reflect.getPrototypeOf(target);
    },
  });
  h.update({ status: 'running', messages: [h.human] });
  h.update({ status: 'idle', messages: [h.human, answer] });
  armed = true;
  h.run.resolve('success');
  await tick();
  try {
    expect(stopping).toBeDefined();
    expect(h.app.getSnapshot()).toMatchObject({
      activity: 'replacing',
      outcome: 'aborted',
      canSubmit: false,
    });
    expect(h.session.load).not.toHaveBeenCalled();
  } finally {
    cleanup.resolve();
    await stopping;
    await pending;
    await h.app.dispose();
  }
});
