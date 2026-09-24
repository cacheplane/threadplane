import type { ThreadState } from '@langchain/langgraph-sdk';
import type { ToolExecutionStore } from '@threadplane/core/tools';
import { describe, expect, it, vi } from 'vitest';
import { createSession } from './create-session';
import type { AgentTransport, StreamEvent } from './transport.types';
import { deferred } from './testing/deferred';

const original = {
  id: 'shared-call',
  name: 'weather',
  args: { city: 'Paris' },
};
const fresh = { id: 'fresh-call', name: 'fresh', args: {} };
const assistant = (calls: unknown[], id = 'assistant') => ({
  type: 'ai',
  id,
  content: '',
  tool_calls: calls,
});
const event = (calls: unknown[], id: string): StreamEvent => ({
  type: 'values',
  data: { messages: [assistant(calls, id)] },
});
const final: StreamEvent = {
  type: 'values',
  data: { messages: [{ type: 'ai', id: 'answer', content: 'Done' }] },
};
function fixture(
  changed: typeof original,
  guarded: boolean,
  historyFirst = false,
  idempotent = false
) {
  const events = [
    [event([original], 'first')],
    historyFirst ? [final] : [event([changed, fresh], 'second')],
    [final],
  ];
  const stream = vi.fn<AgentTransport['stream']>(async function* () {
    for (const value of events.shift() ?? [final]) yield value;
  });
  let messages: unknown[] = [];
  const getHistory = vi.fn(async () =>
    messages.length
      ? [
          {
            values: { messages },
            next: [],
            tasks: [],
            checkpoint: {
              thread_id: 'thread',
              checkpoint_id: 'saved',
              checkpoint_ns: '',
              checkpoint_map: {},
            },
            metadata: null,
            created_at: null,
            parent_checkpoint: null,
          } as ThreadState,
        ]
      : []
  );
  const updateState = vi.fn(async () => undefined);
  const executionStore = {
    claim: vi.fn<ToolExecutionStore['claim']>(async () => 'claimed'),
    record: vi.fn<ToolExecutionStore['record']>(async () => undefined),
  };
  const weather = vi.fn(() => ({ saved: true }));
  const alternate = vi.fn(() => ({ saved: true }));
  const freshHandler = vi.fn(() => ({ saved: true }));
  const session = createSession({
    assistantId: 'agent',
    threadId: 'thread',
    transport: { stream, getHistory, updateState },
    ...(guarded ? { executionStore } : {}),
    tools: {
      weather: { description: 'Weather', handler: weather, idempotent },
      alternate: { description: 'Alternate', handler: alternate },
      fresh: { description: 'Fresh', handler: freshHandler },
    },
  });
  return {
    session,
    stream,
    getHistory,
    updateState,
    executionStore,
    weather,
    alternate,
    freshHandler,
    events,
    history: (next: unknown[]) => {
      messages = next;
    },
  };
}

