import type { ThreadState } from '@langchain/langgraph-sdk';
import { onAgentStateUpdate, type AgentSession } from '@threadplane/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSession } from './create-session';
import { parsePartialJson } from './streaming-tool-calls';
import type {
  AgentTransport,
  LangGraphSubmitOptions,
  StreamEvent,
} from './transport.types';
import { controlledSession } from './testing/controlled-session';
import { LOAD_ERROR } from './testing/failed-load';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const values = (messages: unknown[], state: object = {}): StreamEvent => ({
  type: 'values',
  data: { ...state, messages },
});
const ai = (id: string, content: unknown, more: object = {}) => ({
  type: 'ai',
  id,
  content,
  ...more,
});
function saved(messages: unknown[], more: object = {}): ThreadState {
  return {
    values: { messages },
    next: [],
    tasks: [],
    checkpoint: {
      thread_id: 'thread',
      checkpoint_id: 'c',
      checkpoint_ns: '',
      checkpoint_map: {},
    },
    metadata: null,
    created_at: null,
    parent_checkpoint: null,
    ...more,
  } as unknown as ThreadState;
}

/** A session whose runs replay the given event lists, one list for each run. */
function scripted(
  runs: readonly (readonly StreamEvent[])[],
  more: Partial<AgentTransport> = {},
  options: Partial<Parameters<typeof createSession>[0]> = {}
) {
  const requests: {
    payload: unknown;
    options?: LangGraphSubmitOptions;
  }[] = [];
  const stream = vi.fn<AgentTransport['stream']>(async function* (
    _assistant,
    _thread,
    payload,
    _signal,
    sent
  ) {
    const events = runs[requests.length] ?? [];
    requests.push({ payload, options: sent });
    yield* events;
  });
  const session = createSession({
    assistantId: 'agent',
    threadId: 'thread',
    transport: { stream, ...more },
    ...options,
  });
  cleanups.push(() => session.dispose());
  return { session, stream, requests };
}

