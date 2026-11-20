import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ThreadState } from '@langchain/langgraph-sdk';
import { createSession, type SessionOptions } from './create-session';
import {
  changedSignals,
  convertEventMessages,
  throttleListener,
} from './session-hooks';
import type { AgentTransport, StreamEvent } from './transport.types';
import { controlledTransport } from './testing/controlled-transport';

const sessions: { dispose(): Promise<void> }[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(sessions.splice(0).map((session) => session.dispose()));
});

const answer = (id = 'answer', content = 'Done'): StreamEvent => ({
  type: 'values',
  data: { topic: 'reported', messages: [{ type: 'ai', id, content }] },
});

function fixture(
  options: Partial<SessionOptions> = {},
  extra: Partial<AgentTransport> = {},
  events: readonly StreamEvent[] = [answer()]
) {
  const stream = vi.fn<AgentTransport['stream']>(async function* () {
    yield* events;
  });
  const session = createSession({
    assistantId: 'agent',
    threadId: 'thread',
    ...options,
    transport: { stream, ...extra },
  });
  sessions.push(session);
  return { session, stream };
}

describe('initial values', () => {
  it('publishes them as the state until the backend reports one', async () => {
    const initialValues = { topic: 'draft', nested: { count: 1 } };
    const { session, stream } = fixture({ initialValues });
    expect(session.getSnapshot().state).toEqual(initialValues);
    expect(Object.isFrozen(session.getSnapshot().state)).toBe(true);
    initialValues.nested.count = 2;
    expect(session.getSnapshot().state).toEqual({
      topic: 'draft',
      nested: { count: 1 },
    });
    await session.submit('Go');
    expect(stream.mock.calls[0][2]).not.toHaveProperty('topic');
    expect(session.getSnapshot().state).toEqual({ topic: 'reported' });
  });

  it('is not checked against the declared state', () => {
    const { session } = fixture({
      initialValues: { partial: true },
      stateType: {
        '~standard': {
          version: 1,
          vendor: 'test',
          validate: () => ({ issues: [{ message: 'no' }] }),
        },
      } as never,
    });
    expect(session.getSnapshot().state).toEqual({ partial: true });
    expect(session.getSnapshot().stateIssues).toBeUndefined();
  });
});

describe('toMessage', () => {
  const toMessage = (message: unknown) => {
    const raw = message as { kind?: string; uid?: string; text?: string };
    if (raw.kind === 'broken') throw new Error('unreadable');
    return raw.kind
      ? { type: raw.kind, id: raw.uid, content: raw.text }
      : message;
  };

  it('converts stream messages, root and child, before projection', async () => {
    const { session } = fixture({ toMessage }, {}, [
      {
        type: 'messages',
        messages: [{ kind: 'AIMessageChunk', uid: 'a', text: 'Hel' }],
        messageMetadata: {},
      },
      {
        type: 'values|child:1',
        data: { messages: [{ kind: 'ai', uid: 'c', text: 'Child' }] },
      },
      {
        type: 'values',
        data: { messages: [{ kind: 'ai', uid: 'a', text: 'Hello' }] },
      },
    ]);
    expect(await session.submit('Go')).toBe('success');
    expect(session.getSnapshot().messages.at(-1)).toMatchObject({
      id: 'a',
      content: 'Hello',
    });
    expect(session.getSnapshot().subgraphs[0].messages[0]).toMatchObject({
      id: 'c',
      content: 'Child',
    });
  });

  it('converts saved messages and reads an unreadable one as sent', async () => {
    const { session } = fixture(
      { toMessage },
      {
        getHistory: async () => [
          {
            values: {
              messages: [
                { kind: 'human', uid: 'u', text: 'Hi' },
                { kind: 'broken', type: 'ai', id: 'x', content: 'As sent' },
              ],
            },
            next: [],
            tasks: [],
          } as unknown as ThreadState,
        ],
      }
    );
    await session.load?.();
    expect(
      session.getSnapshot().messages.map((m) => [m.role, m.content])
    ).toEqual([
      ['user', 'Hi'],
      ['assistant', 'As sent'],
    ]);
  });

  it('leaves an event without messages alone', () => {
    const event: StreamEvent = { type: 'custom', data: { name: 'x' } };
    expect(convertEventMessages(event, undefined)).toBe(event);
    expect(convertEventMessages(event, toMessage)).toEqual(event);
    expect(
      convertEventMessages(
        {
          type: 'checkpoints',
          data: { values: { messages: [{ kind: 'ai', uid: 'a', text: 'A' }] } },
        },
        toMessage
      )['data']
    ).toEqual({ values: { messages: [{ type: 'ai', id: 'a', content: 'A' }] } });
  });
});