describe('session invocation identity', () => {
  it('aborts the conflicted live stream without waiting for iterator cleanup', async () => {
    const released = deferred<void>();
    const closing = deferred<void>();
    let signal: AbortSignal | undefined;
    let runs = 0;
    const stream: AgentTransport['stream'] = async function* (
      _a,
      _t,
      _p,
      currentSignal
    ) {
      if (++runs === 1) {
        yield event([original], 'first');
        return;
      }
      signal = currentSignal;
      try {
        yield event([{ ...original, args: { city: 'Tokyo' } }], 'second');
      } finally {
        closing.resolve();
        await released.promise;
      }
    };
    const session = createSession({
      assistantId: 'a',
      threadId: 't',
      transport: { stream },
      tools: {
        weather: { description: 'Weather', handler: () => 'Done' },
      },
    });
    try {
      expect(await session.submit('Start')).toBe('interrupted');
      await closing.promise;
      expect(signal?.aborted).toBe(true);
    } finally {
      released.resolve();
      await session.dispose();
    }
  });
  it('also binds idempotent tools without claiming durable ownership', async () => {
    const f = fixture(
      { ...original, args: { city: 'Tokyo' } },
      true,
      false,
      true
    );
    expect(await f.session.submit('Start')).toBe('interrupted');
    expect(f.weather).toHaveBeenCalledTimes(1);
    expect(f.freshHandler).not.toHaveBeenCalled();
    expect(f.executionStore.claim).not.toHaveBeenCalled();
    expect(f.executionStore.record).not.toHaveBeenCalled();
    await f.session.dispose();
  });

  it('accepts matching duplicates without rerunning their handler', async () => {
    const f = fixture(original, true);
    expect(await f.session.submit('Start')).toBe('success');
    expect(f.weather).toHaveBeenCalledTimes(1);
    expect(f.freshHandler).toHaveBeenCalledTimes(1);
    expect(f.stream).toHaveBeenCalledTimes(3);
    expect(f.session.getSnapshot().error).toBeUndefined();
    await f.session.dispose();
  });

  it('executes the final pending correction before any admission', async () => {
    const changed = { ...original, args: { city: 'Tokyo' } };
    const f = fixture(changed, true, true);
    f.events[0].push(event([changed], 'first'));
    expect(await f.session.submit('Start')).toBe('success');
    expect(f.weather).toHaveBeenCalledExactlyOnceWith(
      changed.args,
      expect.anything()
    );
    expect(f.session.getSnapshot().error).toBeUndefined();
    await f.session.dispose();
  });

  it('retains admission when a running observer stops before a guarded claim starts', async () => {
    const f = fixture(original, true, true);
    const off = f.session.subscribe(() => {
      if (
        f.session
          .getSnapshot()
          .toolCalls.some((call) => call.status === 'running')
      )
        void f.session.stop();
    });
    expect(await f.session.submit('Start')).toBe('aborted');
    off();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(f.executionStore.claim).not.toHaveBeenCalled();
    expect(f.weather).not.toHaveBeenCalled();
    f.history([assistant([{ ...original, args: { city: 'Tokyo' } }])]);
    await f.session.load?.();
    expect(f.session.getSnapshot().error?.message).toMatch(/identity conflict/);
    await f.session.dispose();
  });

  it('leaves no-catalog observers free to observe same-ID corrections', async () => {
    const stream = vi.fn<AgentTransport['stream']>(async function* () {
      yield event([original], 'first');
      yield event([{ ...original, args: { city: 'Tokyo' } }], 'second');
    });
    const session = createSession({
      assistantId: 'a',
      threadId: 't',
      transport: { stream },
    });
    expect(await session.submit('Observe')).toBe('success');
    expect(session.getSnapshot().toolCalls[0].args).toEqual({ city: 'Tokyo' });
    expect(session.getSnapshot().error).toBeUndefined();
    await session.dispose();
  });

  it('leaves child observations independent of root admissions', async () => {
    const f = fixture(original, false, true);
    f.events[1].unshift({
      ...event([{ ...original, args: { city: 'Tokyo' } }], 'child'),
      namespace: ['child:task'],
    });
    expect(await f.session.submit('Start')).toBe('success');
    expect(f.weather).toHaveBeenCalledTimes(1);
    expect(f.session.getSnapshot().error).toBeUndefined();
    expect(f.session.getSnapshot().subgraphs).toHaveLength(1);
    await f.session.dispose();
  });

  it('does not allow pause completion to mask a finalized conflict', async () => {
    const f = fixture({ ...original, name: 'unregistered' }, false);
    f.events[1].unshift({
      type: 'updates',
      data: { __interrupt__: [{ value: 'Proceed?' }] },
    });
    expect(await f.session.submit('Start')).toBe('interrupted');
    expect(f.session.getSnapshot().error?.message).toMatch(/identity conflict/);
    expect(f.freshHandler).not.toHaveBeenCalled();
    await f.session.dispose();
  });

  it('retains identity while reconnecting an interrupted continuation', async () => {
    let runs = 0;
    const stream = vi.fn<AgentTransport['stream']>(async function* (
      _a,
      _t,
      _p,
      _s,
      options
    ) {
      options?.onRunCreated?.({ run_id: `run-${++runs}`, thread_id: 't' });
      if (runs === 1) yield { ...event([original], 'first'), sseId: '1' };
      else
        yield {
          type: 'messages',
          sseId: '2',
          messageMetadata: {},
          messages: [
            { type: 'AIMessageChunk', id: 'answer', content: 'Partial' },
          ],
        };
    });
    const joinStream = vi.fn<NonNullable<AgentTransport['joinStream']>>(
      async function* () {
        yield {
          ...event([{ ...original, name: 'unregistered' }, fresh], 'joined'),
          sseId: '3',
        };
      }
    );
    const getRunStatus = vi.fn<NonNullable<AgentTransport['getRunStatus']>>(
      async () => (runs === 1 ? 'success' : 'running')
    );
    const weather = vi.fn(() => 'Done');
    const freshHandler = vi.fn(() => 'Fresh');
    const session = createSession({
      assistantId: 'a',
      threadId: 't',
      transport: { stream, joinStream, getRunStatus },
      tools: {
        weather: { description: 'Weather', handler: weather },
        fresh: { description: 'Fresh', handler: freshHandler },
      },
    });
    expect(await session.submit('Start')).toBe('interrupted');
    expect(session.getSnapshot().reconnect).toEqual({ runId: 'run-2' });
    expect(await session.reconnect()).toBe('interrupted');
    expect(session.getSnapshot().error?.message).toMatch(/identity conflict/);
    expect(session.getSnapshot().reconnect).toBeUndefined();
    expect(weather).toHaveBeenCalledTimes(1);
    expect(freshHandler).not.toHaveBeenCalled();
    expect(stream).toHaveBeenCalledTimes(2);
    expect(joinStream).toHaveBeenCalledTimes(1);
    await expect(session.reconnect()).rejects.toThrow(/identity conflict/);
    await session.dispose();
  });

  it.each(['check', 'automatic'] as const)(
    'protects against history conflict during %s reconciliation',
    async (mode) => {
      const f = fixture(original, false, true);
      expect(await f.session.submit('Admit')).toBe('success');
      f.events.splice(0, f.events.length, []);
      const changed = { ...original, args: { city: 'Tokyo' } };
      if (mode === 'automatic') f.history([assistant([changed])]);
      expect(await f.session.submit('Disconnected')).toBe('interrupted');
      if (mode === 'check') {
        expect(f.session.getSnapshot().error?.recovery).toBe('check');
        f.history([assistant([changed])]);
        await f.session.checkStatus?.();
      }
      expect(f.session.getSnapshot()).toMatchObject({
        status: 'error',
        error: {
          recovery: 'none',
          message: expect.stringMatching(/identity conflict/),
        },
      });
      await expect(f.session.submit('Blocked')).rejects.toThrow(
        /identity conflict/
      );
      f.history([]);
      await f.session.load?.();
      expect(f.session.getSnapshot().error?.message).toMatch(
        /identity conflict/
      );
      await f.session.dispose();
    }
  );

  it('does not stamp recovered delivery successful when later history projection discovers a conflict', async () => {
    const f = fixture(original, false, true);
    expect(await f.session.submit('Admit')).toBe('success');
    f.events.splice(0, f.events.length, []);
    expect(await f.session.submit('Disconnected')).toBe('interrupted');
    const human = (f.stream.mock.calls.at(-1)?.[2] as { messages: unknown[] })
      .messages[0];
    let reads = 0;
    f.history([
      human,
      assistant(
        [
          {
            id: original.id,
            name: original.name,
            get args() {
              return { city: ++reads === 1 ? 'Paris' : 'Tokyo' };
            },
          },
        ],
        'recovered'
      ),
    ]);
    await f.session.checkStatus?.();
    expect(f.session.getSnapshot().error?.message).toMatch(/identity conflict/);
    expect(
      f.session
        .getSnapshot()
        .messages.find((message) => message.id === 'recovered')?.delivery
    ).toMatchObject({ phase: 'complete', outcome: 'interrupted' });
    expect(f.weather).toHaveBeenCalledTimes(1);
    expect(f.stream).toHaveBeenCalledTimes(3);
    await f.session.dispose();
  });

  for (const route of ['load', 'check'] as const) {
    it.each(['stop', 'throw'] as const)(
      `does not commit a ${route} conflict after a projection getter's %s`,
      async (effect) => {
        const f = fixture(original, false, true);
        expect(await f.session.submit('Admit')).toBe('success');
        if (route === 'check') {
          f.events.splice(0, f.events.length, []);
          expect(await f.session.submit('Disconnected')).toBe('interrupted');
        }
        f.history([
          assistant([
            {
              ...original,
              args: {
                get city() {
                  if (effect === 'throw') throw new Error('Projection failed');
                  void f.session.stop();
                  return 'Tokyo';
                },
              },
            },
          ]),
        ]);
        const reading =
          route === 'load' ? f.session.load?.() : f.session.checkStatus?.();
        if (effect === 'throw') await expect(reading).rejects.toThrow();
        else await reading;
        expect(f.session.getSnapshot().error?.message ?? '').not.toMatch(
          /identity conflict/
        );
        f.history([]);
        expect(await f.session.submit('Still usable')).toBe('success');
        await f.session.dispose();
      }
    );
  }

  it('does not compare cyclic history arguments or commit their partial conflict', async () => {
    const f = fixture(original, false, true);
    expect(await f.session.submit('Admit')).toBe('success');
    const cyclic: Record<string, unknown> = { city: 'Tokyo' };
    cyclic['self'] = cyclic;
    f.history([assistant([{ ...original, args: cyclic }])]);
    await expect(f.session.load?.()).rejects.toThrow();
    expect(f.session.getSnapshot().error).toBeUndefined();
    f.history([]);
    expect(await f.session.submit('Still usable')).toBe('success');
    await f.session.dispose();
  });

  it('does not commit a conflict when another history projection branch fails', async () => {
    const f = fixture(original, false, true);
    expect(await f.session.submit('Admit')).toBe('success');
    f.history([
      assistant([{ ...original, args: { city: 'Tokyo' } }]),
      {
        type: 'ai',
        id: 'broken',
        get content() {
          throw new Error('Failed text projection');
        },
      },
    ]);
    await expect(f.session.load?.()).rejects.toThrow();
    expect(f.session.getSnapshot().error).toBeUndefined();
    f.history([]);
    expect(await f.session.submit('Still usable')).toBe('success');
    await f.session.dispose();
  });
  for (const guarded of [false, true]) {
    it.each(['args', 'name'] as const)(
      `blocks a contradictory %s continuation (guarded=${guarded})`,
      async (field) => {
        const changed =
          field === 'args'
            ? { ...original, args: { city: 'Tokyo' } }
            : { ...original, name: 'alternate' };
        const f = fixture(changed, guarded);
        expect(await f.session.submit('Start')).toBe('interrupted');
        expect(f.session.getSnapshot().error).toMatchObject({
          kind: 'interrupted',
          recovery: 'none',
          retryable: false,
        });
        expect(f.weather).toHaveBeenCalledTimes(1);
        expect(f.alternate).not.toHaveBeenCalled();
        expect(f.freshHandler).not.toHaveBeenCalled();
        expect(f.stream).toHaveBeenCalledTimes(2);
        expect(f.updateState).not.toHaveBeenCalled();
        expect(f.executionStore.claim).toHaveBeenCalledTimes(guarded ? 1 : 0);
        expect(f.executionStore.record).toHaveBeenCalledTimes(guarded ? 1 : 0);
        await f.session.dispose();
      }
    );

    it.each(['args', 'name'] as const)(
      `retains a first history receipt's %s conflict (guarded=${guarded})`,
      async (field) => {
        const changed =
          field === 'args'
            ? { ...original, args: { city: 'Tokyo' } }
            : { ...original, name: 'unregistered' };
        const f = fixture(changed, guarded, true);
        expect(await f.session.submit('Start')).toBe('success');
        f.history([
          assistant([changed]),
          {
            type: 'tool',
            id: 'receipt',
            tool_call_id: original.id,
            content: 'Wire result',
          },
        ]);
        await f.session.load?.();
        expect(f.session.getSnapshot().toolCalls).toEqual([]);
        expect(f.session.getSnapshot().error).toMatchObject({
          kind: 'interrupted',
          recovery: 'none',
        });
        for (const messages of [[], [assistant([], 'unrelated')]]) {
          f.history(messages);
          await f.session.load?.();
          expect(f.session.getSnapshot().error).toMatchObject({
            kind: 'interrupted',
            recovery: 'none',
          });
        }
        const reads = f.getHistory.mock.calls.length;
        await expect(f.session.submit('Again')).rejects.toThrow(
          /identity|conflict/i
        );
        await expect(f.session.resume()).rejects.toThrow(/identity|conflict/i);
        await expect(f.session.reconnect()).rejects.toThrow(
          /identity|conflict/i
        );
        expect(f.stream).toHaveBeenCalledTimes(2);
        expect(f.getHistory).toHaveBeenCalledTimes(reads);
        expect(f.updateState).not.toHaveBeenCalled();
        await f.session.dispose();
      }
    );
  }
});
