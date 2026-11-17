import type { ThreadState } from '@langchain/langgraph-sdk';
import { describe, expect, it, vi } from 'vitest';
import { createSession } from './create-session';
import { checkpointEvent, fixture, position, saved } from './testing/checkpoint-fixture';
import { deferred } from './testing/deferred';

const human = (id: string, content: string) => ({ id, type: 'human', content });
const ai = (id: string, content: string) => ({ id, type: 'ai', content });
const turn1 = [human('u1', 'First question'), ai('a1', 'First answer')];
const turn2 = [...turn1, human('u2', 'Second question'), ai('a2', 'Second answer')];

/** A thread with two finished turns and a checkpoint saved at every step, newest first. */
function thread() {
  const f = fixture();
  const history = [
    saved('t2-done', turn2),
    saved('t2-input', turn2.slice(0, 3)),
    saved('t1-done', turn1),
    saved('t1-input', turn1.slice(0, 1)),
    saved('start', []),
  ];
  f.states.clear();
  for (const state of history)
    f.states.set(String(state.checkpoint.checkpoint_id), state);
  f.transport.getHistory = vi.fn(async () => history);
  const forks: { from: string; input: unknown }[] = [];
  f.transport.stream = vi.fn(async function* (_a, _t, input, _s, options) {
    const from = String(
      (options as { checkpoint?: { checkpoint_id?: string } } | undefined)
        ?.checkpoint?.checkpoint_id
    );
    forks.push({ from, input });
    const id = `regenerated-${forks.length}`;
    options?.onRunCreated?.({ run_id: `run-${id}`, thread_id: 'thread' });
    const base = (f.states.get(from)?.values as { messages: unknown[] }).messages;
    const result = saved(id, [
      ...base,
      ...(input as { messages: unknown[] }).messages,
      ai(`answer-${id}`, `Answer ${forks.length}`),
    ]);
    f.states.set(id, result);
    yield checkpointEvent(result);
  });
  const session = createSession({
    assistantId: 'agent',
    threadId: 'thread',
    transport: f.transport,
  });
  return { ...f, history, forks, session };
}
const contents = (session: ReturnType<typeof thread>['session']) =>
  session.getSnapshot().messages.map((message) => message.content);

describe('regenerate', () => {
  it('answers the last prompt again from the checkpoint before it', async () => {
    const t = thread();
    await t.session.load?.();
    expect(contents(t.session)).toEqual([
      'First question',
      'First answer',
      'Second question',
      'Second answer',
    ]);
    expect(await t.session.regenerate?.('a2')).toBe('success');
    expect(t.forks).toHaveLength(1);
    expect(t.forks[0].from).toBe('t1-done');
    expect((t.forks[0].input as { messages: { content: string }[] }).messages).toMatchObject([
      { type: 'human', content: 'Second question' },
    ]);
    expect(contents(t.session)).toEqual([
      'First question',
      'First answer',
      'Second question',
      'Answer 1',
    ]);
    expect(t.session.getSnapshot().status).toBe('idle');
  });

  it('answers an earlier prompt again and drops what followed it', async () => {
    const t = thread();
    await t.session.load?.();
    expect(await t.session.regenerate?.('a1')).toBe('success');
    expect(t.forks[0].from).toBe('start');
    expect(contents(t.session)).toEqual(['First question', 'Answer 1']);
  });

  it('rejects an id that is not an assistant message, without reading history', async () => {
    const t = thread();
    await t.session.load?.();
    const reads = vi.mocked(t.transport.getHistory!).mock.calls.length;
    await expect(t.session.regenerate?.('missing')).rejects.toThrow(/assistant message/);
    await expect(t.session.regenerate?.('u2')).rejects.toThrow(/assistant message/);
    expect(vi.mocked(t.transport.getHistory!).mock.calls).toHaveLength(reads);
    expect(t.forks).toHaveLength(0);
  });

  it('rejects when the checkpoint before the prompt is not in the history page', async () => {
    const t = thread();
    await t.session.load?.();
    t.transport.getHistory = vi.fn(async () => t.history.slice(0, 2));
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport: t.transport,
    });
    await session.load?.();
    await expect(session.regenerate?.('a2')).rejects.toThrow(/not in the loaded history/);
    expect(t.forks).toHaveLength(0);
    expect(contents(session)).toHaveLength(4);
  });

  it('rejects while a response is running', async () => {
    const t = thread();
    await t.session.load?.();
    const held = deferred<void>();
    t.transport.stream = vi.fn(async function* (_a, _t, _i, signal) {
      await Promise.race([
        held.promise,
        new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve())),
      ]);
      // Held until stopped; this run produces no events.
      yield* [];
    });
    const running = t.session.submit('Third question');
    await vi.waitFor(() => expect(t.session.getSnapshot().status).toBe('running'));
    await expect(t.session.regenerate?.('a2')).rejects.toThrow(/running/);
    await t.session.stop();
    await running;
  });

  it('rejects when the conversation changes while history is read', async () => {
    const t = thread();
    await t.session.load?.();
    const reading = deferred<ThreadState[]>();
    t.transport.getHistory = vi.fn(() => reading.promise);
    const pending = t.session.regenerate?.('a2');
    const disposed = t.session.dispose();
    reading.resolve(t.history);
    await expect(pending).rejects.toThrow();
    await disposed;
    expect(t.forks).toHaveLength(0);
  });

  it.each(['getHistory', 'getState', 'getRunStatus', 'joinStream'] as const)(
    'is not offered by a transport without %s',
    (capability) => {
      const f = fixture();
      delete f.transport[capability];
      const session = createSession({
        assistantId: 'agent',
        threadId: 'thread',
        transport: f.transport,
      });
      expect(session.regenerate).toBeUndefined();
    }
  );

  it('is offered by a transport that can fork', () => {
    expect(typeof thread().session.regenerate).toBe('function');
    expect(position('start').checkpoint_id).toBe('start');
  });
});