describe('structured content', () => {
  const image = {
    type: 'image_url',
    image_url: { url: 'https://x.test/a.png' },
  };

  it('publishes blocks beside the text when a message holds more than text', async () => {
    const { session } = scripted([], {
      getHistory: async () => [
        saved([
          {
            type: 'human',
            id: 'u',
            content: [{ type: 'text', text: 'Look at ' }, image, 'this'],
          },
          ai('a', [{ type: 'text', text: 'A ' }, { text: 'cat' }]),
          ai('b', 'Plain'),
        ]),
      ],
    });
    await session.load?.();
    const [user, textOnly, plain] = session.getSnapshot().messages;
    expect(user.content).toBe('Look at this');
    expect(user.blocks).toEqual([
      { type: 'text', text: 'Look at ' },
      { type: 'image', url: 'https://x.test/a.png' },
      { type: 'text', text: 'this' },
    ]);
    expect(Object.isFrozen(user.blocks)).toBe(true);
    // Text keeps its shape, however the backend split it.
    expect(textOnly.content).toBe('A cat');
    expect('blocks' in textOnly).toBe(false);
    expect('blocks' in plain).toBe(false);
    expect('extra' in plain).toBe(false);
  });

  it('reads inline tool blocks, base64 images and tool results', async () => {
    const { session } = scripted([
      [
        values([
          ai('a', [
            { type: 'text', text: 'Calling' },
            { type: 'tool_use', id: 't1', name: 'search', input: { q: 'x' } },
            {
              type: 'tool_result',
              tool_use_id: 't1',
              content: 'found',
              is_error: true,
            },
            {
              type: 'image',
              source_type: 'base64',
              mime_type: 'image/gif',
              data: 'AAAA',
            },
            { type: 'reasoning', text: 'hidden' },
          ]),
        ]),
      ],
    ]);
    expect(await session.submit('Go')).toBe('success');
    const message = session.getSnapshot().messages.at(-1);
    expect(message?.content).toBe('Calling');
    expect(message?.blocks).toEqual([
      { type: 'text', text: 'Calling' },
      { type: 'tool_use', id: 't1', name: 'search', args: { q: 'x' } },
      { type: 'tool_result', toolCallId: 't1', result: 'found', isError: true },
      { type: 'image', url: 'data:image/gif;base64,AAAA' },
    ]);
  });

  it('keeps streamed text and adopts the blocks of the full message', async () => {
    const f = controlledSession();
    cleanups.push(() => f.session.dispose());
    const run = f.session.submit('Go');
    await f.started();
    await f.emit({
      type: 'messages',
      messageMetadata: { langgraph_node: 'agent' },
      messages: [
        {
          type: 'AIMessageChunk',
          id: 'a',
          content: [{ type: 'text', text: 'Hel' }],
        },
      ],
    });
    expect(f.session.getSnapshot().messages.at(-1)?.blocks).toBeUndefined();
    await f.emit(values([ai('a', [{ type: 'text', text: 'Hello' }, image])]));
    f.streams[0].finish();
    expect(await run).toBe('success');
    expect(f.session.getSnapshot().messages.at(-1)).toMatchObject({
      content: 'Hello',
      blocks: [
        { type: 'text', text: 'Hello' },
        { type: 'image', url: 'https://x.test/a.png' },
      ],
    });
  });

  it('sends submitted blocks as wire content and shows them on the user message', async () => {
    const { session, requests } = scripted([[values([ai('a', 'Seen')])]]);
    const blocks = [
      { type: 'text', text: 'What is this?' },
      { type: 'image', url: 'https://x.test/a.png', alt: 'A cat' },
    ] as const;
    expect(await session.submit({ message: 'What is this?', blocks })).toBe(
      'success'
    );
    const sent = (requests[0].payload as { messages: { content: unknown }[] })
      .messages[0];
    expect(sent.content).toEqual([
      { type: 'text', text: 'What is this?' },
      { type: 'image_url', image_url: { url: 'https://x.test/a.png' } },
    ]);
    const user = session.getSnapshot().messages[0];
    expect(user).toMatchObject({ role: 'user', content: 'What is this?' });
    expect(user.blocks).toEqual(blocks);
    expect(user.blocks).not.toBe(blocks);
  });

  it('rejects blocks a user message cannot carry without sending', async () => {
    const { session, stream } = scripted([]);
    await expect(
      session.submit({
        message: 'x',
        blocks: [{ type: 'tool_use', id: 't', name: 'n', args: {} }],
      })
    ).rejects.toThrow(/text and image blocks/);
    await expect(
      session.submit({ message: 'x', blocks: [] })
    ).rejects.toThrow();
    expect(stream).not.toHaveBeenCalled();
    expect(session.getSnapshot().messages).toEqual([]);
  });

  it('publishes wire extras only on a session that keeps raw messages', async () => {
    const full = ai('a', 'Done', {
      additional_kwargs: { refusal: null, model: 'm' },
      response_metadata: { finish_reason: 'stop' },
      tool_calls: [],
      example: false,
      name: null,
    });
    const lean = scripted([[values([full])]]);
    await lean.session.submit('Go');
    expect('extra' in (lean.session.getSnapshot().messages.at(-1) ?? {})).toBe(
      false
    );
    const raw = scripted([[values([full])]], {}, { rawMessages: true });
    await raw.session.submit('Go');
    const message = raw.session.getSnapshot().messages.at(-1);
    expect(message?.extra).toEqual({
      additional_kwargs: { refusal: null, model: 'm' },
      response_metadata: { finish_reason: 'stop' },
    });
    expect(Object.isFrozen(message?.extra)).toBe(true);
  });
});

