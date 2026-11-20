import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createSession } from './create-session';
import { initialMessageState } from './message-reducer';
import {
  finalizeProjection,
  projectStream,
  type StreamProjection,
} from './stream-projection';
import type { AgentTransport, StreamEvent } from './transport.types';

// A recorded run of a real backend whose model answers through the OpenAI
// Responses API: one prompt, two model responses (each a reasoning item and a
// function call), one tool result, then a pause. Each response opens with a
// chunk under the provider's response id and continues under the model run's
// placeholder id. The recording is stored compactly: message metadata is
// shared, encrypted reasoning payloads are shortened, and each event's
// top-level copies of its `data` are rebuilt below as the transport delivers
// them.
const RECORDED_USER_ID = 'd19b3d08-b8e3-4db2-a378-84d48975b736';
const RESPONSES = [
  'resp_0d4d7ad9cefa9014006a9c42e02c5087d087abec0efa3ba877',
  'resp_0d4d7ad9cefa9014006a9c42e13f9887d0a2fc2f25f479a3dd',
] as const;

type Compact = {
  readonly metas: readonly Record<string, unknown>[];
  readonly events: readonly (
    | readonly ['messages', Record<string, unknown>, number]
    | readonly [string, Record<string, unknown>]
  )[];
};

function recording(userId = RECORDED_USER_ID): StreamEvent[] {
  const compact = JSON.parse(
    readFileSync(
      new URL('./testing/responses-replay.json', import.meta.url),
      'utf8'
    ).replaceAll(RECORDED_USER_ID, userId)
  ) as Compact;
  return compact.events.map((entry) => {
    if (entry[0] === 'messages') {
      const metadata = compact.metas[entry[2] as number];
      return {
        type: 'messages',
        messages: [entry[1]],
        messageMetadata: metadata,
        data: [entry[1], metadata],
      } as unknown as StreamEvent;
    }
    return { type: entry[0], ...entry[1], data: entry[1] } as StreamEvent;
  });
}

const wireMessages = (event: StreamEvent) =>
  (event.type === 'values'
    ? (event['data'] as { messages?: { id: string; type: string }[] }).messages
    : undefined) ?? [];

const streamed = (event: StreamEvent) =>
  (event.messages ?? []) as readonly Record<string, unknown>[];

/** How many responses the backend had opened once each event was delivered. */
function openedResponses(events: readonly StreamEvent[]): number[] {
  const opened = new Set<string>();
  return events.map((event) => {
    for (const message of streamed(event))
      if (RESPONSES.includes(message['id'] as (typeof RESPONSES)[number]))
        opened.add(message['id'] as string);
    return opened.size;
  });
}

const TASK = 'generate:de1ff271-bb08-d098-f921-18b98899424c';
const RUN = 'lc_run--01a07265-3a22-76b3-95d9-7313a72283a4';
const chunk = (
  id: string,
  content: unknown,
  options: { task?: string | null; opens?: boolean; provider?: string } = {}
): StreamEvent => ({
  type: 'messages',
  messageMetadata: {
    langgraph_node: 'generate',
    ...(options.task === null
      ? {}
      : { langgraph_checkpoint_ns: options.task ?? TASK }),
  },
  messages: [
    {
      type: 'AIMessageChunk',
      id,
      content,
      response_metadata: {
        model_provider: options.provider ?? 'openai',
        ...(options.opens ? { id } : {}),
      },
    },
  ],
});
const opening = (id: string, task?: string | null) =>
  chunk(id, [], { opens: true, task });
const saved = (...messages: unknown[]): StreamEvent => ({
  type: 'values',
  data: { messages },
});
const full = (id: string, content: unknown, provider = 'openai') => ({
  type: 'ai',
  id,
  content,
  response_metadata: { model_provider: provider, id },
});
function project(events: readonly StreamEvent[]) {
  let current = {
    state: initialMessageState(),
    projection: {
      generation: 'run',
      baselineIds: [],
      sawAssistant: false,
      terminal: false,
      paused: false,
      canonical: [],
    } as StreamProjection,
  };
  const steps: string[][] = [];
  for (const event of events) {
    current = projectStream(current.state, current.projection, event);
    steps.push(current.state.messages.map((message) => message.id));
  }
  const state = finalizeProjection(current.state, current.projection);
  return { steps, messages: state.messages };
}

