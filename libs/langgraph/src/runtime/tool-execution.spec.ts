import { canonicalInvocation } from './tool-provenance';
/* eslint @typescript-eslint/no-unused-vars: ["warn", { "argsIgnorePattern": "^_" }] */
import { describe, expect, it, vi } from 'vitest';
import { createSession } from './create-session';
import type { AgentTransport, StreamEvent } from './transport.types';
import { deferred } from './testing/deferred';
import type { ToolExecutionStore } from '@threadplane/core/tools';
import type { ThreadState } from '@langchain/langgraph-sdk';

export function toolEvent(
  id = 'call-1',
  name = 'weather',
  args: unknown = { city: 'Paris' }
): StreamEvent {
  return {
    type: 'values',
    data: {
      messages: [
        {
          type: 'ai',
          id: `assistant-${id}`,
          content: '',
          tool_calls: [{ id, name, args }],
        },
      ],
    },
  };
}
export const finalEvent: StreamEvent = {
  type: 'values',
  data: { messages: [{ type: 'ai', id: 'answer', content: 'Done' }] },
};

export function fixture(
  events: StreamEvent[][] = [[toolEvent()], [finalEvent]]
) {
  const stream = vi.fn<AgentTransport['stream']>(async function* () {
    for (const event of events.shift() ?? [finalEvent]) yield event;
  });
  const updateState = vi.fn<NonNullable<AgentTransport['updateState']>>(
    async () => undefined
  );
  return { stream, updateState };
}

