import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSession } from './create-session';
import type { AgentTransport, StreamEvent } from './transport.types';
import { controlledSession } from './testing/controlled-session';
import { controlledTransport } from './testing/controlled-transport';
import { deferred } from './testing/deferred';
import {
  fixture as checkpointFixture,
  position,
  saved,
} from './testing/checkpoint-fixture';

const ai = (reasoning?: unknown, content = 'Answer') => ({
  type: 'ai',
  id: 'answer',
  content,
  reasoning,
});
const frame = (reasoning?: unknown, content = 'Answer'): StreamEvent => ({
  type: 'values',
  data: { messages: [ai(reasoning, content)] },
});
const delta = (reasoning?: unknown, content = ''): StreamEvent => ({
  type: 'messages',
  messageMetadata: {},
  messages: [{ ...ai(reasoning, content), type: 'AIMessageChunk' }],
});
const cleanups: (() => Promise<void>)[] = [];
function fixture() {
  const f = controlledSession();
  cleanups.push(() => f.session.dispose());
  return f;
}
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe('reasoning through actual session ownership', () => {
  it('captures history before later getters mutate it, retains equal identity and clears omissions', async () => {
    const f = fixture();
    const raw = ai('Saved');
    f.getHistory.mockResolvedValueOnce([
      saved('history', [], {
        values: {
          messages: [raw],
          get application() {
            raw.reasoning = 'Mutated';
            return true;
          },
        },
      }),
    ]);
    await f.session.load!();
    const before = f.session.getSnapshot();
    expect(before.messages[0].reasoning).toBe('Saved');
    f.getHistory.mockResolvedValue([
      saved('history', [], {
        values: { messages: [ai('Saved')], application: true },
      }),
    ]);
    await f.session.load!();
    expect(f.session.getSnapshot()).toBe(before);
    f.getHistory.mockResolvedValue([saved('history', [ai('Changed')])]);
    await f.session.load!();
    expect(f.session.getSnapshot().messages[0].reasoning).toBe('Changed');
    f.getHistory.mockResolvedValue([saved('history', [ai('')])]);
    await f.session.load!();
    expect(f.session.getSnapshot().messages[0].reasoning).toBe('');
    f.getHistory.mockResolvedValue([saved('history', [ai()])]);
    await f.session.load!();
    expect(f.session.getSnapshot().messages[0].reasoning).toBeUndefined();
    expect(before.messages[0].reasoning).toBe('Saved');
    expect(Object.isFrozen(raw)).toBe(false);
    expect(f.stream).not.toHaveBeenCalled();
  });

  it('appends chunks verbatim, replaces cumulative snapshots and captures canonical correction before source mutation', async () => {
    const f = fixture();
    const run = f.session.submit('Go');
    await f.started();
    await f.emit(delta('A', 'A'));
    await f.emit(delta('A'));
    await f.emit(delta('AA'));
    expect(f.session.getSnapshot().messages.at(-1)?.reasoning).toBe('AAAA');
    await f.emit(delta(undefined, 'B'));
    expect(f.session.getSnapshot().messages.at(-1)?.reasoning).toBe('AAAA');
    await f.emit(frame('Short', 'AB'));
    expect(f.session.getSnapshot().messages.at(-1)?.reasoning).toBe('Short');
    await f.emit(frame('', 'AB'));
    expect(f.session.getSnapshot().messages.at(-1)?.reasoning).toBe('');
    const raw = ai('Corrected', 'Final');
    await f.emit({ type: 'values', data: { messages: [raw] } });
    const captured = f.session.getSnapshot().messages.at(-1)!;
    raw.reasoning = 'Mutated';
    f.streams[0].finish();
    expect(await run).toBe('success');
    expect(f.session.getSnapshot().messages.at(-1)).toMatchObject({
      reasoning: 'Corrected',
      delivery: { phase: 'complete', outcome: 'success' },
    });
    expect(captured.reasoning).toBe('Corrected');
  });

  it('canonical omission clears retained interim reasoning on completion', async () => {
    const f = fixture();
    const run = f.session.submit('Go');
    await f.started();
    await f.emit(delta('Interim'));
    await f.emit(frame(undefined, 'Final'));
    expect(f.session.getSnapshot().messages.at(-1)?.reasoning).toBe('Interim');
    f.streams[0].finish();
    expect(await run).toBe('success');
    expect(f.session.getSnapshot().messages.at(-1)?.reasoning).toBeUndefined();
  });

  it.each(['history', 'stream'] as const)(
    'bars a stale owner reentered through a %s reasoning getter',
    async (mode) => {
      const f = fixture();
      let nested: Promise<unknown> | undefined;
      let fired = false;
      const raw = {
        ...ai(),
        get reasoning() {
          if (!fired) {
            fired = true;
            nested = f.session.submit('Replacement');
          }
          return 'Stale';
        },
      };
      if (mode === 'history') {
        f.getHistory.mockResolvedValue([saved('stale', [raw])]);
        await f.session.load!();
        await f.started();
      } else {
        const run = f.session.submit('Original');
        await f.started();
        await f.emit({ type: 'values', data: { messages: [raw] } });
        await run;
        await f.started(1);
      }
      expect(fired).toBe(true);
      expect(
        f.session.getSnapshot().messages.some((m) => m.reasoning === 'Stale')
      ).toBe(false);
      await f.session.stop();
      await nested;
    }
  );

  it('retains stopped reasoning while isolating stale attempts and namespaced children', async () => {
    const f = fixture();
    const old = f.session.submit('Old');
    await f.started();
    await f.emit(frame('Old'));
    await f.session.stop();
    expect(await old).toBe('aborted');
    const stopped = f.session.getSnapshot();
    const run = f.session.submit('New');
    await f.started(1);
    f.streams[0].release(frame('Stale'));
    await f.emit(frame('Root'), 1);
    await f.emit({ ...frame('Child'), namespace: ['child'] }, 1);
    await f.emit({ ...frame('Sibling'), namespace: ['sibling'] }, 1);
    const retained = f.session.getSnapshot();
    expect(retained.messages.find((m) => m.id === 'answer')?.reasoning).toBe(
      'Root'
    );
    expect(retained.subgraphs.map((s) => s.messages[0].reasoning)).toEqual([
      'Child',
      'Sibling',
    ]);
    await f.emit({ ...frame('Changed'), namespace: ['child'] }, 1);
    expect(f.session.getSnapshot().subgraphs[1]).toBe(retained.subgraphs[1]);
    expect(retained.subgraphs[0].messages[0].reasoning).toBe('Child');
    f.streams[1].finish();
    await run;
    expect(stopped.messages.at(-1)).toMatchObject({
      reasoning: 'Old',
      delivery: { outcome: 'aborted' },
    });
    expect(f.stream).toHaveBeenCalledTimes(2);
    expect(f.getHistory).not.toHaveBeenCalled();
  });

  it('does not inherit paused reasoning when a resumed delta establishes a new generation', async () => {
    const f = fixture();
    f.getHistory.mockResolvedValue([
      saved('paused', [ai('Paused')], {
        tasks: [
          {
            id: 'task',
            name: 'approval',
            interrupts: [{ id: 'approve', value: 'Continue?' }],
          },
        ],
        next: ['approval'],
      }),
    ]);
    await f.session.load!();
    const paused = f.session.getSnapshot();
    expect(paused.messages[0].reasoning).toBe('Paused');
    const run = f.session.resume(true);
    await f.started();
    await f.emit(delta(undefined, 'Resumed'));
    const current = f.session.getSnapshot().messages[0];
    expect(current.delivery.generation).not.toBe(
      paused.messages[0].delivery.generation
    );
    expect(current.reasoning).toBeUndefined();
    await f.emit(frame('Fresh', 'Done'));
    f.streams[0].finish();
    expect(await run).toBe('success');
    expect(f.session.getSnapshot().messages[0].reasoning).toBe('Fresh');
    expect(f.session.getSnapshot().messages).toHaveLength(1);
    expect(f.stream).toHaveBeenCalledOnce();
  });

  it('retains same physical-run reasoning while reconnecting then accepts canonical clearing', async () => {
    const stream = vi.fn<AgentTransport['stream']>(async function* (
      _a,
      _t,
      _i,
      _s,
      options
    ) {
      options?.onRunCreated?.({ run_id: 'run', thread_id: 'thread' });
      yield { ...delta('Retained', 'Partial'), sseId: '1' };
    });
    const joined = controlledTransport<StreamEvent>();
    const started = deferred<void>();
    const joinStream = vi.fn<NonNullable<AgentTransport['joinStream']>>(() => {
      started.resolve();
      return joined.stream;
    });
    const getRunStatus = vi.fn<NonNullable<AgentTransport['getRunStatus']>>(
      async () => 'running'
    );
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport: { stream, joinStream, getRunStatus },
    });
    cleanups.push(() => session.dispose());
    await session.submit('Go');
    const interrupted = session.getSnapshot();
    expect(interrupted.messages.at(-1)?.reasoning).toBe('Retained');
    getRunStatus.mockResolvedValue('success');
    const run = session.reconnect();
    await started.promise;
    expect(session.getSnapshot().messages.at(-1)?.reasoning).toBe('Retained');
    joined.release({ ...frame(undefined, 'Final'), sseId: '2' });
    joined.finish();
    expect(await run).toBe('success');
    expect(session.getSnapshot().messages.at(-1)?.reasoning).toBeUndefined();
    expect(interrupted.messages.at(-1)?.reasoning).toBe('Retained');
    expect(stream).toHaveBeenCalledOnce();
    expect(joinStream).toHaveBeenCalledOnce();
    expect(
      session.getSnapshot().messages.filter((m) => m.role === 'user')
    ).toHaveLength(1);
  });

  it('retains reasoning through exact checkpoint fork and load without executing historical tools', async () => {
    const f = checkpointFixture();
    f.source.values = {
      messages: [
        {
          ...ai('Historical'),
          tool_calls: [{ id: 'old', name: 'work', args: {} }],
        },
        { type: 'tool', id: 'result', tool_call_id: 'old', content: 'Saved' },
      ],
    };
    const handler = vi.fn(() => 'must not execute');
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport: f.transport,
      tools: { work: { description: 'Work', handler } },
    });
    cleanups.push(() => session.dispose());
    expect(await session.fork(position('a'), 'Continue')).toBe('success');
    expect(session.getSnapshot().messages[0].reasoning).toBe('Historical');
    const branch = f.states.get('result-1')!;
    (
      branch.values as { messages: ReturnType<typeof ai>[] }
    ).messages[0].reasoning = 'Reloaded';
    await session.load!();
    expect(session.getSnapshot().messages[0].reasoning).toBe('Reloaded');
    expect(f.transport.getState).toHaveBeenCalledTimes(3);
    expect(vi.mocked(f.transport.getState!).mock.calls[2][1]).toEqual(
      position('result-1')
    );
    expect(f.transport.stream).toHaveBeenCalledOnce();
    expect(f.transport.getHistory).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it.each(['Date', 'cycle'] as const)(
    'keeps strict %s checkpoint ingress rejected before display normalization',
    async (kind) => {
      const f = checkpointFixture();
      const cycle: Record<string, unknown> = {};
      cycle['self'] = cycle;
      const raw = kind === 'Date' ? new Date() : cycle;
      f.source.values = { messages: [ai(raw)] };
      const session = createSession({
        assistantId: 'agent',
        threadId: 'thread',
        transport: f.transport,
      });
      cleanups.push(() => session.dispose());
      const before = session.getSnapshot();
      await expect(session.fork(position('a'), 'Rejected')).rejects.toThrow();
      expect(session.getSnapshot()).toBe(before);
      expect(f.transport.getState).toHaveBeenCalledOnce();
      expect(f.transport.stream).not.toHaveBeenCalled();
      expect(Object.isFrozen(raw)).toBe(false);
    }
  );
});
