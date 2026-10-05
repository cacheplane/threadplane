import { describe, expect, it } from 'vitest';
import type { Message, ToolCall } from '@threadplane/core';
import {
  captureTerminal,
  copyData,
  validToolArgs,
  type SubagentsState,
} from './authority';

const delivery = (id: string) => ({
  generation: id,
  phase: 'complete' as const,
  outcome: 'success' as const,
});
function terminal(): SubagentsState {
  const result = '{"flight_number":"UA123"}';
  return {
    status: 'idle',
    interrupts: [],
    subgraphs: [],
    messages: [
      {
        id: 'human',
        role: 'user',
        content: 'Status UA123',
        delivery: delivery('human'),
      },
      {
        id: 'call',
        role: 'assistant',
        content: '',
        toolCallIds: ['lookup'],
        delivery: delivery('call'),
      },
      {
        id: 'result',
        role: 'tool',
        name: 'task',
        toolCallId: 'lookup',
        content: result,
        delivery: delivery('result'),
      },
      {
        id: 'answer',
        role: 'assistant',
        content: 'Observed UA123.',
        delivery: delivery('answer'),
      },
    ],
    toolCalls: [
      {
        id: 'lookup',
        name: 'task',
        args: {
          subagent_type: 'research',
          task_description: 'Plan LAX to JFK',
        },
        status: 'complete',
        result,
      },
    ],
    history: [
      {
        checkpoint: {
          thread_id: 'thread',
          checkpoint_ns: '',
          checkpoint_id: 'saved',
        },
        next: [],
      },
    ],
  };
}
describe('canonical tool conversation authority', () => {
  it('captures a frozen exact terminal transcript and literal tool result', () => {
    const state = terminal(),
      authority = captureTerminal(state, 'thread');
    expect(authority?.messages).toEqual(state.messages);
    expect(authority?.tools).toEqual(state.toolCalls);
    expect(Object.isFrozen(authority?.tools[0].args)).toBe(true);
    expect(captureTerminal(state, 'other')).toBeNull();
  });
  it('accepts a direct text answer and domain error data', () => {
    const state = terminal();
    expect(
      captureTerminal(
        {
          ...state,
          messages: [state.messages[0], state.messages[3]],
          toolCalls: [],
        },
        'thread'
      )
    ).not.toBeNull();
    const result = '{"error":"Flight not found"}';
    expect(
      captureTerminal(
        {
          ...state,
          messages: state.messages.map((m) =>
            m.role === 'tool' ? { ...m, content: result } : m
          ),
          toolCalls: [{ ...state.toolCalls[0], status: 'complete', result }],
        },
        'thread'
      )
    ).not.toBeNull();
  });
  it('accepts parallel same-name results in reverse completion order', () => {
    const state = terminal();
    const tools: ToolCall[] = ['LAX', 'JFK'].map((code) => ({
      id: code,
      name: 'task',
      args: { subagent_type: 'research', task_description: code },
      status: 'complete',
      result: code,
    }));
    const results: Message[] = [...tools].reverse().map((tool) => ({
      id: `result-${tool.id}`,
      role: 'tool',
      name: tool.name,
      toolCallId: tool.id,
      content: tool.status === 'complete' ? (tool.result as string) : '',
      delivery: delivery(`result-${tool.id}`),
    }));
    const messages = [
      state.messages[0],
      { ...state.messages[1], toolCallIds: ['LAX', 'JFK'] },
      ...results,
      state.messages[3],
    ];
    expect(
      captureTerminal({ ...state, messages, toolCalls: tools }, 'thread')
    ).not.toBeNull();
  });
  it.each([
    'foreign-root',
    'pending',
    'interrupt',
    'subgraph',
    'error',
    'running',
    'no-history',
  ])('rejects unsafe terminal state %s', (mode) => {
    const state = terminal();
    const changes: Partial<SubagentsState> =
      mode === 'foreign-root'
        ? {
            history: [
              {
                checkpoint: {
                  thread_id: 'thread',
                  checkpoint_ns: 'child',
                  checkpoint_id: 'saved',
                },
                next: [],
              },
            ],
          }
        : mode === 'pending'
        ? {
            history: [
              {
                checkpoint: {
                  thread_id: 'thread',
                  checkpoint_ns: '',
                  checkpoint_id: 'saved',
                },
                next: ['tools'],
              },
            ],
          }
        : mode === 'interrupt'
        ? { interrupts: [{}] }
        : mode === 'subgraph'
        ? { subgraphs: [{}] }
        : mode === 'error'
        ? { error: { kind: 'server', message: 'private', retryable: false } }
        : mode === 'running'
        ? { status: 'running' }
        : { history: undefined };
    expect(captureTerminal({ ...state, ...changes }, 'thread')).toBeNull();
  });
  it.each([
    'duplicate-call',
    'orphan-result',
    'wrong-name',
    'wrong-result',
    'duplicate-result',
    'result-before-call',
    'missing-result',
    'pending-call',
    'bad-args',
    'bad-generation',
    'failed-delivery',
    'empty-answer',
  ])('rejects invalid transcript %s', (mode) => {
    const state = terminal();
    const messages = [...state.messages];
    let tools = [...state.toolCalls];
    if (mode === 'duplicate-call')
      messages[1] = { ...messages[1], toolCallIds: ['lookup', 'lookup'] };
    if (mode === 'orphan-result')
      messages[2] = { ...messages[2], toolCallId: 'orphan' };
    if (mode === 'wrong-name')
      messages[2] = { ...messages[2], name: 'get_airport_info' };
    if (mode === 'wrong-result')
      messages[2] = { ...messages[2], content: 'changed' };
    if (mode === 'duplicate-result')
      messages.splice(3, 0, {
        ...messages[2],
        id: 'duplicate',
        delivery: delivery('duplicate'),
      });
    if (mode === 'result-before-call')
      [messages[1], messages[2]] = [messages[2], messages[1]];
    if (mode === 'missing-result') messages.splice(2, 1);
    if (mode === 'pending-call') tools = [{ ...tools[0], status: 'pending' }];
    if (mode === 'bad-args')
      tools = [{ ...tools[0], args: { flight_number: 123 } }];
    if (mode === 'bad-generation')
      messages[1] = { ...messages[1], delivery: delivery('foreign') };
    if (mode === 'failed-delivery')
      messages[1] = {
        ...messages[1],
        delivery: { ...delivery('call'), outcome: 'error' },
      };
    if (mode === 'empty-answer') messages[3] = { ...messages[3], content: '' };
    expect(
      captureTerminal({ ...state, messages, toolCalls: tools }, 'thread')
    ).toBeNull();
  });
  it('validates exact supported specialist arguments', () => {
    for (const role of ['research', 'booking', 'itinerary'])
      expect(
        validToolArgs({
          name: 'task',
          args: { subagent_type: role, task_description: 'Plan' },
        })
      ).toBe(true);
    for (const args of [
      {},
      { subagent_type: 'unknown', task_description: 'Plan' },
      { subagent_type: 'research', task_description: '' },
      { subagent_type: 'research', task_description: 123 },
      { subagent_type: 'research', task_description: 'Plan', extra: true },
    ])
      expect(validToolArgs({ name: 'task', args })).toBe(false);
    expect(
      validToolArgs({
        name: 'book_flight',
        args: { subagent_type: 'booking', task_description: 'Plan' },
      })
    ).toBe(false);
  });
  it('rejects accessors and unsafe data without calling formatting hooks', () => {
    let reads = 0;
    const accessor = Object.defineProperty({}, 'flight_number', {
      get() {
        reads++;
        return 'UA123';
      },
    });
    const toJSON = {
      toJSON() {
        reads++;
        return {};
      },
    };
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);
    const extra = Object.defineProperty([], 'extra', {
      get() {
        reads++;
        return true;
      },
    });
    for (const value of [
      accessor,
      toJSON,
      cyclic,
      extra,
      Array(3),
      Object.create({ a: 1 }),
      Object.assign({}, { [Symbol()]: true }),
      NaN,
      Infinity,
    ])
      expect(() => copyData(value)).toThrow();
    const state = terminal();
    expect(
      captureTerminal(
        { ...state, toolCalls: [{ ...state.toolCalls[0], args: accessor }] },
        'thread'
      )
    ).toBeNull();
    expect(reads).toBe(0);
  });
});
