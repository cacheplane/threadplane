import type { BaseEvent } from '@ag-ui/client';
import { describe, expect, it, vi } from 'vitest';
import { STORAGE_COPY } from './agent-session';
import { createSession } from './create-session';
import { decisionState, interruptSession } from './decision';
import { bindingFixture } from './testing/binding-fixture';
import { memoryStore } from './testing/memory-store';
import type { ReconcileAnswer, SessionPersistence, ThreadRecord } from './thread-store';

type Fixture = ReturnType<typeof bindingFixture>;
type Exchange = Awaited<ReturnType<Fixture['started']>>;
const finish = (exchange: Exchange, outcome?: unknown) =>
  exchange.emit({
    type: 'RUN_FINISHED',
    threadId: exchange.body.threadId,
    runId: exchange.body.runId,
    ...(outcome !== undefined && { outcome }),
  });
const approval = { type: 'interrupt', interrupts: [{ id: 'i1', reason: 'approval' }] };
const yes = [{ interruptId: 'i1', status: 'resolved' as const, value: true }];
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function durable(
  memory = memoryStore(),
  reconcile?: SessionPersistence['reconcile']
) {
  const persistence: SessionPersistence = {
    namespace: 'app',
    store: memory.store,
    ...(reconcile && { reconcile }),
  };
  return { memory, persistence, saved: () => memory.record('app', 'native-thread') };
}
/** A session that submitted once and paused for approval. */
async function paused(persistence: SessionPersistence) {
  const fixture = bindingFixture({ persistence, state: { city: 'Rome' } });
  await fixture.session.ready;
  const run = fixture.session.submit('Book it');
  const first = await fixture.started();
  first.emit({ type: 'TEXT_MESSAGE_START', messageId: 'a1', role: 'assistant' });
  first.emit({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'a1', delta: 'Shall I?' });
  first.emit({ type: 'TEXT_MESSAGE_END', messageId: 'a1' });
  finish(first, approval);
  expect(await run).toBe('paused');
  await settle();
  return { fixture, first };
}
/** A session whose answer was sent and whose run then ended with no terminal. */
async function truncated(persistence: SessionPersistence) {
  const { fixture } = await paused(persistence);
  const answered = fixture.session.resume(yes);
  const second = await fixture.started(1);
  second.end();
  expect(await answered).toBe('interrupted');
  return fixture;
}

describe('a session without durability', () => {
  it('is ready at once and has no recovery commands', async () => {
    const fixture = bindingFixture();
    await expect(fixture.session.ready).resolves.toBeUndefined();
    expect(fixture.session.getSnapshot().inputBlocked).toBeUndefined();
    expect('reconcileInterrupt' in fixture.session).toBe(false);
    expect('checkStatus' in fixture.session).toBe(false);
    await fixture.cleanup();
  });
});