describe('owned function tools', () => {
  it.each(['local', 'durable'] as const)(
    'retains %s settled results through removal and replay echoes',
    async (source) => {
      const makeMessage = (ids: string[]) => ({
        type: 'ai',
        id: 'assistant-call-1',
        content: 'Correction',
        tool_calls: ids.map((id) => ({
          id,
          name: 'weather',
          args: { city: 'Paris' },
        })),
      });
      const transport = fixture([
        [toolEvent()],
        [
          { type: 'values', data: { messages: [makeMessage([])] } },
          {
            type: 'values',
            data: {
              messages: [
                makeMessage(['call-1']),
                {
                  type: 'tool',
                  id: 'server-echo',
                  tool_call_id: 'call-1',
                  content: 'Wire text',
                },
                { type: 'ai', id: 'answer', content: 'Done' },
              ],
            },
          },
        ],
      ]);
      const handler = vi.fn((_args: { city: string }) => ({ saved: true }));
      const executionStore: ToolExecutionStore = {
        acquire: vi.fn(async () =>
          source === 'local'
            ? { status: 'acquired' as const, token: 'owner' }
            : {
                status: 'complete' as const,
                result: JSON.stringify({
                  ok: true as const,
                  value: { saved: true },
                }),
              }
        ),
        settle: vi.fn(async () => 'accepted' as const),
      };
      const session = createSession({
        assistantId: 'agent',
        threadId: 'thread',
        transport,
        executionStore,
        tools: { weather: { description: 'Weather', handler } },
      });
      const corrected: unknown[] = [];
      const off = session.subscribe(() => {
        const snapshot = session.getSnapshot();
        if (
          snapshot.messages.find((message) => message.id === 'assistant-call-1')
            ?.toolCallIds?.length === 0
        )
          corrected.push(snapshot.toolCalls);
      });
      try {
        await expect(session.submit('Work')).resolves.toBe('success');
        expect(corrected.length).toBeGreaterThan(0);
        expect(corrected[0]).toMatchObject([
          { id: 'call-1', status: 'complete', result: { saved: true } },
        ]);
        expect(session.getSnapshot().toolCalls).toMatchObject([
          { id: 'call-1', status: 'complete', result: { saved: true } },
        ]);
        expect(handler).toHaveBeenCalledTimes(source === 'local' ? 1 : 0);
        expect(executionStore.acquire).toHaveBeenCalledTimes(1);
        expect(executionStore.settle).toHaveBeenCalledTimes(
          source === 'local' ? 1 : 0
        );
        expect(transport.stream).toHaveBeenCalledTimes(2);
      } finally {
        off();
        await session.dispose();
      }
    }
  );

  it.each(['literal argument', '{"unfinished":'] as const)(
    'passes finalized primitive string %s unchanged while keeping chunks private',
    async (args) => {
      const transport = fixture([
        [
          {
            type: 'values',
            data: {
              messages: [
                {
                  type: 'AIMessageChunk',
                  id: 'chunk',
                  content: '',
                  tool_calls: [
                    { id: 'fragment', name: 'literal', args: '{"partial":' },
                  ],
                  tool_call_chunks: [
                    { id: 'fragment', name: 'literal', args: '{"partial":' },
                  ],
                },
              ],
            },
          },
          toolEvent('full', 'literal', args),
        ],
        [finalEvent],
      ]);
      const handler = vi.fn((value: string) => value);
      const session = createSession({
        assistantId: 'agent',
        threadId: 'thread',
        transport,
        tools: { literal: { description: 'Literal', handler } },
      });
      const seen: unknown[] = [];
      const off = session.subscribe(() => {
        seen.push(...session.getSnapshot().toolCalls);
      });
      try {
        await session.submit('Go');
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0]).toBe(args);
        expect(session.getSnapshot().toolCalls).toEqual([
          {
            id: 'full',
            name: 'literal',
            args,
            status: 'complete',
            result: args,
          },
        ]);
        expect(
          seen.every((call) => (call as { id: string }).id === 'full')
        ).toBe(true);
      } finally {
        off();
        await session.dispose();
      }
    }
  );
  it('does not acquire a later user turn replayed in the active stream history', async () => {
    const handler = vi.fn((_args: { city: string }) => 'Never');
    const transport = fixture();
    transport.stream.mockImplementation(async function* (
      _assistant,
      _thread,
      input
    ) {
      const user = (input as { messages: unknown[] }).messages[0];
      yield {
        type: 'values',
        data: {
          messages: [
            user,
            { type: 'ai', id: 'ours', content: 'Complete' },
            { type: 'human', id: 'another-user', content: 'Other work' },
            {
              type: 'ai',
              id: 'other-assistant',
              content: '',
              tool_calls: [
                { id: 'other-call', name: 'weather', args: { city: 'Paris' } },
              ],
            },
          ],
        },
      };
    });
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport,
      tools: { weather: { description: 'Weather', handler } },
    });
    await session.submit('Ours');
    expect(handler).not.toHaveBeenCalled();
    expect(transport.stream).toHaveBeenCalledTimes(1);
  });
  it('exposes registered client calls only and never interprets prototype names as handlers', async () => {
    const transport = fixture([
      [
        toolEvent('unknown', 'toString'),
        toolEvent('backend', 'server'),
        toolEvent(),
      ],
    ]);
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport,
      tools: {
        weather: {
          description: 'Weather',
          handler: (_args: { city: string }) => 'Sun',
        },
      },
    });
    await session.submit('Hi');
    expect(session.getSnapshot().toolCalls.map((call) => call.name)).toEqual([
      'weather',
    ]);
  });

  it('does not execute earlier historical calls replayed before the submitted-user anchor', async () => {
    const handler = vi.fn((_args: { city: string }) => 'Never');
    const transport = fixture();
    transport.stream.mockImplementation(async function* (
      _assistant,
      _thread,
      input
    ) {
      const user = (input as { messages: unknown[] }).messages[0];
      yield {
        type: 'values',
        data: {
          messages: [
            {
              type: 'ai',
              id: 'old-ai',
              content: '',
              tool_calls: [
                { id: 'old', name: 'weather', args: { city: 'Paris' } },
              ],
            },
            user,
            { type: 'ai', id: 'new-ai', content: 'No tools now' },
          ],
        },
      };
    });
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport,
      tools: { weather: { description: 'Weather', handler } },
    });
    await session.submit('Hi');
    expect(handler).not.toHaveBeenCalled();
    expect(transport.stream).toHaveBeenCalledTimes(1);
  });

  it('checkStatus with finalized tools is read-only and never claims, handles, or continues', async () => {
    const handler = vi.fn((_args: { city: string }) => 'Never');
    const executionStore = {
      acquire: vi.fn(async () => ({
        status: 'acquired' as const,
        token: 'owner',
      })),
      settle: vi.fn(async () => 'accepted' as const),
    };
    const transport = fixture();
    transport.stream.mockImplementation(async function* () {
      yield { type: 'error', data: { message: 'Unknown status' } };
    });
    const getHistory = vi.fn<NonNullable<AgentTransport['getHistory']>>(
      async () => [
        {
          values: {
            messages: [
              ...(transport.stream.mock.calls[0][2] as { messages: unknown[] })
                .messages,
              {
                type: 'ai',
                id: 'recovered',
                content: '',
                tool_calls: [
                  {
                    id: 'recovered-call',
                    name: 'weather',
                    args: { city: 'Paris' },
                  },
                ],
              },
            ],
          },
          next: [],
          tasks: [],
          checkpoint: {
            thread_id: 'thread',
            checkpoint_ns: '',
            checkpoint_id: 'after',
            checkpoint_map: {},
          },
          metadata: null,
          created_at: null,
          parent_checkpoint: null,
        } as ThreadState,
      ]
    );
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport: { ...transport, getHistory },
      executionStore,
      tools: { weather: { description: 'Weather', handler } },
    });
    await session.submit('Hi');
    await session.checkStatus?.();
    expect(session.getSnapshot().toolCalls[0]).toMatchObject({
      id: 'recovered-call',
      status: 'pending',
    });
    expect(executionStore.acquire).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    expect(transport.stream).toHaveBeenCalledTimes(1);
  });
  it('executes a named authored tool and continues once with the exact catalog and result', async () => {
    const transport = fixture();
    const handler = vi.fn((args: { city: string }) => ({
      forecast: args.city,
    }));
    const parameters = {
      type: 'object',
      properties: { city: { type: 'string' } },
    };
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport,
      tools: { weather: { description: 'Weather', parameters, handler } },
    });
    await expect(session.submit('Weather?')).resolves.toBe('success');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toEqual({ city: 'Paris' });
    expect(transport.stream).toHaveBeenCalledTimes(2);
    expect(transport.stream.mock.calls[0][2]).toMatchObject({
      client_tools: [{ name: 'weather', description: 'Weather', parameters }],
    });
    expect(transport.stream.mock.calls[1][2]).toEqual({
      client_tools: [{ name: 'weather', description: 'Weather', parameters }],
      messages: [
        {
          id: 'client-tool-result-call-1',
          role: 'tool',
          type: 'tool',
          tool_call_id: 'call-1',
          content: '{"forecast":"Paris"}',
        },
      ],
    });
    expect(session.getSnapshot().toolCalls).toEqual([
      {
        id: 'call-1',
        name: 'weather',
        args: { city: 'Paris' },
        status: 'complete',
        result: { forecast: 'Paris' },
      },
    ]);
  });

  it('isolates handler arguments and captures caller-owned catalog configuration', async () => {
    const transport = fixture();
    const handler = vi.fn((args: { city: string }) => {
      args.city = 'Lyon';
      return args.city;
    });
    const tools = {
      weather: {
        description: 'Original',
        followUp: true,
        parameters: { title: 'Original' },
        handler,
      },
    };
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport,
      tools,
    });
    tools.weather.handler = vi.fn(() => 'Wrong');
    tools.weather.followUp = false;
    tools.weather.parameters.title = 'Changed';
    tools.weather.description = 'Changed';
    await session.submit('Hi');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot().toolCalls[0]).toMatchObject({
      args: { city: 'Paris' },
      result: 'Lyon',
      status: 'complete',
    });
    expect(transport.stream.mock.calls[0][2]).toMatchObject({
      client_tools: [
        { description: 'Original', parameters: { title: 'Original' } },
      ],
    });
    expect(transport.stream).toHaveBeenCalledTimes(2);
  });

  it('supports no-input context, void results, rejection, and one batched continuation', async () => {
    const ping = {
      type: 'values' as const,
      data: {
        messages: [
          {
            type: 'ai',
            id: 'ping-message',
            content: '',
            tool_calls: [{ id: 'ping', name: 'ping' }],
          },
        ],
      },
    };
    const transport = fixture([
      [ping, toolEvent('fail', 'fail', {})],
      [finalEvent],
    ]);
    let signal: AbortSignal | undefined;
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport,
      tools: {
        ping: {
          description: 'Ping',
          handler: (_args: void, context: { signal: AbortSignal }): void => {
            signal = context.signal;
          },
        },
        fail: {
          description: 'Fail',
          handler: async (_args: object): Promise<string> => {
            throw new Error('declined');
          },
        },
      },
    });
    await session.submit('Go');
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(session.getSnapshot().toolCalls[0].args).toBeUndefined();
    expect(transport.stream).toHaveBeenCalledTimes(2);
    expect(transport.stream.mock.calls[1][2]).toMatchObject({
      messages: [
        { tool_call_id: 'ping', content: '' },
        { tool_call_id: 'fail', content: 'Error: declined' },
      ],
    });
    expect(session.getSnapshot().toolCalls).toMatchObject([
      { status: 'complete', result: undefined },
      { status: 'error', error: 'declined' },
    ]);
  });

  it('never reexecutes server-settled or duplicate finalized calls', async () => {
    const event = toolEvent();
    const transport = fixture([
      [
        event,
        {
          type: 'values',
          data: {
            messages: [
              {
                type: 'tool',
                id: 'server-result',
                tool_call_id: 'call-1',
                content: 'Server',
              },
            ],
          },
        },
      ],
      [event],
    ]);
    const handler = vi.fn((_args: { city: string }) => 'Local');
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport,
      tools: { weather: { description: 'Weather', handler } },
    });
    await session.submit('First');
    await session.submit('Second');
    expect(handler).not.toHaveBeenCalled();
    expect(transport.stream).toHaveBeenCalledTimes(2);
    expect(session.getSnapshot().toolCalls).toEqual([]);
    expect(session.getSnapshot().messages).toContainEqual(
      expect.objectContaining({ role: 'tool', content: 'Server' })
    );
  });

  it('stops promptly when the handler ignores abort and discards its late result', async () => {
    const entered = deferred<void>();
    const result = deferred<string>();
    const transport = fixture();
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport,
      tools: {
        weather: {
          description: 'Weather',
          handler: (_args: { city: string }) => {
            entered.resolve();
            return result.promise;
          },
        },
      },
    });
    try {
      const run = session.submit('Go');
      await entered.promise;
      await session.stop();
      await expect(run).resolves.toBe('aborted');
      const snapshot = session.getSnapshot();
      result.resolve('Late');
      await result.promise;
      expect(session.getSnapshot()).toBe(snapshot);
      expect(transport.stream).toHaveBeenCalledTimes(1);
    } finally {
      result.resolve('Cleanup');
      await session.dispose();
    }
  });

  it.each(['resolve', 'reject'] as const)(
    'records cancellation before a noncooperative handler later %s, without stale publication',
    async (ending) => {
      const entered = deferred<void>();
      const result = deferred<string>();
      const flushed = deferred<void>();
      const transport = fixture();
      transport.updateState.mockImplementation(async () => {
        flushed.resolve();
      });
      const executionStore = {
        acquire: vi.fn(async () => ({
          status: 'acquired' as const,
          token: 'owner',
        })),
        settle: vi.fn<ToolExecutionStore['settle']>(
          async () => 'accepted' as const
        ),
      };
      const session = createSession({
        assistantId: 'agent',
        threadId: 'thread',
        transport,
        executionStore,
        tools: {
          weather: {
            description: 'Weather',
            handler: (_args: { city: string }) => {
              entered.resolve();
              return result.promise;
            },
          },
        },
      });
      try {
        const run = session.submit('Go');
        await entered.promise;
        await session.stop();
        await expect(run).resolves.toBe('aborted');
        await flushed.promise;
        const snapshot = session.getSnapshot();
        expect(executionStore.settle).toHaveBeenCalledWith(
          { threadId: 'thread', toolCallId: 'call-1' },
          {
            invocation: canonicalInvocation('weather', { city: 'Paris' }),
            token: 'owner',
            result: expect.stringContaining('cancelled'),
          }
        );
        if (ending === 'resolve') result.resolve('Late');
        else result.reject(new Error('Late rejection'));
        await result.promise.catch(() => undefined);
        expect(session.getSnapshot()).toBe(snapshot);
        expect(executionStore.settle).toHaveBeenCalledTimes(1);
        expect(transport.stream).toHaveBeenCalledTimes(1);
      } finally {
        result.resolve('cleanup');
        await session.dispose();
      }
    }
  );

  it('keeps external abort linked across the entire continuation chain', async () => {
    const entered = deferred<void>();
    const handlerResult = deferred<string>();
    const transport = fixture([[toolEvent('first')], [toolEvent('second')]]);
    let count = 0;
    const controller = new AbortController();
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport,
      tools: {
        weather: {
          description: 'Weather',
          handler: (_args: { city: string }) => {
            if (++count === 1) return 'First';
            entered.resolve();
            return handlerResult.promise;
          },
        },
      },
    });
    try {
      const run = session.submit('Go', { signal: controller.signal });
      await entered.promise;
      controller.abort();
      await expect(run).resolves.toBe('aborted');
      expect(transport.stream).toHaveBeenCalledTimes(2);
      expect(session.getSnapshot().toolCalls[1]).toMatchObject({
        status: 'error',
        error: expect.stringContaining('cancelled'),
      });
    } finally {
      handlerResult.resolve('cleanup');
      await session.dispose();
    }
  });

  it.each(['stop', 'dispose', 'submit'] as const)(
    'survives handler abort callbacks that synchronously %s',
    async (command) => {
      const entered = deferred<void>();
      const result = deferred<string>();
      const transport = fixture();
      let replacement: Promise<unknown> | undefined;
      const session = createSession({
        assistantId: 'agent',
        threadId: 'thread',
        transport,
        tools: {
          weather: {
            description: 'Weather',
            handler: (
              _args: { city: string },
              context: { signal: AbortSignal }
            ) => {
              context.signal.addEventListener(
                'abort',
                () => {
                  replacement =
                    command === 'submit'
                      ? session.submit('Replacement')
                      : session[command]();
                },
                { once: true }
              );
              entered.resolve();
              return result.promise;
            },
          },
        },
      });
      try {
        const run = session.submit('First');
        await entered.promise;
        await session.stop();
        await expect(run).resolves.toBe('aborted');
        await replacement;
        expect(transport.stream).toHaveBeenCalledTimes(
          command === 'submit' ? 2 : 1
        );
        if (command === 'dispose')
          await expect(session.submit('Never')).resolves.toBe('aborted');
        expect(session.getSnapshot().toolCalls[0]).toMatchObject({
          status: 'error',
        });
      } finally {
        result.resolve('cleanup');
        await session.dispose();
      }
    }
  );
});

