import { describe, expect, it, vi } from 'vitest';
import type { PlainValue } from '@threadplane/core';
import type { ToolExecutionStore } from '@threadplane/core/tools';
import { captureTools, executeTool } from './function-tools';
import { createSession } from './create-session';
import { canonicalInvocation } from './tool-provenance';
import { deferred } from './testing/deferred';

const call = {
  id: 'call',
  name: 'work',
  args: { x: 1 },
  status: 'pending' as const,
};
const key = { threadId: 'thread', toolCallId: call.id };
const invocation = canonicalInvocation(call.name, call.args);
function definition(value: PlainValue = 'result') {
  const handler = vi.fn((): PlainValue => value);
  const def = captureTools({
    work: { description: 'Work', handler },
  }).definitions.get('work');
  if (!def) throw new Error('Missing definition');
  return { handler, def };
}
function store() {
  return {
    acquire: vi.fn<ToolExecutionStore['acquire']>(async () => ({
      status: 'acquired',
      token: 'owner',
    })),
    settle: vi.fn<ToolExecutionStore['settle']>(async () => 'accepted'),
  };
}

describe('durable execution authority', () => {
  it('captures provider capability getters once and binds their receiver', async () => {
    let acquireReads = 0,
      settleReads = 0,
      optionReads = 0;
    const provider: ToolExecutionStore = {
      get acquire() {
        acquireReads++;
        return async function (this: ToolExecutionStore) {
          expect(this).toBe(provider);
          return { status: 'acquired' as const, token: 'owner' };
        };
      },
      get settle() {
        settleReads++;
        return async function (this: ToolExecutionStore) {
          expect(this).toBe(provider);
          return 'accepted' as const;
        };
      },
    };
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      get executionStore() {
        optionReads++;
        return provider;
      },
      transport: {
        async *stream() {
          yield {
            type: 'values',
            data: {
              messages: [
                {
                  type: 'ai',
                  id: 'ai',
                  content: '',
                  tool_calls: [{ id: 'call', name: 'work', args: {} }],
                },
              ],
            },
          };
        },
        async updateState() {
          return undefined;
        },
      },
      tools: {
        work: { description: 'Work', followUp: false, handler: () => 'saved' },
      },
    });
    try {
      expect(await session.submit('Go')).toBe('success');
      expect([optionReads, acquireReads, settleReads]).toEqual([1, 1, 1]);
    } finally {
      await session.dispose();
    }
  });
  it('executes only with captured owner authority and settles the original invocation', async () => {
    const f = definition(),
      guard = store();
    const result = await executeTool(
      f.def,
      call,
      new AbortController().signal,
      key,
      guard
    );
    expect(result).toEqual({
      type: 'settled',
      result: { ok: true, value: 'result' },
    });
    expect(guard.acquire).toHaveBeenCalledWith(key, invocation);
    expect(guard.settle).toHaveBeenCalledWith(key, {
      invocation,
      token: 'owner',
      result: '{"ok":true,"value":"result"}',
    });
    expect(f.handler).toHaveBeenCalledTimes(1);
  });
  it.each([undefined, -0, NaN, Infinity, { x: undefined }, Array(1)])(
    'keeps exact original result %j while storing non-reusable marker',
    async (value) => {
      const f = definition(value),
        guard = store();
      // default parameters intentionally do not stand in for an authored undefined result.
      f.handler.mockReturnValue(value);
      const result = await executeTool(
        f.def,
        call,
        new AbortController().signal,
        key,
        guard
      );
      expect(result).toEqual({ type: 'settled', result: { ok: true, value } });
      expect(guard.settle).toHaveBeenCalledWith(key, {
        invocation,
        token: 'owner',
        result: null,
      });
    }
  );
  it.each([
    null,
    undefined,
    'acquired',
    { status: 'acquired', token: '' },
    { status: 'complete', result: '{}' },
    { status: 'unavailable' },
  ])(
    'does not execute or settle malformed/unavailable acquisition %j',
    async (response) => {
      const f = definition(),
        guard = store();
      guard.acquire.mockResolvedValue(response as never);
      expect(
        (
          await executeTool(
            f.def,
            call,
            new AbortController().signal,
            key,
            guard
          )
        ).type
      ).toBe('unavailable');
      expect(f.handler).not.toHaveBeenCalled();
      expect(guard.settle).not.toHaveBeenCalled();
    }
  );
  it('reports conflict as a fact without executing or settling', async () => {
    const f = definition(),
      guard = store();
    guard.acquire.mockResolvedValue({ status: 'conflict' });
    expect(
      await executeTool(f.def, call, new AbortController().signal, key, guard)
    ).toEqual({ type: 'conflict' });
    expect(f.handler).not.toHaveBeenCalled();
    expect(guard.settle).not.toHaveBeenCalled();
  });
  it.each(['rejected', undefined, {}, 'unknown'])(
    'does not publish completion after acknowledgment %j',
    async (response) => {
      const f = definition(),
        guard = store();
      guard.settle.mockResolvedValue(response as never);
      expect(
        (
          await executeTool(
            f.def,
            call,
            new AbortController().signal,
            key,
            guard
          )
        ).type
      ).toBe('unavailable');
      expect(f.handler).toHaveBeenCalledTimes(1);
      expect(guard.settle).toHaveBeenCalledTimes(1);
    }
  );
  it('reuses exact encoded strings without settlement authority', async () => {
    const f = definition(),
      guard = store();
    guard.acquire.mockResolvedValue({
      status: 'complete',
      result: '{"ok":true,"value":"Error: literal"}',
    });
    expect(
      await executeTool(f.def, call, new AbortController().signal, key, guard)
    ).toEqual({
      type: 'settled',
      result: { ok: true, value: 'Error: literal' },
    });
    expect(f.handler).not.toHaveBeenCalled();
    expect(guard.settle).not.toHaveBeenCalled();
  });
  it('settles cancellation only for a late acquired owner', async () => {
    const f = definition(),
      guard = store(),
      controller = new AbortController();
    const acquisition =
      deferred<Awaited<ReturnType<ToolExecutionStore['acquire']>>>();
    guard.acquire.mockReturnValue(acquisition.promise);
    const execution = executeTool(f.def, call, controller.signal, key, guard);
    controller.abort();
    acquisition.resolve({ status: 'acquired', token: 'late-owner' });
    expect((await execution).type).toBe('settled');
    expect(f.handler).not.toHaveBeenCalled();
    expect(guard.settle).toHaveBeenCalledWith(key, {
      invocation,
      token: 'late-owner',
      result: expect.stringContaining('cancelled'),
    });
  });
  it('rejects the old provider before transport or handler effects', () => {
    const stream = vi.fn(),
      handler = vi.fn(() => undefined);
    expect(() =>
      createSession({
        assistantId: 'agent',
        threadId: 'thread',
        transport: { stream },
        executionStore: {
          claim: async () => 'claimed',
          record: async () => undefined,
        } as never,
        tools: { work: { description: 'Work', handler } },
      })
    ).toThrow(/acquire.*settle/);
    expect(stream).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });
});
