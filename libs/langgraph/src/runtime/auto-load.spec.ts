import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ThreadState } from '@langchain/langgraph-sdk';
import { createSession, type SessionOptions } from './create-session';
import type { AgentTransport, StreamEvent } from './transport.types';
import { deferred } from './testing/deferred';

const sessions: { dispose(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.dispose()));
});

const saved = (value: Partial<ThreadState>): ThreadState =>
  ({ values: {}, next: [], tasks: [], ...value } as ThreadState);
const call = (id: string, description: string) => ({
  id,
  name: 'task',
  args: { subagent_type: 'researcher', description },
});

function fixture(
  options: Partial<SessionOptions>,
  transport: Partial<AgentTransport>
) {
  const stream = vi.fn<AgentTransport['stream']>(async function* () {
    yield {
      type: 'values',
      data: { messages: [{ type: 'ai', id: 'a', content: 'Done' }] },
    };
  });
  const session = createSession({
    assistantId: 'agent',
    threadId: 'thread',
    ...options,
    transport: { stream, ...transport },
  });
  sessions.push(session);
  return { session, stream };
}

describe('automatic history load', () => {
  const history = [
    saved({
      values: {
        topic: 'saved',
        messages: [
          { type: 'human', id: 'u', content: 'Hi' },
          { type: 'ai', id: 'a', content: 'Hello' },
        ],
      },
    }),
  ];

  it('reads the thread once created and shows that it is loading', async () => {
    const gate = deferred<ThreadState[]>();
    const getHistory = vi.fn(() => gate.promise);
    const { session } = fixture({ autoLoad: true }, { getHistory });
    // Creating the session itself still requests nothing.
    expect(getHistory).not.toHaveBeenCalled();
    expect('loading' in session.getSnapshot()).toBe(false);
    await vi.waitFor(() => expect(session.getSnapshot().loading).toBe(true));
    expect(getHistory).toHaveBeenCalledTimes(1);
    gate.resolve(history);
    await vi.waitFor(() =>
      expect(session.getSnapshot().messages).toHaveLength(2)
    );
    expect('loading' in session.getSnapshot()).toBe(false);
    expect(session.getSnapshot().state).toEqual({ topic: 'saved' });
    expect(session.lifecycle.getSnapshot().threadPersistedAt).not.toBeNull();
  });

  it('requests nothing without the option, without a thread, or without history support', async () => {
    const getHistory = vi.fn(async () => history);
    const plain = fixture({}, { getHistory });
    const lazy = fixture(
      { autoLoad: true, threadId: null },
      { getHistory, createThread: async () => 'created' }
    );
    const blind = fixture({ autoLoad: true }, {});
    await Promise.resolve();
    await Promise.resolve();
    expect(getHistory).not.toHaveBeenCalled();
    expect(plain.session.getSnapshot().messages).toEqual([]);
    expect(lazy.session.getSnapshot().status).toBe('idle');
    expect(blind.session.getSnapshot().status).toBe('idle');
  });

  it('publishes a failed automatic read as an error and stops loading', async () => {
    const { session } = fixture(
      { autoLoad: true },
      {
        getHistory: async () => {
          throw new Error('secret');
        },
      }
    );
    await vi.waitFor(() => expect(session.getSnapshot().status).toBe('error'));
    expect(session.getSnapshot().error).toMatchObject({
      kind: 'server',
      message: 'The conversation could not be loaded.',
      recovery: 'none',
    });
    expect('loading' in session.getSnapshot()).toBe(false);
  });

  it('yields to a command the application issues first', async () => {
    const getHistory = vi.fn(async () => history);
    const { session, stream } = fixture({ autoLoad: true }, { getHistory });
    expect(await session.submit('Go')).toBe('success');
    expect(stream).toHaveBeenCalledTimes(1);
    expect(getHistory).not.toHaveBeenCalled();
  });

  it('shows loading for an explicit load too, and clears it on stop', async () => {
    const gate = deferred<ThreadState[]>();
    const getHistory = vi
      .fn<NonNullable<AgentTransport['getHistory']>>()
      .mockResolvedValueOnce(history)
      .mockReturnValueOnce(gate.promise);
    const { session } = fixture({ autoLoad: true }, { getHistory });
    await vi.waitFor(() =>
      expect(session.getSnapshot().messages).toHaveLength(2)
    );
    const reading = session.load?.();
    await vi.waitFor(() => expect(session.getSnapshot().loading).toBe(true));
    await session.stop();
    expect('loading' in session.getSnapshot()).toBe(false);
    await reading;
  });
});

