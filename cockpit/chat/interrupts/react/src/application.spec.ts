import { expect, it, vi } from 'vitest';
import type { CompleteOutcome, Message } from '@threadplane/core';
import {
  createInterruptsApplication,
  type InterruptsSession,
} from './application';
import type { InterruptsState } from './authority';

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Expected test evidence');
  return value;
}

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}
async function tick() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}
const message = (
  id: string,
  role: Message['role'],
  content: string,
  outcome: 'success' | 'paused' = 'success'
): Message => ({
  id,
  role,
  content,
  delivery: { generation: 'live', phase: 'complete', outcome },
});
function setup() {
  const creation = deferred<string>();
  let run = deferred<CompleteOutcome>(),
    load = deferred<void>();
  let state: InterruptsState = {
    status: 'idle',
    messages: [],
    toolCalls: [],
    interrupts: [],
    subgraphs: [],
    history: undefined,
  };
  const observers = new Set<() => void>();
  const session: InterruptsSession = {
    getSnapshot: () => state,
    subscribe: vi.fn((notify) => {
      observers.add(notify);
      return () => observers.delete(notify);
    }),
    submit: vi.fn(() => run.promise),
    resume: vi.fn(() => run.promise),
    load: vi.fn(() => load.promise),
    stop: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  };
  const createThread = vi.fn(() => creation.promise),
    sessionFactory = vi.fn(() => session);
  const app = createInterruptsApplication({ createThread, sessionFactory });
  const human = message('human', 'user', 'Book UA123.');
  const calling = {
    ...message('calling', 'assistant', '', 'paused'),
    toolCallIds: ['booking'],
  };
  const tool = {
    id: 'booking',
    name: 'book_flight',
    args: { flight_number: 'UA123' },
    status: 'pending' as const,
  };
  const interrupts = [
    {
      id: 'approval',
      value: {
        type: 'approval_request',
        summary: 'Demo booking',
        flight: {
          flight_number: 'UA123',
          airline: 'UA',
          from: 'LAX',
          to: 'JFK',
          depart_local: '08:00',
          aircraft: 'Boeing 787',
        },
      },
    },
  ];
  function update(patch: Partial<InterruptsState>) {
    state = { ...state, ...patch };
    for (const notify of observers) notify();
  }
  function canonical(next: string[], checkpoint = 'pause') {
    update({
      messages: state.messages.map((m) => ({
        ...m,
        delivery: {
          generation: m.id,
          phase: 'complete',
          outcome: next.length && m.id === 'calling' ? 'paused' : 'success',
        },
      })),
      history: [
        {
          checkpoint: {
            thread_id: 'thread',
            checkpoint_ns: '',
            checkpoint_id: checkpoint,
          },
          next,
        },
      ],
    });
    load.resolve();
  }
  async function start() {
    const pending = app.submit('Book UA123.');
    creation.resolve('thread');
    await tick();
    update({ status: 'running', messages: [human] });
    update({
      status: 'idle',
      messages: [human, calling],
      toolCalls: [tool],
      interrupts,
    });
    run.resolve('paused');
    await tick();
    return { pending };
  }
  async function pause() {
    const { pending } = await start();
    canonical(['tools']);
    await pending;
  }
  function nextOperation() {
    run = deferred<CompleteOutcome>();
    load = deferred<void>();
    return { run, load };
  }
  function result() {
    update({
      status: 'idle',
      messages: [
        ...state.messages,
        {
          ...message('result', 'tool', 'Booked UA123.'),
          name: 'book_flight',
          toolCallId: 'booking',
        },
        message('answer', 'assistant', 'Booked UA123.'),
      ],
      toolCalls: [{ ...tool, status: 'complete', result: 'Booked UA123.' }],
      interrupts: [],
    });
    run.resolve('success');
  }
  return {
    app,
    session,
    createThread,
    sessionFactory,
    creation,
    start,
    pause,
    update,
    canonical,
    nextOperation,
    result,
    human,
    calling,
    tool,
    interrupts,
    get run() {
      return run;
    },
    get load() {
      return load;
    },
  };
}
it('does no remote work before a nonblank submitted message', async () => {
  const h = setup();
  await h.app.submit(' ');
  await h.app.dispose();
  expect(h.createThread).not.toHaveBeenCalled();
  expect(h.sessionFactory).not.toHaveBeenCalled();
});
it('waits for saved pause confirmation before publishing one immutable decision', async () => {
  const h = setup(),
    { pending } = await h.start();
  expect(h.session.load).toHaveBeenCalledOnce();
  expect(h.app.getSnapshot()).toMatchObject({
    busy: true,
    activity: 'confirming',
    decision: null,
    canSubmit: false,
  });
  await h.app.submit('Duplicate');
  h.canonical(['tools']);
  await pending;
  expect(h.app.getSnapshot()).toMatchObject({
    busy: false,
    canSubmit: false,
    outcome: 'paused',
    decision: { approval: { summary: 'Demo booking' } },
  });
  expect(h.createThread).toHaveBeenCalledOnce();
  expect(h.session.submit).toHaveBeenCalledOnce();
  await h.app.dispose();
});
it.each(['confirm', 'cancel'] as const)(
  'sends only scalar %s once and waits for canonical terminal state',
  async (value) => {
    const h = setup();
    await h.pause();
    const decision = required(h.app.getSnapshot().decision);
    h.nextOperation();
    const pending = h.app.decide(decision, value);
    await h.app.decide(decision, value);
    await h.app.submit('Forbidden while paused');
    expect(h.session.resume).toHaveBeenCalledTimes(1);
    expect(h.session.resume).toHaveBeenCalledWith(
      value,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    h.result();
    await tick();
    expect(h.app.getSnapshot()).toMatchObject({
      busy: true,
      canSubmit: false,
      decision: null,
    });
    h.canonical([], 'terminal');
    await pending;
    expect(h.app.getSnapshot()).toMatchObject({
      busy: false,
      canSubmit: true,
      outcome: 'success',
      decision: null,
    });
    expect(h.session.load).toHaveBeenCalledTimes(2);
    expect(h.createThread).toHaveBeenCalledOnce();
    await h.app.dispose();
  }
);
it.each(['checkpoint', 'batch', 'payload'] as const)(
  'rejects observed %s replacement before a captured decision',
  async (kind) => {
    const h = setup();
    await h.pause();
    const decision = required(h.app.getSnapshot().decision);
    if (kind === 'checkpoint')
      h.update({
        history: [
          {
            checkpoint: {
              thread_id: 'thread',
              checkpoint_ns: '',
              checkpoint_id: 'other',
            },
            next: ['tools'],
          },
        ],
      });
    if (kind === 'batch') h.update({ interrupts: [...h.interrupts] });
    if (kind === 'payload')
      h.update({ messages: [h.human, { ...h.calling, content: 'Different' }] });
    await h.app.decide(decision, 'confirm');
    expect(h.session.resume).not.toHaveBeenCalled();
    expect(h.app.getSnapshot().canSubmit).toBe(false);
    await h.app.dispose();
  }
);
it('rechecks authority after admission subscribers change the checkpoint', async () => {
  const h = setup();
  await h.pause();
  const decision = required(h.app.getSnapshot().decision);
  const release = h.app.subscribe(() => {
    if (h.app.getSnapshot().busy) {
      release();
      h.update({
        history: [
          {
            checkpoint: {
              thread_id: 'thread',
              checkpoint_ns: '',
              checkpoint_id: 'changed',
            },
            next: ['tools'],
          },
        ],
      });
    }
  });
  await h.app.decide(decision, 'confirm');
  expect(h.session.resume).not.toHaveBeenCalled();
  await h.app.dispose();
});
it.each([
  'missing',
  'changed',
  'foreign',
  'unsupported',
  'ambiguous',
  'failed',
] as const)('blocks %s saved evidence with no retry', async (kind) => {
  const h = setup(),
    { pending } = await h.start();
  if (kind === 'failed') h.load.reject(new Error('PRIVATE backend error'));
  else {
    if (kind === 'missing') h.update({ messages: [h.human] });
    if (kind === 'changed')
      h.update({ messages: [h.human, { ...h.calling, content: 'Changed' }] });
    if (kind === 'unsupported')
      h.update({ interrupts: [{ id: 'approval', value: { type: 'other' } }] });
    if (kind === 'ambiguous')
      h.update({ toolCalls: [h.tool, { ...h.tool, id: 'second' }] });
    h.canonical(['tools']);
    if (kind === 'foreign')
      h.update({
        history: [
          {
            checkpoint: {
              thread_id: 'foreign',
              checkpoint_ns: '',
              checkpoint_id: 'pause',
            },
            next: ['tools'],
          },
        ],
      });
  }
  await pending;
  await h.app.submit('Replay');
  expect(h.app.getSnapshot()).toMatchObject({
    canSubmit: false,
    decision: null,
  });
  expect(h.session.submit).toHaveBeenCalledOnce();
  expect(JSON.stringify(h.app.getSnapshot())).not.toContain('PRIVATE');
  await h.app.dispose();
});
it.each(['stop', 'dispose'] as const)(
  'fences late saved pause after %s',
  async (action) => {
    const h = setup(),
      { pending } = await h.start();
    await h.app[action]();
    const before = h.app.getSnapshot();
    h.canonical(['tools']);
    await pending;
    expect(h.app.getSnapshot()).toBe(before);
    expect(h.session.dispose).toHaveBeenCalledOnce();
  }
);
it('quarantines failed creation and resets locally without eager creation', async () => {
  const h = setup(),
    pending = h.app.submit('Book UA123.');
  h.creation.reject(new Error('PRIVATE'));
  await pending;
  await h.app.submit('Replay');
  expect(h.createThread).toHaveBeenCalledOnce();
  await h.app.newConversation();
  expect(h.app.getSnapshot()).toMatchObject({
    canSubmit: true,
    threadId: null,
    decision: null,
  });
  expect(h.createThread).toHaveBeenCalledOnce();
  await h.app.dispose();
});
it('rejects an old decision after New and holds competing work through cleanup', async () => {
  const h = setup();
  await h.pause();
  const decision = required(h.app.getSnapshot().decision);
  const cleanup = deferred<void>();
  vi.mocked(h.session.dispose).mockReturnValue(cleanup.promise);
  const replacement = h.app.newConversation();
  await tick();
  await h.app.newConversation();
  await h.app.submit('Competing');
  await h.app.decide(decision, 'confirm');
  expect(h.app.getSnapshot()).toMatchObject({
    busy: true,
    activity: 'replacing',
    decision: null,
  });
  expect(h.createThread).toHaveBeenCalledOnce();
  cleanup.resolve();
  await replacement;
  expect(h.app.getSnapshot()).toMatchObject({
    busy: false,
    canSubmit: true,
    viewGeneration: 1,
  });
  expect(h.session.resume).not.toHaveBeenCalled();
  await h.app.dispose();
});
it('keeps unsafe child evidence sticky after it disappears', async () => {
  const h = setup(),
    pending = h.app.submit('Book UA123.');
  h.creation.resolve('thread');
  await tick();
  h.update({ status: 'running', messages: [h.human], subgraphs: [{}] });
  h.update({
    status: 'idle',
    messages: [h.human, h.calling],
    toolCalls: [h.tool],
    interrupts: h.interrupts,
    subgraphs: [],
  });
  h.run.resolve('paused');
  await pending;
  expect(h.session.load).not.toHaveBeenCalled();
  expect(h.app.getSnapshot().decision).toBeNull();
  await h.app.dispose();
});
it('does not mistake an unowned successful outcome for a submitted turn', async () => {
  const h = setup(),
    pending = h.app.submit('Book UA123.');
  h.creation.resolve('thread');
  await tick();
  h.run.resolve('success');
  await pending;
  expect(h.session.load).not.toHaveBeenCalled();
  expect(h.app.getSnapshot().canSubmit).toBe(false);
  await h.app.dispose();
});
it('saves a direct answer and continues on the same thread with a fresh turn', async () => {
  const h = setup(),
    first = h.app.submit('Question');
  h.creation.resolve('thread');
  await tick();
  h.update({
    messages: [
      message('u1', 'user', 'Question'),
      message('a1', 'assistant', 'Answer'),
    ],
  });
  h.run.resolve('success');
  await tick();
  h.canonical([], 'first');
  await first;
  expect(h.app.getSnapshot().canSubmit).toBe(true);
  const previous = h.session.getSnapshot().messages;
  h.nextOperation();
  const second = h.app.submit('Next');
  const next = [
    message('u2', 'user', 'Next'),
    message('a2', 'assistant', 'Next answer'),
  ].map((m) => ({ ...m, delivery: { ...m.delivery, generation: 'second' } }));
  h.update({ messages: [...previous, ...next] });
  h.run.resolve('success');
  await tick();
  h.canonical([], 'second');
  await second;
  expect(h.app.getSnapshot().canSubmit).toBe(true);
  expect(h.createThread).toHaveBeenCalledOnce();
  expect(h.session.submit).toHaveBeenCalledTimes(2);
  await h.app.dispose();
});
it('requires a fresh authority for a second pause and rejects the earlier captured decision', async () => {
  const h = setup();
  await h.pause();
  const old = required(h.app.getSnapshot().decision);
  h.nextOperation();
  const resumed = h.app.decide(old, 'confirm');
  h.result();
  await tick();
  h.canonical([], 'terminal');
  await resumed;
  const previous = h.session.getSnapshot();
  h.nextOperation();
  const next = h.app.submit('Book again');
  h.update({
    messages: [
      ...previous.messages,
      {
        ...message('human-2', 'user', 'Book again'),
        delivery: {
          generation: 'second',
          phase: 'complete',
          outcome: 'success',
        },
      },
      {
        ...message('calling-2', 'assistant', '', 'paused'),
        toolCallIds: ['booking-2'],
        delivery: {
          generation: 'second',
          phase: 'complete',
          outcome: 'paused',
        },
      },
    ],
    toolCalls: [...previous.toolCalls, { ...h.tool, id: 'booking-2' }],
    interrupts: [{ ...h.interrupts[0], id: 'approval-2' }],
  });
  h.run.resolve('paused');
  await tick();
  h.update({
    messages: h.session.getSnapshot().messages.map((m) => ({
      ...m,
      delivery: {
        generation: m.id,
        phase: 'complete',
        outcome: m.id === 'calling-2' ? 'paused' : 'success',
      },
    })),
    history: [
      {
        checkpoint: {
          thread_id: 'thread',
          checkpoint_ns: '',
          checkpoint_id: 'second-pause',
        },
        next: ['tools'],
      },
    ],
  });
  h.load.resolve();
  await next;
  expect(h.app.getSnapshot().decision?.checkpoint).not.toBe(old.checkpoint);
  expect(h.app.getSnapshot().decision).not.toBeNull();
  await h.app.decide(old, 'cancel');
  expect(h.session.resume).toHaveBeenCalledOnce();
  await h.app.dispose();
});
it('retains changed saved booking arguments observed during resume even when later restored', async () => {
  const h = setup();
  await h.pause();
  const decision = required(h.app.getSnapshot().decision);
  h.nextOperation();
  const pending = h.app.decide(decision, 'confirm');
  h.update({ toolCalls: [{ ...h.tool, args: { flight_number: 'AA404' } }] });
  h.update({ toolCalls: [h.tool] });
  h.result();
  await tick();
  h.canonical([], 'terminal');
  await pending;
  expect(h.app.getSnapshot().canSubmit).toBe(false);
  expect(h.session.load).toHaveBeenCalledOnce();
  await h.app.dispose();
});
it('never replays a failed resume and accepts no freeform scalar', async () => {
  const h = setup();
  await h.pause();
  const decision = required(h.app.getSnapshot().decision);
  await h.app.decide(decision, 'untrusted' as never);
  expect(h.session.resume).not.toHaveBeenCalled();
  h.nextOperation();
  const pending = h.app.decide(decision, 'cancel');
  h.run.reject(new Error('PRIVATE'));
  await pending;
  await h.app.decide(decision, 'cancel');
  expect(h.session.resume).toHaveBeenCalledOnce();
  expect(h.app.getSnapshot().decision).toBeNull();
  expect(h.app.getSnapshot().canSubmit).toBe(false);
  await h.app.dispose();
});
it('fences a late resumed result after Stop and releases the session only once', async () => {
  const h = setup();
  await h.pause();
  h.nextOperation();
  const pending = h.app.decide(
    required(h.app.getSnapshot().decision),
    'confirm'
  );
  await h.app.stop();
  await h.app.stop();
  const stopped = h.app.getSnapshot();
  h.result();
  await pending;
  expect(h.app.getSnapshot()).toBe(stopped);
  expect(h.session.stop).toHaveBeenCalledOnce();
  expect(h.session.dispose).toHaveBeenCalledOnce();
  expect(h.session.load).toHaveBeenCalledOnce();
  await h.app.dispose();
});
it.each(['stop', 'dispose'] as const)(
  'cannot restore decision authority when %s occurs during checkpoint capture',
  async (action) => {
    const h = setup(),
      { pending } = await h.start();
    h.canonical(['tools']);
    let entered = false;
    const checkpoint = new Proxy(
      { thread_id: 'thread', checkpoint_ns: '', checkpoint_id: 'pause' },
      {
        getPrototypeOf(target) {
          if (!entered) {
            entered = true;
            void h.app[action]();
          }
          return Object.getPrototypeOf(target);
        },
      }
    );
    h.update({ history: [{ checkpoint, next: ['tools'] }] });
    await pending;
    await tick();
    expect(entered).toBe(true);
    expect(h.app.getSnapshot().canSubmit).toBe(false);
    expect(h.app.getSnapshot().decision).toBeNull();
    expect(h.session.dispose).toHaveBeenCalledOnce();
  }
);
it('cannot grant success when Stop occurs during terminal checkpoint capture', async () => {
  const h = setup();
  await h.pause();
  h.nextOperation();
  const pending = h.app.decide(
    required(h.app.getSnapshot().decision),
    'confirm'
  );
  h.result();
  await tick();
  h.canonical([], 'terminal');
  let entered = false;
  h.update({
    history: [
      {
        checkpoint: new Proxy(
          { thread_id: 'thread', checkpoint_ns: '', checkpoint_id: 'terminal' },
          {
            getPrototypeOf(target) {
              if (!entered) {
                entered = true;
                void h.app.stop();
              }
              return Object.getPrototypeOf(target);
            },
          }
        ),
        next: [],
      },
    ],
  });
  await pending;
  await tick();
  expect(entered).toBe(true);
  expect(h.app.getSnapshot()).toMatchObject({
    canSubmit: false,
    outcome: 'aborted',
    decision: null,
  });
});
it('rejects another run generation attached to an admitted answer', async () => {
  const h = setup(),
    pending = h.app.submit('Question');
  h.creation.resolve('thread');
  await tick();
  h.update({
    messages: [
      message('u', 'user', 'Question'),
      {
        ...message('a', 'assistant', 'Answer'),
        delivery: {
          generation: 'foreign-run',
          phase: 'complete',
          outcome: 'success',
        },
      },
    ],
  });
  h.run.resolve('success');
  await tick();
  h.canonical([], 'terminal');
  await pending;
  expect(h.app.getSnapshot().canSubmit).toBe(false);
  expect(h.session.load).not.toHaveBeenCalled();
  await h.app.dispose();
});
it('retains a failed message outcome even when a later observation claims success', async () => {
  const h = setup(),
    pending = h.app.submit('Question');
  h.creation.resolve('thread');
  await tick();
  const human = message('u', 'user', 'Question'),
    answer = message('a', 'assistant', 'Answer');
  h.update({
    messages: [
      human,
      {
        ...answer,
        delivery: { generation: 'live', phase: 'complete', outcome: 'error' },
      },
    ],
  });
  h.update({ messages: [human, answer] });
  h.run.resolve('success');
  await tick();
  h.canonical([], 'terminal');
  await pending;
  expect(h.app.getSnapshot().canSubmit).toBe(false);
  expect(h.session.load).not.toHaveBeenCalled();
  await h.app.dispose();
});
it.each(['arguments', 'name', 'error'] as const)(
  'keeps conflicting finalized tool %s sticky before the first saved pause',
  async (kind) => {
    const h = setup(),
      pending = h.app.submit('Book UA123.');
    h.creation.resolve('thread');
    await tick();
    h.update({
      status: 'running',
      messages: [h.human, h.calling],
      toolCalls: [h.tool],
    });
    h.update({
      toolCalls: [
        kind === 'arguments'
          ? { ...h.tool, args: { flight_number: 'AA404' } }
          : kind === 'name'
          ? { ...h.tool, name: 'unowned_tool' }
          : { ...h.tool, status: 'error', error: 'PRIVATE' },
      ],
    });
    h.update({ status: 'idle', toolCalls: [h.tool], interrupts: h.interrupts });
    h.run.resolve('paused');
    await tick();
    h.canonical(['tools']);
    await pending;
    expect(h.app.getSnapshot().decision).toBeNull();
    expect(h.session.load).not.toHaveBeenCalled();
    await h.app.dispose();
  }
);
it('rejects a checkpoint replaced inside the final pre-resume authority validation', async () => {
  const h = setup();
  await h.pause();
  const decision = required(h.app.getSnapshot().decision);
  let validations = 0,
    replaced = false;
  const checkpoint = new Proxy(
    { thread_id: 'thread', checkpoint_ns: '', checkpoint_id: 'pause' },
    {
      getPrototypeOf(target) {
        if (h.app.getSnapshot().busy && ++validations === 2) {
          replaced = true;
          h.update({
            history: [
              {
                checkpoint: {
                  thread_id: 'thread',
                  checkpoint_ns: '',
                  checkpoint_id: 'changed',
                },
                next: ['tools'],
              },
            ],
          });
        }
        return Object.getPrototypeOf(target);
      },
    }
  );
  h.update({ history: [{ checkpoint, next: ['tools'] }] });
  h.nextOperation();
  const pending = h.app.decide(decision, 'confirm');
  h.run.resolve('error');
  await pending;
  expect(replaced).toBe(true);
  expect(h.session.resume).not.toHaveBeenCalled();
  expect(h.app.getSnapshot().decision).toBeNull();
  await h.app.dispose();
});