describe('tool calls', () => {
  const chunk = (args: string, first = false): StreamEvent => ({
    type: 'messages',
    messageMetadata: { langgraph_node: 'agent' },
    messages: [
      {
        type: 'AIMessageChunk',
        id: 'a',
        content: '',
        tool_call_chunks: [
          first
            ? { index: 0, id: 'call-1', name: 'get_weather', args }
            : { index: 0, id: null, name: null, args },
        ],
      },
    ],
  });

  it('lists a call apart while its arguments stream, then finalizes it under the same id', async () => {
    const f = controlledSession();
    cleanups.push(() => f.session.dispose());
    const run = f.session.submit('Weather?');
    await f.started();
    expect(f.session.getSnapshot().streamingToolCalls).toBeUndefined();
    await f.emit(chunk('{"ci', true));
    expect(f.session.getSnapshot().streamingToolCalls).toEqual([
      { id: 'call-1', name: 'get_weather', argsText: '{"ci', args: {} },
    ]);
    expect(f.session.getSnapshot().toolCalls).toEqual([]);
    await f.emit(chunk('ty":"Par'));
    const streaming = f.session.getSnapshot().streamingToolCalls;
    expect(streaming).toEqual([
      {
        id: 'call-1',
        name: 'get_weather',
        argsText: '{"city":"Par',
        args: { city: 'Par' },
      },
    ]);
    expect(Object.isFrozen(streaming)).toBe(true);
    await f.emit(
      values([
        ai('a', '', {
          tool_calls: [
            { id: 'call-1', name: 'get_weather', args: { city: 'Paris' } },
          ],
        }),
      ])
    );
    expect(f.session.getSnapshot().streamingToolCalls).toBeUndefined();
    expect(f.session.getSnapshot().toolCalls).toEqual([
      {
        id: 'call-1',
        name: 'get_weather',
        args: { city: 'Paris' },
        status: 'pending',
      },
    ]);
    f.streams[0].finish();
    await run;
  });

  it('drops argument fragments when the run ends before they are finalized', async () => {
    const f = controlledSession();
    cleanups.push(() => f.session.dispose());
    const run = f.session.submit('Weather?');
    await f.started();
    await f.emit(chunk('{"city":', true));
    expect(f.session.getSnapshot().streamingToolCalls).toHaveLength(1);
    await f.session.stop();
    expect(await run).toBe('aborted');
    expect(f.session.getSnapshot().streamingToolCalls).toBeUndefined();
  });

  it('reads partial JSON as far as it goes', () => {
    expect(parsePartialJson('')).toBeUndefined();
    expect(parsePartialJson('{')).toEqual({});
    expect(parsePartialJson('{"a":1,"b":[1,2')).toEqual({ a: 1, b: [1, 2] });
    expect(parsePartialJson('{"a":"x\\')).toEqual({ a: 'x' });
    expect(parsePartialJson('{"a":tru')).toEqual({});
    expect(parsePartialJson('{"a":true,"b":nul')).toEqual({ a: true });
    expect(parsePartialJson('{"a":-1.')).toEqual({ a: -1 });
    expect(parsePartialJson('{"a":{"b":"c"},"d')).toEqual({ a: { b: 'c' } });
    expect(parsePartialJson('[{"a":1},{"b"')).toEqual([{ a: 1 }, {}]);
    expect(parsePartialJson('{"a":1}')).toEqual({ a: 1 });
    expect(parsePartialJson('not json')).toBeUndefined();
  });

  const delegation = ai('a', '', {
    tool_calls: [
      {
        id: 'call-1',
        name: 'task',
        args: { subagent_type: 'researcher', description: 'Find it' },
      },
    ],
  });

  it('makes a call an error when its tool message says the tool failed', async () => {
    const failed = {
      type: 'tool',
      id: 't',
      tool_call_id: 'call-1',
      status: 'error',
      content: 'Error: the child crashed',
    };
    const { session } = scripted([
      [
        values([delegation]),
        {
          type: 'values|tools:child',
          data: { messages: [{ type: 'human', id: 'h', content: 'Find it' }] },
        },
        values([delegation, failed, ai('b', 'It failed')]),
      ],
    ]);
    expect(await session.submit('Delegate')).toBe('success');
    const snapshot = session.getSnapshot();
    expect(snapshot.toolCalls).toEqual([
      {
        id: 'call-1',
        name: 'task',
        args: { subagent_type: 'researcher', description: 'Find it' },
        status: 'error',
        error: 'Error: the child crashed',
      },
    ]);
    // A failed delegation is a failed child, not a completed one.
    expect(snapshot.subagents[0]).toMatchObject({
      toolCallId: 'call-1',
      status: 'error',
    });
  });

  it('settles an error when the failed result arrives before its call', async () => {
    const f = controlledSession();
    cleanups.push(() => f.session.dispose());
    const run = f.session.submit('Go');
    await f.started();
    await f.emit({
      type: 'messages',
      messageMetadata: { langgraph_node: 'tools' },
      messages: [
        {
          type: 'tool',
          id: 't',
          tool_call_id: 'call-1',
          status: 'error',
          content: 'Nope',
        },
      ],
    });
    await f.emit({ type: 'messages/complete', messages: [delegation] });
    expect(f.session.getSnapshot().toolCalls[0]).toMatchObject({
      status: 'error',
      error: 'Nope',
    });
    f.streams[0].finish();
    await run;
  });

  it('keeps the structured parts of a tool result, live and from history', async () => {
    const parts = [
      { type: 'text', text: 'Chart ' },
      { type: 'image_url', image_url: { url: 'https://x.test/c.png' } },
      { type: 'text', text: 'attached' },
    ];
    const result = {
      type: 'tool',
      id: 't',
      tool_call_id: 'call-1',
      content: parts,
    };
    const transcript = [delegation, result, ai('b', 'Here')];
    const { session } = scripted([[values(transcript)]], {
      getHistory: async () => [saved(transcript)],
    });
    expect(await session.submit('Go')).toBe('success');
    const live = session.getSnapshot().toolCalls[0];
    expect(live).toMatchObject({
      status: 'complete',
      result: 'Chart attached',
      parts,
    });
    expect(Object.isFrozen((live as { parts?: unknown }).parts)).toBe(true);
    await session.load?.();
    expect(session.getSnapshot().toolCalls[0]).toMatchObject({
      status: 'complete',
      result: 'Chart attached',
      parts,
    });
    // The tool message itself reads as text with its blocks.
    expect(
      session.getSnapshot().messages.find((message) => message.role === 'tool')
    ).toMatchObject({
      content: 'Chart attached',
      blocks: [
        { type: 'text', text: 'Chart ' },
        { type: 'image', url: 'https://x.test/c.png' },
        { type: 'text', text: 'attached' },
      ],
    });
  });

  it('restores a failed tool call from history as an error', async () => {
    const { session } = scripted([], {
      getHistory: async () => [
        saved([
          delegation,
          {
            type: 'tool',
            id: 't',
            tool_call_id: 'call-1',
            status: 'error',
            content: 'Failed',
          },
        ]),
      ],
    });
    await session.load?.();
    expect(session.getSnapshot().toolCalls[0]).toMatchObject({
      status: 'error',
      error: 'Failed',
    });
  });
});

