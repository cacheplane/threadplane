import { afterEach, describe, expect, it } from 'vitest';
import type { ThreadState } from '@langchain/langgraph-sdk';
import { createSession, type SessionOptions } from './create-session';
import {
  mapChildExecutions,
  relateSubgraphs,
} from './delegation-projection';
import type { StreamEvent } from './transport.types';

const sessions: { dispose(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.dispose()));
});

const call = (id: string, description?: string, name = 'task') => ({
  id,
  name,
  args: {
    subagent_type: 'researcher',
    ...(description === undefined ? {} : { description }),
  },
});
const dispatch = (...calls: ReturnType<typeof call>[]): StreamEvent => ({
  type: 'values',
  data: {
    messages: [{ type: 'ai', id: 'plan', content: '', tool_calls: calls }],
  },
});
const child = (segment: string, task?: string): StreamEvent => ({
  type: `values|${segment}`,
  data: {
    messages: [
      ...(task ? [{ type: 'human', id: `${segment}-task`, content: task }] : []),
      { type: 'ai', id: `${segment}-answer`, content: 'Found it' },
    ],
  },
});
const finish = (...calls: ReturnType<typeof call>[]): StreamEvent => ({
  type: 'values',
  data: {
    messages: [
      {
        type: 'ai',
        id: 'plan',
        content: '',
        tool_calls: calls,
      },
      ...calls.map(({ id }) => ({
        type: 'tool',
        id: `${id}-result`,
        tool_call_id: id,
        content: 'Done',
      })),
      { type: 'ai', id: 'final', content: 'All done' },
    ],
  },
});

function run(
  events: readonly StreamEvent[],
  options: Partial<SessionOptions> = {}
) {
  const session = createSession({
    assistantId: 'agent',
    threadId: 'thread',
    ...options,
    transport: {
      async *stream() {
        yield* events;
      },
    },
  });
  sessions.push(session);
  return session;
}