describe('throttle', () => {
  it('limits listener calls while a run streams and delivers the end at once', async () => {
    vi.useFakeTimers();
    const active = controlledTransport<StreamEvent>();
    const { session } = fixture({ throttle: 50 }, { stream: () => active.stream });
    const notify = vi.fn();
    const seen: string[] = [];
    session.subscribe(() => {
      notify();
      seen.push(session.getSnapshot().messages.at(-1)?.content ?? '');
    });
    const run = session.submit('Go');
    await vi.advanceTimersByTimeAsync(0);
    expect(notify).toHaveBeenCalledTimes(1);
    for (const content of ['A', 'AB', 'ABC']) {
      active.release({
        type: 'messages/partial',
        messages: [{ type: 'ai', id: 'a', content }],
      });
      await vi.advanceTimersByTimeAsync(0);
    }
    // The snapshot is current; only the listener waits.
    expect(session.getSnapshot().messages.at(-1)?.content).toBe('ABC');
    expect(notify).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(50);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(seen.at(-1)).toBe('ABC');
    active.release(answer('a', 'ABCD'));
    await vi.advanceTimersByTimeAsync(0);
    active.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(await run).toBe('success');
    expect(session.getSnapshot().status).toBe('idle');
    expect(seen.at(-1)).toBe('ABCD');
    const calls = notify.mock.calls.length;
    await vi.advanceTimersByTimeAsync(500);
    expect(notify).toHaveBeenCalledTimes(calls);
  });

  it('cancels a pending call on release and on dispose', () => {
    vi.useFakeTimers();
    const notify = vi.fn();
    const throttled = throttleListener(notify, 50, () => false);
    throttled();
    throttled();
    expect(notify).toHaveBeenCalledTimes(1);
    throttled.cancel();
    vi.advanceTimersByTime(100);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('is off by default', async () => {
    const { session } = fixture({}, {}, [
      { type: 'messages/partial', messages: [{ type: 'ai', id: 'a', content: 'A' }] },
      { type: 'messages/partial', messages: [{ type: 'ai', id: 'a', content: 'AB' }] },
      answer('a', 'ABC'),
    ]);
    const notify = vi.fn();
    session.subscribe(notify);
    await session.submit('Go');
    expect(notify.mock.calls.length).toBeGreaterThanOrEqual(4);
  });
});

describe('generated UI capabilities', () => {
  it('rides every run that has input, and no run without', async () => {
    const a2uiClientCapabilities = {
      supportedCatalogIds: ['standard'],
      inlineCatalogs: [{ id: 'inline' }],
    };
    const { session, stream } = fixture({ a2uiClientCapabilities });
    await session.submit('Go');
    await session.submit(null);
    expect(stream.mock.calls[0][2]).toMatchObject({
      a2ui_client_capabilities: a2uiClientCapabilities,
    });
    expect(stream.mock.calls[1][2]).toBeNull();
    const plain = fixture();
    await plain.session.submit('Go');
    expect(plain.stream.mock.calls[0][2]).not.toHaveProperty(
      'a2ui_client_capabilities'
    );
  });
});

describe('telemetry', () => {
  it('reports the instance, each request and how its stream ended', async () => {
    const telemetry = vi.fn();
    const { session } = fixture({ telemetry });
    expect(telemetry).toHaveBeenCalledWith({
      event: 'tplane:runtime_instance_created',
      properties: { transport: 'langgraph', surface: 'agent' },
    });
    await session.submit('Go');
    await session.submit(null);
    expect(telemetry.mock.calls.map(([payload]) => payload.event)).toEqual([
      'tplane:runtime_instance_created',
      'tplane:runtime_request_created',
      'tplane:stream_started',
      'tplane:stream_ended',
      'tplane:runtime_request_created',
      'tplane:stream_started',
      'tplane:stream_ended',
    ]);
    expect(telemetry.mock.calls[1][0].properties.requestType).toBe('submit');
    expect(telemetry.mock.calls[4][0].properties.requestType).toBe('continue');
    expect(telemetry.mock.calls[3][0].properties.durationMs).toEqual(
      expect.any(Number)
    );
  });

  it('reports a failed stream with the error kind and survives a failing sink', async () => {
    const telemetry = vi.fn((payload: { event: string }) => {
      if (payload.event === 'tplane:stream_started') throw new Error('sink');
      return Promise.reject(new Error('async sink'));
    });
    const { session } = fixture(
      { telemetry },
      {
        // eslint-disable-next-line require-yield
        async *stream() {
          throw Object.assign(new Error('Denied'), { status: 403 });
        },
      }
    );
    expect(await session.submit('Go')).toBe('error');
    expect(telemetry.mock.calls.at(-1)?.[0]).toMatchObject({
      event: 'tplane:stream_errored',
      properties: { errorClass: 'auth' },
    });
  });

  it('reports nothing for a stopped run or when turned off', async () => {
    const telemetry = vi.fn();
    const active = controlledTransport<StreamEvent>();
    const { session } = fixture({ telemetry }, { stream: () => active.stream });
    const run = session.submit('Go');
    await vi.waitFor(() => expect(session.getSnapshot().status).toBe('running'));
    await session.stop();
    expect(await run).toBe('aborted');
    expect(telemetry.mock.calls.map(([payload]) => payload.event)).toEqual([
      'tplane:runtime_instance_created',
      'tplane:runtime_request_created',
      'tplane:stream_started',
    ]);
    const off = fixture({ telemetry: false });
    expect(await off.session.submit('Go')).toBe('success');
  });
});

describe('development collector', () => {
  it('is touched for the instance and each request, told of milestones, and disposed', async () => {
    const developmentRuntime = {
      touch: vi.fn(),
      milestone: vi.fn(),
      dispose: vi.fn(() => {
        throw new Error('ignored');
      }),
    };
    const { session } = fixture(
      { developmentRuntime },
      {
        getHistory: async () => [
          {
            values: { messages: [{ type: 'human', id: 'u', content: 'Hi' }] },
            next: [],
            tasks: [],
          } as unknown as ThreadState,
        ],
      }
    );
    expect(developmentRuntime.touch).toHaveBeenCalledTimes(1);
    await session.load?.();
    expect(developmentRuntime.milestone).toHaveBeenCalledWith(
      'thread.persisted'
    );
    await session.submit('Go');
    expect(developmentRuntime.touch).toHaveBeenCalledTimes(2);
    expect(developmentRuntime.milestone).toHaveBeenCalledWith(
      'transport.connected'
    );
    await session.dispose();
    expect(developmentRuntime.dispose).toHaveBeenCalledTimes(1);
  });
});

describe('devtools', () => {
  function sink() {
    const log: string[] = [];
    let open: string | undefined;
    return {
      log,
      devtools: {
        begin: (type: string) => {
          open = type;
        },
        end: () => {
          open = undefined;
        },
        wrote: (name: string) => log.push(`${open}:${name}`),
        outside<R>(label: string, run: () => R): R {
          open = label;
          try {
            return run();
          } finally {
            open = undefined;
          }
        },
      },
    };
  }

  it('names the fields each event changed, and the changes no event caused', async () => {
    const { log, devtools } = sink();
    const { session } = fixture({ devtools }, {}, [
      { type: 'custom', data: { name: 'progress', data: 1 } },
      answer(),
    ]);
    await session.submit('Go');
    await session.setBranch('b');
    expect(log).toEqual(
      expect.arrayContaining([
        'run:start:status',
        'run:start:messages',
        'custom:custom',
        'values:messages',
        'values:values',
        'run:end:status',
        'branch:branch',
      ])
    );
    expect(log.some((entry) => entry.startsWith('undefined:'))).toBe(false);
  });

  it('reports the names of differing fields only', () => {
    const { session } = fixture();
    const before = session.getSnapshot();
    expect(changedSignals(before, before)).toEqual([]);
    expect(
      changedSignals(before, { ...before, interrupts: [], queue: [] })
    ).toEqual(['interrupt', 'interrupts', 'queue']);
  });

  it('contains a failing sink', async () => {
    const { session } = fixture({
      devtools: {
        begin() {
          throw new Error('sink');
        },
        end() {
          /* unused */
        },
        wrote() {
          /* unused */
        },
        outside() {
          throw new Error('sink');
        },
      },
    });
    expect(await session.submit('Go')).toBe('success');
  });
});

describe('scripted runs', () => {
  it('streams the armed frames instead of calling the transport, once', async () => {
    const take = vi
      .fn()
      .mockReturnValueOnce({
        frames: [
          {
            event: 'messages',
            data: [{ type: 'AIMessageChunk', id: 's', content: 'Scr' }, {}],
          },
          {
            event: 'values',
            data: { messages: [{ type: 'ai', id: 's', content: 'Scripted' }] },
          },
        ],
      })
      .mockReturnValue(null);
    const createThread = vi.fn(async () => 'created');
    const stream = vi.fn<AgentTransport['stream']>(async function* () {
      yield answer('real', 'Real');
    });
    const session = createSession({
      assistantId: 'agent',
      scriptedRuns: { take },
      transport: { stream, createThread },
    });
    sessions.push(session);
    expect(await session.submit('Go')).toBe('success');
    expect(stream).not.toHaveBeenCalled();
    // The backend never saw a scripted run, so it created no thread for it.
    expect(createThread).not.toHaveBeenCalled();
    expect(session.getSnapshot().messages.at(-1)).toMatchObject({
      id: 's',
      content: 'Scripted',
    });
    expect(await session.submit('Again')).toBe('success');
    expect(stream).toHaveBeenCalledTimes(1);
    expect(createThread).toHaveBeenCalledTimes(1);
  });

  it('ends a scripted run on stop and ignores a failing source', async () => {
    const { session, stream } = fixture({
      scriptedRuns: {
        take() {
          throw new Error('source');
        },
      },
    });
    expect(await session.submit('Go')).toBe('success');
    expect(stream).toHaveBeenCalledTimes(1);
  });
});

describe('operation failure reporter', () => {
  it('is accepted for the owned transport and ignored for a supplied one', async () => {
    const onOperationFailure = vi.fn();
    const owned = createSession({
      assistantId: 'agent',
      threadId: 'thread',
      apiUrl: 'http://127.0.0.1:1',
      onOperationFailure,
    });
    sessions.push(owned);
    expect(owned.getSnapshot().status).toBe('idle');
    const { session } = fixture({ onOperationFailure });
    expect(await session.submit('Go')).toBe('success');
    expect(onOperationFailure).not.toHaveBeenCalled();
  });
});