describe('error diagnostics', () => {
  it('describes a failure the backend sent, beside the error, until it clears', async () => {
    const { session } = scripted([
      [
        {
          type: 'error',
          data: { error: 'ValueError', message: 'Bad input', status: 500 },
        },
      ],
      [values([ai('a', 'Fine')])],
    ]);
    expect(await session.submit('Go')).toBe('error');
    const failed = session.getSnapshot();
    expect(failed.error).toMatchObject({
      kind: 'server',
      message: 'Bad input',
    });
    expect(failed.errorDiagnostic).toEqual({
      message: 'Bad input',
      status: 500,
      data: { error: 'ValueError' },
    });
    expect(Object.isFrozen(failed.errorDiagnostic)).toBe(true);
    // The diagnostic stays with its error across unrelated publications.
    await session.setBranch('other');
    expect(session.getSnapshot().errorDiagnostic).toBe(failed.errorDiagnostic);
    expect(await session.submit('Again')).toBe('success');
    expect(session.getSnapshot().error).toBeUndefined();
    expect('errorDiagnostic' in session.getSnapshot()).toBe(false);
  });

  it('describes nothing for a failure the session could not read', async () => {
    const stream = vi.fn<AgentTransport['stream']>(async function* () {
      yield values([ai('a', 'Partial')]);
      throw new Error('PRIVATE socket detail');
    });
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport: { stream },
    });
    cleanups.push(() => session.dispose());
    expect(await session.submit('Go')).toBe('interrupted');
    const snapshot = session.getSnapshot();
    expect(snapshot.error?.kind).toBe('interrupted');
    expect(snapshot.errorDiagnostic).toBeUndefined();
    expect(JSON.stringify(snapshot)).not.toContain('PRIVATE');
  });

  it('publishes an error when an explicit history load fails, and still rejects', async () => {
    const getHistory = vi
      .fn<NonNullable<AgentTransport['getHistory']>>()
      .mockRejectedValueOnce(new Error('PRIVATE'))
      .mockResolvedValueOnce([saved([ai('a', 'Loaded')])]);
    const { session } = scripted([], { getHistory });
    const notify = vi.fn();
    session.subscribe(notify);
    await expect(session.load?.()).rejects.toMatchObject({
      name: 'LangGraphRequestError',
    });
    expect(session.getSnapshot()).toMatchObject({
      status: 'error',
      error: LOAD_ERROR,
      messages: [],
    });
    expect(session.getSnapshot().errorDiagnostic).toBeUndefined();
    expect(JSON.stringify(session.getSnapshot())).not.toContain('PRIVATE');
    expect(notify).toHaveBeenCalledTimes(1);
    await session.load?.();
    expect(session.getSnapshot()).toMatchObject({ status: 'idle' });
    expect(session.getSnapshot().error).toBeUndefined();
    expect(session.getSnapshot().messages[0].content).toBe('Loaded');
  });
});

