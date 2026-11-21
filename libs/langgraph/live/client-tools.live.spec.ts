import type { ClientToolSpec } from '@threadplane/core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSession } from '../src/runtime/create-session';
import {
  liveSession,
  recordSnapshots,
  settled,
  startLiveBackend,
  type LiveBackend,
} from './backend';

/**
 * Client tools against the client-tools graph: the caller declares the tools,
 * the graph binds them to the model from the `client_tools` state key, and a
 * call to one ends the run so the caller can answer it.
 */
let backend: LiveBackend;
const sessions: { dispose(): Promise<void> }[] = [];
const track = <S extends { dispose(): Promise<void> }>(session: S): S => {
  sessions.push(session);
  return session;
};

beforeAll(async () => {
  backend = await startLiveBackend({
    python: 'cockpit/langgraph/client-tools/python',
    graph: 'client-tools',
    fixtures: [
      'cockpit/langgraph/client-tools/angular/e2e/fixtures/client-tools.json',
    ],
  });
});
afterAll(async () => {
  await Promise.allSettled(sessions.map((session) => session.dispose()));
  await backend?.stop();
});

const location = {
  type: 'object',
  properties: { location: { type: 'string' } },
  required: ['location'],
} as const;
const catalog: readonly ClientToolSpec[] = [
  {
    name: 'get_weather',
    description: 'Look up the current weather for a location.',
    parameters: location,
  },
  {
    name: 'confirm_booking',
    description: 'Ask the person to confirm a booking.',
    parameters: {
      type: 'object',
      properties: { summary: { type: 'string' } },
      required: ['summary'],
    },
  },
  {
    name: 'weather_snapshot',
    description: 'Show a quiet weather snapshot.',
    parameters: location,
  },
];
const WEATHER = "What's the weather in San Francisco?";
const WEATHER_ANSWER = "It's 68°F and sunny in San Francisco right now.";
type Wire = {
  type: string;
  id: string;
  content: string;
  tool_call_id?: string;
};
const wireMessages = (values: unknown) =>
  ((values as { messages?: Wire[] }).messages ?? []) as Wire[];

function declared(options: Parameters<typeof liveSession>[1] = {}) {
  const session = track(liveSession(backend, options));
  session.clientTools?.setCatalog(catalog);
  return session;
}

