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
function start(messages: unknown[] = [assistant('step', ['c1'])]) {
  return projectStream(initialMessageState(), projection(), {
    type: 'values',
    data: { messages: [user, ...messages] },
  });
}

describe('authoritative tool ownership', () => {
  it('captures terminal citations before finalization and clears omitted canonical metadata', () => {
    const citations = [
      { id: 'source', title: 'Original', extra: { tags: ['original'] } },
    ];
    const before = start([
      { ...assistant('step'), additional_kwargs: { citations } },
    ]);
    expect(before.state.messages[1].citations?.[0].title).toBe('Original');
    citations[0].title = 'Mutated';
    citations[0].extra.tags.push('mutated');
    const final = finalizeProjection(before.state, before.projection);
    expect(final.messages[1].citations?.[0]).toEqual({
      id: 'source',
      index: 1,
      title: 'Original',
      extra: { tags: ['original'] },
    });
    const correction = projectStream(final, before.projection, {
      type: 'values',
      data: { messages: [user, assistant('step', undefined, 'Corrected')] },
    });
    expect(correction.state.messages[1].citations).toBe(
      final.messages[1].citations
    );
    expect(
      finalizeProjection(correction.state, correction.projection).messages[1]
        .citations
    ).toBeUndefined();
  });

  it('leaves pause classification to the aggregate interrupt projector without reading control getters', () => {
    const before = start();
    const next = projectStream(before.state, before.projection, {
      type: 'custom',
      data: {
        get __interrupt__() {
          throw new Error('not a control event');
        },
      },
    });
    expect(next.state).toBe(before.state);
    expect(next.projection).toBe(before.projection);
  });
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

describe('resume projection turn ownership', () => {
  function resumed() {
    const initial = start([assistant('step', ['pending'], 'Waiting')]);
    const state = reduceMessages(
      finalizeProjection(initial.state, initial.projection),
      { type: 'complete', generation: 'run', outcome: 'paused' }
    );
    const next: StreamProjection = {
      ...projection(),
      generation: 'resume',
      baselineIds: state.messages.map((message) => message.id),
      resume: { turnIds: ['step'] },
    };
    return { state, projection: next };
  }

  it('retains exact replay delivery but recognizes current terminal pending arguments', () => {
    const before = resumed();
    const next = projectStream(before.state, before.projection, {
      type: 'values',
      data: { messages: [user, assistant('step', ['pending'], 'Waiting')] },
    });
    expect(next.state.messages).toBe(before.state.messages);
    expect(next.projection.terminal).toBe(true);
    expect(next.projection.toolCallIds).toEqual(['pending']);
  });

  it.each(['', 'Changed'])(
    'attributes changed same-ID terminal content %j to resume',
    (content) => {
      const before = resumed();
      const next = projectStream(before.state, before.projection, {
        type: 'values',
        data: { messages: [assistant('step', [], content)] },
      });
      expect(next.state.messages.at(-1)).toMatchObject({
        content,
        delivery: { generation: 'resume', phase: 'streaming' },
      });
      expect(next.projection.sawAssistant).toBe(true);
      expect(
        finalizeProjection(next.state, next.projection).messages.at(-1)?.content
      ).toBe(content);
    }
  );

  it('treats same-ID chunks as new activity and replaces interim text with the terminal correction', () => {
    const before = resumed();
    const delta = projectStream(before.state, before.projection, {
      type: 'messages',
      messageMetadata: {},
      messages: [
        {
          type: 'AIMessageChunk',
          id: 'step',
          content: 'New streaming content',
        },
      ],
    });
    expect(delta.state.messages.at(-1)?.content).toBe('New streaming content');
    expect(delta.state.messages.at(-1)?.delivery).toMatchObject({
      generation: 'resume',
      phase: 'streaming',
    });
    expect(delta.projection.terminal).toBe(false);
    const terminal = projectStream(delta.state, delta.projection, {
      type: 'values',
      data: { messages: [assistant('step', [], 'Final')] },
    });
    expect(
      finalizeProjection(terminal.state, terminal.projection).messages.at(-1)
        ?.content
    ).toBe('Final');
  });

  it('uses captured baseline turn membership when the current user anchor is omitted', () => {
    const before = resumed();
    const withOld = reduceMessages(before.state, {
      type: 'message',
      mode: 'snapshot',
      message: {
        id: 'old',
        role: 'assistant',
        content: '',
        toolCallIds: ['old-call'],
        delivery: before.state.messages[0].delivery,
      },
    });
    const next = projectStream(
      withOld,
      {
        ...before.projection,
        baselineIds: [...before.projection.baselineIds, 'old'],
      },
      {
        type: 'values',
        data: {
          messages: [
            assistant('old', ['old-call']),
            assistant('step', ['pending']),
            { ...user, id: 'next-user' },
            assistant('next', ['next-call']),
          ],
        },
      }
    );
    expect(next.projection.toolCallIds).toEqual(['pending']);
  });
});
