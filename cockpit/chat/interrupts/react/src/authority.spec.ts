import { describe, expect, it } from 'vitest';
import type { Message, ToolCall } from '@threadplane/core';
import {
  capturePause,
  captureTerminal,
  sameObservedAuthority,
  type InterruptsState,
} from './authority';

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Expected test evidence');
  return value;
}

const delivery = (id: string, outcome: 'success' | 'paused' = 'success') => ({
  generation: id,
  phase: 'complete' as const,
  outcome,
});
function paused(overrides: Partial<InterruptsState> = {}): InterruptsState {
  return {
    status: 'idle',
    messages: [
      {
        id: 'human',
        role: 'user',
        content: 'Book UA123.',
        delivery: delivery('human'),
      },
      {
        id: 'calling',
        role: 'assistant',
        content: '',
        toolCallIds: ['booking'],
        delivery: delivery('calling', 'paused'),
      },
    ],
    toolCalls: [
      {
        id: 'booking',
        name: 'book_flight',
        args: { flight_number: '  ua123  ' },
        status: 'pending',
      },
    ],
    interrupts: [
      {
        id: 'approval',
        value: {
          type: 'approval_request',
          summary: 'Book this demo flight?',
          flight: {
            flight_number: 'UA123',
            airline: 'UA',
            from: 'LAX',
            to: 'JFK',
            depart_local: '08:00',
            aircraft: 'Boeing 787',
          },
        },
      },
    ],
    subgraphs: [],
    history: [
      {
        checkpoint: {
          thread_id: 'thread',
          checkpoint_ns: '',
          checkpoint_id: 'pause',
        },
        parent_checkpoint: null,
        created_at: '2026-10-05T00:00:00Z',
        next: ['tools'],
      },
    ],
    ...overrides,
  };
}
function terminal(): InterruptsState {
  const state = paused();
  return {
    ...state,
    interrupts: [],
    messages: [
      state.messages[0],
      { ...state.messages[1], delivery: delivery('calling') },
      {
        id: 'result',
        role: 'tool',
        name: 'book_flight',
        toolCallId: 'booking',
        content: 'Booked UA123.',
        delivery: delivery('result'),
      },
      {
        id: 'answer',
        role: 'assistant',
        content: 'Booked UA123.',
        delivery: delivery('answer'),
      },
    ],
    toolCalls: [
      { ...state.toolCalls[0], status: 'complete', result: 'Booked UA123.' },
    ],
    history: [
      {
        ...required(state.history)[0],
        checkpoint: {
          thread_id: 'thread',
          checkpoint_ns: '',
          checkpoint_id: 'terminal',
        },
        next: [],
      },
    ],
  };
}
const mutateApproval = (
  state: InterruptsState,
  changes: Record<string, unknown>
): InterruptsState => {
  const original = state.interrupts[0] as {
    id: string;
    value: Record<string, unknown>;
  };
  return {
    ...state,
    interrupts: [{ ...original, value: { ...original.value, ...changes } }],
  };
};