describe('a declared catalog', () => {
  it('is sent with the run, and a call to one of its tools waits for the caller', async () => {
    const session = declared();
    expect(session.getSnapshot().pendingClientTools).toEqual([]);
    const recorded = recordSnapshots(session);
    expect(await session.submit(WEATHER)).toBe('success');
    recorded.release();

    // The graph received the catalog: it is in the thread's saved state.
    const saved = await backend.saved(session.threadId as string);
    expect((saved.values as Record<string, unknown>)['client_tools']).toEqual(
      catalog
    );

    const snapshot = session.getSnapshot();
    expect(snapshot.status).toBe('idle');
    expect(snapshot.pendingClientTools).toHaveLength(1);
    const [call] = snapshot.pendingClientTools ?? [];
    expect(call).toMatchObject({
      name: 'get_weather',
      args: { location: 'San Francisco' },
      status: 'pending',
    });
    // The pending call is the entry `toolCalls` lists.
    expect(snapshot.toolCalls).toEqual([call]);
    expect(snapshot.toolCalls[0]).toBe(call);
    // While the run was going the call was not yet the caller's to answer.
    expect(
      recorded.snapshots
        .filter((entry) => entry.status === 'running')
        .every((entry) => (entry.pendingClientTools ?? []).length === 0)
    ).toBe(true);

    // The model wrote the call's arguments on the stream before they were
    // final: it was listed apart, under the id it kept once finalized.
    const streaming = recorded.snapshots.flatMap(
      (entry) => entry.streamingToolCalls ?? []
    );
    expect(streaming.length).toBeGreaterThan(0);
    expect(streaming.every((entry) => entry.id === call.id)).toBe(true);
    expect(streaming.every((entry) => entry.name === 'get_weather')).toBe(true);
    expect(JSON.parse(streaming.at(-1)?.argsText ?? '')).toEqual({
      location: 'San Francisco',
    });
    expect(streaming.at(-1)?.args).toEqual({ location: 'San Francisco' });
    // Once final, the call is in `toolCalls` and nothing is left streaming.
    expect('streamingToolCalls' in snapshot).toBe(false);
    expect(
      recorded.snapshots.some(
        (entry) =>
          (entry.streamingToolCalls ?? []).some((s) => s.id === call.id) &&
          entry.toolCalls.some((t) => t.id === call.id)
      )
    ).toBe(false);
  });

  it('resolve records the result and continues the run with it', async () => {
    const session = declared();
    await session.submit(WEATHER);
    const [call] = session.getSnapshot().pendingClientTools ?? [];
    const result = { temperatureF: 68, conditions: 'Sunny' };
    session.clientTools?.resolve(call.id, { ok: true, value: result });
    // Shown at once, before the backend has heard of it.
    expect(session.getSnapshot().toolCalls[0]).toMatchObject({
      id: call.id,
      status: 'complete',
      result,
    });
    expect(session.getSnapshot().pendingClientTools).toEqual([]);

    const done = await settled(
      session,
      (snapshot) =>
        snapshot.status === 'idle' &&
        snapshot.messages.at(-1)?.content === WEATHER_ANSWER
    );
    expect(done.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
    ]);
    expect(done.pendingClientTools).toEqual([]);
    // The authored result is kept, not replaced by the wire text of it.
    expect(done.toolCalls[0]).toMatchObject({ status: 'complete', result });

    // The server holds one tool message for the call, under the stable id.
    const saved = await backend.saved(session.threadId as string);
    const tools = wireMessages(saved.values).filter(
      (message) => message.type === 'tool'
    );
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      id: `client-tool-result-${call.id}`,
      tool_call_id: call.id,
      content: JSON.stringify(result),
    });
    // One submission, one continuation: two runs, and one user message.
    expect(
      await backend.client.runs.list(session.threadId as string)
    ).toHaveLength(2);
    expect(
      wireMessages(saved.values).filter((message) => message.type === 'human')
    ).toHaveLength(1);
  });

  it('settles several calls and continues once, with a failure among them', async () => {
    const session = declared();
    expect(await session.submit('Plan a trip to Portland')).toBe('success');
    const waiting = session.getSnapshot();
    expect(
      waiting.pendingClientTools?.map((call) => [call.name, call.args])
    ).toEqual([
      ['get_weather', { location: 'Portland' }],
      ['confirm_booking', { summary: 'Fictional trip to Portland' }],
    ]);
    // The graph declared a plan for the turn; the session publishes it.
    expect(waiting.plan?.map((step) => step.status)).toEqual([
      'in_progress',
      'in_progress',
      'pending',
    ]);
    const [weather, booking] = waiting.pendingClientTools ?? [];
    session.clientTools?.settle?.(weather.id, {
      ok: true,
      value: { temperatureF: 68 },
    });
    // Recording one result starts nothing while another call still waits.
    expect(
      session.getSnapshot().pendingClientTools?.map((call) => call.id)
    ).toEqual([booking.id]);
    expect(session.getSnapshot().status).toBe('idle');
    session.clientTools?.resolve(booking.id, {
      ok: false,
      error: 'The person declined.',
    });
    expect(session.getSnapshot().toolCalls).toMatchObject([
      { id: weather.id, status: 'complete', result: { temperatureF: 68 } },
      { id: booking.id, status: 'error', error: 'The person declined.' },
    ]);
    const done = await settled(
      session,
      (snapshot) =>
        snapshot.status === 'idle' &&
        snapshot.messages.at(-1)?.role === 'assistant' &&
        snapshot.messages.at(-1)?.content.startsWith('Portland') === true
    );
    expect(done.messages.at(-1)?.content).toBe(
      'Portland is 68°F and sunny, and your fictional trip is booked.'
    );
    expect(done.plan?.every((step) => step.status === 'completed')).toBe(true);
    // Both results went back in one continuation run.
    const saved = await backend.saved(session.threadId as string);
    expect(
      wireMessages(saved.values)
        .filter((message) => message.type === 'tool')
        .map((message) => [message.tool_call_id, message.content])
    ).toEqual([
      [weather.id, '{"temperatureF":68}'],
      [booking.id, 'Error: The person declined.'],
    ]);
    expect(
      await backend.client.runs.list(session.threadId as string)
    ).toHaveLength(2);
  });

  it('settle and flush make a result durable without another run', async () => {
    const session = declared();
    expect(
      await session.submit('Show me a quiet weather snapshot for Oslo')
    ).toBe('success');
    const [call] = session.getSnapshot().pendingClientTools ?? [];
    expect(call).toMatchObject({ name: 'weather_snapshot' });
    session.clientTools?.settle?.(call.id, { ok: true, value: 'shown' });
    expect(session.getSnapshot().pendingClientTools).toEqual([]);
    // Nothing reached the server yet.
    const staged = await backend.saved(session.threadId as string);
    expect(
      wireMessages(staged.values).some((message) => message.type === 'tool')
    ).toBe(false);

    await session.clientTools?.flush?.();
    const saved = await backend.saved(session.threadId as string);
    expect(wireMessages(saved.values).at(-1)).toMatchObject({
      type: 'tool',
      id: `client-tool-result-${call.id}`,
      tool_call_id: call.id,
      content: 'shown',
    });
    // The write started no run, and the session shows no new answer.
    expect(
      await backend.client.runs.list(session.threadId as string)
    ).toHaveLength(1);
    expect(session.getSnapshot().status).toBe('idle');
    expect(
      session.getSnapshot().messages.filter((m) => m.role === 'assistant')
    ).toHaveLength(1);
    // Flushing again writes nothing more.
    await session.clientTools?.flush?.();
    expect(
      wireMessages(
        (await backend.saved(session.threadId as string)).values
      ).filter((message) => message.type === 'tool')
    ).toHaveLength(1);

    // A reload sees the call as answered: nothing waits for the caller.
    const reloaded = declared({ threadId: session.threadId });
    await reloaded.load?.();
    expect(reloaded.getSnapshot().pendingClientTools).toEqual([]);
    expect(reloaded.getSnapshot().toolCalls[0]).toMatchObject({
      id: call.id,
      status: 'complete',
      result: 'shown',
    });
  });

  it('restores a waiting call after a reload, and answers it from there', async () => {
    const author = declared();
    await author.submit(WEATHER);
    const [call] = author.getSnapshot().pendingClientTools ?? [];

    const reloaded = track(liveSession(backend, { threadId: author.threadId }));
    await reloaded.load?.();
    // No catalog declared yet: the session cannot know the call is the caller's.
    expect('pendingClientTools' in reloaded.getSnapshot()).toBe(false);
    reloaded.clientTools?.setCatalog(catalog);
    expect(reloaded.getSnapshot().pendingClientTools).toEqual([
      {
        id: call.id,
        name: 'get_weather',
        args: { location: 'San Francisco' },
        status: 'pending',
      },
    ]);
    reloaded.clientTools?.resolve(call.id, { ok: true, value: 'Sunny, 68°F' });
    const done = await settled(
      reloaded,
      (snapshot) =>
        snapshot.status === 'idle' &&
        snapshot.messages.at(-1)?.content === WEATHER_ANSWER
    );
    expect(done.pendingClientTools).toEqual([]);
  });

  it('refuses a result for a call that is not waiting', async () => {
    const session = declared();
    expect(() =>
      session.clientTools?.resolve('nothing', { ok: true, value: 1 })
    ).toThrow(/No pending client tool call/);
    await session.submit(WEATHER);
    const [call] = session.getSnapshot().pendingClientTools ?? [];
    session.clientTools?.settle?.(call.id, { ok: true, value: 1 });
    expect(() =>
      session.clientTools?.settle?.(call.id, { ok: true, value: 2 })
    ).toThrow(/No pending client tool call/);
  });
});

