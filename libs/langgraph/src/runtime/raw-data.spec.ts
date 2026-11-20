import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ThreadState } from '@langchain/langgraph-sdk';
import {
  createSession,
  getToolCalls,
  langGraphToolCalls,
  type SessionOptions,
} from './create-session';
import { observeToolProgress } from './raw-data';
import type { AgentTransport, StreamEvent } from './transport.types';
import { controlledTransport } from './testing/controlled-transport';

const sessions: { dispose(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.dispose()));
});

function fixture(
  events: readonly StreamEvent[],
  options: Partial<SessionOptions> = {},
  extra: Partial<AgentTransport> = {}
) {
  const session = createSession({
    assistantId: 'agent',
    threadId: 'thread',
    ...options,
    transport: {
      async *stream() {
        yield* events;
      },
      ...extra,
    },
  });
  sessions.push(session);
  return session;
}

const usage = (input: number, output: number) => ({
  input_tokens: input,
  output_tokens: output,
  total_tokens: input + output,
});

describe('raw LangGraph messages', () => {
  const final = {
    type: 'ai',
    id: 'a',
    content: [{ type: 'text', text: 'Hello' }],
    additional_kwargs: { vendor: { trace: 'x' } },
    tool_calls: [{ id: 'call-1', name: 'search', args: { q: 'x' } }],
  };
  const result = {
    type: 'tool',
    id: 't',
    tool_call_id: 'call-1',
    content: 'Found',
    status: 'error',
  };

  it('publishes each transcript message as it was sent, in order', async () => {
    const session = fixture(
      [{ type: 'values', data: { messages: [final, result] } }],
      { rawMessages: true }
    );
    await session.submit('Hi');
    const { langGraphMessages, messages } = session.getSnapshot();
    expect(langGraphMessages).toHaveLength(messages.length);
    // The session's own user message is given in wire shape.
    expect(langGraphMessages?.[0]).toEqual({
      type: 'human',
      id: messages[0].id,
      content: 'Hi',
    });
    expect(langGraphMessages?.[1]).toEqual(final);
    expect(langGraphMessages?.[2]).toEqual(result);
    expect(Object.isFrozen(langGraphMessages?.[1])).toBe(true);
  });

  it('gives a streaming message as its latest chunk with the text so far', async () => {
    const active = controlledTransport<StreamEvent>();
    const session = fixture(
      [],
      { rawMessages: true },
      {
        stream: () => active.stream,
      }
    );
    const run = session.submit('Hi');
    for (const content of ['Hel', 'lo']) {
      active.release({
        type: 'messages',
        messages: [
          { type: 'AIMessageChunk', id: 'a', content, response_metadata: {} },
        ],
        messageMetadata: { langgraph_node: 'agent', tags: ['x'] },
      });
    }
    await vi.waitFor(() =>
      expect(session.getSnapshot().langGraphMessages?.[1]).toMatchObject({
        type: 'AIMessageChunk',
        id: 'a',
        content: 'Hello',
      })
    );
    expect(session.getSnapshot().messageMetadata).toEqual({
      a: {
        messageId: 'a',
        streamMetadata: { langgraph_node: 'agent', tags: ['x'] },
      },
    });
    active.release({ type: 'values', data: { messages: [final] } });
    // A chunk that arrives after the full message does not replace it.
    active.release({
      type: 'messages',
      messages: [{ type: 'AIMessageChunk', id: 'a', content: '!' }],
      messageMetadata: {},
    });
    active.finish();
    await run;
    expect(session.getSnapshot().langGraphMessages?.[1]).toEqual(final);
  });

  it('follows a history load and is absent without the option', async () => {
    const history = [
      {
        values: {
          messages: [{ type: 'human', id: 'u', content: 'Hi' }, final],
        },
        next: [],
        tasks: [],
      } as unknown as ThreadState,
    ];
    const session = fixture(
      [],
      { rawMessages: true },
      {
        getHistory: async () => history,
      }
    );
    await session.load?.();
    expect(session.getSnapshot().langGraphMessages).toEqual([
      { type: 'human', id: 'u', content: 'Hi' },
      final,
    ]);
    const plain = fixture([{ type: 'values', data: { messages: [final] } }]);
    await plain.submit('Hi');
    expect('langGraphMessages' in plain.getSnapshot()).toBe(false);
    expect('messageMetadata' in plain.getSnapshot()).toBe(false);
  });

  it('pairs raw tool calls with their results', () => {
    const user = { type: 'human', id: 'u', content: 'Hi' };
    const pending = {
      type: 'ai',
      id: 'b',
      content: '',
      tool_calls: [{ id: 'call-2', name: 'search', args: {} }, { name: 'bad' }],
    };
    const calls = langGraphToolCalls([user, final, result, pending]);
    expect(calls.map((call) => [call.id, call.state, call.index])).toEqual([
      ['call-1', 'error', 0],
      ['call-2', 'pending', 0],
    ]);
    expect(calls[0]).toMatchObject({
      call: { id: 'call-1', name: 'search', args: { q: 'x' } },
      result,
      aiMessage: final,
    });
    expect(
      langGraphToolCalls([final, { ...result, status: 'success' }])[0].state
    ).toBe('completed');
    expect(getToolCalls(pending, [user, final, result, pending])).toHaveLength(
      1
    );
    expect(getToolCalls({ type: 'ai' }, [final])).toEqual([]);
  });
});

