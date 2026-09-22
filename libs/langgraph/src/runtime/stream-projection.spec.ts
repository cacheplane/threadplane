import { describe, expect, it } from 'vitest';
import type { ToolCall } from '@threadplane/core';
import { initialMessageState, reduceMessages } from './message-reducer';
import {
  finalizeProjection,
  projectStream,
  type StreamProjection,
} from './stream-projection';

const user = { type: 'human', id: 'user', content: 'Work' };
const call = (id: string) => ({ id, name: 'work', args: { id } });
const assistant = (id: string, ids?: string[], content = '') => ({
  type: 'ai',
  id,
  content,
  ...(ids === undefined ? {} : { tool_calls: ids.map(call) }),
});
const projection = (): StreamProjection => ({
  generation: 'run',
  userId: user.id,
  baselineIds: [],
  sawAssistant: false,
  terminal: false,
  paused: false,
  canonical: [],
});
function start(messages = [assistant('step', ['c1'])]) {
  return projectStream(initialMessageState(), projection(), {
    type: 'values',
    data: { messages: [user, ...messages] },
  });
}

describe('authoritative tool ownership', () => {
  it.each([{ ids: [] }, { ids: ['c2'] }])(
    'reconciles one assistant call list to $ids',
    ({ ids }) => {
      const before = start();
      const next = projectStream(before.state, before.projection, {
        type: 'values',
        data: { messages: [user, assistant('step', ids, 'Corrected')] },
      });
      expect(next.state.toolCalls.map((entry) => entry.id)).toEqual(ids);
      expect(next.projection.toolCallIds).toEqual(ids);
      expect(
        finalizeProjection(next.state, next.projection).messages[1]
      ).toMatchObject({
        content: 'Corrected',
        toolCallIds: ids,
      });
      expect(before.state.toolCalls.map((entry) => entry.id)).toEqual(['c1']);
    }
  );

  it('keeps omitted tool metadata and ignores empty chunk defaults', () => {
    const before = start();
    for (const raw of [
      assistant('step'),
      { ...assistant('step', []), type: 'AIMessageChunk' },
    ]) {
      const next = projectStream(before.state, before.projection, {
        type: 'values',
        data: { messages: [user, raw] },
      });
      expect(next.state.toolCalls.map((entry) => entry.id)).toEqual(['c1']);
      expect(next.projection.toolCallIds).toEqual(['c1']);
      expect(next.state.messages[1].toolCallIds).toEqual(['c1']);
    }
  });

  it('preserves earlier distinct assistant steps when correcting a later step', () => {
    const before = start([
      assistant('earlier', ['c0']),
      assistant('later', ['c1']),
    ]);
    const next = projectStream(before.state, before.projection, {
      type: 'values',
      data: { messages: [user, assistant('later', ['c2'])] },
    });
    expect(next.state.toolCalls.map((entry) => entry.id)).toEqual(['c0', 'c2']);
    expect(next.projection.toolCallIds).toEqual(['c0', 'c2']);
    expect(
      next.state.messages.find((entry) => entry.id === 'earlier')?.toolCallIds
    ).toEqual(['c0']);
  });

  it('does not let partial chunks overwrite finalized call ownership before a correction', () => {
    const before = start();
    const chunk = projectStream(before.state, before.projection, {
      type: 'messages',
      messageMetadata: {},
      messages: [
        { ...assistant('step', ['fragment']), type: 'AIMessageChunk' },
      ],
    });
    expect(chunk.projection.toolCallIds).toEqual(['c1']);
    expect(chunk.state.messages[1].toolCallIds).toEqual(['c1']);
    const corrected = projectStream(chunk.state, chunk.projection, {
      type: 'values',
      data: { messages: [user, assistant('step', [])] },
    });
    expect(corrected.state.toolCalls).toEqual([]);
    expect(corrected.projection.toolCallIds).toEqual([]);
  });

  it.each(['running', 'complete', 'error'] as const)(
    'preserves a %s fact across removal and replay',
    (status) => {
      const before = start();
      const fact: ToolCall = {
        ...before.state.toolCalls[0],
        ...(status === 'complete'
          ? { status, result: { saved: true } }
          : status === 'error'
          ? { status, error: 'Saved failure' }
          : { status }),
      };
      const state = reduceMessages(before.state, {
        type: 'tool',
        toolCall: fact,
      });
      const corrected = projectStream(state, before.projection, {
        type: 'values',
        data: { messages: [user, assistant('step', [])] },
      });
      expect(corrected.state.toolCalls).toEqual([fact]);
      expect(corrected.projection.toolCallIds).toEqual([]);
      const replayed = projectStream(corrected.state, corrected.projection, {
        type: 'values',
        data: { messages: [user, assistant('step', ['c1'])] },
      });
      expect(replayed.state.toolCalls).toEqual([fact]);
    }
  );

  it('preserves server settlement evidence even after a corrected assistant in the same batch', () => {
    const before = start();
    const next = projectStream(before.state, before.projection, {
      type: 'values',
      data: {
        messages: [
          user,
          assistant('step', []),
          { type: 'tool', id: 'result', tool_call_id: 'c1', content: 'Saved' },
        ],
      },
    });
    expect(next.state.toolCalls).toMatchObject([
      { id: 'c1', status: 'complete', result: 'Saved' },
    ]);
    expect(next.projection.toolCallIds).toEqual([]);
  });
});