describe('persistence', () => {
  it('holds the input until the saved thread is read, and makes commands wait for it', async () => {
    const { persistence } = durable();
    const fixture = bindingFixture({ persistence });
    try {
      expect(fixture.session.getSnapshot().inputBlocked).toBe('hydrating');
      const run = fixture.session.submit('Early');
      expect(fixture.exchanges).toHaveLength(0);
      await fixture.session.ready;
      expect(fixture.session.getSnapshot().inputBlocked).toBeUndefined();
      finish(await fixture.started());
      expect(await run).toBe('success');
    } finally {
      await fixture.cleanup();
    }
  });

  it('restores messages, state and a waiting pause into a new session, which answers it', async () => {
    const { persistence, saved } = durable();
    const { fixture: first } = await paused(persistence);
    expect(saved()).toMatchObject({
      revision: 0,
      state: { city: 'Rome' },
      pause: { interrupts: approval.interrupts },
    });
    await first.cleanup();

    const second = bindingFixture({ persistence });
    try {
      await second.session.ready;
      const restored = second.session.getSnapshot();
      expect(restored).toMatchObject({
        status: 'idle',
        state: { city: 'Rome' },
        inputBlocked: 'decision',
        interrupts: approval.interrupts,
      });
      expect(restored.messages.map((message) => message.content)).toEqual([
        'Book it',
        'Shall I?',
      ]);
      expect(decisionState(restored)).toMatchObject({ phase: 'ready' });

      const answered = second.session.resume(yes);
      const exchange = await second.started();
      // The answer was saved before it was sent.
      expect(saved()?.pause?.attempt).toMatchObject({ runId: exchange.body.runId });
      expect(exchange.body.resume).toEqual([
        { interruptId: 'i1', status: 'resolved', payload: true },
      ]);
      expect(exchange.body.messages).toHaveLength(2);
      expect(exchange.body.state).toEqual({ city: 'Rome' });
      finish(exchange);
      expect(await answered).toBe('success');
      await settle();
      expect(saved()?.pause).toBeUndefined();
    } finally {
      await second.cleanup();
    }
  });

  it('restores a sent answer as uncertain: only reconciliation continues', async () => {
    const { persistence, saved } = durable();
    const first = await truncated(persistence);
    expect(interruptSession(first.session.getSnapshot()).phase).toBe('recovery-required');
    expect(first.session.getSnapshot().error?.recovery).toBe('none');
    await settle();
    expect(saved()?.pause?.attempt).toMatchObject({ acknowledged: true });
    await first.cleanup();

    const second = bindingFixture({ persistence });
    try {
      await second.session.ready;
      const restored = second.session.getSnapshot();
      expect(decisionState(restored)).toMatchObject({ phase: 'uncertain' });
      expect(interruptSession(restored)).toMatchObject({
        phase: 'recovery-required',
        runId: saved()?.pause?.sourceRunId,
        attempt: { responses: [{ interruptId: 'i1' }] },
      });
      expect(restored.inputBlocked).toBe('decision');
      await expect(second.session.resume(yes)).rejects.toThrow(
        'No interrupt is waiting for an answer.'
      );
      expect(await second.session.submit('Bypass')).toBe('error');
      expect(second.exchanges).toHaveLength(0);
      // Without a reconciler nothing can say what happened.
      await expect(second.session.reconcileInterrupt?.()).rejects.toThrow(
        'requires a persistence reconciler'
      );
      expect(second.session.getSnapshot().inputBlocked).toBe('decision');
    } finally {
      await second.cleanup();
    }
  });

  it('does not send an answer it could not save, and releases the claim', async () => {
    const memory = memoryStore();
    const { persistence } = durable(memory);
    const { fixture } = await paused(persistence);
    try {
      // Another writer takes the thread.
      const key = JSON.stringify(['app', 'native-thread']);
      memory.records.set(key, { ...(memory.records.get(key) as ThreadRecord), revision: 7 });
      expect(await fixture.session.resume(yes)).toBe('error');
      expect(fixture.exchanges).toHaveLength(1);
      const snapshot = fixture.session.getSnapshot();
      expect(snapshot.decision).not.toHaveProperty('attempt');
      expect(snapshot).toMatchObject({
        status: 'error',
        inputBlocked: 'storage',
        error: { message: STORAGE_COPY, recovery: 'none' },
      });
      await expect(fixture.session.resume(yes)).rejects.toThrow(
        'Thread storage needs reconciliation'
      );
      expect(await fixture.session.submit('Bypass')).toBe('error');
    } finally {
      await fixture.cleanup();
    }
  });

  it('rejects ready and holds the session when the saved thread cannot be read', async () => {
    const memory = memoryStore();
    let broken = true;
    const reconcile = vi.fn(async (record: ThreadRecord): Promise<ReconcileAnswer> => ({
      status: 'completed',
      messages: record.messages,
    }));
    const fixture = bindingFixture({
      persistence: {
        namespace: 'app',
        reconcile,
        store: {
          ...memory.store,
          load: async (key) => {
            if (broken) throw new Error('store offline');
            return memory.store.load(key);
          },
        },
      },
    });
    try {
      await expect(fixture.session.ready).rejects.toThrow('store offline');
      expect(fixture.session.getSnapshot()).toMatchObject({
        status: 'error',
        inputBlocked: 'storage',
        error: { message: STORAGE_COPY },
      });
      expect(await fixture.session.submit('Go')).toBe('error');
      expect(fixture.exchanges).toHaveLength(0);
      broken = false;
      await fixture.session.reconcileInterrupt?.();
      expect(fixture.session.getSnapshot()).toMatchObject({ status: 'idle' });
      expect(fixture.session.getSnapshot().inputBlocked).toBeUndefined();
      const run = fixture.session.submit('Go');
      finish(await fixture.started());
      expect(await run).toBe('success');
    } finally {
      await fixture.cleanup();
    }
  });
});

