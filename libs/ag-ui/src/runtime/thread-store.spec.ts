import { describe, expect, it, vi } from 'vitest';
import { memoryStore } from './testing/memory-store';
import {
  contentOf,
  createThreadStore,
  observationOf,
  ownContent,
  type ReconcileAnswer,
  type ThreadContent,
} from './thread-store';

const thread: ThreadContent = {
  messages: [
    { id: 'u1', role: 'user', content: 'Book it' },
    { id: 'a1', role: 'assistant', content: 'Shall I?' },
  ],
  state: { city: 'Rome' },
};
const pause = {
  sourceRunId: 'r1',
  interrupts: [{ id: 'i1', reason: 'approval' }],
};
const attempt = {
  runId: 'r2',
  responses: [
    { interruptId: 'i1', status: 'resolved' as const, payload: true },
  ],
};

describe('createThreadStore', () => {
  it('requires a nonempty scope and keeps namespaces and threads apart', async () => {
    const memory = memoryStore();
    expect(() =>
      createThreadStore({ namespace: ' ', store: memory.store }, 't')
    ).toThrow('identifiers must be nonempty');
    expect(() =>
      createThreadStore({ namespace: 'app', store: memory.store }, '')
    ).toThrow('identifiers must be nonempty');
    await createThreadStore(
      { namespace: 'a', store: memory.store },
      'b:c'
    ).save(thread);
    await createThreadStore(
      { namespace: 'a:b', store: memory.store },
      'c'
    ).save(thread);
    expect(memory.records.size).toBe(2);
  });

  it('saves with rising revisions and loads frozen copies', async () => {
    const memory = memoryStore();
    const store = createThreadStore(
      { namespace: 'app', store: memory.store },
      't'
    );
    expect(await store.load()).toBeNull();
    await store.save(thread);
    await store.save({ ...thread, pause });
    const saved = memory.record('app', 't');
    expect(saved).toMatchObject({
      version: 1,
      namespace: 'app',
      threadId: 't',
      revision: 1,
      pause,
    });
    const loaded = await createThreadStore(
      { namespace: 'app', store: memory.store },
      't'
    ).load();
    expect(loaded).toEqual(saved);
    expect(Object.isFrozen(loaded?.messages)).toBe(true);
  });

  it('rejects a competing writer without retrying, until it loads again', async () => {
    const memory = memoryStore();
    const config = { namespace: 'app', store: memory.store };
    const first = createThreadStore(config, 't');
    const second = createThreadStore(config, 't');
    await first.save(thread);
    await second.load();
    await first.save({ ...thread, pause });
    const writes = memory.calls.compareAndSwap;
    await expect(second.save(thread)).rejects.toThrow(
      'another writer owns this thread'
    );
    // The losing save is not sent again.
    await expect(second.save(thread)).rejects.toThrow(
      'another writer owns this thread'
    );
    expect(memory.calls.compareAndSwap).toBe(writes + 1);
    await second.load();
    await second.save(thread);
    expect(memory.record('app', 't')).toMatchObject({ revision: 2 });
    expect(memory.record('app', 't')?.pause).toBeUndefined();
  });

  it('runs operations one at a time and continues after a failure', async () => {
    const memory = memoryStore();
    const order: string[] = [];
    let fail = true;
    const store = createThreadStore(
      {
        namespace: 'app',
        store: {
          load: memory.store.load,
          compareAndSwap: async (key, expected, next) => {
            order.push(`start ${next.revision}`);
            await Promise.resolve();
            if (fail) {
              fail = false;
              throw new Error('disk full');
            }
            const wrote = await memory.store.compareAndSwap(
              key,
              expected,
              next
            );
            order.push(`end ${next.revision}`);
            return wrote;
          },
        },
      },
      't'
    );
    const failed = store.save(thread);
    const ok = store.save(thread);
    await expect(failed).rejects.toThrow('disk full');
    await ok;
    await store.idle();
    expect(order).toEqual(['start 0', 'start 0', 'end 0']);
  });

  it('rejects a record of another scope, version or shape', async () => {
    const memory = memoryStore();
    const key = JSON.stringify(['app', 't']);
    const base = {
      version: 1,
      namespace: 'app',
      threadId: 't',
      revision: 0,
      ...thread,
    };
    const load = (record: object) => {
      memory.records.set(key, record as never);
      return createThreadStore(
        { namespace: 'app', store: memory.store },
        't'
      ).load();
    };
    await expect(load({ ...base, version: 2 })).rejects.toThrow(
      'identity or revision'
    );
    await expect(load({ ...base, threadId: 'other' })).rejects.toThrow(
      'identity or revision'
    );
    await expect(load({ ...base, revision: -1 })).rejects.toThrow(
      'identity or revision'
    );
    await expect(load({ ...base, messages: 'none' })).rejects.toThrow(
      'Invalid saved thread'
    );
    await expect(
      load({ ...base, messages: [thread.messages[0], thread.messages[0]] })
    ).rejects.toThrow('Duplicate message ID');
    await expect(
      load({ ...base, pause: { ...pause, interrupts: [] } })
    ).rejects.toThrow('needs its interrupts');
    await expect(
      load({
        ...base,
        pause: { ...pause, attempt: { ...attempt, responses: [] } },
      })
    ).rejects.toThrow('does not match its interrupts');
  });

  describe('reconcile', () => {
    const setup = async (
      answer: ReconcileAnswer | (() => Promise<ReconcileAnswer>)
    ) => {
      const memory = memoryStore();
      const reconcile = vi.fn(async () =>
        typeof answer === 'function' ? answer() : answer
      );
      const config = { namespace: 'app', store: memory.store, reconcile };
      const store = createThreadStore(config, 't');
      await store.save({ ...thread, pause: { ...pause, attempt } });
      return { memory, reconcile, store, config };
    };

    it('stores a completed answer and passes the reconciler a copy of the latest record', async () => {
      const done = {
        messages: [
          ...thread.messages,
          { id: 'a2', role: 'assistant', content: 'Booked' },
        ],
      };
      const { memory, reconcile, store, config } = await setup({
        status: 'completed',
        ...done,
      } as never);
      // Another writer moved the record on; reconcile asks about that one.
      const other = createThreadStore(config, 't');
      await other.load();
      await other.save({
        ...thread,
        state: { city: 'Oslo' },
        pause: { ...pause, attempt },
      });
      const record = await store.reconcile();
      expect(reconcile).toHaveBeenCalledWith(
        expect.objectContaining({ revision: 1, state: { city: 'Oslo' } })
      );
      expect(record).toMatchObject({ revision: 2 });
      expect(record?.pause).toBeUndefined();
      expect(memory.record('app', 't')?.messages).toHaveLength(3);
    });

    it('accepts a pause that still waits, an acknowledged answer and a new pause', async () => {
      const waiting = await setup({ status: 'pending', ...thread, pause });
      expect((await waiting.store.reconcile())?.pause).toEqual(pause);
      const started = await setup({
        status: 'acknowledged',
        ...thread,
        pause: { ...pause, attempt: { ...attempt, acknowledged: true } },
      });
      expect((await started.store.reconcile())?.pause?.attempt).toMatchObject({
        acknowledged: true,
      });
      const again = await setup({
        status: 'completed',
        ...thread,
        pause: {
          sourceRunId: 'r2',
          interrupts: [{ id: 'i2', reason: 'approval' }],
        },
      });
      expect((await again.store.reconcile())?.pause?.sourceRunId).toBe('r2');
    });

    it.each<[string, ReconcileAnswer]>([
      ['an unknown outcome', { status: 'unknown' }],
      [
        'a pending answer that keeps the attempt',
        { status: 'pending', ...thread, pause: { ...pause, attempt } },
      ],
      ['a pending answer without a pause', { status: 'pending', ...thread }],
      [
        'an acknowledged answer without the attempt',
        { status: 'acknowledged', ...thread, pause },
      ],
      [
        'a completed answer that keeps the old pause',
        { status: 'completed', ...thread, pause },
      ],
      ['a status it does not know', { status: 'done', ...thread } as never],
    ])('rejects %s and leaves the store untouched', async (_name, answer) => {
      const { memory, store } = await setup(answer);
      await expect(store.reconcile()).rejects.toThrow(
        /Recovery requires|Invalid authoritative/
      );
      expect(memory.record('app', 't')).toMatchObject({ revision: 0 });
    });

    it('resolves null when nothing is saved, and rejects without a reconciler', async () => {
      const memory = memoryStore();
      const reconcile = vi.fn();
      expect(
        await createThreadStore(
          { namespace: 'app', store: memory.store, reconcile },
          't'
        ).reconcile()
      ).toBeNull();
      expect(reconcile).not.toHaveBeenCalled();
      const plain = createThreadStore(
        { namespace: 'app', store: memory.store },
        't'
      );
      expect(plain.canReconcile).toBe(false);
      await plain.save(thread);
      await expect(plain.reconcile()).rejects.toThrow(
        'requires a persistence reconciler'
      );
    });
  });
});

describe('thread content', () => {
  it('round-trips a thread with a waiting pause through an observation', () => {
    const observation = observationOf(ownContent({ ...thread, pause }));
    expect(observation).toMatchObject({
      status: 'idle',
      state: { city: 'Rome' },
      run: { id: 'r1', outcome: 'paused' },
      decision: {
        kind: 'native',
        sourceRunId: 'r1',
        interrupts: pause.interrupts,
      },
    });
    expect(contentOf(observation)).toEqual({ ...thread, pause });
  });

  it('restores a pause saved with its answer as one whose run is over', () => {
    const observation = observationOf(
      ownContent({ ...thread, pause: { ...pause, attempt } })
    );
    expect(observation.run).toEqual({ id: 'r2', outcome: 'interrupted' });
    expect(observation.decision).toMatchObject({ attempt });
  });

  it('keeps no state for a thread that has none, and no unanswerable pause', () => {
    const observation = observationOf(ownContent({ messages: [] }));
    expect(contentOf(observation)).toEqual({ messages: [] });
    expect(
      contentOf({
        ...observation,
        decision: { kind: 'unsupported', sourceRunId: 'r1' },
      })
    ).toEqual({ messages: [] });
  });
});
