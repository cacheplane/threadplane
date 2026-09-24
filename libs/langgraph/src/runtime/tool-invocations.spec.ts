import type { PlainValue, ToolCall } from '@threadplane/core';
import { describe, expect, it } from 'vitest';
import { initialMessageState, reduceMessages } from './message-reducer';
import { projectHistory } from './history-projection';
import type { ThreadState } from '@langchain/langgraph-sdk';

const call = (
  args: PlainValue = { city: 'Paris' },
  name = 'weather'
): ToolCall => ({ id: 'call', name, args, status: 'pending' });
const admit = (toolCall = call()) =>
  reduceMessages(initialMessageState(), { type: 'tool-admitted', toolCall });
describe('owned session invocation facts', () => {
  it('keeps an externally observed conflict sticky on only the admitted invocation', () => {
    const before = admit();
    const after = reduceMessages(before, { type: 'tool-conflict', id: 'call' });
    expect(after.invocations[0].conflicted).toBe(true);
    expect(after.invocations[0].args).toBe(before.invocations[0].args);
    expect(
      reduceMessages(after, { type: 'tool-admitted', toolCall: call() })
    ).toBe(after);
    expect(reduceMessages(after, { type: 'tool-conflict', id: 'call' })).toBe(
      after
    );
    expect(
      reduceMessages(before, { type: 'tool-conflict', id: 'unknown' })
    ).toBe(before);
  });
  it('owns admitted data and preserves matching/no-op references', () => {
    const args = { nested: { city: 'Paris' } };
    const state = admit(call(args));
    args.nested.city = 'Tokyo';
    expect(state.invocations).toEqual([
      { id: 'call', name: 'weather', args: { nested: { city: 'Paris' } } },
    ]);
    expect(Object.isFrozen(state.invocations[0].args)).toBe(true);
    expect(
      reduceMessages(state, {
        type: 'tool-admitted',
        toolCall: call({ nested: { city: 'Paris' } }),
      })
    ).toBe(state);
  });
  it.each([
    [{ a: 1, b: 2 }, { b: 2, a: 1 }, false],
    [NaN, NaN, false],
    [0, -0, true],
    [{}, { a: undefined }, true],
    [new Array(1), [undefined], true],
    [new Array(1), new Array(2), true],
    [
      Object.assign(new Array(3), { 0: 1, 2: 3 }),
      Object.assign(new Array(3), { 0: 1, 2: 3 }),
      false,
    ],
  ] as const)(
    'compares exact plain arguments %#',
    (before, after, conflict) => {
      const admitted = admit(call(before));
      const projected = reduceMessages(admitted, {
        type: 'tool',
        toolCall: call(after),
      });
      expect(projected.invocations[0].conflicted === true).toBe(conflict);
      expect(projected.invocations[0].args).toEqual(before);
    }
  );
  it('permits corrections before explicit admission and does not infer admission from running status', () => {
    const pending = reduceMessages(initialMessageState(), {
      type: 'tool',
      toolCall: call(),
    });
    const corrected = reduceMessages(pending, {
      type: 'tool',
      toolCall: call({ city: 'Tokyo' }),
    });
    expect(corrected.invocations).toEqual([]);
    expect(corrected.toolCalls[0].args).toEqual({ city: 'Tokyo' });
    const running = reduceMessages(corrected, {
      type: 'tool',
      toolCall: { ...call(), status: 'running' },
    });
    expect(running.invocations).toEqual([]);
  });
  it('observes before settled suppression and never replaces bound arguments', () => {
    const admitted = admit();
    const complete = reduceMessages(admitted, {
      type: 'tool',
      toolCall: { ...call(), status: 'complete', result: 'Done' },
    });
    const conflict = reduceMessages(complete, {
      type: 'tool',
      toolCall: call({}, 'changed'),
    });
    expect(conflict.invocations[0].conflicted).toBe(true);
    expect(conflict.toolCalls).toBe(complete.toolCalls);
    expect(reduceMessages(conflict, { type: 'tool', toolCall: call() })).toBe(
      conflict
    );
    expect(
      reduceMessages(conflict, {
        type: 'tool-admitted',
        toolCall: call({}, 'changed'),
      })
    ).toBe(conflict);
  });
  it('checks overwritten raw history calls and keeps conflicts through empty/equal reads', () => {
    const state = admit();
    const message = (args: PlainValue) => ({
      id: 'same-message',
      type: 'ai',
      content: '',
      tool_calls: [call(args)],
    });
    const history = [
      {
        values: {
          messages: [
            message({ city: 'Tokyo' }),
            message({ city: 'Paris' }),
            { type: 'tool', tool_call_id: 'call', content: 'Wire' },
          ],
        },
      },
    ] as unknown as ThreadState[];
    const projected = projectHistory(state, history, {
      registeredTools: new Set(['weather']),
    });
    expect(projected.toolCalls).toEqual([]);
    expect(projected.invocations[0].conflicted).toBe(true);
    const empty = projectHistory(projected, []);
    expect(empty.invocations).toBe(projected.invocations);
    expect(projectHistory(empty, [])).toBe(empty);
  });

  it('captures bound history arguments once for both comparison and projection', () => {
    let reads = 0;
    const rawCall = {
      id: 'call',
      name: 'weather',
      get args() {
        reads += 1;
        return { city: reads === 1 ? 'Paris' : 'Tokyo' };
      },
    };
    const history = [
      {
        values: {
          messages: [
            { id: 'a', type: 'ai', content: '', tool_calls: [rawCall] },
          ],
        },
      },
    ] as unknown as ThreadState[];
    const projected = projectHistory(admit(), history);
    expect(reads).toBe(1);
    expect(projected.invocations[0].conflicted).toBeUndefined();
    expect(projected.toolCalls[0].args).toEqual({ city: 'Paris' });
  });

  it('does not inspect overwritten argument getters for observers without admissions', () => {
    const history = [
      {
        values: {
          messages: [
            {
              id: 'a',
              type: 'ai',
              content: '',
              tool_calls: [
                {
                  id: 'call',
                  name: 'weather',
                  get args() {
                    throw new Error('shadowed');
                  },
                },
              ],
            },
            { id: 'a', type: 'ai', content: 'replacement' },
          ],
        },
      },
    ] as unknown as ThreadState[];
    const projected = projectHistory(initialMessageState(), history);
    expect(projected.messages[0].content).toBe('replacement');
    expect(projected.invocations).toEqual([]);
  });
});
