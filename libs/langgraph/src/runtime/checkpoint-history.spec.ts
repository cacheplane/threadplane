import type { ThreadState } from '@langchain/langgraph-sdk';
import { assert, describe, expect, it, vi } from 'vitest';
import { createSession } from './create-session';
import type { AgentTransport } from './transport.types';
import { deferred } from './testing/deferred';

function checkpoint(id: string | null = 'latest'): ThreadState {
  return {
    checkpoint: {
      thread_id: 't',
      checkpoint_ns: '',
      checkpoint_id: id,
      checkpoint_map: { child: { id: 'nested' } },
    },
    parent_checkpoint: {
      thread_id: 't',
      checkpoint_ns: '',
      checkpoint_id: 'parent',
      checkpoint_map: null,
    },
    created_at: '2026-09-22T12:00:00Z',
    next: ['work'],
    values: { messages: [{ type: 'ai', id: 'answer', content: 'Latest' }] },
    tasks: [],
    metadata: null,
  };
}

function fixture(read: NonNullable<AgentTransport['getHistory']>) {
  const stream = vi.fn<AgentTransport['stream']>(async function* () {
    yield {
      type: 'values',
      data: { messages: [{ type: 'ai', id: 'run', content: 'Done' }] },
    };
  });
  const getHistory = vi.fn(read);
  const session = createSession({
    assistantId: 'a',
    threadId: 't',
    transport: { stream, getHistory },
  });
  return { session, stream, getHistory };
}