describe('a fixed handler map', () => {
  it('still runs its tools itself and hands the results back', async () => {
    const handler = vi.fn((args: { location: string }) => ({
      location: args.location,
      temperatureF: 68,
      conditions: 'Sunny',
    }));
    const session = track(
      createSession({
        assistantId: backend.graph,
        apiUrl: backend.url,
        tools: {
          get_weather: {
            description: 'Look up the current weather for a location.',
            parameters: location,
            handler,
          },
        },
      })
    );
    // The capability is for tools declared after creation.
    expect(session.clientTools).toBeUndefined();
    expect(await session.submit(WEATHER)).toBe('success');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toEqual({ location: 'San Francisco' });
    const snapshot = session.getSnapshot();
    expect(snapshot.messages.at(-1)?.content).toBe(WEATHER_ANSWER);
    expect(snapshot.toolCalls).toMatchObject([
      {
        name: 'get_weather',
        status: 'complete',
        result: { location: 'San Francisco', temperatureF: 68 },
      },
    ]);
    expect('pendingClientTools' in snapshot).toBe(false);
    const saved = await backend.saved(session.threadId as string);
    expect(
      (saved.values as { client_tools?: { name: string }[] }).client_tools?.map(
        (tool) => tool.name
      )
    ).toEqual(['get_weather']);
  });
});