describe('reconcileInterrupt and checkStatus', () => {
  const answering = (answer: (record: ThreadRecord) => ReconcileAnswer) => {
    const reconcile = vi.fn(async (record: ThreadRecord) => answer(record));
    return { reconcile, ...durable(memoryStore(), reconcile) };
  };
  const completed = (record: ThreadRecord): ReconcileAnswer => ({
    status: 'completed',
    messages: [...record.messages, { id: 'a2', role: 'assistant', content: 'Booked' }],
    state: record.state,
  });

  it('offers checkStatus only with a reconciler', async () => {
    const plain = bindingFixture({ persistence: durable().persistence });
    expect('checkStatus' in plain.session).toBe(false);
    expect(typeof plain.session.reconcileInterrupt).toBe('function');
    await plain.cleanup();
    const checking = bindingFixture({ persistence: answering(completed).persistence });
    expect(typeof checking.session.checkStatus).toBe('function');
    await checking.cleanup();
  });

  it('offers a check for a truncated answer, asks once on its own and settles on completion', async () => {
    const { persistence, reconcile } = answering(completed);
    const fixture = await truncated(persistence);
    try {
      // The failure offers the check before its automatic answer lands.
      await fixture.changed((snapshot) => snapshot.status === 'idle');
      expect(reconcile).toHaveBeenCalledOnce();
      expect(reconcile.mock.calls[0][0].pause?.attempt).toBeDefined();
      const snapshot = fixture.session.getSnapshot();
      expect(snapshot.decision).toBeUndefined();
      expect(snapshot.error).toBeUndefined();
      expect(snapshot.inputBlocked).toBeUndefined();
      expect(snapshot.messages.at(-1)?.content).toBe('Booked');
      expect(fixture.exchanges).toHaveLength(2);
      const next = fixture.session.submit('Thanks');
      finish(await fixture.started(2));
      expect(await next).toBe('success');
    } finally {
      await fixture.cleanup();
    }
  });

  it("says recovery 'check' while the answer is uncertain, and refuses commands during a check", async () => {
    let release!: (answer: ReconcileAnswer) => void;
    const reconcile = vi.fn(
      () => new Promise<ReconcileAnswer>((resolve) => (release = resolve))
    );
    const { persistence } = durable(memoryStore(), reconcile);
    const fixture = await truncated(persistence);
    try {
      await fixture.changed((snapshot) => snapshot.inputBlocked === 'checking');
      expect(fixture.session.getSnapshot().error).toMatchObject({
        kind: 'interrupted',
        retryable: false,
        recovery: 'check',
      });
      await vi.waitFor(() => expect(reconcile).toHaveBeenCalledOnce());
      expect(await fixture.session.submit('Bypass')).toBe('error');
      await expect(fixture.session.resume(yes)).rejects.toThrow('A status check is in progress.');
      await expect(fixture.session.reconcileInterrupt?.()).rejects.toThrow(
        'A status check is in progress.'
      );
      // A second check while one is open asks nothing more.
      await fixture.session.checkStatus?.();
      expect(reconcile).toHaveBeenCalledOnce();
      release({ status: 'unknown' });
      await fixture.changed((snapshot) => snapshot.inputBlocked === 'decision');
      expect(fixture.session.getSnapshot().error?.recovery).toBe('check');
    } finally {
      await fixture.cleanup();
    }
  });

  it('shows the pause again when the backend says it still waits', async () => {
    const { persistence } = answering((record) => ({
      status: 'pending',
      messages: record.messages,
      state: record.state,
      pause: { sourceRunId: record.pause?.sourceRunId ?? '', interrupts: approval.interrupts },
    }));
    const fixture = await truncated(persistence);
    try {
      const snapshot = await fixture.changed((next) => next.interrupts !== undefined);
      expect(snapshot).toMatchObject({ status: 'idle', interrupts: approval.interrupts });
      expect(snapshot.error).toBeUndefined();
      const answered = fixture.session.resume(yes);
      finish(await fixture.started(2));
      expect(await answered).toBe('success');
    } finally {
      await fixture.cleanup();
    }
  });

  it('keeps the check offered for an acknowledgement, which reconcileInterrupt adopts', async () => {
    const { persistence, reconcile } = answering((record) => ({
      status: 'acknowledged',
      messages: record.messages,
      state: record.state,
      pause: record.pause,
    }));
    const fixture = await truncated(persistence);
    try {
      await vi.waitFor(() => expect(reconcile).toHaveBeenCalledOnce());
      await fixture.changed((snapshot) => snapshot.inputBlocked === 'decision');
      expect(fixture.session.getSnapshot()).toMatchObject({
        status: 'error',
        error: { recovery: 'check' },
      });
      await fixture.session.checkStatus?.();
      expect(reconcile).toHaveBeenCalledTimes(2);
      expect(fixture.session.getSnapshot().status).toBe('error');

      await fixture.session.reconcileInterrupt?.();
      const adopted = fixture.session.getSnapshot();
      expect(adopted.status).toBe('idle');
      expect(adopted.error).toBeUndefined();
      expect(interruptSession(adopted).phase).toBe('recovery-required');
      expect(adopted.inputBlocked).toBe('decision');
    } finally {
      await fixture.cleanup();
    }
  });

  it('leaves the error in place when the reconciler throws, and rejects from reconcileInterrupt', async () => {
    const reconcile = vi.fn(async (): Promise<ReconcileAnswer> => {
      throw new Error('backend unreachable');
    });
    const { persistence } = durable(memoryStore(), reconcile);
    const fixture = await truncated(persistence);
    try {
      await vi.waitFor(() => expect(reconcile).toHaveBeenCalledOnce());
      await fixture.changed((snapshot) => snapshot.inputBlocked === 'decision');
      await expect(fixture.session.checkStatus?.()).resolves.toBeUndefined();
      expect(fixture.session.getSnapshot().error?.recovery).toBe('check');
      await expect(fixture.session.reconcileInterrupt?.()).rejects.toThrow('backend unreachable');
      expect(fixture.session.getSnapshot().inputBlocked).toBe('decision');
    } finally {
      await fixture.cleanup();
    }
  });

  it('never asks the reconciler about an ordinary failed submission', async () => {
    const { persistence, reconcile } = answering(completed);
    const fixture = bindingFixture({ persistence });
    try {
      const run = fixture.session.submit('Go');
      (await fixture.started()).end();
      expect(await run).toBe('interrupted');
      await settle();
      expect(reconcile).not.toHaveBeenCalled();
      expect(fixture.session.getSnapshot().error?.recovery).toBe('none');
    } finally {
      await fixture.cleanup();
    }
  });

  it('rejects after disposal and while a run is going, and discards a late answer', async () => {
    let release!: (answer: ReconcileAnswer) => void;
    const reconcile = vi.fn(
      () => new Promise<ReconcileAnswer>((resolve) => (release = resolve))
    );
    const { persistence } = durable(memoryStore(), reconcile);
    const fixture = await truncated(persistence);
    await vi.waitFor(() => expect(reconcile).toHaveBeenCalledOnce());
    const before = fixture.session.getSnapshot().messages;
    await fixture.session.dispose();
    release({ status: 'completed', messages: [] });
    await settle();
    expect(fixture.session.getSnapshot().messages).toBe(before);
    await expect(fixture.session.checkStatus?.()).rejects.toThrow('The session is disposed.');
    await expect(fixture.session.reconcileInterrupt?.()).rejects.toThrow(
      'The session is disposed.'
    );

    const busy = bindingFixture({ persistence: answering(completed).persistence });
    await busy.session.ready;
    const run = busy.session.submit('Go');
    const exchange = await busy.started();
    await expect(busy.session.checkStatus?.()).rejects.toThrow('Stop the active request');
    await expect(busy.session.reconcileInterrupt?.()).rejects.toThrow('Stop the active request');
    finish(exchange);
    await run;
    await busy.cleanup();
  });
});

