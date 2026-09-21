import {
  completeDelivery,
  streamingDelivery,
  type Message,
  type ToolCall,
} from '@threadplane/core';
import { describe, expect, it } from 'vitest';
import {
  initialMessageState,
  reduceMessages,
  type MessageEvent,
} from './message-reducer';

function message(
  id: string,
  content: string,
  role: Message['role'] = 'assistant'
): Message {
  return { id, content, role, delivery: streamingDelivery('run-1') };
}

describe('pure text and tool transitions', () => {
  it('appends repeated identical deltas and shares untouched messages', () => {
    const before = reduceMessages(initialMessageState(), {
      type: 'message',
      mode: 'snapshot',
      message: message('user-1', 'Question', 'user'),
    });
    const first = reduceMessages(before, {
      type: 'message',
      mode: 'delta',
      message: message('ai-1', '|'),
    });
    const second = reduceMessages(first, {
      type: 'message',
      mode: 'delta',
      message: message('ai-1', '|'),
    });
    expect(second.messages[1].content).toBe('||');
    expect(second.messages[0]).toBe(before.messages[0]);
    expect(first.messages[1].content).toBe('|');
    expect(before.messages).toHaveLength(1);
  });

  it('treats snapshots as cumulative, ignores duplicate/shorter snapshots and blocks late deltas after canonical content', () => {
    const first = reduceMessages(initialMessageState(), {
      type: 'message',
      mode: 'snapshot',
      message: message('ai-1', 'hello'),
    });
    expect(
      reduceMessages(first, {
        type: 'message',
        mode: 'snapshot',
        message: message('ai-1', 'hello'),
      })
    ).toBe(first);
    expect(
      reduceMessages(first, {
        type: 'message',
        mode: 'snapshot',
        message: message('ai-1', 'hel'),
      })
    ).toBe(first);
    const final = reduceMessages(first, {
      type: 'message',
      mode: 'canonical',
      message: message('ai-1', 'hello world'),
    });
    expect(
      reduceMessages(final, {
        type: 'message',
        mode: 'delta',
        message: message('ai-1', '!'),
      })
    ).toBe(final);
    expect(
      reduceMessages(final, {
        type: 'message',
        mode: 'snapshot',
        message: message('ai-1', 'hello'),
      })
    ).toBe(final);
    expect(
      reduceMessages(final, {
        type: 'message',
        mode: 'canonical',
        message: message('ai-1', 'hello world'),
      })
    ).toBe(final);
  });

  it('preserves an explicitly correlated optimistic ID across server echoes and subsequent server updates', () => {
    const first = reduceMessages(initialMessageState(), {
      type: 'message',
      mode: 'snapshot',
      message: message('local', 'hello', 'user'),
    });
    const echo = reduceMessages(first, {
      type: 'message',
      mode: 'snapshot',
      existingId: 'local',
      message: message('server', 'hello', 'user'),
    });
    const repeated = reduceMessages(echo, {
      type: 'message',
      mode: 'snapshot',
      message: message('server', 'hello', 'user'),
    });
    expect(echo.messages).toBe(first.messages);
    expect(repeated).toBe(echo);
    expect(repeated.messages.map((value) => value.id)).toEqual(['local']);
    // Equal text alone must not collapse two legitimate user submissions.
    const another = reduceMessages(repeated, {
      type: 'message',
      mode: 'snapshot',
      message: message('local-2', 'hello', 'user'),
    });
    expect(another.messages).toHaveLength(2);
  });

  it.each(['hello', ''])(
    'replaces draft text exactly with canonical content %j',
    (content) => {
      const draft = reduceMessages(initialMessageState(), {
        type: 'message',
        mode: 'delta',
        message: message('ai', 'hello world'),
      });
      const terminal = reduceMessages(draft, {
        type: 'message',
        mode: 'canonical',
        message: message('ai', content),
      });
      expect(terminal.messages[0].content).toBe(content);
      expect(draft.messages[0].content).toBe('hello world');
    }
  );

  it.each(['hello world', 'different content'])(
    'retains terminal canonical text after a late cumulative snapshot %j',
    (content) => {
      const terminal = reduceMessages(initialMessageState(), {
        type: 'message',
        mode: 'canonical',
        message: message('ai', 'hello'),
      });
      expect(
        reduceMessages(terminal, {
          type: 'message',
          mode: 'snapshot',
          message: message('ai', content),
        })
      ).toBe(terminal);
    }
  );

  it('allows later snapshot metadata and delivery completion without replacing terminal text', () => {
    const terminal = reduceMessages(initialMessageState(), {
      type: 'message',
      mode: 'canonical',
      message: message('ai', 'hello'),
    });
    const enriched = reduceMessages(terminal, {
      type: 'message',
      mode: 'snapshot',
      message: {
        ...message('ai', 'stale draft'),
        name: 'assistant',
        toolCallIds: ['call-1'],
        delivery: completeDelivery('run-1', 'success'),
      },
    });
    expect(enriched.messages[0]).toMatchObject({
      content: 'hello',
      name: 'assistant',
      toolCallIds: ['call-1'],
      delivery: completeDelivery('run-1', 'success'),
    });
    expect(terminal.messages[0].delivery.phase).toBe('streaming');
    expect(
      reduceMessages(enriched, {
        type: 'message',
        mode: 'snapshot',
        message: message('ai', 'another draft'),
      })
    ).toBe(enriched);
  });

  it('accepts an explicitly ordered canonical correction exactly and preserves duplicate identity', () => {
    const original = reduceMessages(initialMessageState(), {
      type: 'message',
      mode: 'canonical',
      message: {
        ...message('ai', 'hello world'),
        toolCallIds: ['call-1'],
        delivery: completeDelivery('run-1', 'success'),
      },
    });
    const correction: MessageEvent = {
      type: 'message',
      mode: 'canonical',
      message: message('ai', 'hello'),
    };
    const corrected = reduceMessages(original, correction);
    expect(corrected.messages[0]).toMatchObject({
      id: 'ai',
      content: 'hello',
      toolCallIds: ['call-1'],
      delivery: completeDelivery('run-1', 'success'),
    });
    expect(reduceMessages(corrected, correction)).toBe(corrected);
    expect(
      reduceMessages(corrected, {
        type: 'message',
        mode: 'delta',
        message: message('ai', '!'),
      })
    ).toBe(corrected);
    expect(original.messages[0].content).toBe('hello world');
  });

  it('preserves streamed assistant identity across a canonical server ID change', () => {
    const first = reduceMessages(initialMessageState(), {
      type: 'message',
      mode: 'delta',
      message: message('chunk', 'hello'),
    });
    const final = reduceMessages(first, {
      type: 'message',
      mode: 'canonical',
      existingId: 'chunk',
      message: message('server', 'hello world'),
    });
    expect(final.messages[0]).toMatchObject({
      id: 'chunk',
      content: 'hello world',
    });
    expect(
      reduceMessages(final, {
        type: 'message',
        mode: 'delta',
        message: message('server', '!'),
      })
    ).toBe(final);
  });

  it.each(['success', 'error', 'aborted', 'interrupted', 'paused'] as const)(
    'finalizes only matching streaming delivery as %s',
    (outcome) => {
      const old = {
        ...message('old', 'already complete'),
        delivery: completeDelivery('old-run', 'success'),
      };
      let state = reduceMessages(initialMessageState(), {
        type: 'message',
        mode: 'snapshot',
        message: old,
      });
      state = reduceMessages(state, {
        type: 'message',
        mode: 'delta',
        message: message('ai', 'partial'),
      });
      const final = reduceMessages(state, {
        type: 'complete',
        generation: 'run-1',
        outcome,
      });
      expect(final.messages[0]).toBe(state.messages[0]);
      expect(final.messages[1].delivery).toEqual(
        completeDelivery('run-1', outcome)
      );
      expect(state.messages[1].delivery.phase).toBe('streaming');
      expect(
        reduceMessages(final, {
          type: 'complete',
          generation: 'run-1',
          outcome,
        })
      ).toBe(final);
      expect(
        reduceMessages(final, {
          type: 'message',
          mode: 'delta',
          message: message('ai', 'late'),
        })
      ).toBe(final);
    }
  );

  it('owns incoming nested values and upserts tool slices without mutating history', () => {
    const ids = ['call-1'];
    const input = { ...message('ai', 'searching'), toolCallIds: ids };
    const args = { queries: ['first'] };
    const call: ToolCall = {
      id: 'call-1',
      name: 'search',
      status: 'running',
      args,
    };
    const first = reduceMessages(initialMessageState(), {
      type: 'message',
      mode: 'delta',
      message: input,
    });
    const running = reduceMessages(first, { type: 'tool', toolCall: call });
    ids.push('call-2');
    args.queries.push('second');
    expect(running.messages[0].toolCallIds).toEqual(['call-1']);
    expect(running.toolCalls[0].args).toEqual({ queries: ['first'] });
    const result = { hits: ['found'] };
    const complete = reduceMessages(running, {
      type: 'tool',
      toolCall: {
        ...call,
        args: { queries: ['first'] },
        status: 'complete',
        result,
      },
    });
    result.hits.push('later');
    expect(complete.toolCalls[0]).toMatchObject({
      status: 'complete',
      result: { hits: ['found'] },
    });
    expect(complete.messages).toBe(running.messages);
    expect(running.toolCalls[0].status).toBe('running');
    expect(Object.isFrozen(complete.toolCalls[0])).toBe(true);
    expect(
      reduceMessages(complete, {
        type: 'tool',
        toolCall: {
          id: 'call-1',
          name: 'search',
          args: { queries: ['first'] },
          status: 'complete',
          result: { hits: ['found'] },
        },
      })
    ).toBe(complete);
  });

  it('replays fixed events deterministically without changing the initial state or events', () => {
    const initial = initialMessageState();
    const events: readonly MessageEvent[] = [
      {
        type: 'message',
        mode: 'snapshot',
        message: message('user', 'go', 'user'),
      },
      { type: 'message', mode: 'delta', message: message('ai', 'a') },
      { type: 'message', mode: 'delta', message: message('ai', 'a') },
      { type: 'complete', generation: 'run-1', outcome: 'success' },
    ];
    const saved = JSON.stringify(events);
    const replay = () => events.reduce(reduceMessages, initial);
    expect(replay()).toEqual(replay());
    expect(initial.messages).toEqual([]);
    expect(JSON.stringify(events)).toBe(saved);
  });

  it('preserves sibling tool calls when a handler failure is published as plain text', () => {
    const first: ToolCall = {
      id: 'one',
      name: 'search',
      args: { query: 'one' },
      status: 'running',
    };
    const second: ToolCall = {
      id: 'two',
      name: 'search',
      args: { query: 'two' },
      status: 'running',
    };
    let state = reduceMessages(initialMessageState(), {
      type: 'tool',
      toolCall: first,
    });
    state = reduceMessages(state, { type: 'tool', toolCall: second });
    const failed = reduceMessages(state, {
      type: 'tool',
      toolCall: { ...second, status: 'error', error: 'Handler declined' },
    });
    expect(failed.toolCalls[0]).toBe(state.toolCalls[0]);
    expect(failed.toolCalls[1]).toMatchObject({
      status: 'error',
      error: 'Handler declined',
    });
  });
});