describe('a model run continuing the response it opened', () => {
  it('routes string chunks under the run id into the opened response', () => {
    const { steps, messages } = project([
      opening('resp_a'),
      chunk(RUN, 'Hel'),
      chunk(RUN, 'lo'),
      chunk(RUN, ''),
      saved(full('resp_a', 'Hello')),
    ]);
    expect(steps.every((ids) => ids.join() === 'resp_a')).toBe(true);
    expect(messages.map((m) => [m.id, m.content])).toEqual([
      ['resp_a', 'Hello'],
    ]);
  });

  it('binds each run of a task to its own response when they open in turn', () => {
    const { steps } = project([
      opening('resp_a'),
      chunk(RUN, 'A'),
      opening('resp_b'),
      chunk('lc_run--second', 'B'),
      chunk(RUN, 'A'),
    ]);
    expect(steps.at(-1)).toEqual(['resp_a', 'resp_b']);
  });

  it.each([
    [
      'two responses are open at once in the task',
      [opening('resp_a'), opening('resp_b'), chunk(RUN, 'A')],
      ['resp_a', 'resp_b', RUN],
    ],
    [
      'a response opens after an unresolved pair in the same task',
      [
        opening('resp_a'),
        opening('resp_b'),
        opening('resp_c'),
        chunk(RUN, 'A'),
      ],
      ['resp_a', 'resp_b', 'resp_c', RUN],
    ],
    [
      'the run was streaming before the response opened',
      [chunk(RUN, 'A'), opening('resp_a'), chunk(RUN, 'B')],
      [RUN, 'resp_a'],
    ],
    [
      'the response opened in another task',
      [opening('resp_a', 'generate:other'), chunk(RUN, 'A')],
      ['resp_a', RUN],
    ],
    [
      'the events name no task',
      [opening('resp_a', null), chunk(RUN, 'A', { task: null })],
      ['resp_a', RUN],
    ],
    [
      'the first chunk does not declare a response id',
      [chunk('resp_a', []), chunk(RUN, 'A')],
      ['resp_a', RUN],
    ],
    [
      'the following chunks carry an id that is not a run placeholder',
      [opening('resp_a'), chunk('other', 'A')],
      ['resp_a', 'other'],
    ],
    [
      'the response comes from another provider',
      [
        chunk('resp_a', [], { opens: true, provider: 'other' }),
        chunk(RUN, 'A', { provider: 'other' }),
      ],
      ['resp_a', RUN],
    ],
    [
      'the run id is a message of the turn before',
      [opening('resp_a'), chunk('lc_run--earlier', 'A')],
      ['resp_a', 'lc_run--earlier'],
    ],
  ] as const)('keeps the wire ids when %s', (_name, events, expected) => {
    let current = {
      state: initialMessageState(),
      projection: {
        generation: 'run',
        baselineIds: ['lc_run--earlier'],
        sawAssistant: false,
        terminal: false,
        paused: false,
        canonical: [],
      } as StreamProjection,
    };
    for (const event of events)
      current = projectStream(current.state, current.projection, event);
    expect(current.state.messages.map((message) => message.id)).toEqual(
      expected
    );
  });

  it('stops routing a run id that final state names as a message of its own', () => {
    const { steps } = project([
      opening('resp_a'),
      chunk(RUN, 'A'),
      saved(full(RUN, 'A', 'other')),
      chunk(RUN, 'B'),
    ]);
    expect(steps[1]).toEqual(['resp_a']);
    expect(steps.at(-1)).toEqual(['resp_a', RUN]);
  });

  it('reconciles reasoning and function items from final state when no task is named', () => {
    const reasoning = { type: 'reasoning', id: 'rs_1', summary: [], index: 0 };
    const call = {
      type: 'function_call',
      name: 'list_backups',
      call_id: 'call_1',
      id: 'fc_1',
      index: 1,
    };
    const { steps, messages } = project([
      opening('resp_a', null),
      chunk(RUN, [reasoning], { task: null }),
      chunk(RUN, [{ ...call, arguments: '' }], { task: null }),
      chunk(RUN, [{ type: 'function_call', arguments: '{}', index: 1 }], {
        task: null,
      }),
      chunk(RUN, '', { task: null }),
      saved({
        ...full('resp_a', [reasoning, { ...call, arguments: '{}' }]),
        tool_calls: [{ id: 'call_1', name: 'list_backups', args: {} }],
      }),
    ]);
    expect(steps[1]).toEqual(['resp_a', RUN]);
    expect(messages.map((message) => message.id)).toEqual(['resp_a']);
  });
});

