import { expect, it, vi } from 'vitest';
import type { Message, CompleteOutcome } from '@threadplane/core';
import { createMessagesApplication, type MessagesSession } from './application';

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
  let state: ReturnType<MessagesSession['getSnapshot']> = {
    status: 'idle',
    messages: [],
    toolCalls: [],
    interrupts: [],
    subgraphs: [],
    history: undefined,
  };
  const observers = new Set<() => void>();
  const session: MessagesSession = {
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
  const app = createMessagesApplication({ createThread, sessionFactory });
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
      messages: messages.map((m) => ({
        ...m,
        delivery: { generation: m.id, phase: 'complete', outcome: 'success' },
      })),
      history: [{ next }],
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
    history: [{ next: [] }],
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
  h.update({ history: [{ next: [] }], messages: [h.human, h.answer] });
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
  vi.spyOn(h.session, 'getSnapshot').mockImplementationOnce(() => {
    void h.app.stop();
    return state;
  });
  h.saved();
  await pending;
  expect(h.app.getSnapshot()).toMatchObject({
    canSubmit: false,
    outcome: 'aborted',
    busy: false,
  });
});