describe('saved approval authority', () => {
  it('rejects custom array prototypes and non-index properties without evaluating accessors', () => {
    const state = paused();
    let reads = 0;
    const messages = [...state.messages];
    Object.defineProperty(messages, 'extra', {
      get() {
        ++reads;
        return true;
      },
    });
    expect(capturePause({ ...state, messages }, 'thread')).toBeNull();
    const toolCalls = [...state.toolCalls];
    Object.setPrototypeOf(toolCalls, Object.create(Array.prototype));
    expect(capturePause({ ...state, toolCalls }, 'thread')).toBeNull();
    expect(reads).toBe(0);
  });
  it('owns one canonical paused booking and normalizes its backend argument', () => {
    const state = paused(),
      authority = capturePause(state, 'thread');
    expect(authority?.approval.flight.flight_number).toBe('UA123');
    expect(authority?.approval.summary).toBe('Book this demo flight?');
    expect(authority?.batch).toBe(state.interrupts);
    expect(Object.isFrozen(authority?.approval.flight)).toBe(true);
    expect(authority && sameObservedAuthority(authority, state)).toBe(true);
  });
  it('confirms resolved tool history and the formerly paused assistant only after canonical success', () => {
    const state = terminal();
    expect(captureTerminal(state, 'thread')).not.toBeNull();
    expect(
      captureTerminal(
        {
          ...state,
          messages: state.messages.map((m) =>
            m.id === 'calling'
              ? { ...m, delivery: delivery(m.id, 'paused') }
              : m
          ),
        },
        'thread'
      )
    ).toBeNull();
    expect(captureTerminal(paused(), 'thread')).toBeNull();
  });
  it('accepts a direct text answer without tools', () => {
    const state = terminal();
    expect(
      captureTerminal(
        {
          ...state,
          toolCalls: [],
          messages: [state.messages[0], state.messages[3]],
        },
        'thread'
      )
    ).not.toBeNull();
  });
  it('accepts causally resolved read tools before the current pending booking', () => {
    const state = paused();
    const messages: Message[] = [
      state.messages[0],
      {
        id: 'reading',
        role: 'assistant',
        content: '',
        toolCallIds: ['lookup'],
        delivery: delivery('reading'),
      },
      {
        id: 'lookup-result',
        role: 'tool',
        name: 'lookup_flight',
        toolCallId: 'lookup',
        content: '{"flight_number":"UA123"}',
        delivery: delivery('lookup-result'),
      },
      state.messages[1],
    ];
    const toolCalls: ToolCall[] = [
      {
        id: 'lookup',
        name: 'lookup_flight',
        args: { flight_number: 'UA123' },
        status: 'complete',
        result: '{"flight_number":"UA123"}',
      },
      ...state.toolCalls,
    ];
    expect(
      capturePause({ ...state, messages, toolCalls }, 'thread')
    ).not.toBeNull();
  });
  it('rejects two pending calls even when the real task exposes one interrupt', () => {
    const state = paused();
    expect(
      capturePause(
        {
          ...state,
          messages: [
            state.messages[0],
            { ...state.messages[1], toolCallIds: ['booking', 'other'] },
          ],
          toolCalls: [
            ...state.toolCalls,
            { ...state.toolCalls[0], id: 'other' },
          ],
        },
        'thread'
      )
    ).toBeNull();
  });
  it('rejects unsupported, mismatched or multiple approvals', () => {
    const state = paused();
    expect(
      capturePause(mutateApproval(state, { type: 'refund_approval' }), 'thread')
    ).toBeNull();
    const original = (
      state.interrupts[0] as { value: { flight: Record<string, unknown> } }
    ).value.flight;
    expect(
      capturePause(
        mutateApproval(state, {
          flight: { ...original, flight_number: 'AA404' },
        }),
        'thread'
      )
    ).toBeNull();
    expect(
      capturePause(
        { ...state, interrupts: [...state.interrupts, ...state.interrupts] },
        'thread'
      )
    ).toBeNull();
  });
  it('does not execute payload or argument getters', () => {
    let reads = 0;
    const value = Object.defineProperty(
      { type: 'approval_request' },
      'summary',
      {
        enumerable: true,
        get() {
          ++reads;
          return 'Confirm';
        },
      }
    );
    const state = paused({ interrupts: [{ id: 'approval', value }] });
    expect(capturePause(state, 'thread')).toBeNull();
    const args = Object.defineProperty({}, 'flight_number', {
      enumerable: true,
      get() {
        ++reads;
        return 'UA123';
      },
    });
    expect(
      capturePause(
        paused({
          toolCalls: [
            { id: 'booking', name: 'book_flight', args, status: 'pending' },
          ],
        }),
        'thread'
      )
    ).toBeNull();
    expect(reads).toBe(0);
  });
  it('rejects missing, foreign, non-root or non-authoritative checkpoints', () => {
    const state = paused();
    expect(capturePause({ ...state, history: undefined }, 'thread')).toBeNull();
    for (const checkpoint of [
      { thread_id: 'other', checkpoint_ns: '', checkpoint_id: 'pause' },
      { thread_id: 'thread', checkpoint_ns: 'child', checkpoint_id: 'pause' },
      { thread_id: 'thread', checkpoint_ns: '' },
    ]) {
      expect(
        capturePause(
          {
            ...state,
            history: [{ ...required(state.history)[0], checkpoint }],
          },
          'thread'
        )
      ).toBeNull();
    }
    expect(
      capturePause(
        {
          ...state,
          history: [{ ...required(state.history)[0], next: ['other'] }],
        },
        'thread'
      )
    ).toBeNull();
    expect(capturePause({ ...state, subgraphs: [{}] }, 'thread')).toBeNull();
  });
  it('fences a new checkpoint with a shared interrupt batch and identical payload', () => {
    const state = paused(),
      authority = capturePause(state, 'thread');
    expect(authority).not.toBeNull();
    const changed = {
      ...state,
      history: [
        {
          ...required(state.history)[0],
          checkpoint: {
            thread_id: 'thread',
            checkpoint_ns: '',
            checkpoint_id: 'new-pause',
          },
        },
      ],
    };
    expect(authority && sameObservedAuthority(authority, changed)).toBe(false);
    expect(
      authority &&
        sameObservedAuthority(authority, {
          ...state,
          interrupts: [...state.interrupts],
        })
    ).toBe(false);
    expect(
      authority &&
        sameObservedAuthority(authority, {
          ...state,
          messages: [
            { ...state.messages[0], content: 'Different request' },
            state.messages[1],
          ],
        })
    ).toBe(false);
  });
  it('rejects a pending call from an older human turn', () => {
    const state = paused();
    expect(
      capturePause(
        {
          ...state,
          messages: [
            ...state.messages,
            {
              id: 'later',
              role: 'user',
              content: 'New request',
              delivery: delivery('later'),
            },
          ],
        },
        'thread'
      )
    ).toBeNull();
  });
  it('rejects duplicate message/call identities and noncausal results', () => {
    const state = terminal();
    expect(
      captureTerminal(
        { ...state, messages: [...state.messages, state.messages[0]] },
        'thread'
      )
    ).toBeNull();
    expect(
      captureTerminal(
        { ...state, toolCalls: [...state.toolCalls, state.toolCalls[0]] },
        'thread'
      )
    ).toBeNull();
    expect(
      captureTerminal(
        {
          ...state,
          messages: [
            state.messages[0],
            state.messages[2],
            state.messages[1],
            state.messages[3],
          ],
        },
        'thread'
      )
    ).toBeNull();
    expect(
      captureTerminal(
        {
          ...state,
          messages: state.messages.map((m) =>
            m.role === 'tool' ? { ...m, toolCallId: 'other' } : m
          ),
        },
        'thread'
      )
    ).toBeNull();
    expect(
      captureTerminal(
        {
          ...state,
          toolCalls: [
            {
              ...state.toolCalls[0],
              status: 'complete',
              result: 'Different result',
            },
          ],
        },
        'thread'
      )
    ).toBeNull();
  });
  it('rejects unknown tools, unresolved errors, unconfirmed generations and child evidence', () => {
    const state = terminal();
    expect(
      captureTerminal(
        { ...state, toolCalls: [{ ...state.toolCalls[0], name: 'foreign' }] },
        'thread'
      )
    ).toBeNull();
    expect(
      captureTerminal(
        {
          ...state,
          error: { kind: 'server', message: 'Failure', retryable: false },
        },
        'thread'
      )
    ).toBeNull();
    expect(
      captureTerminal(
        {
          ...state,
          messages: state.messages.map((m) => ({
            ...m,
            delivery: { ...m.delivery, generation: 'unconfirmed' },
          })),
        },
        'thread'
      )
    ).toBeNull();
    expect(captureTerminal({ ...state, subgraphs: [{}] }, 'thread')).toBeNull();
  });
});
