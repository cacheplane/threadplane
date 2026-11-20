import type { BaseEvent } from '@ag-ui/client';
import { describe, expect, it, vi } from 'vitest';
import { projectSubagents } from './child-projection';
import { projectMessages } from './message-projection';
import { collectReplay, foldReplay, httpReplay } from './replay';

const ev = (event: object) => event as BaseEvent;
/** A run's start; `prompts` are the user messages its input carried. */
const started = (runId: string, prompts?: object[]) =>
  ev({
    type: 'RUN_STARTED',
    threadId: 't',
    runId,
    ...(prompts && { input: { threadId: 't', runId, messages: prompts } }),
  });
const finished = (runId: string, outcome?: object) =>
  ev({
    type: 'RUN_FINISHED',
    threadId: 't',
    runId,
    ...(outcome && { outcome }),
  });
const user = (id: string, content: string) => ({ id, role: 'user', content });
const text = (messageId: string, delta: string) => [
  ev({ type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' }),
  ev({ type: 'TEXT_MESSAGE_CONTENT', messageId, delta }),
  ev({ type: 'TEXT_MESSAGE_END', messageId }),
];
const drained = [
  started('r1', [user('u1', 'Find flights')]),
  ev({
    type: 'REASONING_MESSAGE_START',
    messageId: 'think',
    role: 'reasoning',
    timestamp: 1000,
  }),
  ev({
    type: 'REASONING_MESSAGE_CONTENT',
    messageId: 'think',
    delta: 'Checking',
  }),
  ev({ type: 'REASONING_MESSAGE_END', messageId: 'think', timestamp: 1750 }),
  ev({
    type: 'TOOL_CALL_START',
    toolCallId: 'c1',
    toolCallName: 'search',
    parentMessageId: 'a1',
  }),
  ev({ type: 'TOOL_CALL_ARGS', toolCallId: 'c1', delta: '{"to":"Rome"}' }),
  ev({ type: 'TOOL_CALL_END', toolCallId: 'c1' }),
  ev({
    type: 'TOOL_CALL_RESULT',
    messageId: 'tr1',
    toolCallId: 'c1',
    content: '2 flights',
  }),
  ...text('a2', 'Two flights found'),
  ev({ type: 'STATE_SNAPSHOT', snapshot: { city: 'Rome' } }),
  finished('r1'),
];

describe('foldReplay', () => {
  it('rebuilds a drained run: the prompt, reasoning, a tool call and the answer', async () => {
    const { observation, events } = await foldReplay('t', drained);
    expect(observation).toMatchObject({
      status: 'idle',
      state: { city: 'Rome' },
      run: { id: 'r1', outcome: 'success' },
    });
    expect(observation.transcript.map((record) => record.id)).toEqual([
      'u1',
      'think',
      'a1',
      'tr1',
      'a2',
    ]);
    // The duration is what the events' own timestamps establish.
    expect(observation.reasoningDurations).toEqual({ think: 750 });
    const messages = projectMessages(observation);
    expect(messages.map((message) => message.content)).toEqual([
      'Find flights',
      '',
      '2 flights',
      'Two flights found',
    ]);
    expect(messages[1].reasoningDurationMs).toBe(750);
    expect(events.map((event) => event.type)).toEqual(
      drained.map((event) => event.type)
    );
    expect(Object.isFrozen(observation.transcript)).toBe(true);
  });

  it('omits a reasoning duration the events cannot establish', async () => {
    const { observation } = await foldReplay(
      't',
      drained.map(({ timestamp: _dropped, ...event }) => ev(event))
    );
    expect(observation.reasoningDurations).toBeUndefined();
  });

  it('expands chunk events as the live pipeline does', async () => {
    const { observation } = await foldReplay('t', [
      started('r1'),
      ev({
        type: 'TEXT_MESSAGE_CHUNK',
        messageId: 'a1',
        role: 'assistant',
        delta: 'Hel',
      }),
      ev({ type: 'TEXT_MESSAGE_CHUNK', messageId: 'a1', delta: 'lo' }),
      finished('r1'),
    ]);
    expect(
      projectMessages(observation).map((message) => message.content)
    ).toEqual(['Hello']);
  });

  it('restores a parked run as a pending pause', async () => {
    const { observation } = await foldReplay('t', [
      started('r1', [user('u1', 'Book it')]),
      finished('r1', {
        type: 'interrupt',
        interrupts: [{ id: 'i1', reason: 'approval' }],
      }),
    ]);
    expect(observation.status).toBe('idle');
    expect(observation.run).toMatchObject({ id: 'r1', outcome: 'paused' });
    expect(observation.decision).toMatchObject({
      kind: 'native',
      sourceRunId: 'r1',
      interrupts: [{ id: 'i1', reason: 'approval' }],
    });
  });

  it('treats a run after a pause as the answer to that pause', async () => {
    const { observation } = await foldReplay('t', [
      started('r1', [user('u1', 'Book it')]),
      finished('r1', {
        type: 'interrupt',
        interrupts: [{ id: 'i1', reason: 'approval' }],
      }),
      started('r2'),
      ...text('a1', 'Booked'),
      finished('r2'),
    ]);
    expect(observation.decision).toBeUndefined();
    expect(observation.run).toMatchObject({ id: 'r2', outcome: 'success' });
    expect(observation.transcript.map((record) => record.id)).toEqual([
      'u1',
      'a1',
    ]);
  });

  it('restores a custom interrupt notice a resume profile can answer', async () => {
    const stored = [
      started('r1'),
      ev({
        type: 'CUSTOM',
        name: 'on_interrupt',
        value: '{"question":"Proceed?"}',
      }),
      finished('r1'),
    ];
    const answerable = await foldReplay('t', stored, {
      interruptTransport: 'auto',
    });
    expect(answerable.observation.run?.outcome).toBe('paused');
    expect(answerable.observation.decision).toMatchObject({
      kind: 'native',
      interrupts: [{ reason: 'on_interrupt', value: { question: 'Proceed?' } }],
    });
    // Without a profile the ordinary finish clears the notice, as it does live.
    const observed = await foldReplay('t', stored);
    expect(observed.observation.decision).toBeUndefined();
    expect(observed.observation.run?.outcome).toBe('success');
  });

  it('keeps child events under their child and out of the root messages', async () => {
    const { observation } = await foldReplay('t', [
      started('r1', [user('u1', 'Research')]),
      ev({
        type: 'SUBAGENT_STARTED',
        subagentRunId: 'child',
        name: 'researcher',
      }),
      ev({
        type: 'TEXT_MESSAGE_START',
        messageId: 'c-a',
        role: 'assistant',
        subagentRunId: 'child',
      }),
      ev({
        type: 'TEXT_MESSAGE_CONTENT',
        messageId: 'c-a',
        delta: 'Found',
        subagentRunId: 'child',
      }),
      ev({
        type: 'TEXT_MESSAGE_END',
        messageId: 'c-a',
        subagentRunId: 'child',
      }),
      ev({ type: 'SUBAGENT_FINISHED', subagentRunId: 'child' }),
      ...text('a1', 'Done'),
      finished('r1'),
    ]);
    const [child] = projectSubagents(observation);
    expect(child).toMatchObject({
      id: 'child',
      name: 'researcher',
      status: 'complete',
    });
    expect(child.messages.map((message) => message.content)).toEqual(['Found']);
    expect(
      projectMessages(observation).map((message) => message.content)
    ).toEqual(['Research', 'Done']);
  });

  it('settles a run the replay ends in the middle of as interrupted and leaves the thread idle', async () => {
    const { observation } = await foldReplay('t', [
      started('r1', [user('u1', 'Go')]),
      ev({ type: 'TEXT_MESSAGE_START', messageId: 'a1', role: 'assistant' }),
      ev({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'a1', delta: 'Half' }),
    ]);
    expect(observation.status).toBe('idle');
    expect(observation.run).toMatchObject({ id: 'r1', outcome: 'interrupted' });
    expect(projectMessages(observation).at(-1)?.content).toBe('Half');
  });

  it('leaves a replayed RUN_ERROR as a failed thread, redacted when asked', async () => {
    const stored = [
      started('r1'),
      ev({ type: 'RUN_ERROR', message: 'secret detail', code: 'X' }),
    ];
    const plain = await foldReplay('t', stored);
    expect(plain.observation).toMatchObject({
      status: 'error',
      run: {
        outcome: 'error',
        terminal: { type: 'RUN_ERROR', message: 'secret detail' },
      },
    });
    const redacted = await foldReplay('t', stored, {
      redact: () => ({ type: 'RUN_ERROR', message: 'generic' } as never),
    });
    expect(JSON.stringify(redacted)).not.toContain('secret detail');
    expect(redacted.events.at(-1)).toEqual({
      type: 'RUN_ERROR',
      message: 'generic',
    });
  });

  it('ignores what a run sends after its terminal event, as a live run does', async () => {
    const { observation, events } = await foldReplay('t', [
      started('r1'),
      ev({ type: 'RUN_ERROR', message: 'failed' }),
      ...text('late', 'Late'),
      started('r2'),
      finished('r2'),
      ev({ type: 'CUSTOM', name: 'late', value: 1 }),
    ]);
    expect(observation.transcript).toHaveLength(0);
    expect(observation.run).toMatchObject({ id: 'r2', outcome: 'success' });
    expect(events.map((event) => event.type)).toEqual([
      'RUN_STARTED',
      'RUN_ERROR',
      'RUN_STARTED',
      'RUN_FINISHED',
    ]);
  });

  it('closes the response at a notice under legacy observation', async () => {
    const { observation, events } = await foldReplay(
      't',
      [
        started('r1'),
        ev({ type: 'CUSTOM', name: 'on_interrupt', value: 'x' }),
        ...text('late', 'Late'),
      ],
      { interruptMode: 'legacy-observation', interruptTransport: 'auto' }
    );
    expect(observation.run?.outcome).toBe('paused');
    expect(observation.transcript).toHaveLength(0);
    expect(events).toHaveLength(2);
  });

  it.each([
    ['events before the first run', [...text('a1', 'x'), started('r1')]],
    ['a run without an id', [ev({ type: 'RUN_STARTED', threadId: 't' })]],
    [
      'a run of another thread',
      [ev({ type: 'RUN_STARTED', threadId: 'other', runId: 'r1' })],
    ],
    ['an entry without a type', [started('r1'), ev({ messageId: 'a1' })]],
    [
      'content for a message that never started',
      [
        started('r1'),
        ev({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'ghost', delta: 'x' }),
      ],
    ],
    [
      'a finish while a message is still open',
      [
        started('r1'),
        ev({ type: 'TEXT_MESSAGE_START', messageId: 'a', role: 'assistant' }),
        finished('r1'),
      ],
    ],
  ])('rejects %s', async (_name, stored) => {
    await expect(foldReplay('t', stored)).rejects.toThrow();
  });
});

describe('collectReplay', () => {
  const live = () => new AbortController().signal;
  it('collects a promise of events and an observable that completes', async () => {
    const events = [started('r1'), finished('r1')];
    expect(await collectReplay(async () => events, 't', live())).toEqual(
      events
    );
    const unsubscribe = vi.fn();
    const observable = {
      subscribe(observer: { next(event: BaseEvent): void; complete(): void }) {
        for (const event of events) observer.next(event);
        observer.complete();
        return { unsubscribe };
      },
    };
    expect(await collectReplay(() => observable, 't', live())).toEqual(events);
  });

  it('rejects a source that throws, errors or resolves to something else', async () => {
    await expect(
      collectReplay(
        () => {
          throw new Error('sync');
        },
        't',
        live()
      )
    ).rejects.toThrow('sync');
    await expect(
      collectReplay(() => Promise.reject(new Error('async')), 't', live())
    ).rejects.toThrow('async');
    await expect(
      collectReplay(
        () => ({
          subscribe(observer: { error(error: unknown): void }) {
            observer.error(new Error('stream'));
            return { unsubscribe: () => undefined };
          },
        }),
        't',
        live()
      )
    ).rejects.toThrow('stream');
    await expect(
      collectReplay(async () => ({ events: [] } as never), 't', live())
    ).rejects.toThrow('must resolve to an array');
  });

  it('rejects with an AbortError and releases an observable when the signal aborts', async () => {
    const controller = new AbortController();
    const unsubscribe = vi.fn();
    const pending = collectReplay(
      () => ({ subscribe: () => ({ unsubscribe }) }),
      't',
      controller.signal
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(unsubscribe).toHaveBeenCalledOnce();
    await expect(
      collectReplay(async () => [], 't', controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('httpReplay', () => {
  const signal = new AbortController().signal;
  const serve = (status: number, body?: unknown) =>
    vi.fn(
      async () =>
        new Response(body === undefined ? null : JSON.stringify(body), {
          status,
        })
    );

  it('gets the events of a thread with the given headers', async () => {
    const fetch = serve(200, { events: [started('r1'), finished('r1')] });
    const source = httpReplay({
      url: (id) => `/threads/${id}/events`,
      fetch,
      headers: { authorization: 'Bearer x' },
    });
    expect(await source('t 1', signal)).toHaveLength(2);
    expect(fetch).toHaveBeenCalledWith('/threads/t 1/events', {
      method: 'GET',
      headers: { accept: 'application/json', authorization: 'Bearer x' },
      signal,
    });
  });

  it('reads a 404 as no events and rejects other failures and malformed bodies', async () => {
    const source = (fetch: typeof globalThis.fetch) =>
      httpReplay({ url: () => '/events', fetch })('t', signal);
    expect(await source(serve(404))).toEqual([]);
    await expect(source(serve(500))).rejects.toThrow('status 500');
    await expect(source(serve(200, { items: [] }))).rejects.toThrow(
      'events array'
    );
    await expect(source(serve(200, { events: [{ id: 1 }] }))).rejects.toThrow(
      'string type'
    );
  });
});