describe('child graphs related to tool calls', () => {
  it('uses the backend binding, whatever order children arrive in', async () => {
    const session = run([
      dispatch(call('call-a', 'Task A'), call('call-b', 'Task B')),
      {
        type: 'custom',
        data: {
          type: 'threadplane.subagent_binding',
          namespace: 'tools:two',
          tool_call_id: 'call-b',
        },
      },
      {
        type: 'custom|tools:one',
        data: {
          type: 'threadplane.subagent_binding',
          namespace: 'tools:one',
          tool_call_id: 'call-a',
        },
      },
      child('tools:two'),
      child('tools:one'),
      finish(call('call-a', 'Task A'), call('call-b', 'Task B')),
    ]);
    expect(await session.submit('Go')).toBe('success');
    expect(
      session
        .getSnapshot()
        .subagents.map((agent) => [
          agent.namespace[0],
          agent.toolCallId,
          agent.description,
          agent.name,
          agent.status,
        ])
    ).toEqual([
      ['tools:two', 'call-b', 'Task B', 'researcher', 'complete'],
      ['tools:one', 'call-a', 'Task A', 'researcher', 'complete'],
    ]);
    expect(session.getSnapshot().subgraphs[0].delegation).toEqual({
      toolCallId: 'call-b',
      name: 'researcher',
      description: 'Task B',
      status: 'complete',
    });
  });

  it('matches a child by its task text when nothing binds it', async () => {
    const session = run([
      dispatch(call('call-a', 'Task A'), call('call-b', 'Task B')),
      child('tools:two', 'Task B'),
      child('tools:one', 'Please do: Task A'),
      finish(call('call-a', 'Task A'), call('call-b', 'Task B')),
    ]);
    await session.submit('Go');
    expect(
      session.getSnapshot().subagents.map((agent) => agent.toolCallId)
    ).toEqual(['call-b', 'call-a']);
  });

  it('relates the only outstanding call by position', async () => {
    const seen: (string | undefined)[] = [];
    const session = run([
      dispatch(call('call-a')),
      child('tools:one'),
      finish(call('call-a')),
    ]);
    session.subscribe(() => {
      const first = session.getSnapshot().subagents[0];
      if (first) seen.push(`${first.toolCallId}:${first.status}`);
    });
    await session.submit('Go');
    expect(seen[0]).toBe('call-a:running');
    expect(seen.at(-1)).toBe('call-a:complete');
    expect(session.getSnapshot().subagents[0].description).toBeUndefined();
  });

  it('leaves children unrelated when several calls cannot be told apart', async () => {
    const session = run([
      dispatch(call('call-a'), call('call-b')),
      child('tools:two'),
      child('tools:one'),
    ]);
    await session.submit('Go');
    expect(
      session.getSnapshot().subagents.map((agent) => agent.toolCallId)
    ).toEqual([undefined, undefined]);
    expect(session.getSnapshot().subagents[0].name).toBe('tools');
  });

  it('relates only the configured tool names', async () => {
    const events = [
      dispatch(call('call-a', 'Task A', 'delegate')),
      child('tools:one', 'Task A'),
    ];
    const standard = run(events);
    await standard.submit('Go');
    expect(standard.getSnapshot().subagents[0].toolCallId).toBeUndefined();
    const configured = run(events, { subagentToolNames: ['delegate'] });
    await configured.submit('Go');
    expect(configured.getSnapshot().subagents[0].toolCallId).toBe('call-a');
    const none = run(
      [dispatch(call('call-a', 'Task A')), child('tools:one', 'Task A')],
      { subagentToolNames: [] }
    );
    await none.submit('Go');
    expect(none.getSnapshot().subagents[0].toolCallId).toBeUndefined();
  });

  it('never relates plain subgraph nodes, nested delegations or calls without a subagent type', () => {
    const subgraph = (namespace: string[]) => ({
      namespace,
      messages: [],
      toolCalls: [],
      state: undefined,
      interrupts: [],
    });
    const subgraphs = [
      subgraph(['research:1']),
      subgraph(['tools:a', 'tools:b']),
      subgraph(['tools:a', 'model:1']),
    ];
    const bindings = new Map<string, string>();
    expect(
      relateSubgraphs(
        subgraphs,
        [{ id: 'c', name: 'task', args: { subagent_type: 'abc' }, status: 'pending' }],
        new Set(['task']),
        bindings
      )
    ).toBe(subgraphs);
    const tool = [subgraph(['tools:a'])];
    expect(
      relateSubgraphs(
        tool,
        [{ id: 'c', name: 'task', args: { topic: 'x' }, status: 'pending' }],
        new Set(['task']),
        bindings
      )
    ).toBe(tool);
    expect(bindings.size).toBe(0);
  });

  it('keeps a relation and its reference across publications', () => {
    const subgraphs = [
      {
        namespace: ['tools:a'],
        messages: [],
        toolCalls: [],
        state: undefined,
        interrupts: [],
      },
    ];
    const bindings = new Map<string, string>();
    const calls = [
      {
        id: 'c',
        name: 'task',
        args: { subagent_type: 'abc' },
        status: 'pending' as const,
      },
    ];
    const first = relateSubgraphs(subgraphs, calls, new Set(['task']), bindings);
    const second = relateSubgraphs(subgraphs, calls, new Set(['task']), bindings);
    expect(first[0].delegation?.toolCallId).toBe('c');
    expect(second[0]).toBe(first[0]);
    expect(bindings.get('tools:a')).toBe('c');
  });
});

describe('child executions in saved history', () => {
  const saved = (value: Partial<ThreadState>): ThreadState =>
    ({ values: {}, next: [], tasks: [], ...value } as ThreadState);

  it('links a finished task by its tool message and an outstanding one by send index', () => {
    const history = [
      saved({
        values: {
          messages: [
            {
              type: 'ai',
              id: 'plan',
              tool_calls: [{ id: 'call-a' }, { id: 'call-b' }],
            },
          ],
        },
        tasks: [
          {
            id: 'task-b',
            name: 'tools',
            path: ['__pregel_push', 1],
            error: 'Failed',
          },
        ] as never,
      }),
      saved({
        tasks: [
          {
            id: 'task-a',
            name: 'tools',
            path: ['__pregel_push', 0],
            result: {
              messages: [{ type: 'tool', tool_call_id: 'call-a' }],
            },
          },
        ] as never,
      }),
    ];
    const found = mapChildExecutions(history, new Set(['call-a', 'call-b']));
    expect([...found.values()]).toEqual([
      {
        toolCallId: 'call-a',
        checkpointNs: 'tools:task-a',
        outstanding: false,
        failed: false,
      },
      {
        toolCallId: 'call-b',
        checkpointNs: 'tools:task-b',
        outstanding: true,
        failed: true,
      },
    ]);
  });

  it('omits calls that history does not link', () => {
    expect(
      mapChildExecutions(
        [saved({ tasks: [{ id: 't', name: 'tools', path: ['__pregel_pull'] }] as never })],
        new Set(['call-a'])
      ).size
    ).toBe(0);
    expect(mapChildExecutions([], new Set(['call-a'])).size).toBe(0);
  });
});
