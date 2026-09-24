import { expect, it, vi } from 'vitest';
import { createSession } from './create-session';
import type { AgentTransport } from './transport.types';

// Observe the private queue without replacing its scheduling or write callback.
// Public load admission deliberately excludes pending persistence; this seam lets
// us enqueue a cleanup flush at the exact pre-commit projection boundary.
const seam = vi.hoisted(() => ({
  persistence: undefined as
    | ReturnType<typeof import('./tool-persistence').createToolPersistence>
    | undefined,
  buffer: undefined as
    | ReturnType<typeof import('./function-tools').createToolBuffer>
    | undefined,
}));
vi.mock('./tool-persistence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./tool-persistence')>();
  return {
    createToolPersistence(
      ...args: Parameters<typeof actual.createToolPersistence>
    ) {
      seam.buffer = args[0];
      seam.persistence = actual.createToolPersistence(...args);
      return seam.persistence;
    },
  };
});

it('checks current conflict at the real queued write callback and quarantines the staged result', async () => {
  let flush: Promise<void> | undefined;
  let runs = 0;
  const original = { id: 'call', name: 'work', args: { city: 'Paris' } };
  const stream = vi.fn<AgentTransport['stream']>(async function* () {
    const calls =
      ++runs === 1
        ? [original]
        : [
            {
              ...original,
              args: {
                get city() {
                  // It is not yet a committed conflict when cleanup enters the real queue.
                  flush = seam.persistence?.flush(new AbortController().signal);
                  void flush?.catch(() => undefined);
                  return 'Tokyo';
                },
              },
            },
          ];
    yield {
      type: 'values',
      data: {
        messages: [
          {
            type: 'ai',
            id: `assistant-${runs}`,
            content: '',
            tool_calls: calls,
          },
        ],
      },
    };
  });
  const updateState = vi.fn(async () => undefined);
  const record = vi.fn(async () => undefined);
  const handler = vi.fn(() => 'Owned result');
  const session = createSession({
    assistantId: 'a',
    threadId: 't',
    transport: { stream, updateState, getHistory: async () => [] },
    executionStore: { claim: async () => 'claimed', record },
    tools: { work: { description: 'Work', handler } },
  });
  try {
    expect(await session.submit('Start')).toBe('interrupted');
    expect(flush).toBeDefined();
    await expect(flush).rejects.toThrow(/identity conflict/);
    expect(updateState).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledTimes(1);
    expect(stream).toHaveBeenCalledTimes(2);
    expect(seam.persistence?.pending).toBe(0);
    const staged = seam.buffer?.snapshot().messages;
    expect(staged).toMatchObject([
      { tool_call_id: 'call', content: 'Owned result' },
    ]);
    await session.load?.();
    expect(session.getSnapshot().error?.message).toMatch(/identity conflict/);
    expect(seam.buffer?.snapshot().messages).toEqual(staged);
    // A rejected callback retains the existing persistence failure latch.
    await expect(
      seam.persistence?.flush(new AbortController().signal)
    ).rejects.toThrow(/previous tool result write/);
    expect(updateState).not.toHaveBeenCalled();
  } finally {
    await session.dispose();
  }
});
