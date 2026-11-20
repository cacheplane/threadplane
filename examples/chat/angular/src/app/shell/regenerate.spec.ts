import { signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import type { DemoAgent } from './agent-ref';
import { checkpointBefore, regenerateFromCheckpoint } from './regenerate';

type Checkpoints = NonNullable<ReturnType<DemoAgent['checkpoints']>>;
type Messages = ReturnType<DemoAgent['messages']>;

const human = (id: string, content: string) => ({ id, type: 'human', content });
const ai = (id: string, content: string) => ({ id, type: 'ai', content });
/** One saved checkpoint: its id, the node it would run next, and its messages. */
const saved = (id: string, label: string | undefined, messages: unknown[]) =>
  ({ id, label, values: { messages } }) as unknown as Checkpoints[number];

/** A thread's page after two turns, oldest first, as a LangGraph deployment saves it. */
const TWO_TURNS: Checkpoints = [
  saved('t1-input', '__start__', []),
  saved('t1-generate', 'generate', [human('u1', 'Q1')]),
  saved('t1-done', undefined, [human('u1', 'Q1'), ai('a1', 'A1')]),
  saved('t2-input', '__start__', [human('u1', 'Q1'), ai('a1', 'A1')]),
  saved('t2-generate', 'generate', [human('u1', 'Q1'), ai('a1', 'A1'), human('u2', 'Q2')]),
  saved('t2-done', undefined, [human('u1', 'Q1'), ai('a1', 'A1'), human('u2', 'Q2'), ai('a2', 'A2')]),
];

const transcript = [
  { id: 'u1', role: 'user', content: 'Q1' },
  { id: 'a1', role: 'assistant', content: 'A1' },
  { id: 'u2', role: 'user', content: 'Q2' },
  { id: 'a2', role: 'assistant', content: 'A2' },
] as unknown as Messages;

/** `null`: no history page has been loaded. */
function harness(checkpoints: Checkpoints | null = TWO_TURNS) {
  const page = signal<Checkpoints | undefined>(checkpoints ?? undefined);
  const status = signal<'idle' | 'running'>('idle');
  const messages = signal<Messages>(transcript);
  const submit = vi.fn(async () => 'success' as const);
  const agent = { messages, status, checkpoints: page } as unknown as Pick<
    DemoAgent,
    'messages' | 'status' | 'checkpoints'
  >;
  return {
    page,
    status,
    messages,
    submit,
    regenerate: regenerateFromCheckpoint(agent, submit as unknown as DemoAgent['submit'], 60),
  };
}

describe('checkpointBefore', () => {
  it('is the newest checkpoint that does not hold the prompt yet', () => {
    expect(checkpointBefore(TWO_TURNS, 'u2')).toBe('t2-input');
    expect(checkpointBefore(TWO_TURNS, 'u1')).toBe('t1-input');
  });

  it('is undefined when every loaded checkpoint holds the prompt, or none is loaded', () => {
    expect(checkpointBefore(TWO_TURNS.slice(1, 3), 'u1')).toBeUndefined();
    expect(checkpointBefore(undefined, 'u1')).toBeUndefined();
    expect(checkpointBefore([], 'u1')).toBeUndefined();
  });

  it('skips a checkpoint the backend sent without an id', () => {
    const page = [saved('older', undefined, []), saved(undefined as unknown as string, '__start__', [])];
    expect(checkpointBefore(page, 'u1')).toBe('older');
  });
});

describe('regenerateFromCheckpoint', () => {
  it('sends the prompt again as a run from the checkpoint before it', async () => {
    const t = harness();
    expect(await t.regenerate('a2')).toBe('success');
    expect(t.submit).toHaveBeenCalledExactlyOnceWith(
      { message: 'Q2' },
      { run: { checkpointId: 't2-input' } },
    );
  });

  it('regenerates an earlier answer from the checkpoint before its own prompt', async () => {
    const t = harness();
    await t.regenerate('a1');
    expect(t.submit).toHaveBeenCalledExactlyOnceWith(
      { message: 'Q1' },
      { run: { checkpointId: 't1-input' } },
    );
  });

  it('keeps the run settings the caller passed, beside the checkpoint', async () => {
    const t = harness();
    const signal = new AbortController().signal;
    await t.regenerate('a2', { signal, run: { durability: 'sync' } });
    expect(t.submit).toHaveBeenCalledExactlyOnceWith(
      { message: 'Q2' },
      { signal, run: { durability: 'sync', checkpointId: 't2-input' } },
    );
  });

  it('rejects for anything that is not an assistant message with a prompt before it', async () => {
    const t = harness();
    await expect(t.regenerate('missing')).rejects.toThrow(/assistant message/);
    await expect(t.regenerate('u2')).rejects.toThrow(/assistant message/);
    t.messages.set(transcript.slice(1));
    await expect(t.regenerate('a1')).rejects.toThrow(/No prompt precedes/);
    expect(t.submit).not.toHaveBeenCalled();
  });

  it('rejects while a response is running', async () => {
    const t = harness();
    t.status.set('running');
    await expect(t.regenerate('a2')).rejects.toThrow(/running/);
    expect(t.submit).not.toHaveBeenCalled();
  });

  it('waits for the history page of the run it answers again', async () => {
    // The page still ends at the first turn: the read after turn two has not landed.
    const t = harness(TWO_TURNS.slice(0, 3));
    const pending = t.regenerate('a2');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(t.submit).not.toHaveBeenCalled();
    t.page.set(TWO_TURNS);
    await pending;
    expect(t.submit).toHaveBeenCalledExactlyOnceWith(
      { message: 'Q2' },
      { run: { checkpointId: 't2-input' } },
    );
  });

  it('starts from the previous turn when the newer page never arrives', async () => {
    // The last checkpoint of turn one holds everything before the prompt, so
    // it is as good a starting point as turn two's input checkpoint.
    const t = harness(TWO_TURNS.slice(0, 3));
    await t.regenerate('a2');
    expect(t.submit).toHaveBeenCalledExactlyOnceWith(
      { message: 'Q2' },
      { run: { checkpointId: 't1-done' } },
    );
  });

  it('rejects when no loaded checkpoint precedes the prompt', async () => {
    const unloaded = harness(null);
    await expect(unloaded.regenerate('a1')).rejects.toThrow(/not in the loaded history/);
    expect(unloaded.submit).not.toHaveBeenCalled();

    // A page that starts after the prompt was saved cannot answer either.
    const late = harness(TWO_TURNS.slice(1));
    await expect(late.regenerate('a1')).rejects.toThrow(/not in the loaded history/);
    expect(late.submit).not.toHaveBeenCalled();
  });

  it('rejects when the conversation moves on while it waits', async () => {
    const t = harness(TWO_TURNS.slice(0, 3));
    const pending = t.regenerate('a2');
    t.status.set('running');
    await expect(pending).rejects.toThrow(/conversation changed/);
    expect(t.submit).not.toHaveBeenCalled();
  });
});