describe('replay', () => {
  const ev = (event: object) => event as BaseEvent;
  const stored = [
    ev({
      type: 'RUN_STARTED',
      threadId: 'native-thread',
      runId: 'r1',
      input: {
        threadId: 'native-thread',
        runId: 'r1',
        messages: [{ id: 'u1', role: 'user', content: 'Book it' }],
      },
    }),
    ev({ type: 'TEXT_MESSAGE_START', messageId: 'a1', role: 'assistant' }),
    ev({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'a1', delta: 'Shall I?' }),
    ev({ type: 'TEXT_MESSAGE_END', messageId: 'a1' }),
    ev({ type: 'RUN_FINISHED', threadId: 'native-thread', runId: 'r1', outcome: approval }),
  ];

  it('rebuilds the thread from its events and wins over persistence without reading it', async () => {
    const { persistence, memory } = durable();
    const replay = vi.fn(async () => stored);
    const fixture = bindingFixture({ persistence, replay });
    try {
      expect(fixture.session.getSnapshot().inputBlocked).toBe('hydrating');
      await fixture.session.ready;
      expect(replay).toHaveBeenCalledWith('native-thread', expect.any(AbortSignal));
      expect(memory.calls.load).toBe(0);
      const snapshot = fixture.session.getSnapshot();
      expect(snapshot.messages.map((message) => message.content)).toEqual([
        'Book it',
        'Shall I?',
      ]);
      expect(snapshot.interrupts).toEqual(approval.interrupts);
      const answered = fixture.session.resume(yes);
      const exchange = await fixture.started();
      // The next request carries the replayed history.
      expect(exchange.body.messages.map((message) => message.id)).toEqual(['u1', 'a1']);
      finish(exchange);
      expect(await answered).toBe('success');
    } finally {
      await fixture.cleanup();
    }
  });

  it.each([
    ['returns nothing', async () => []],
    ['fails', async () => Promise.reject(new Error('offline'))],
    ['cannot be folded', async () => [ev({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'x', delta: 'x' })]],
  ])('falls back to persistence, without rejecting ready, when replay %s', async (_name, replay) => {
    const { persistence } = durable();
    const { fixture: first } = await paused(persistence);
    await first.cleanup();
    const fixture = bindingFixture({ persistence, replay });
    try {
      await expect(fixture.session.ready).resolves.toBeUndefined();
      expect(fixture.session.getSnapshot().interrupts).toEqual(approval.interrupts);
    } finally {
      await fixture.cleanup();
    }
  });

  it('keeps the thread it was created with when replay returns nothing and nothing is saved', async () => {
    const fixture = bindingFixture({
      replay: async () => [],
      messages: [{ id: 'u0', role: 'user', content: 'Given' }],
    });
    try {
      await fixture.session.ready;
      expect(fixture.session.getSnapshot().messages).toHaveLength(1);
      expect(fixture.session.getSnapshot().inputBlocked).toBeUndefined();
      expect('reconcileInterrupt' in fixture.session).toBe(false);
    } finally {
      await fixture.cleanup();
    }
  });

  it('aborts the replay request on dispose and applies nothing', async () => {
    let signal!: AbortSignal;
    let release!: (events: BaseEvent[]) => void;
    const fixture = bindingFixture({
      replay: (_threadId, given) => {
        signal = given;
        return new Promise<BaseEvent[]>((resolve) => (release = resolve));
      },
    });
    await fixture.session.dispose();
    expect(signal.aborted).toBe(true);
    release(stored);
    await fixture.session.ready;
    expect(fixture.session.getSnapshot().messages).toHaveLength(0);
  });
});