describe('child agents', () => {
  it('publishes a child state and the calls its model is still writing', async () => {
    const f = controlledSession();
    cleanups.push(() => f.session.dispose());
    const run = f.session.submit('Go');
    await f.started();
    await f.emit({
      type: 'values|tools:child',
      data: {
        topic: 'cats',
        messages: [{ type: 'human', id: 'h', content: 'Research cats' }],
      },
    });
    const child = () => f.session.getSnapshot().subagents[0];
    expect(child().state).toEqual({ topic: 'cats' });
    expect(Object.isFrozen(child().state)).toBe(true);
    expect('streamingToolCalls' in child()).toBe(false);
    await f.emit({
      type: 'messages|tools:child',
      messageMetadata: { langgraph_node: 'model' },
      messages: [
        {
          type: 'AIMessageChunk',
          id: 'c',
          content: '',
          tool_call_chunks: [
            { index: 0, id: 'child-call', name: 'lookup', args: '{"q":"ca' },
          ],
        },
      ],
    });
    expect(child().streamingToolCalls).toEqual([
      {
        id: 'child-call',
        name: 'lookup',
        argsText: '{"q":"ca',
        args: { q: 'ca' },
      },
    ]);
    // The root graph is writing none.
    expect(f.session.getSnapshot().streamingToolCalls).toBeUndefined();
    await f.emit({
      type: 'values|tools:child',
      data: {
        topic: 'cats',
        messages: [
          { type: 'human', id: 'h', content: 'Research cats' },
          ai('c', '', {
            tool_calls: [
              { id: 'child-call', name: 'lookup', args: { q: 'cats' } },
            ],
          }),
        ],
      },
    });
    expect('streamingToolCalls' in child()).toBe(false);
    expect(child().toolCalls).toHaveLength(1);
    f.streams[0].finish();
    await run;
  });
});

describe('refused input', () => {
  it('says why submit is refused while a tool result is unresolved', async () => {
    const call = ai('a', '', {
      tool_calls: [{ id: 'call', name: 'work', args: {} }],
    });
    const stream = vi.fn<AgentTransport['stream']>(async function* () {
      yield values([call]);
    });
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport: { stream },
      executionStore: {
        acquire: async () => {
          throw new Error('Store is down');
        },
        settle: async () => {
          throw new Error('Store is down');
        },
      },
      tools: { work: { description: 'Work', handler: () => 'done' } },
    });
    cleanups.push(() => session.dispose());
    expect(session.getSnapshot().inputBlocked).toBeUndefined();
    expect(await session.submit('Go')).toBe('interrupted');
    const blocked = session.getSnapshot().inputBlocked;
    expect(blocked?.reason).toBe('unsettled-tools');
    expect(typeof blocked?.message).toBe('string');
    expect(Object.isFrozen(blocked)).toBe(true);
    // The block states exactly what submit does.
    await expect(session.submit('Again')).rejects.toThrow(
      /unsettled tool execution/
    );
    expect(stream).toHaveBeenCalledOnce();
  });

  it('is absent whenever a submission is accepted', async () => {
    const { session } = scripted([
      [values([ai('a', 'One')])],
      [values([ai('b', 'Two')])],
    ]);
    const seen: unknown[] = [];
    session.subscribe(() => seen.push(session.getSnapshot().inputBlocked));
    await session.submit('One');
    await session.submit('Two');
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((block) => block === undefined)).toBe(true);
    expect('inputBlocked' in session.getSnapshot()).toBe(false);
  });
});

describe('running without a message', () => {
  it('continues the thread with no input and adds no user message', async () => {
    const { session, requests } = scripted([[values([ai('a', 'Continued')])]]);
    expect(await session.runWithoutMessage()).toBe('success');
    expect(requests[0].payload).toBeNull();
    expect(session.getSnapshot().messages.map((m) => m.role)).toEqual([
      'assistant',
    ]);
  });

  it('merges a state as the input of the run', async () => {
    const { session, requests } = scripted([[values([ai('a', 'Updated')])]]);
    const state = { draft: 'Notes', nested: { count: 1 } };
    expect(await session.runWithoutMessage({ state })).toBe('success');
    expect(requests[0].payload).toEqual(state);
    expect(requests[0].payload).not.toBe(state);
    expect(session.getSnapshot().messages.map((m) => m.role)).toEqual([
      'assistant',
    ]);
  });

  it('rejects a state that is not plain data without sending', async () => {
    const { session, stream } = scripted([]);
    await expect(
      session.runWithoutMessage({ state: { when: new Date() } as never })
    ).rejects.toThrow();
    expect(stream).not.toHaveBeenCalled();
  });

  it('is the core command on a borrowed session', async () => {
    const { session, requests } = scripted([[values([ai('a', 'Ok')])]]);
    const borrowed: AgentSession = session;
    expect(await borrowed.runWithoutMessage?.({ state: { step: 2 } })).toBe(
      'success'
    );
    expect(requests[0].payload).toEqual({ step: 2 });
  });
});