describe('child agents restored from history', () => {
  const messages = [
    { type: 'human', id: 'u', content: 'Research two things' },
    {
      type: 'ai',
      id: 'plan',
      content: '',
      tool_calls: [
        call('call-a', 'Task A'),
        call('call-b', 'Task B'),
        call('call-c', 'Task C'),
        call('call-d', 'Task D'),
      ],
    },
    { type: 'tool', id: 'ra', tool_call_id: 'call-a', content: 'A done' },
    { type: 'tool', id: 'rc', tool_call_id: 'call-c', content: 'C done' },
  ];
  const history = () => [
    saved({
      values: { messages },
      next: ['tools'],
      tasks: [
        { id: 'task-b', name: 'tools', path: ['__pregel_push', 1] },
      ] as never,
    }),
    saved({
      tasks: [
        {
          id: 'task-a',
          name: 'tools',
          path: ['__pregel_push', 0],
          result: { messages: [{ type: 'tool', tool_call_id: 'call-a' }] },
        },
      ] as never,
    }),
  ];
  const childState = (namespace: string, text: string): ThreadState =>
    saved({
      values: {
        notes: text,
        messages: [
          { type: 'human', id: `${namespace}-h`, content: 'Task' },
          { type: 'ai', id: `${namespace}-a`, content: text },
        ],
      },
      checkpoint: {
        thread_id: 'thread',
        checkpoint_ns: namespace,
        checkpoint_id: 'c',
      } as never,
    });

  it('publishes no child from a history load unless asked to restore them', async () => {
    const getChildState = vi.fn<NonNullable<AgentTransport['getChildState']>>(
      async (_thread, namespace) => childState(namespace, `From ${namespace}`)
    );
    const { session } = fixture(
      {},
      { getHistory: async () => history(), getChildState }
    );
    await session.load?.();
    expect(session.getSnapshot().subgraphs).toEqual([]);
    expect(session.getSnapshot().subagents).toEqual([]);
    expect(getChildState).not.toHaveBeenCalled();
  });

  it('rebuilds each child with its tool call, status and transcript', async () => {
    const getChildState = vi.fn<NonNullable<AgentTransport['getChildState']>>(
      async (_thread, namespace) => childState(namespace, `From ${namespace}`)
    );
    const { session } = fixture(
      { restoreSubagents: true },
      { getHistory: async () => history(), getChildState }
    );
    await session.load?.();
    // Status and relation come from the parent's history at once.
    expect(
      session
        .getSnapshot()
        .subagents.map((agent) => [
          agent.namespace[0],
          agent.toolCallId,
          agent.description,
          agent.status,
        ])
    ).toEqual([
      ['tools:task-a', 'call-a', 'Task A', 'complete'],
      ['tools:task-b', 'call-b', 'Task B', 'running'],
      // A result with no recorded task: the call id stands in for the task id.
      ['tools:call-c', 'call-c', 'Task C', 'complete'],
      // call-d is pending with no recorded task, so it is not shown yet.
    ]);
    await vi.waitFor(() =>
      expect(session.getSnapshot().subagents[0].messages).toHaveLength(2)
    );
    expect(getChildState.mock.calls.map((entry) => entry[1]).sort()).toEqual([
      'tools:task-a',
      'tools:task-b',
    ]);
    const [first, second, third] = session.getSnapshot().subagents;
    expect(first.messages.at(-1)?.content).toBe('From tools:task-a');
    expect(second.messages.at(-1)?.content).toBe('From tools:task-b');
    expect(third.messages).toEqual([]);
    expect(session.getSnapshot().subgraphs[0].state).toEqual({
      notes: 'From tools:task-a',
    });
    expect(first.id).toBe(JSON.stringify(['tools:task-a']));
  });

  it('never fills a child from another namespace, and survives a failed read', async () => {
    const getChildState = vi.fn<NonNullable<AgentTransport['getChildState']>>(
      async (_thread, namespace) => {
        if (namespace === 'tools:task-a') return childState('', 'The parent');
        throw new Error('unavailable');
      }
    );
    const { session } = fixture(
      { restoreSubagents: true },
      { getHistory: async () => history(), getChildState }
    );
    await session.load?.();
    await vi.waitFor(() => expect(getChildState).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    await Promise.resolve();
    expect(
      session.getSnapshot().subagents.map((agent) => agent.messages.length)
    ).toEqual([0, 0, 0]);
    expect(session.getSnapshot().status).toBe('idle');
  });

  it('restores status and relation without transport.getChildState', async () => {
    const { session } = fixture(
      { restoreSubagents: true },
      { getHistory: async () => history() }
    );
    await session.load?.();
    expect(
      session.getSnapshot().subagents.map((agent) => agent.status)
    ).toEqual(['complete', 'running', 'complete']);
  });

  it('streams a continued run into the restored child instead of adding one', async () => {
    const events: StreamEvent[] = [
      {
        type: 'values|tools:task-b',
        data: {
          messages: [{ type: 'ai', id: 'live', content: 'Still going' }],
        },
      },
      {
        type: 'values',
        data: {
          messages: [
            ...messages,
            {
              type: 'tool',
              id: 'rb',
              tool_call_id: 'call-b',
              content: 'B done',
            },
            { type: 'ai', id: 'final', content: 'All done' },
          ],
        },
      },
    ];
    const { session } = fixture(
      { restoreSubagents: true },
      {
        getHistory: async () => history(),
        async *stream() {
          yield* events;
        },
      }
    );
    await session.load?.();
    const before = session.getSnapshot().subagents[1].id;
    expect(await session.submit(null)).toBe('success');
    const children = session.getSnapshot().subagents;
    expect(children).toHaveLength(3);
    expect(children[1]).toMatchObject({
      id: before,
      toolCallId: 'call-b',
      status: 'complete',
    });
    expect(children[1].messages.at(-1)?.content).toBe('Still going');
  });

  it('restores nothing when no delegation tool is configured', async () => {
    const { session } = fixture(
      { subagentToolNames: [] },
      { getHistory: async () => history() }
    );
    await session.load?.();
    expect(session.getSnapshot().subagents).toEqual([]);
  });
});
