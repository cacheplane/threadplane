import type { ThreadState } from '@langchain/langgraph-sdk';
import { describe, expect, it, vi } from 'vitest';
import { createSession } from './create-session';
import { checkpointEvent, fixture, position, saved } from './testing/checkpoint-fixture';
import { deferred } from './testing/deferred';

const human = (id: string, content: string) => ({ id, type: 'human', content });
const ai = (id: string, content: string) => ({ id, type: 'ai', content });
const turn1 = [human('u1', 'First question'), ai('a1', 'First answer')];
const turn2 = [...turn1, human('u2', 'Second question'), ai('a2', 'Second answer')];

/** The checkpoint a real run saves when it accepts its input: the state before
 * the prompt, with the graph's entry still to run. */
const inputCheckpoint = (id: string, messages: unknown[], prompt: unknown) =>
  saved(id, messages, {
    next: ['__start__'],
    tasks: [
      {
        id: `task-${id}`,
        name: '__start__',
        path: ['__pregel_pull', '__start__'],
        error: null,
        interrupts: [],
        checkpoint: null,
        state: null,
        result: { messages: [prompt] },
      },
    ],
    metadata: { run_id: `run-${id}`, source: 'input' },
  });
/** The checkpoint after the entry wrote the prompt, with the model node next. */
const loopCheckpoint = (id: string, messages: unknown[]) =>
  saved(id, messages, {
    next: ['generate'],
    tasks: [
      {
        id: `task-${id}`,
        name: 'generate',
        path: ['__pregel_pull', 'generate'],
        error: null,
        interrupts: [],
        checkpoint: null,
        state: null,
        result: null,
      },
    ],
    metadata: { run_id: `run-${id}`, source: 'loop' },
  });
/** Two finished turns as a LangGraph server saves them, newest first: every
 * run leaves an input checkpoint, a step checkpoint and a completed one. */
const serverHistory = () => [
  saved('t2-done', turn2),
  loopCheckpoint('t2-loop', turn2.slice(0, 3)),
  inputCheckpoint('t2-input', turn1, turn2[2]),
  saved('t1-done', turn1),
  loopCheckpoint('t1-loop', turn1.slice(0, 1)),
  inputCheckpoint('t1-input', [], turn1[0]),
];

/** A thread with two finished turns and a checkpoint saved at every step, newest first. */
function thread(
  history = [
    saved('t2-done', turn2),
    saved('t2-input', turn2.slice(0, 3)),
    saved('t1-done', turn1),
    saved('t1-input', turn1.slice(0, 1)),
    saved('start', []),
  ]
) {
  const f = fixture();
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

  it('sends the run settings it is given with the regenerated run', async () => {
    const t = thread();
    await t.session.load?.();
    const created: string[] = [];
    expect(
      await t.session.regenerate?.('a2', {
        config: { configurable: { model: 'small' }, tags: ['again'] },
        context: { tone: 'brief' },
        metadata: { reason: 'regenerate' },
        run: {
          interruptBefore: ['tools'],
          streamMode: ['debug'],
          onRunCreated: (run) => created.push(run.run_id),
          // The run starts from the checkpoint before the prompt, whatever
          // checkpoint the settings name.
          checkpointId: 't2-done',
        },
      })
    ).toBe('success');
    const stream = vi.mocked(t.transport.stream);
    const sent = stream.mock.calls.at(-1)?.[4];
    expect(sent).toMatchObject({
      config: { configurable: { model: 'small' }, tags: ['again'] },
      context: { tone: 'brief' },
      metadata: { reason: 'regenerate' },
      interruptBefore: ['tools'],
      checkpoint: { checkpoint_id: 't1-done' },
    });
    expect(sent?.streamMode).toContain('debug');
    expect(sent?.streamMode).toContain('values');
    expect(sent).not.toHaveProperty('checkpointId');
    expect(sent).not.toHaveProperty('run');
    expect(created).toEqual(['run-regenerated-1']);
    expect(t.forks[0].from).toBe('t1-done');
  });

  it('answers an earlier prompt again and drops what followed it', async () => {
    const t = thread();
    await t.session.load?.();
    expect(await t.session.regenerate?.('a1')).toBe('success');
    expect(t.forks[0].from).toBe('start');
    expect(contents(t.session)).toEqual(['First question', 'Answer 1']);
  });

  describe('on the history a LangGraph server saves', () => {
    it('answers the first prompt again from the checkpoint its run saved on accepting the input', async () => {
      const t = thread(serverHistory());
      await t.session.load?.();
      expect(await t.session.regenerate?.('a1')).toBe('success');
      expect(t.forks).toHaveLength(1);
      // The thread holds no completed checkpoint before its first prompt.
      expect(t.forks[0].from).toBe('t1-input');
      expect(
        (t.forks[0].input as { messages: { content: string }[] }).messages
      ).toMatchObject([{ type: 'human', content: 'First question' }]);
      expect(contents(t.session)).toEqual(['First question', 'Answer 1']);
      expect(t.session.getSnapshot().status).toBe('idle');
    });

    it('answers a later prompt again and keeps the turns before it', async () => {
      const t = thread(serverHistory());
      await t.session.load?.();
      expect(await t.session.regenerate?.('a2')).toBe('success');
      expect(t.forks[0].from).toBe('t2-input');
      expect(contents(t.session)).toEqual([
        'First question',
        'First answer',
        'Second question',
        'Answer 1',
      ]);
      // The regenerated branch accepts the next message.
      expect(await t.session.submit('Third question')).toBe('success');
      expect(t.forks[1].from).toBe('regenerated-1');
    });

    it('rejects a source with graph work other than its waiting input', async () => {
      const history = serverHistory();
      // The entry failed: this is not a checkpoint that only awaits input.
      (history[5].tasks[0] as { error: unknown }).error = 'failed';
      const t = thread(history);
      await t.session.load?.();
      await expect(t.session.regenerate?.('a1')).rejects.toThrow();
      expect(t.forks).toHaveLength(0);
      expect(contents(t.session)).toHaveLength(4);
    });

    it('leaves fork itself refusing a checkpoint with remaining work', async () => {
      const t = thread(serverHistory());
      await t.session.load?.();
      await expect(
        t.session.fork(position('t1-input'), 'Another question')
      ).rejects.toThrow();
      await expect(
        t.session.fork(position('t2-loop'), 'Another question')
      ).rejects.toThrow();
      expect(t.forks).toHaveLength(0);
    });
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

  it('is offered by the owned transport unless SDK request retries are on', async () => {
    const owned = (clientOptions?: { maxRetries: number }) =>
      createSession({
        assistantId: 'agent',
        threadId: 'thread',
        apiUrl: 'https://runtime.example/api',
        ...(clientOptions ? { clientOptions } : {}),
      });
    const sessions = [owned(), owned({ maxRetries: 0 }), owned({ maxRetries: 2 })];
    expect(sessions.map((session) => typeof session.regenerate)).toEqual([
      'function',
      'function',
      'undefined',
    ]);
    await Promise.all(sessions.map((session) => session.dispose()));
  });

  it('is offered by a transport that can fork', () => {
    expect(typeof thread().session.regenerate).toBe('function');
    expect(position('start').checkpoint_id).toBe('start');
  });
});