describe('tool progress', () => {
  const tool = (data: Record<string, unknown>): StreamEvent => ({
    type: 'tools',
    data,
  });

  it('follows each running tool and starts empty with every run', async () => {
    const active = controlledTransport<StreamEvent>();
    const session = fixture([], {}, { stream: () => active.stream });
    expect('toolProgress' in session.getSnapshot()).toBe(false);
    const run = session.submit('Hi');
    active.release(
      tool({
        event: 'on_tool_start',
        name: 'search',
        toolCallId: 'c1',
        input: { q: 'x' },
      })
    );
    active.release(
      tool({
        event: 'on_tool_event',
        name: 'search',
        toolCallId: 'c1',
        data: { step: 1 },
      })
    );
    active.release(tool({ event: 'on_tool_start', name: 'other' }));
    await vi.waitFor(() =>
      expect(session.getSnapshot().toolProgress).toEqual([
        {
          toolCallId: 'c1',
          name: 'search',
          state: 'running',
          input: { q: 'x' },
          data: { step: 1 },
        },
        { name: 'other', state: 'starting', input: undefined },
      ])
    );
    active.release(
      tool({
        event: 'on_tool_end',
        name: 'search',
        toolCallId: 'c1',
        output: 'ok',
      })
    );
    active.release(
      tool({ event: 'on_tool_error', name: 'other', error: 'boom' })
    );
    active.release({
      type: 'values',
      data: { messages: [{ type: 'ai', id: 'a', content: 'Done' }] },
    });
    active.finish();
    await run;
    expect(
      session
        .getSnapshot()
        .toolProgress?.map((entry) => [
          entry.name,
          entry.state,
          entry.result,
          entry.error,
        ])
    ).toEqual([
      ['search', 'completed', 'ok', undefined],
      ['other', 'error', undefined, 'boom'],
    ]);
  });

  it('ignores malformed events and hides error detail for a protected transport', () => {
    const none = new Map();
    expect(
      observeToolProgress(none, tool({ event: 'x', name: 'a' }), false)
    ).toBe(none);
    expect(observeToolProgress(none, tool({ name: 'a' }), false)).toBe(none);
    expect(observeToolProgress(none, { type: 'values', data: {} }, false)).toBe(
      none
    );
    expect(
      observeToolProgress(
        none,
        tool({ event: 'on_tool_error', name: 'a', error: 'secret' }),
        true
      ).get('a')?.error
    ).toBe('The tool call failed.');
  });
});

