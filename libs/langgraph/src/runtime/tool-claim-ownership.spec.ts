import { canonicalInvocation } from './tool-provenance';
import { describe, expect, it, vi } from 'vitest';
import type { ThreadState } from '@langchain/langgraph-sdk';
import type { ToolExecutionStore } from '@threadplane/core/tools';
import { createSession } from './create-session';
import type { AgentTransport, StreamEvent } from './transport.types';
import { deferred } from './testing/deferred';

const key = { threadId: 'thread', toolCallId: 'foreign' };
function call(id: string, messageId = `ai-${id}`): StreamEvent {
  return {
    type: 'values',
    data: {
      messages: [
        {
          type: 'ai',
          id: messageId,
          content: '',
          tool_calls: [{ id, name: 'work', args: { id } }],
        },
      ],
    },
  };
}
function history(ids: string[] = []): ThreadState[] {
  return [
    {
      values: {
        messages: ids.map((id) => ({
          type: 'tool',
          id: `result-${id}`,
          tool_call_id: id,
          content: 'Authoritative wire result',
        })),
      },
      next: [],
    } as unknown as ThreadState,
  ];
}
function fixture(events = [call('foreign')]) {
  const stream = vi.fn<AgentTransport['stream']>(async function* () {
    for (const event of events) yield event;
  });
  const updateState = vi.fn<NonNullable<AgentTransport['updateState']>>(
    async () => undefined
  );
  const getHistory = vi.fn<NonNullable<AgentTransport['getHistory']>>(
    async () => history()
  );
  const handler = vi.fn(({ id }: { id: string }) => `Owned ${id}`);
  return { stream, updateState, getHistory, handler };
}
const drain = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('tool acquire ownership', () => {
  it.each(['executing', 'failed', 'reject'] as const)(
    'does not turn %s authority into a tool result or allow a bypass',
    async (status) => {
      const f = fixture();
      const store: ToolExecutionStore = {
        acquire: vi.fn(async () => {
          if (status === 'reject') throw new Error('secret');
          return { status } as never;
        }),
        settle: vi.fn(async () => 'accepted' as const),
      };
      const session = createSession({
        assistantId: 'agent',
        threadId: key.threadId,
        transport: f,
        executionStore: store,
        tools: { work: { description: 'Work', handler: f.handler } },
      });
      try {
        await expect(session.submit('Go')).resolves.toBe('interrupted');
        expect(f.stream).toHaveBeenCalledTimes(1);
        expect(f.handler).not.toHaveBeenCalled();
        expect(store.settle).not.toHaveBeenCalled();
        expect(f.updateState).not.toHaveBeenCalled();
        expect(session.getSnapshot().toolCalls).toMatchObject([
          { status: 'pending' },
        ]);
        expect(session.getSnapshot().error).toMatchObject({
          kind: 'interrupted',
          recovery: 'none',
        });
        expect(JSON.stringify(session.getSnapshot())).not.toContain('secret');
        await expect(session.submit('Bypass')).rejects.toThrow(
          /unsettled tool/
        );
        await expect(session.resume()).rejects.toThrow();
        await expect(session.reconnect()).rejects.toThrow();
        await session.checkStatus?.();
        expect(f.getHistory).not.toHaveBeenCalled();
        // An old checkpoint, absent call, or run completion does not prove settlement.
        f.getHistory.mockResolvedValue([history()[0], history(['foreign'])[0]]);
        await session.load?.();
        await expect(session.submit('Still blocked')).rejects.toThrow(
          /unsettled tool/
        );
        expect(session.getSnapshot().error?.kind).toBe('interrupted');
        f.getHistory.mockResolvedValue(history(['foreign']));
        await session.load?.();
        await expect(session.submit('Recovered')).resolves.toBe('success');
        expect(store.acquire).toHaveBeenCalledTimes(1);
        expect(f.handler).not.toHaveBeenCalled();
      } finally {
        await session.dispose();
      }
    }
  );

  it('reuses a stored failed result without rewriting it', async () => {
    const f = fixture();
    const store: ToolExecutionStore = {
      acquire: vi.fn<ToolExecutionStore['acquire']>(async () => ({
        status: 'complete' as const,
        result: JSON.stringify({ ok: false, error: 'Recorded failure' }),
      })),
      settle: vi.fn(async () => 'accepted' as const),
    };
    const session = createSession({
      assistantId: 'agent',
      threadId: key.threadId,
      transport: f,
      executionStore: store,
      tools: {
        work: { description: 'Work', followUp: false, handler: f.handler },
      },
    });
    try {
      await expect(session.submit('Go')).resolves.toBe('success');
      expect(f.handler).not.toHaveBeenCalled();
      expect(store.settle).not.toHaveBeenCalled();
      expect(f.updateState.mock.calls[0][1]).toMatchObject({
        messages: [{ content: 'Error: Recorded failure' }],
      });
    } finally {
      await session.dispose();
    }
  });

  it.each([false, true])(
    'preserves simulated settlement acknowledgment uncertainty (accepted=%s) without inventing a failure',
    async (accepted) => {
      const f = fixture();
      let saved: unknown;
      const store: ToolExecutionStore = {
        acquire: async () => ({ status: 'acquired' as const, token: 'owner' }),
        settle: vi.fn(async (_key, result) => {
          if (accepted) saved = result;
          throw new Error('secret database failure');
        }),
      };
      const session = createSession({
        assistantId: 'agent',
        threadId: key.threadId,
        transport: f,
        executionStore: store,
        tools: { work: { description: 'Work', handler: f.handler } },
      });
      try {
        await expect(session.submit('Go')).resolves.toBe('interrupted');
        expect(f.handler).toHaveBeenCalledTimes(1);
        expect(saved).toEqual(
          accepted
            ? {
                invocation: canonicalInvocation('work', { id: 'foreign' }),
                token: 'owner',
                result: JSON.stringify({ ok: true, value: 'Owned foreign' }),
              }
            : undefined
        );
        expect(f.updateState).not.toHaveBeenCalled();
        expect(f.stream).toHaveBeenCalledTimes(1);
        expect(session.getSnapshot().toolCalls[0]).toMatchObject({
          status: 'pending',
        });
        expect(JSON.stringify(session.getSnapshot())).not.toContain('secret');
        await expect(session.submit('Retry')).rejects.toThrow(/unsettled tool/);
      } finally {
        await session.dispose();
      }
    }
  );

  it.each(['stop', 'dispose'] as const)(
    'does not author a late foreign acquire after %s',
    async (command) => {
      const f = fixture();
      const entered = deferred<void>();
      const claiming =
        deferred<Awaited<ReturnType<ToolExecutionStore['acquire']>>>();
      const store: ToolExecutionStore = {
        acquire: () => {
          entered.resolve();
          return claiming.promise;
        },
        settle: vi.fn(async () => 'accepted' as const),
      };
      const session = createSession({
        assistantId: 'agent',
        threadId: key.threadId,
        transport: f,
        executionStore: store,
        tools: { work: { description: 'Work', handler: f.handler } },
      });
      try {
        const run = session.submit('Go');
        await entered.promise;
        await expect(session.submit('Supersede')).rejects.toThrow(
          /unsettled tool/
        );
        await session[command]();
        await expect(run).resolves.toBe('aborted');
        expect(session.getSnapshot().toolCalls[0]).toMatchObject({
          status: 'pending',
        });
        const snapshot = session.getSnapshot();
        claiming.resolve({ status: 'unavailable' });
        await drain();
        expect(session.getSnapshot()).toBe(snapshot);
        expect(f.handler).not.toHaveBeenCalled();
        expect(store.settle).not.toHaveBeenCalled();
        expect(f.updateState).not.toHaveBeenCalled();
        expect(f.stream).toHaveBeenCalledTimes(1);
        if (command === 'stop')
          await expect(session.submit('Bypass')).rejects.toThrow(
            /unsettled tool/
          );
      } finally {
        claiming.resolve({ status: 'unavailable' });
        await session.dispose();
      }
    }
  );

  it('a synchronous stop before acquire authors nothing and releases provisional admission', async () => {
    const f = fixture();
    const store: ToolExecutionStore = {
      acquire: vi.fn<ToolExecutionStore['acquire']>(async () => ({
        status: 'acquired' as const,
        token: 'owner',
      })),
      settle: vi.fn(async () => 'accepted' as const),
    };
    const session = createSession({
      assistantId: 'agent',
      threadId: key.threadId,
      transport: f,
      executionStore: store,
      tools: {
        work: { description: 'Work', followUp: false, handler: f.handler },
      },
    });
    const off = session.subscribe(() => {
      if (
        session
          .getSnapshot()
          .toolCalls.some((tool) => tool.status === 'running')
      )
        void session.stop();
    });
    try {
      await expect(session.submit('Go')).resolves.toBe('aborted');
      await drain();
      expect(store.acquire).not.toHaveBeenCalled();
      expect(store.settle).not.toHaveBeenCalled();
      expect(f.updateState).not.toHaveBeenCalled();
      off();
      f.stream.mockImplementation(async function* () {
        yield call('foreign', 'new-assistant');
      });
      await expect(session.submit('Again')).resolves.toBe('success');
      expect(f.handler).toHaveBeenCalledTimes(1);
    } finally {
      off();
      await session.dispose();
    }
  });

  it.each([
    ['foreign-first', false],
    ['owned-first', false],
    ['foreign-first', true],
    ['owned-first', true],
  ] as const)(
    'persists legitimate mixed results only, %s, handler rejects=%s',
    async (order, rejects) => {
      const f = fixture([call('foreign'), call('owned')]);
      if (rejects)
        f.handler.mockImplementation(() => {
          throw new Error('Handler declined');
        });
      const foreign =
        deferred<Awaited<ReturnType<ToolExecutionStore['acquire']>>>();
      const recorded = deferred<void>();
      const recording = deferred<void>();
      const store: ToolExecutionStore = {
        acquire: ({ toolCallId }) =>
          toolCallId === 'foreign'
            ? foreign.promise
            : Promise.resolve({ status: 'acquired' as const, token: 'owner' }),
        settle: vi.fn(async () => {
          recording.resolve();
          await recorded.promise;
          return 'accepted' as const;
        }),
      };
      // Simulate a state write accepted by the server with its response lost; no network fault injection.
      let accepted: unknown;
      f.updateState.mockImplementation(async (_thread, values) => {
        accepted = values;
        throw new Error('lost response');
      });
      const session = createSession({
        assistantId: 'agent',
        threadId: key.threadId,
        transport: f,
        executionStore: store,
        tools: { work: { description: 'Work', handler: f.handler } },
      });
      try {
        const run = session.submit('Go');
        await recording.promise;
        if (order === 'foreign-first') {
          foreign.resolve({ status: 'unavailable' });
          await drain();
        }
        recorded.resolve();
        if (order === 'owned-first') {
          await drain();
          foreign.resolve({ status: 'unavailable' });
        }
        await expect(run).resolves.toBe('interrupted');
        expect(f.stream).toHaveBeenCalledTimes(1);
        expect(f.handler).toHaveBeenCalledTimes(1);
        expect(store.settle).toHaveBeenCalledTimes(1);
        expect(accepted).toEqual({
          messages: [
            expect.objectContaining({
              tool_call_id: 'owned',
              content: rejects ? 'Error: Handler declined' : 'Owned owned',
            }),
          ],
        });
        await expect(session.submit('Bypass')).rejects.toThrow(
          /unsettled tool/
        );
        f.getHistory.mockResolvedValue(history(['foreign', 'owned']));
        await session.load?.();
        f.stream.mockImplementation(async function* () {
          yield {
            type: 'values',
            data: { messages: [{ type: 'ai', id: 'answer', content: 'Done' }] },
          };
        });
        await expect(session.submit('After recovery')).resolves.toBe('success');
        expect(f.stream.mock.calls[1][2]).toMatchObject({
          messages: [
            (accepted as { messages: unknown[] }).messages[0],
            { type: 'human', content: 'After recovery' },
          ],
        });
        expect(f.handler).toHaveBeenCalledTimes(1);
      } finally {
        foreign.resolve({ status: 'unavailable' });
        recorded.resolve();
        await session.dispose();
      }
    }
  );

  it('a simulated lost acquire acknowledgement never turns acquired authority into a fabricated result', async () => {
    const f = fixture();
    let claimed = false;
    const store: ToolExecutionStore = {
      acquire: async () => {
        claimed = true;
        throw new Error('Lost acknowledgement');
      },
      settle: vi.fn(async () => 'accepted' as const),
    };
    const session = createSession({
      assistantId: 'agent',
      threadId: key.threadId,
      transport: f,
      executionStore: store,
      tools: { work: { description: 'Work', handler: f.handler } },
    });
    try {
      await expect(session.submit('Go')).resolves.toBe('interrupted');
      expect(claimed).toBe(true);
      expect(f.handler).not.toHaveBeenCalled();
      expect(store.settle).not.toHaveBeenCalled();
      expect(f.updateState).not.toHaveBeenCalled();
      await session.load?.();
      await expect(session.submit('Retry')).rejects.toThrow(/unsettled tool/);
    } finally {
      await session.dispose();
    }
  });

  it.each(['stop', 'dispose', 'replacement', 'getter', 'reject'] as const)(
    'does not clear blockers from a stale or failed history read: %s',
    async (action) => {
      const f = fixture();
      const store: ToolExecutionStore = {
        acquire: async () => ({ status: 'unavailable' }),
        settle: vi.fn(async () => 'accepted' as const),
      };
      const session = createSession({
        assistantId: 'agent',
        threadId: key.threadId,
        transport: f,
        executionStore: store,
        tools: { work: { description: 'Work', handler: f.handler } },
      });
      const read = deferred<ThreadState[]>();
      const entered = deferred<void>();
      try {
        await session.submit('Go');
        f.getHistory.mockImplementationOnce(() => {
          entered.resolve();
          return read.promise;
        });
        const loading = session.load?.();
        // Observe a rejected read immediately so this test cannot leak rejection.
        const done = loading?.catch((error) => error);
        await entered.promise;
        if (action === 'stop' || action === 'dispose') await session[action]();
        if (action === 'replacement') await session.load?.();
        if (action === 'reject') read.reject(new Error('Offline'));
        else if (action === 'getter') {
          const page = history(['foreign'])[0];
          read.resolve([
            {
              ...page,
              get values() {
                void session.stop();
                return page.values;
              },
            },
          ]);
        } else read.resolve(history(['foreign']));
        await done;
        await drain();
        if (action === 'dispose')
          await expect(session.submit('Retry')).resolves.toBe('aborted');
        else
          await expect(session.submit('Retry')).rejects.toThrow(
            /unsettled tool/
          );
        expect(store.settle).not.toHaveBeenCalled();
        expect(f.updateState).not.toHaveBeenCalled();
        expect(f.stream).toHaveBeenCalledTimes(1);
      } finally {
        read.resolve([]);
        await session.dispose();
      }
    }
  );

  it('requires evidence for every unresolved call before releasing admission', async () => {
    const f = fixture([call('foreign'), call('another')]);
    const store: ToolExecutionStore = {
      acquire: async () => ({ status: 'unavailable' }),
      settle: vi.fn(async () => 'accepted' as const),
    };
    const session = createSession({
      assistantId: 'agent',
      threadId: key.threadId,
      transport: f,
      executionStore: store,
      tools: { work: { description: 'Work', handler: f.handler } },
    });
    try {
      await session.submit('Go');
      f.getHistory.mockResolvedValue(history(['foreign']));
      await session.load?.();
      await expect(session.submit('Too soon')).rejects.toThrow(
        /unsettled tool/
      );
      f.getHistory.mockResolvedValue(history(['foreign', 'another']));
      await session.load?.();
      await expect(session.submit('Ready')).resolves.toBe('success');
      expect(f.handler).not.toHaveBeenCalled();
    } finally {
      await session.dispose();
    }
  });

  it('stages a conclusive owned result before a completion subscriber submits', async () => {
    const f = fixture();
    const store: ToolExecutionStore = {
      acquire: async () => ({ status: 'acquired' as const, token: 'owner' }),
      settle: vi.fn(async () => 'accepted' as const),
    };
    const session = createSession({
      assistantId: 'agent',
      threadId: key.threadId,
      transport: f,
      executionStore: store,
      tools: { work: { description: 'Work', handler: f.handler } },
    });
    let replacement: Promise<unknown> | undefined;
    const off = session.subscribe(() => {
      if (
        !replacement &&
        session.getSnapshot().toolCalls[0]?.status === 'complete'
      ) {
        f.stream.mockImplementation(async function* () {
          yield {
            type: 'values',
            data: { messages: [{ type: 'ai', id: 'answer', content: 'Done' }] },
          };
        });
        replacement = session.submit('Replacement');
      }
    });
    try {
      await expect(session.submit('Go')).resolves.toBe('interrupted');
      await expect(replacement).resolves.toBe('success');
      expect(f.stream).toHaveBeenCalledTimes(2);
      expect(f.stream.mock.calls[1][2]).toMatchObject({
        messages: [
          { tool_call_id: 'foreign', content: 'Owned foreign' },
          { type: 'human', content: 'Replacement' },
        ],
      });
      expect(store.settle).toHaveBeenCalledTimes(1);
    } finally {
      off();
      await session.dispose();
    }
  });
});