describe('durability with client tools', () => {
  it('restores a pause with its unresolved backend call, and answers it', async () => {
    const { persistence, saved } = durable();
    const bodies: { runId: string; threadId: string; messages: unknown[]; resume?: unknown }[] = [];
    const replies = [
      (body: (typeof bodies)[number]) => [
        { type: 'RUN_STARTED', threadId: body.threadId, runId: body.runId },
        { type: 'TOOL_CALL_START', toolCallId: 'tc-1', toolCallName: 'book', parentMessageId: 'a1' },
        { type: 'TOOL_CALL_END', toolCallId: 'tc-1' },
        { type: 'RUN_FINISHED', threadId: body.threadId, runId: body.runId, outcome: approval },
      ],
      (body: (typeof bodies)[number]) => [
        { type: 'RUN_STARTED', threadId: body.threadId, runId: body.runId },
        { type: 'TOOL_CALL_RESULT', messageId: 'tr-1', toolCallId: 'tc-1', content: 'booked' },
        { type: 'RUN_FINISHED', threadId: body.threadId, runId: body.runId },
      ],
    ];
    const create = () =>
      createSession(
        {
          threadId: 'native-thread',
          url: 'unused',
          persistence,
          fetch: async (_url, init) => {
            const body = JSON.parse(String(init?.body));
            bodies.push(body);
            return new Response(
              replies[bodies.length - 1](body)
                .map((event) => `data: ${JSON.stringify(event)}\n\n`)
                .join(''),
              { headers: { 'content-type': 'text/event-stream' } }
            );
          },
        },
        { local: { description: 'local', handler: () => 1 } }
      );
    const first = create();
    expect(await first.submit('Book it')).toBe('paused');
    await first.dispose();
    await settle();
    expect(saved()?.pause).toBeDefined();

    const second = create();
    await second.ready;
    const restored = second.getSnapshot();
    expect(restored.clientTools.blocker).toBeUndefined();
    expect(restored.interrupts).toEqual(approval.interrupts);
    expect(await second.resume(yes)).toBe('success');
    expect(bodies[1].resume).toEqual([{ interruptId: 'i1', status: 'resolved', payload: true }]);
    expect(JSON.stringify(bodies[1].messages)).toContain('tc-1');
    expect(second.getSnapshot().clientTools.blocker).toBeUndefined();
    await settle();
    expect(saved()?.pause).toBeUndefined();
    await second.dispose();
  });
});
