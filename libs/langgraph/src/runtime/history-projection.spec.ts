import type { ThreadState } from '@langchain/langgraph-sdk';
import { describe, expect, it } from 'vitest';
import { completeDelivery, staticDelivery } from '@threadplane/core';
import { initialMessageState, reduceMessages } from './message-reducer';
import { projectHistory } from './history-projection';

const human = (id: string, content = 'Question') => ({
  type: 'human',
  id,
  content,
});
const ai = (id: string, content = 'Answer', tool_calls?: unknown[]) => ({
  type: 'ai',
  id,
  content,
  ...(tool_calls === undefined ? {} : { tool_calls }),
});
const call = (id: string, name = 'work', args: unknown = { id }) => ({
  id,
  name,
  args,
});
const result = (id: string, tool_call_id: string, content = 'Saved') => ({
  type: 'tool',
  id,
  tool_call_id,
  content,
});
function checkpoint(
  messages: unknown[],
  overrides: Partial<ThreadState> = {}
): ThreadState {
  return {
    values: { messages } as ThreadState['values'],
    next: [],
    tasks: [],
    checkpoint: {
      thread_id: 'thread',
      checkpoint_id: 'latest',
      checkpoint_ns: '',
      checkpoint_map: {},
    },
    metadata: null,
    created_at: null,
    parent_checkpoint: null,
    ...overrides,
  };
}
const initial = () => initialMessageState();