describe('function tool execution guard', () => {
  it('retains a durable done fact discovered after stop instead of replacing it with cancellation', async () => {
    const claiming = deferred<void>();
    const acquire = deferred<{
      status: 'complete';
      result: string;
    }>();
    const flushed = deferred<void>();
    const transport = fixture();
    transport.updateState.mockImplementation(async () => {
      flushed.resolve();
    });
    const handler = vi.fn((_args: { city: string }) => 'Never');
    const executionStore = {
      acquire: () => {
        claiming.resolve();
        return acquire.promise;
      },
      settle: vi.fn(async () => 'accepted' as const),
    };
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport,
      executionStore,
      tools: { weather: { description: 'Weather', handler } },
    });
    try {
      const run = session.submit('Go');
      await claiming.promise;
      await session.stop();
      await expect(run).resolves.toBe('aborted');
      acquire.resolve({
        status: 'complete' as const,
        result: JSON.stringify({ ok: true, value: 'Previously completed' }),
      });
      await flushed.promise;
      expect(transport.updateState.mock.calls[0][1]).toMatchObject({
        messages: [{ content: 'Previously completed' }],
      });
      expect(executionStore.settle).not.toHaveBeenCalled();
      expect(handler).not.toHaveBeenCalled();
      expect(transport.stream).toHaveBeenCalledTimes(1);
    } finally {
      acquire.resolve({
        status: 'complete' as const,
        result: JSON.stringify({ ok: true, value: 'cleanup' }),
      });
      await session.dispose();
    }
  });
  it('retains captured store methods and keeps settle rejection unresolved', async () => {
    const transport = fixture();
    const acquire = vi.fn(async () => ({
      status: 'acquired' as const,
      token: 'owner',
    }));
    const settle = vi.fn(async () => {
      throw new Error('write failed');
    });
    const executionStore = { acquire, settle };
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport,
      executionStore,
      tools: {
        weather: {
          description: 'Weather',
          handler: (_args: { city: string }) => 'Result',
        },
      },
    });
    executionStore.acquire = vi.fn(async () => ({
      status: 'acquired' as const,
      token: 'owner',
    }));
    executionStore.settle = vi.fn(async () => {
      throw new Error('different');
    });
    await expect(session.submit('Go')).resolves.toBe('interrupted');
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledTimes(1);
    expect(executionStore.acquire).not.toHaveBeenCalled();
    expect(session.getSnapshot().toolCalls[0]).toMatchObject({
      status: 'pending',
    });
    expect(transport.updateState).not.toHaveBeenCalled();
    expect(transport.stream).toHaveBeenCalledTimes(1);
  });
  it('claims before handling, records before settlement, and idempotent tools skip the guard', async () => {
    const recorded = deferred<void>();
    const recording = deferred<void>();
    const order: string[] = [];
    const transport = fixture();
    const executionStore = {
      acquire: vi.fn(async () => {
        order.push('acquire');
        return { status: 'acquired' as const, token: 'owner' };
      }),
      settle: vi.fn(async () => {
        order.push('settle');
        recording.resolve();
        await recorded.promise;
        return 'accepted' as const;
      }),
    };
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport,
      executionStore,
      tools: {
        weather: {
          description: 'Weather',
          handler: (_args: { city: string }) => {
            order.push('handler');
            return 'Sun';
          },
        },
      },
    });
    try {
      const run = session.submit('Go');
      await recording.promise;
      expect(order).toEqual(['acquire', 'handler', 'settle']);
      expect(executionStore.acquire).toHaveBeenCalledWith(
        {
          threadId: 'thread',
          toolCallId: 'call-1',
        },
        canonicalInvocation('weather', { city: 'Paris' })
      );
      expect(session.getSnapshot().toolCalls[0].status).toBe('running');
      expect(transport.stream).toHaveBeenCalledTimes(1);
      recorded.resolve();
      await run;
      expect(session.getSnapshot().toolCalls[0]).toMatchObject({
        status: 'complete',
        result: 'Sun',
      });
    } finally {
      recorded.resolve();
      await session.dispose();
    }
    const bypass = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport: fixture(),
      executionStore,
      tools: {
        weather: {
          description: 'Weather',
          idempotent: true,
          handler: (_args: { city: string }) => 'Sun',
        },
      },
    });
    await bypass.submit('Go');
    expect(executionStore.acquire).toHaveBeenCalledTimes(1);
    expect(executionStore.settle).toHaveBeenCalledTimes(1);
  });

  it.each(['done', 'executing', 'failed', 'reject'] as const)(
    'fails closed/reuses prior %s records',
    async (status) => {
      const handler = vi.fn((_args: { city: string }) => 'New');
      const executionStore = {
        acquire: vi.fn(async () => {
          if (status === 'reject') throw new Error('offline');
          return status === 'done'
            ? {
                status: 'complete' as const,
                result: JSON.stringify({ ok: true, value: 'Saved' }),
              }
            : ({ status } as never);
        }),
        settle: vi.fn(async () => 'accepted' as const),
      };
      const session = createSession({
        assistantId: 'agent',
        threadId: 'thread',
        transport: fixture(),
        executionStore,
        tools: { weather: { description: 'Weather', handler } },
      });
      await session.submit('Go');
      expect(handler).not.toHaveBeenCalled();
      expect(session.getSnapshot().toolCalls[0]).toMatchObject(
        status === 'done'
          ? { status: 'complete', result: 'Saved' }
          : { status: 'pending' }
      );
    }
  );

  it.each(['resolve', 'reject'] as const)(
    'settles stop while acquire is pending; late acquire %s cannot execute',
    async (ending) => {
      const claimed = deferred<{ status: 'acquired'; token: string }>();
      const claiming = deferred<void>();
      const flushed = deferred<void>();
      const handler = vi.fn((_args: { city: string }) => 'Bad');
      const transport = fixture();
      transport.updateState.mockImplementation(async () => {
        flushed.resolve();
      });
      const executionStore = {
        acquire: vi.fn(() => {
          claiming.resolve();
          return claimed.promise;
        }),
        settle: vi.fn(async () => 'accepted' as const),
      };
      const session = createSession({
        assistantId: 'agent',
        threadId: 'thread',
        transport,
        executionStore,
        tools: { weather: { description: 'Weather', handler } },
      });
      try {
        const run = session.submit('Go');
        await claiming.promise;
        await session.stop();
        await expect(run).resolves.toBe('aborted');
        const snapshot = session.getSnapshot();
        if (ending === 'resolve')
          claimed.resolve({ status: 'acquired' as const, token: 'owner' });
        else claimed.reject(new Error('late'));
        if (ending === 'resolve') await flushed.promise;
        else {
          await new Promise<void>((resolve) => setImmediate(resolve));
          expect(transport.updateState).not.toHaveBeenCalled();
          await expect(session.submit('Retry')).rejects.toThrow(
            /unsettled tool/
          );
        }
        expect(handler).not.toHaveBeenCalled();
        expect(transport.stream).toHaveBeenCalledTimes(1);
        expect(session.getSnapshot()).toBe(snapshot);
        expect(executionStore.settle).toHaveBeenCalledTimes(
          ending === 'resolve' ? 1 : 0
        );
        if (ending === 'resolve')
          expect(executionStore.settle.mock.calls[0]).toEqual([
            { threadId: 'thread', toolCallId: 'call-1' },
            {
              invocation: canonicalInvocation('weather', { city: 'Paris' }),
              token: 'owner',
              result: expect.stringContaining('cancelled'),
            },
          ]);
      } finally {
        claimed.resolve({ status: 'acquired' as const, token: 'owner' });
        await session.dispose();
      }
    }
  );

  it.each(['resolve', 'reject'] as const)(
    'preserves the durable fact when stop races a pending settle %s',
    async (ending) => {
      const recorded = deferred<void>();
      const recording = deferred<void>();
      const flushed = deferred<void>();
      const transport = fixture();
      transport.updateState.mockImplementation(async () => {
        flushed.resolve();
      });
      const executionStore = {
        acquire: vi.fn(async () => ({
          status: 'acquired' as const,
          token: 'owner',
        })),
        settle: vi.fn<ToolExecutionStore['settle']>(() => {
          recording.resolve();
          return recorded.promise.then(() => 'accepted' as const);
        }),
      };
      const session = createSession({
        assistantId: 'agent',
        threadId: 'thread',
        transport,
        executionStore,
        tools: {
          weather: {
            description: 'Weather',
            handler: (_args: { city: string }) => 'Recorded success',
          },
        },
      });
      try {
        const run = session.submit('Go');
        await recording.promise;
        await session.stop();
        await expect(run).resolves.toBe('aborted');
        const snapshot = session.getSnapshot();
        if (ending === 'resolve') recorded.resolve();
        else recorded.reject(new Error('durability failed'));
        if (ending === 'resolve') await flushed.promise;
        else {
          await new Promise<void>((resolve) => setImmediate(resolve));
          expect(transport.updateState).not.toHaveBeenCalled();
          await expect(session.submit('Retry')).rejects.toThrow(
            /unsettled tool/
          );
        }
        expect(executionStore.settle).toHaveBeenCalledTimes(1);
        expect(executionStore.settle.mock.calls[0][1]).toEqual({
          invocation: canonicalInvocation('weather', { city: 'Paris' }),
          token: 'owner',
          result: JSON.stringify({ ok: true, value: 'Recorded success' }),
        });
        if (ending === 'resolve')
          expect(transport.updateState.mock.calls[0][1]).toMatchObject({
            messages: [
              {
                content: 'Recorded success',
              },
            ],
          });
        expect(transport.stream).toHaveBeenCalledTimes(1);
        expect(session.getSnapshot()).toBe(snapshot);
      } finally {
        recorded.resolve();
        await session.dispose();
      }
    }
  );

  it('limits automatic continuation to ten groups and resets on a new user turn', async () => {
    let calls = 0;
    const transport = fixture();
    transport.stream.mockImplementation(async function* () {
      yield toolEvent(`call-${++calls}`);
    });
    const handler = vi.fn((_args: { city: string }) => 'Result');
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport,
      tools: { weather: { description: 'Weather', handler } },
    });
    await session.submit('Go');
    expect(transport.stream).toHaveBeenCalledTimes(11);
    expect(handler).toHaveBeenCalledTimes(10);
    expect(session.getSnapshot().toolCalls[10]).toMatchObject({
      status: 'error',
      error: expect.stringContaining('limit'),
    });
    await session.submit('Again');
    expect(handler).toHaveBeenCalledTimes(20);
  });
});