describe('resume options', () => {
  const pause: StreamEvent = {
    type: 'updates',
    data: { __interrupt__: [{ id: 'approve', value: 'Proceed?' }] },
  };
  const question = ai('q', 'May I?');

  it('sends a message and a state in the command that answers the pause', async () => {
    const { session, requests } = scripted([
      [values([question]), pause],
      [values([question, ai('a', 'Thanks')])],
    ]);
    expect(await session.submit('Start')).toBe('paused');
    expect(
      await session.resume(
        [{ interruptId: 'approve', status: 'resolved', value: true }],
        {
          message: 'Go ahead',
          state: { reviewer: 'Ada' },
          run: { command: { update: { priority: 'high' }, goto: 'next' } },
        }
      )
    ).toBe('success');
    expect(requests[1].payload).toBeNull();
    const command = requests[1].options?.command as {
      resume: unknown;
      goto: unknown;
      update: { messages: { id: string; type: string; content: unknown }[] };
    };
    expect(command).toMatchObject({
      resume: true,
      goto: 'next',
      update: { priority: 'high', reviewer: 'Ada' },
    });
    expect(command.update.messages).toEqual([
      { type: 'human', id: expect.any(String), content: 'Go ahead' },
    ]);
    // The sent message is in the transcript under the id that was sent.
    const user = session
      .getSnapshot()
      .messages.filter((m) => m.role === 'user');
    expect(user.map((m) => m.content)).toEqual(['Start', 'Go ahead']);
    expect(user[1].id).toBe(command.update.messages[0].id);
  });

  it('sends blocks as the message content', async () => {
    const { session, requests } = scripted([
      [values([question]), pause],
      [values([question, ai('a', 'Seen')])],
    ]);
    await session.submit('Start');
    await session.resume(
      [{ interruptId: 'approve', status: 'resolved', value: true }],
      {
        blocks: [
          { type: 'text', text: 'See ' },
          { type: 'image', url: 'https://x.test/a.png' },
        ],
      }
    );
    const command = requests[1].options?.command as {
      update: { messages: { content: unknown }[] };
    };
    expect(command.update.messages[0].content).toEqual([
      { type: 'text', text: 'See ' },
      { type: 'image_url', image_url: { url: 'https://x.test/a.png' } },
    ]);
    expect(
      session
        .getSnapshot()
        .messages.filter((message) => message.role === 'user')
        .at(-1)
    ).toMatchObject({
      role: 'user',
      content: 'See ',
      blocks: [
        { type: 'text', text: 'See ' },
        { type: 'image', url: 'https://x.test/a.png' },
      ],
    });
  });

  it('sends no update for a plain resume', async () => {
    const { session, requests } = scripted([
      [values([question]), pause],
      [values([question, ai('a', 'Thanks')])],
    ]);
    await session.submit('Start');
    await session.resume([
      { interruptId: 'approve', status: 'resolved', value: 'yes' },
    ]);
    expect(requests[1].options?.command).toEqual({ resume: 'yes' });
  });

  it('rejects without sending when the command update cannot merge', async () => {
    const { session, stream } = scripted([[values([question]), pause]]);
    await session.submit('Start');
    await expect(
      session.resume(
        [{ interruptId: 'approve', status: 'resolved', value: true }],
        {
          state: { reviewer: 'Ada' },
          run: { command: { update: [['reviewer', 'Bob']] } },
        }
      )
    ).rejects.toThrow(/needs run.command.update to be a record/);
    await expect(
      session.resume(
        [{ interruptId: 'approve', status: 'resolved', value: true }],
        { message: 1 as never }
      )
    ).rejects.toThrow(/must be text/);
    expect(stream).toHaveBeenCalledOnce();
    expect(session.getSnapshot().interrupts).toHaveLength(1);
  });
});