describe('pure authoritative history projection', () => {
  it('reads only the latest checkpoint, without merging older messages or pause evidence', () => {
    const state = projectHistory(initial(), [
      checkpoint([human('u'), ai('a', 'Latest')]),
      checkpoint([ai('old')], { values: { __interrupt__: ['old'] } }),
    ]);
    expect(state.messages.map((message) => message.id)).toEqual(['u', 'a']);
    expect(state.messages[1].content).toBe('Latest');
    expect(state.messages[1].delivery).toEqual(staticDelivery('a'));
  });

  it('treats empty history and a latest checkpoint without messages as authoritative empty', () => {
    const prior = projectHistory(initial(), [
      checkpoint([ai('a', 'Old', [call('c')])]),
    ]);
    for (const history of [[], [checkpoint([], { values: {} })]]) {
      const empty = projectHistory(prior, history);
      expect(empty).toEqual(initial());
      expect(projectHistory(empty, history)).toBe(empty);
    }
  });

  it('replaces, removes, reorders and corrects shorter or empty content while sharing unchanged IDs', () => {
    const before = projectHistory(initial(), [
      checkpoint([human('u'), ai('a', 'Long answer'), ai('keep'), ai('gone')]),
    ]);
    const shorter = projectHistory(before, [
      checkpoint([ai('keep'), ai('a', 'Long'), human('u')]),
    ]);
    expect(shorter.messages.map((message) => message.id)).toEqual([
      'keep',
      'a',
      'u',
    ]);
    expect(shorter.messages[0]).toBe(before.messages[2]);
    expect(shorter.messages[2]).toBe(before.messages[0]);
    expect(shorter.messages[1].content).toBe('Long');
    const empty = projectHistory(shorter, [checkpoint([ai('a', '')])]);
    expect(empty.messages[0].content).toBe('');
    expect(before.messages[1].content).toBe('Long answer');
  });

  it('keeps equal state, arrays, messages and nested tool identities across separately allocated reads', () => {
    const history = [
      checkpoint([ai('a', '', [call('c', 'work', { nested: ['x'] })])]),
    ];
    const first = projectHistory(initial(), history);
    const second = projectHistory(first, structuredClone(history));
    expect(first.toolCalls).toHaveLength(1);
    expect(second).toBe(first);
    expect(second.messages).toBe(first.messages);
    expect(second.toolCalls).toBe(first.toolCalls);
    expect(second.toolCalls[0].args).toBe(first.toolCalls[0].args);
    expect(second.messages[0].delivery).toEqual(staticDelivery('a'));
  });

  it('resets live canonical and alias bookkeeping and adopts static delivery', () => {
    const live = reduceMessages(initial(), {
      type: 'message',
      mode: 'canonical',
      message: {
        id: 'a',
        role: 'assistant',
        content: 'Answer',
        delivery: completeDelivery('attempt', 'success'),
      },
    });
    const withAliases = {
      ...live,
      aliases: [{ from: 'draft', to: 'a', generation: 'attempt' }],
    };
    const projected = projectHistory(withAliases, [checkpoint([ai('a')])]);
    expect(projected.canonical).toEqual([]);
    expect(projected.aliases).toEqual([]);
    expect(projected.messages[0].delivery).toEqual(staticDelivery('a'));
  });

  it('uses last explicit duplicate occurrence and never publishes duplicate identities or superseded tools', () => {
    const state = projectHistory(initial(), [
      checkpoint([
        ai('same', 'Old', [call('old')]),
        human('u'),
        ai('same', 'Final', [call('new')]),
      ]),
    ]);
    expect(state.messages.map((message) => message.id)).toEqual(['u', 'same']);
    expect(state.messages[1].content).toBe('Final');
    expect(state.toolCalls.map((entry) => entry.id)).toEqual(['new']);
  });

  it('reserves all explicit IDs before assigning deterministic index fallbacks, including unknown roles', () => {
    const history = [
      checkpoint([
        { type: 'human', content: 'No id' },
        ai('history-message-0'),
        { type: 'unsupported', id: 'history-message-0-1' },
        { type: 'ai', content: 'No id either' },
        ai('history-message-3'),
      ]),
    ];
    const first = projectHistory(initial(), history);
    expect(first.messages.map((message) => message.id)).toEqual([
      'history-message-0-2',
      'history-message-0',
      'history-message-3-1',
      'history-message-3',
    ]);
    expect(new Set(first.messages.map((message) => message.id)).size).toBe(4);
    expect(projectHistory(first, structuredClone(history))).toBe(first);
  });

  it('normalizes wire role aliases and text blocks using the text-only stream vocabulary', () => {
    const state = projectHistory(initial(), [
      checkpoint([
        {
          type: 'HumanMessage',
          id: 'u',
          content: [
            { type: 'text', text: 'Hi' },
            { type: 'image', url: 'ignored' },
            { type: 'text', text: '!' },
          ],
        },
        {
          type: 'AIMessage',
          id: 'a',
          content: [{ type: 'text', text: 'Hello' }],
        },
        { role: 'system', id: 's', content: 'Rules' },
        {
          type: 'ToolMessage',
          id: 't',
          name: 'work',
          tool_call_id: 'c',
          content: 'Wire result',
        },
        {
          role: 'assistant',
          id: 'empty',
          content: { text: 'Not a supported block list' },
        },
        null,
        'ignored',
        { type: 'unsupported', id: 'ignored', content: 'Ignored' },
      ]),
    ]);
    expect(
      state.messages.map(({ role, content }) => ({ role, content }))
    ).toEqual([
      { role: 'user', content: 'Hi!' },
      { role: 'assistant', content: 'Hello' },
      { role: 'system', content: 'Rules' },
      { role: 'tool', content: 'Wire result' },
      { role: 'assistant', content: '' },
    ]);
    expect(state.messages[3]).toMatchObject({ name: 'work', toolCallId: 'c' });
  });

  it('matches wire results by exact call ID independent of message order and retains pending calls', () => {
    const state = projectHistory(initial(), [
      checkpoint([
        result('r', 'c1', '{"saved":true}'),
        ai('a', '', [call('c10'), call('c1')]),
      ]),
    ]);
    expect(state.toolCalls).toMatchObject([
      { id: 'c10', status: 'pending' },
      { id: 'c1', status: 'complete', result: '{"saved":true}' },
    ]);
    expect(state.messages[0]).toMatchObject({
      role: 'tool',
      toolCallId: 'c1',
      content: '{"saved":true}',
    });
  });

  it('shares unchanged tools by ID across reorder and removes absent tool metadata and results', () => {
    const before = projectHistory(initial(), [
      checkpoint([ai('a', '', [call('c1'), call('c2')])]),
    ]);
    const reordered = projectHistory(before, [
      checkpoint([ai('a', '', [call('c2'), call('c1')])]),
    ]);
    expect(reordered.toolCalls).toHaveLength(2);
    expect(reordered.toolCalls[0]).toBe(before.toolCalls[1]);
    expect(reordered.toolCalls[1]).toBe(before.toolCalls[0]);
    for (const raw of [ai('a'), ai('a', '', [])]) {
      const removed = projectHistory(reordered, [checkpoint([raw])]);
      expect(removed.toolCalls).toEqual([]);
      expect(removed.messages[0].toolCallIds ?? []).toEqual([]);
    }
  });

  it('owns nested arguments and readonly message data without freezing or mutating the caller', () => {
    const args = { nested: { values: ['original'] } };
    const history = [checkpoint([ai('a', '', [call('c', 'work', args)])])];
    const before = structuredClone(history);
    const state = projectHistory(initial(), history);
    expect(state.messages).toHaveLength(1);
    expect(state.toolCalls).toHaveLength(1);
    expect(history).toEqual(before);
    expect(Object.isFrozen(args.nested.values)).toBe(false);
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.messages)).toBe(true);
    expect(Object.isFrozen(state.messages[0])).toBe(true);
    expect(Object.isFrozen(state.messages[0].toolCallIds)).toBe(true);
    expect(Object.isFrozen(state.toolCalls[0])).toBe(true);
    expect(
      Object.isFrozen((state.toolCalls[0].args as typeof args).nested.values)
    ).toBe(true);
    args.nested.values[0] = 'changed';
    expect(state.toolCalls[0].args).toEqual({
      nested: { values: ['original'] },
    });
  });

  it('does not expose chunk arguments as finalized historical calls', () => {
    const state = projectHistory(initial(), [
      checkpoint([
        {
          ...ai('a', 'Partial', [call('fragment', 'work', '{')]),
          type: 'AIMessageChunk',
        },
      ]),
    ]);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].content).toBe('Partial');
    expect(state.toolCalls).toEqual([]);
    expect(state.messages[0].toolCallIds).toBeUndefined();
  });

  it.each(['values', 'tasks'] as const)(
    'pauses only the last assistant in the latest turn from explicit %s evidence',
    (source) => {
      const messages = [
        human('old-u'),
        ai('old-a'),
        human('new-u'),
        ai('step'),
        ai('latest'),
      ];
      const task = {
        id: 't',
        name: 'ask',
        error: null,
        interrupts: [{ value: 'Continue?' }],
        checkpoint: null,
        state: null,
        result: null,
      };
      const history = [
        checkpoint(
          messages,
          source === 'values'
            ? { values: { messages, __interrupt__: ['Continue?'] } }
            : { tasks: [task] }
        ),
      ];
      const state = projectHistory(initial(), history);
      expect(state.messages.map((message) => message.delivery)).toEqual(
        messages.map((message) =>
          message.id === 'latest'
            ? completeDelivery('latest', 'paused')
            : staticDelivery(message.id)
        )
      );
      expect(projectHistory(state, structuredClone(history))).toBe(state);
    }
  );

  it('never marks an older assistant paused when the latest user has no assistant response', () => {
    const messages = [human('old-u'), ai('old-a'), human('new-u')];
    const state = projectHistory(initial(), [
      checkpoint(messages, {
        values: { messages, __interrupt__: ['Waiting'] },
      }),
    ]);
    expect(state.messages.map((message) => message.delivery)).toEqual(
      messages.map((message) => staticDelivery(message.id))
    );
  });

  it('treats next-node work without explicit interrupts as static history, not interruption', () => {
    const state = projectHistory(initial(), [
      checkpoint([human('u'), ai('a')], { next: ['tools'] }),
    ]);
    expect(state.messages).toHaveLength(2);
    expect(state.messages[1].delivery).toEqual(staticDelivery('a'));
  });

  it('loads an ordinary wire task that omits interrupt evidence', () => {
    const history = [
      checkpoint([human('u'), ai('a')], {
        next: ['tools'],
        tasks: [
          { id: 'task', name: 'tools' },
        ] as unknown as ThreadState['tasks'],
      }),
    ];
    expect(() => projectHistory(initial(), history)).not.toThrow();
    expect(projectHistory(initial(), history).messages[1].delivery).toEqual(
      staticDelivery('a')
    );
  });

  it('exposes only registered pending calls to typed catalogs and retains all ToolMessages', () => {
    const history = [
      checkpoint([
        ai('a', '', [
          call('pending'),
          call('settled'),
          call('remote', 'server'),
        ]),
        result('wire', 'settled', '{"value":42}'),
      ]),
    ];
    const broad = projectHistory(initial(), history);
    expect(broad.toolCalls.map((entry) => entry.id)).toEqual([
      'pending',
      'settled',
      'remote',
    ]);
    const typed = projectHistory(broad, history, {
      registeredTools: new Set(['work']),
    });
    expect(typed.toolCalls).toMatchObject([
      { id: 'pending', status: 'pending' },
    ]);
    expect(typed.messages).toBe(broad.messages);
    expect(typed.messages[1].content).toBe('{"value":42}');
    expect(
      projectHistory(typed, history, { registeredTools: new Set() }).toolCalls
    ).toEqual([]);
  });

  it('does not revive a locally resolved typed result from an authoritative remote wire string', () => {
    const first = projectHistory(initial(), [
      checkpoint([ai('a', '', [call('c')])]),
    ]);
    const local = reduceMessages(first, {
      type: 'tool',
      toolCall: {
        id: 'c',
        name: 'work',
        args: { id: 'c' },
        status: 'complete',
        result: { authored: true },
      },
    });
    const history = [
      checkpoint([
        ai('a', '', [call('c')]),
        result('wire', 'c', 'Server authored text'),
      ]),
    ];
    const typed = projectHistory(local, history, {
      registeredTools: new Set(['work']),
    });
    expect(typed.toolCalls).toEqual([]);
    expect(typed.messages[1].content).toBe('Server authored text');
    expect(projectHistory(local, history).toolCalls).toMatchObject([
      { id: 'c', status: 'complete', result: 'Server authored text' },
    ]);
  });
});