describe('usage', () => {
  const chunk = (id: string, metadata: object): StreamEvent => ({
    type: 'messages',
    messages: [
      { type: 'AIMessageChunk', id, content: 'x', usage_metadata: metadata },
    ],
    messageMetadata: { ls_provider: 'acme', ls_model_name: 'model-1' },
  });

  it('reports the tokens of the run that just settled, by provider and model', async () => {
    const active = controlledTransport<StreamEvent>();
    const session = fixture([], {}, { stream: () => active.stream });
    const run = session.submit('Hi');
    active.release(chunk('a', { input_tokens: 10 }));
    active.release(chunk('a', { output_tokens: 4, total_tokens: 14 }));
    await vi.waitFor(() =>
      expect(session.getSnapshot().messages).toHaveLength(2)
    );
    // Absent while the run is going.
    expect('usage' in session.getSnapshot()).toBe(false);
    active.release({
      type: 'values',
      data: {
        messages: [
          {
            type: 'ai',
            id: 'b',
            content: 'Second model',
            usage_metadata: {
              ...usage(100, 20),
              input_token_details: { cache_read: 60, cache_creation: 5 },
              output_token_details: { reasoning: 7 },
            },
            response_metadata: { model_provider: 'other', model_name: 'big' },
          },
        ],
      },
    });
    active.finish();
    await run;
    expect(session.getSnapshot().usage).toEqual({
      entries: [
        {
          provider: 'acme',
          model: 'model-1',
          inputTokens: 10,
          outputTokens: 4,
          totalTokens: 14,
        },
        {
          provider: 'other',
          model: 'big',
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120,
          reasoningTokens: 7,
          cachedInputTokens: 60,
          cacheWriteInputTokens: 5,
        },
      ],
    });
  });

  it('takes a full message as the total and never counts earlier turns', async () => {
    const first = {
      type: 'ai',
      id: 'a',
      content: 'One',
      usage_metadata: usage(10, 5),
    };
    let turn = 0;
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport: {
        async *stream() {
          turn += 1;
          if (turn === 1) {
            yield {
              type: 'messages',
              messages: [
                {
                  type: 'AIMessageChunk',
                  id: 'a',
                  usage_metadata: usage(9, 1),
                },
              ],
              messageMetadata: {},
            };
            yield { type: 'values', data: { messages: [first] } };
            return;
          }
          yield {
            type: 'values',
            data: {
              messages: [
                first,
                {
                  type: 'ai',
                  id: 'b',
                  content: 'Two',
                  usage_metadata: usage(3, 2),
                },
              ],
            },
          };
        },
      },
    });
    sessions.push(session);
    await session.submit('One');
    expect(session.getSnapshot().usage?.entries).toEqual([
      { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    ]);
    await session.submit('Two');
    expect(session.getSnapshot().usage?.entries).toEqual([
      { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
    ]);
  });

  it('is absent when nothing was reported or the run was stopped', async () => {
    const session = fixture([
      {
        type: 'values',
        data: { messages: [{ type: 'ai', id: 'a', content: 'x' }] },
      },
    ]);
    await session.submit('Hi');
    expect('usage' in session.getSnapshot()).toBe(false);
    const active = controlledTransport<StreamEvent>();
    const stopped = fixture([], {}, { stream: () => active.stream });
    const run = stopped.submit('Hi');
    active.release(chunk('a', usage(1, 1)));
    await vi.waitFor(() =>
      expect(stopped.getSnapshot().messages).toHaveLength(2)
    );
    await stopped.stop();
    await run;
    expect('usage' in stopped.getSnapshot()).toBe(false);
  });
});

describe('thread creation time', () => {
  it('is recorded when the session creates its thread, and never for a given one', async () => {
    const session = createSession({
      assistantId: 'agent',
      transport: {
        async *stream() {
          yield {
            type: 'values',
            data: { messages: [{ type: 'ai', id: 'a', content: 'x' }] },
          };
        },
        createThread: async () => 'created',
      },
    });
    sessions.push(session);
    const notify = vi.fn();
    session.lifecycle.subscribe(notify);
    expect(session.lifecycle.getSnapshot().threadCreatedAt).toBeNull();
    await session.submit('Hi');
    const created = session.lifecycle.getSnapshot().threadCreatedAt;
    expect(created).toEqual(expect.any(Number));
    expect(notify).toHaveBeenCalled();
    await session.submit('Again');
    expect(session.lifecycle.getSnapshot().threadCreatedAt).toBe(created);
    const given = fixture([
      {
        type: 'values',
        data: { messages: [{ type: 'ai', id: 'a', content: 'x' }] },
      },
    ]);
    await given.submit('Hi');
    expect(given.lifecycle.getSnapshot().threadCreatedAt).toBeNull();
  });
});