describe('client tools', () => {
  const catalog = [
    {
      name: 'get_weather',
      description: 'Look up the weather',
      parameters: {
        type: 'object',
        properties: { location: { type: 'string' } },
      },
    },
    { name: 'confirm', description: 'Ask the person', parameters: {} },
  ];
  const asks = (...calls: { id: string; name: string; args: object }[]) =>
    ai('a', '', { tool_calls: calls });
  const weather = { id: 'w1', name: 'get_weather', args: { location: 'Oslo' } };
  const confirm = { id: 'c1', name: 'confirm', args: {} };

  it('has no capability on a session with a fixed handler map', () => {
    const session = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport: { stream: vi.fn() },
      tools: { work: { description: 'Work', handler: () => 'done' } },
    });
    cleanups.push(() => session.dispose());
    expect(session.clientTools).toBeUndefined();
    expect('pendingClientTools' in session.getSnapshot()).toBe(false);
  });

  it('sends the declared catalog with later runs and replaces it on request', async () => {
    const { session, requests } = scripted([
      [values([ai('a', 'One')])],
      [values([ai('b', 'Two')])],
      [values([ai('c', 'Three')])],
    ]);
    await session.submit('Before');
    expect(requests[0].payload).not.toHaveProperty('client_tools');
    expect('pendingClientTools' in session.getSnapshot()).toBe(false);
    session.clientTools?.setCatalog(catalog);
    expect(session.getSnapshot().pendingClientTools).toEqual([]);
    await session.submit('With');
    expect(
      (requests[1].payload as { client_tools: unknown }).client_tools
    ).toEqual(catalog);
    session.clientTools?.setCatalog([]);
    await session.submit('Without');
    expect(requests[2].payload).not.toHaveProperty('client_tools');
    expect(() =>
      session.clientTools?.setCatalog([{ name: '' } as never])
    ).toThrow(/needs a name/);
  });

  it('lists a declared tool call once the run ends without a result for it', async () => {
    const f = controlledSession();
    cleanups.push(() => f.session.dispose());
    f.session.clientTools?.setCatalog(catalog);
    const run = f.session.submit('Weather in Oslo?');
    await f.started();
    await f.emit(
      values([asks(weather, { id: 's1', name: 'server_tool', args: {} })])
    );
    // Not actionable while the run could still answer it.
    expect(f.session.getSnapshot().pendingClientTools).toEqual([]);
    f.streams[0].finish();
    expect(await run).toBe('success');
    const snapshot = f.session.getSnapshot();
    expect(snapshot.pendingClientTools).toEqual([
      { ...weather, status: 'pending' },
    ]);
    // Each pending call is the entry `toolCalls` lists.
    expect(snapshot.pendingClientTools?.[0]).toBe(snapshot.toolCalls[0]);
  });

  it('resolve records the result and continues with its tool message and the catalog', async () => {
    const { session, requests } = scripted([
      [values([asks(weather)])],
      [values([asks(weather), ai('b', 'Sunny in Oslo')])],
    ]);
    session.clientTools?.setCatalog(catalog);
    await session.submit('Weather in Oslo?');
    const settled = new Promise<void>((resolve) => {
      const release = session.subscribe(() => {
        const { status, messages } = session.getSnapshot();
        if (status === 'idle' && messages.at(-1)?.content === 'Sunny in Oslo') {
          release();
          resolve();
        }
      });
    });
    session.clientTools?.resolve('w1', {
      ok: true,
      value: { temperatureF: 68 },
    });
    // The call shows its result at once and no longer waits.
    expect(session.getSnapshot().toolCalls[0]).toMatchObject({
      status: 'complete',
      result: { temperatureF: 68 },
    });
    expect(session.getSnapshot().pendingClientTools).toEqual([]);
    await settled;
    expect(requests).toHaveLength(2);
    expect(requests[1].payload).toEqual({
      messages: [
        {
          id: 'client-tool-result-w1',
          role: 'tool',
          type: 'tool',
          tool_call_id: 'w1',
          content: '{"temperatureF":68}',
        },
      ],
      client_tools: catalog,
    });
    // No user message was added for the continuation.
    expect(
      session.getSnapshot().messages.filter((m) => m.role === 'user')
    ).toHaveLength(1);
    // The authored result survives the wire echo of its tool message.
    expect(session.getSnapshot().toolCalls[0]).toMatchObject({
      status: 'complete',
      result: { temperatureF: 68 },
    });
  });

  it('settle records without a run and flush writes the staged results once', async () => {
    const updateState = vi.fn<NonNullable<AgentTransport['updateState']>>(
      async () => undefined
    );
    const { session, stream } = scripted([[values([asks(weather, confirm)])]], {
      updateState,
    });
    session.clientTools?.setCatalog(catalog);
    await session.submit('Plan');
    expect(session.getSnapshot().pendingClientTools).toHaveLength(2);
    session.clientTools?.settle?.('w1', { ok: true, value: 'Sunny' });
    session.clientTools?.settle?.('c1', { ok: false, error: 'Declined' });
    expect(session.getSnapshot().pendingClientTools).toEqual([]);
    expect(session.getSnapshot().toolCalls).toMatchObject([
      { id: 'w1', status: 'complete', result: 'Sunny' },
      { id: 'c1', status: 'error', error: 'Declined' },
    ]);
    expect(stream).toHaveBeenCalledOnce();
    expect(updateState).not.toHaveBeenCalled();
    await session.clientTools?.flush?.();
    expect(stream).toHaveBeenCalledOnce();
    expect(updateState).toHaveBeenCalledOnce();
    expect(updateState.mock.calls[0][1]).toEqual({
      messages: [
        {
          id: 'client-tool-result-w1',
          role: 'tool',
          type: 'tool',
          tool_call_id: 'w1',
          content: 'Sunny',
        },
        {
          id: 'client-tool-result-c1',
          role: 'tool',
          type: 'tool',
          tool_call_id: 'c1',
          content: 'Error: Declined',
        },
      ],
    });
    // Nothing is left to write.
    await session.clientTools?.flush?.();
    expect(updateState).toHaveBeenCalledOnce();
  });

  it('keeps results staged when a flush fails and hands them to the next run', async () => {
    const updateState = vi
      .fn<NonNullable<AgentTransport['updateState']>>()
      .mockRejectedValue(new Error('offline'));
    const { session, requests } = scripted(
      [[values([asks(weather)])], [values([asks(weather), ai('b', 'Ok')])]],
      { updateState }
    );
    session.clientTools?.setCatalog(catalog);
    await session.submit('Weather?');
    session.clientTools?.settle?.('w1', { ok: true, value: 'Sunny' });
    await expect(session.clientTools?.flush?.()).rejects.toThrow();
    expect(await session.submit('And then?')).toBe('success');
    const sent = (requests[1].payload as { messages: { id: string }[] })
      .messages;
    expect(sent.map((message) => message.id)).toEqual([
      'client-tool-result-w1',
      expect.any(String),
    ]);
  });

  it('rejects a flush on a transport that cannot write state', async () => {
    const { session } = scripted([[values([asks(weather)])]]);
    session.clientTools?.setCatalog(catalog);
    await session.submit('Weather?');
    session.clientTools?.settle?.('w1', { ok: true, value: 'Sunny' });
    await expect(session.clientTools?.flush?.()).rejects.toThrow(
      /requires transport.updateState/
    );
  });

  it('throws for a call that is not pending', async () => {
    const { session } = scripted([[values([asks(weather)])]]);
    session.clientTools?.setCatalog(catalog);
    expect(() =>
      session.clientTools?.resolve('w1', { ok: true, value: 1 })
    ).toThrow(/No pending client tool call/);
    await session.submit('Weather?');
    expect(() =>
      session.clientTools?.settle?.('other', { ok: true, value: 1 })
    ).toThrow(/No pending client tool call/);
    session.clientTools?.settle?.('w1', { ok: true, value: 1 });
    expect(() =>
      session.clientTools?.settle?.('w1', { ok: true, value: 2 })
    ).toThrow(/No pending client tool call/);
  });

  it('restores a pending call from history and leaves a settled one alone', async () => {
    const { session } = scripted([], {
      getHistory: async () => [
        saved([
          asks(weather, confirm),
          { type: 'tool', id: 't', tool_call_id: 'c1', content: 'yes' },
        ]),
      ],
    });
    session.clientTools?.setCatalog(catalog);
    await session.load?.();
    expect(
      session.getSnapshot().pendingClientTools?.map((call) => call.id)
    ).toEqual(['w1']);
  });
});