describe('a recorded OpenAI Responses run', () => {
  it('holds the shape this suite depends on', () => {
    const events = recording();
    expect(events).toHaveLength(61);
    expect(
      wireMessages(events[events.length - 1]).map((message) => message.type)
    ).toEqual(['human', 'ai', 'tool', 'ai']);
    const chunkIds = [
      ...new Set(
        events.flatMap((event) =>
          event.type === 'messages'
            ? streamed(event).flatMap((message) =>
                message['type'] === 'AIMessageChunk' ? [message['id']] : []
              )
            : []
        )
      ),
    ];
    expect(chunkIds).toHaveLength(4);
    expect(
      chunkIds.filter((id) => String(id).startsWith('lc_run--'))
    ).toHaveLength(2);
  });

  it('projects one assistant message for each response after every event', () => {
    const events = recording();
    const opened = openedResponses(events);
    let current: { state: ReturnType<typeof initialMessageState>; projection: StreamProjection } = {
      state: initialMessageState(),
      projection: {
        generation: 'run',
        userId: RECORDED_USER_ID,
        baselineIds: [],
        sawAssistant: false,
        terminal: false,
        paused: false,
        canonical: [],
      },
    };
    events.forEach((event, index) => {
      current = projectStream(current.state, current.projection, event);
      expect(
        current.state.messages
          .filter((message) => message.role === 'assistant')
          .map((message) => message.id),
        `after event ${index} (${event.type})`
      ).toEqual(RESPONSES.slice(0, opened[index]));
    });
    const final = finalizeProjection(current.state, current.projection);
    expect(final.messages.map((message) => message.id)).toEqual(
      wireMessages(events[events.length - 1]).map((message) => message.id)
    );
    expect(final.toolCalls.map((call) => call.name)).toEqual([
      'list_backups',
      'delete_backups',
    ]);
  });

  it('publishes exactly the backend messages in every snapshot of a session', async () => {
    const template = recording();
    const opened = openedResponses(template);
    let delivered = -1;
    const stream: AgentTransport['stream'] = async function* (
      _assistant,
      _thread,
      payload
    ) {
      const submitted = (
        payload as { messages: { id: string }[] }
      ).messages.at(-1)?.id as string;
      const events = recording(submitted);
      for (const [index, event] of events.entries()) {
        delivered = index;
        yield event;
        // Let the session publish this event before the next one arrives.
        await new Promise<void>((done) => setTimeout(done, 0));
      }
    };
    const session = createSession({
      assistantId: 'chat',
      threadId: 'thread',
      transport: { stream, getHistory: async () => [] },
      transcriptNodeNames: ['generate'],
    });
    const observed: { at: number; ids: string[] }[] = [];
    const release = session.subscribe(() =>
      observed.push({
        at: delivered,
        ids: session
          .getSnapshot()
          .messages.filter((message) => message.role === 'assistant')
          .map((message) => message.id),
      })
    );
    await expect(
      session.submit('Clean up our old database backups')
    ).resolves.toBe('paused');
    release();
    expect(observed.length).toBeGreaterThan(template.length / 2);
    for (const snapshot of observed) {
      // Never an id the backend does not hold, and never more messages than
      // the backend had opened when the snapshot was published.
      expect(RESPONSES).toEqual(expect.arrayContaining(snapshot.ids));
      expect(snapshot.ids).toEqual(
        RESPONSES.slice(0, snapshot.ids.length)
      );
      if (snapshot.at >= 0)
        expect(snapshot.ids.length).toBeLessThanOrEqual(opened[snapshot.at]);
    }
    const final = session.getSnapshot();
    expect(final.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
    ]);
    expect(
      final.messages
        .filter((message) => message.role === 'assistant')
        .map((message) => message.id)
    ).toEqual([...RESPONSES]);
    expect(final.interrupts).toHaveLength(1);
    await session.dispose();
  });
});