describe('explicit checkpoint history observation', () => {
  it('retains a nonempty page through live checkpoint frames, pause, resume and disposal', async () => {
    const f = fixture(async () => [checkpoint()]);
    await f.session.load?.();
    const page = f.session.getSnapshot().history;
    assert(page?.length);
    const snapshots: ReturnType<typeof f.session.getSnapshot>[] = [];
    f.session.subscribe(() => snapshots.push(f.session.getSnapshot()));
    f.stream.mockImplementationOnce(async function* () {
      yield { type: 'checkpoints', data: checkpoint('live') };
      yield {
        type: 'updates',
        data: { __interrupt__: [{ id: 'ask', value: 'Continue?' }] },
      };
    });
    expect(await f.session.submit('Go')).toBe('paused');
    await f.session.stop();
    expect(await f.session.resume(true)).toBe('success');
    await f.session.dispose();
    expect(snapshots.length).toBeGreaterThan(2);
    expect(snapshots.every((snapshot) => snapshot.history === page)).toBe(true);
    expect(f.session.getSnapshot().history).toBe(page);
    expect(f.getHistory).toHaveBeenCalledTimes(1);
  });

  it('distinguishes unobserved from empty and retains the page through commands', async () => {
    const f = fixture(async () => []);
    expect(f.session.getSnapshot().history).toBeUndefined();
    expect(f.getHistory).not.toHaveBeenCalled();
    await f.session.load?.();
    const page = f.session.getSnapshot().history;
    expect(page).toEqual([]);
    await f.session.submit('Go');
    await f.session.stop();
    await f.session.dispose();
    expect(f.session.getSnapshot().history).toBe(page);
    expect(f.getHistory).toHaveBeenCalledTimes(1);
  });

  it('owns compact entries in exact response order, including duplicate and absent ids', async () => {
    const input = [
      checkpoint(),
      checkpoint('parent'),
      checkpoint(null),
      checkpoint(),
    ];
    input[1].checkpoint.checkpoint_ns = 'child:one';
    const f = fixture(async () => input);
    await f.session.load?.();
    const page = f.session.getSnapshot().history;
    expect(page).toEqual(
      input.map(({ checkpoint, parent_checkpoint, created_at, next }) => ({
        checkpoint,
        parent_checkpoint,
        created_at,
        next,
      }))
    );
    assert(page);
    expect(Object.keys(page[0])).toEqual([
      'checkpoint',
      'parent_checkpoint',
      'created_at',
      'next',
    ]);
    input[0].next.push('changed');
    (input[0].checkpoint.checkpoint_map?.['child'] as { id: string }).id =
      'changed';
    expect(page[0].next).toEqual(['work']);
    expect(page[0].checkpoint.checkpoint_map).toEqual({
      child: { id: 'nested' },
    });
    expect(Object.isFrozen(page[0].checkpoint.checkpoint_map?.['child'])).toBe(
      true
    );
    expect(f.session.getSnapshot().messages.map((m) => m.content)).toEqual([
      'Latest',
    ]);
    await f.session.dispose();
  });

  it('never reads excluded data on older entries and shares equal page reads', async () => {
    const poison = vi.fn(() => {
      throw new Error('Excluded');
    });
    const older = checkpoint('older');
    for (const key of ['values', 'tasks', 'metadata'])
      Object.defineProperty(older, key, { get: poison });
    const f = fixture(async () => [checkpoint(), older]);
    await f.session.load?.();
    const first = f.session.getSnapshot();
    expect(first.history).toHaveLength(2);
    await f.session.load?.();
    expect(f.session.getSnapshot()).toBe(first);
    expect(poison).not.toHaveBeenCalled();
    f.getHistory.mockImplementation(async () => {
      const latest = checkpoint();
      latest.next = ['other'];
      return [latest, older];
    });
    await f.session.load?.();
    const next = f.session.getSnapshot();
    assert(first.history && next.history);
    expect(next.history).not.toBe(first.history);
    expect(next.history[1]).toBe(first.history[1]);
    expect(next.history[0].checkpoint).toBe(first.history[0].checkpoint);
    expect(next.messages).toBe(first.messages);
    await f.session.dispose();
  });

  it('rejects unsupported included reference data without partially replacing the snapshot', async () => {
    const f = fixture(async () => [checkpoint()]);
    await f.session.load?.();
    const before = f.session.getSnapshot();
    const cycle: Record<string, unknown> = {};
    cycle['self'] = cycle;
    const bad = checkpoint('bad');
    bad.checkpoint.checkpoint_map = cycle;
    const changed = checkpoint('changed');
    changed.values = {
      messages: [{ type: 'ai', id: 'new', content: 'Must not commit' }],
      changed: true,
    };
    f.getHistory.mockResolvedValue([changed, bad]);
    await expect(f.session.load?.()).rejects.toMatchObject({
      name: 'LangGraphRequestError',
      message: 'The LangGraph request failed.',
    });
    expect(f.session.getSnapshot()).toBe(before);
    await f.session.dispose();
  });

  it.each(['stop', 'dispose', 'submit', 'load'] as const)(
    'does not commit a page whose selected getter invokes %s',
    async (command) => {
      const f = fixture(async () => [checkpoint()]);
      await f.session.load?.();
      const before = f.session.getSnapshot().history;
      const bad = checkpoint('stale');
      let replacement: Promise<unknown> | undefined;
      Object.defineProperty(bad, 'next', {
        get() {
          f.getHistory.mockResolvedValue([checkpoint('replacement')]);
          replacement =
            command === 'submit'
              ? f.session.submit('Go')
              : command === 'load'
              ? f.session.load?.()
              : f.session[command]();
          return ['stale'];
        },
      });
      f.getHistory.mockResolvedValueOnce([bad]);
      await f.session.load?.();
      await replacement;
      if (command === 'load')
        expect(
          f.session.getSnapshot().history?.[0].checkpoint.checkpoint_id
        ).toBe('replacement');
      else expect(f.session.getSnapshot().history).toBe(before);
      expect(JSON.stringify(f.session.getSnapshot())).not.toContain('stale');
      await f.session.dispose();
    }
  );

  it('ignores an old page after an ignored-abort load is replaced', async () => {
    const old = deferred<ThreadState[]>();
    const started = deferred<void>();
    const f = fixture(async () => {
      started.resolve();
      return old.promise;
    });
    const first = f.session.load?.();
    await started.promise;
    f.getHistory.mockResolvedValue([checkpoint('new')]);
    await f.session.load?.();
    await first;
    const before = f.session.getSnapshot();
    old.resolve([checkpoint('late')]);
    await old.promise;
    expect(before.history?.[0].checkpoint.checkpoint_id).toBe('new');
    expect(f.session.getSnapshot()).toBe(before);
    await f.session.dispose();
  });
});