describe('render-store updates', () => {
  it('delivers state_update custom events through the core helper', async () => {
    const f = controlledSession();
    cleanups.push(() => f.session.dispose());
    const updates: unknown[] = [];
    const release = onAgentStateUpdate(f.session, (update) =>
      updates.push(update)
    );
    const run = f.session.submit('Go');
    await f.started();
    await f.emit({
      type: 'custom',
      data: { name: 'state_update', data: { '/dashboard/title': 'Flights' } },
    });
    await f.emit({
      type: 'custom',
      data: { name: 'progress', data: { n: 1 } },
    });
    await f.emit({
      type: 'custom|tools:child',
      data: { name: 'state_update', data: { '/dashboard/rows': [1, 2] } },
    });
    // An update whose data is not a record is not a render-store update.
    await f.emit({ type: 'custom', data: { name: 'state_update', data: 'x' } });
    expect(updates).toEqual([
      { '/dashboard/title': 'Flights' },
      { '/dashboard/rows': [1, 2] },
    ]);
    expect(Object.isFrozen(updates[0])).toBe(true);
    release();
    await f.emit({
      type: 'custom',
      data: { name: 'state_update', data: { '/late': true } },
    });
    expect(updates).toHaveLength(2);
    f.streams[0].finish();
    await run;
  });
});
