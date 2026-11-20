import type { AGUIEvent, BaseEvent } from '@ag-ui/client';
import { describe, expect, it, vi } from 'vitest';
import { createSession } from './create-session';
import { protectedFetch } from './protected-fetch';
import { PROTECTED_COPY } from './session-instruments';
import { bindingFixture } from './testing/binding-fixture';

type Fixture = ReturnType<typeof bindingFixture>;
type Exchange = Awaited<ReturnType<Fixture['started']>>;
const finish = (exchange: Exchange) =>
  exchange.emit({
    type: 'RUN_FINISHED',
    threadId: exchange.body.threadId,
    runId: exchange.body.runId,
  });
const say = (exchange: Exchange, messageId: string, delta: string) => {
  exchange.emit({ type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' });
  exchange.emit({ type: 'TEXT_MESSAGE_CONTENT', messageId, delta });
  exchange.emit({ type: 'TEXT_MESSAGE_END', messageId });
};
const sse = (events: unknown[]) =>
  new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
    {
      headers: { 'content-type': 'text/event-stream' },
    }
  );
const url = 'https://agent.invalid/run';

describe('onRawEvent', () => {
  it('delivers each applied event in order, after the snapshot shows it', async () => {
    const fixture = bindingFixture();
    const { session } = fixture;
    try {
      const seen: { type: string; messages: number }[] = [];
      const release = session.onRawEvent?.((event) =>
        seen.push({
          type: event.type,
          messages: session.getSnapshot().messages.length,
        })
      );
      const run = session.submit('Go');
      const first = await fixture.started();
      say(first, 'a1', 'Hi');
      finish(first);
      expect(await run).toBe('success');
      expect(seen).toEqual([
        { type: 'RUN_STARTED', messages: 1 },
        { type: 'TEXT_MESSAGE_START', messages: 1 },
        // The content is already in the snapshot when its event is delivered.
        { type: 'TEXT_MESSAGE_CONTENT', messages: 2 },
        { type: 'TEXT_MESSAGE_END', messages: 2 },
        { type: 'RUN_FINISHED', messages: 2 },
      ]);
      release?.();
      release?.();
      const again = session.submit('More');
      finish(await fixture.started(1));
      await again;
      expect(seen).toHaveLength(5);
    } finally {
      await fixture.cleanup();
    }
  });

  it('delivers nothing from a superseded run, after a terminal, or after disposal', async () => {
    const fixture = bindingFixture();
    const { session } = fixture;
    const seen: string[] = [];
    session.onRawEvent?.((event) => {
      seen.push(event.type);
      throw new Error('a listener cannot fail the run');
    });
    const one = session.submit('One');
    const first = await fixture.started();
    const two = session.submit('Two');
    const second = await fixture.started(1);
    expect(await one).toBe('aborted');
    finish(second);
    expect(await two).toBe('success');
    expect(first.aborts + first.cancels).toBeGreaterThan(0);
    // Only the surviving run's events, each once.
    expect(
      seen.filter((type) => type === 'RUN_STARTED').length
    ).toBeLessThanOrEqual(2);
    expect(seen.at(-1)).toBe('RUN_FINISHED');
    const count = seen.length;
    await session.dispose();
    expect(session.onRawEvent?.(() => seen.push('late'))).toBeTypeOf(
      'function'
    );
    expect(seen).toHaveLength(count);
  });

  it('delivers the events of a replayed thread once it is restored, and none for a saved one', async () => {
    const stored = [
      { type: 'RUN_STARTED', threadId: 'native-thread', runId: 'r1' },
      { type: 'TEXT_MESSAGE_START', messageId: 'a1', role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'a1', delta: 'Hi' },
      { type: 'TEXT_MESSAGE_END', messageId: 'a1' },
      { type: 'RUN_FINISHED', threadId: 'native-thread', runId: 'r1' },
    ] as BaseEvent[];
    const fixture = bindingFixture({ replay: async () => stored });
    try {
      const seen: { type: string; restored: boolean }[] = [];
      fixture.session.onRawEvent?.((event) =>
        seen.push({
          type: event.type,
          restored: fixture.session.getSnapshot().messages.length === 1,
        })
      );
      await fixture.session.ready;
      expect(seen.map((entry) => entry.type)).toEqual(
        stored.map((event) => event.type)
      );
      expect(seen.every((entry) => entry.restored)).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  });

  it('is supplied with client tools too', async () => {
    const session = createSession(
      {
        url,
        threadId: 't',
        fetch: async (_url, init) => {
          const body = JSON.parse(String(init?.body));
          return sse([
            { type: 'RUN_STARTED', threadId: body.threadId, runId: body.runId },
            {
              type: 'RUN_FINISHED',
              threadId: body.threadId,
              runId: body.runId,
            },
          ]);
        },
      },
      { f: { description: 'f', handler: () => 1 } }
    );
    const seen: string[] = [];
    session.onRawEvent?.((event) => seen.push(event.type));
    expect(await session.submit('Go')).toBe('success');
    expect(seen).toEqual(['RUN_STARTED', 'RUN_FINISHED']);
    await session.dispose();
  });
});

describe('a2uiClientCapabilities', () => {
  const a2uiClientCapabilities = {
    supportedCatalogIds: ['basic'],
    inlineCatalogs: [{ id: 'x' }],
  };

  it('travels in every request state without entering the published state', async () => {
    const fixture = bindingFixture({ a2uiClientCapabilities });
    try {
      expect('state' in fixture.session.getSnapshot()).toBe(false);
      const run = fixture.session.submit({
        message: 'Go',
        state: { city: 'Rome' },
      });
      const first = await fixture.started();
      expect(first.body.state).toEqual({
        city: 'Rome',
        a2ui_client_capabilities: a2uiClientCapabilities,
      });
      // A server snapshot replaces the state; the next request still advertises.
      first.emit({ type: 'STATE_SNAPSHOT', snapshot: { city: 'Oslo' } });
      finish(first);
      await run;
      expect(fixture.session.getSnapshot().state).toEqual({ city: 'Oslo' });
      const again = fixture.session.submit('More');
      const second = await fixture.started(1);
      expect(second.body.state).toEqual({
        city: 'Oslo',
        a2ui_client_capabilities: a2uiClientCapabilities,
      });
      finish(second);
      await again;
    } finally {
      await fixture.cleanup();
    }
  });

  it('is sent with no state at all, and left out of a state that is not a record', async () => {
    const bare = bindingFixture({ a2uiClientCapabilities });
    const run = bare.session.submit('Go');
    const first = await bare.started();
    expect(first.body.state).toEqual({
      a2ui_client_capabilities: a2uiClientCapabilities,
    });
    finish(first);
    await run;
    await bare.cleanup();

    const list = bindingFixture({ a2uiClientCapabilities, state: [1, 2] });
    const listed = list.session.submit('Go');
    const second = await list.started();
    expect(second.body.state).toEqual([1, 2]);
    finish(second);
    await listed;
    await list.cleanup();
  });
});

describe('telemetry', () => {
  it('reports the instance, each request and how its stream ended', async () => {
    const telemetry = vi.fn();
    const fixture = bindingFixture({ telemetry });
    try {
      const base = { transport: 'ag-ui', surface: 'session' };
      expect(telemetry.mock.calls).toEqual([
        [{ event: 'tplane:runtime_instance_created', properties: base }],
      ]);
      const ok = fixture.session.submit('Go');
      finish(await fixture.started());
      await ok;
      const failed = fixture.session.submit('Again');
      (await fixture.started(1)).emit({ type: 'RUN_ERROR', message: 'Busy' });
      await failed;
      const retried = fixture.session.retry?.();
      (await fixture.started(2)).end();
      await retried;
      const events = telemetry.mock.calls.map(([payload]) => [
        payload.event,
        payload.properties.requestType ?? payload.properties.errorClass,
      ]);
      expect(events).toEqual([
        ['tplane:runtime_instance_created', undefined],
        ['tplane:runtime_request_created', 'submit'],
        ['tplane:stream_started', undefined],
        ['tplane:stream_ended', undefined],
        ['tplane:runtime_request_created', 'submit'],
        ['tplane:stream_started', undefined],
        ['tplane:stream_errored', 'Error'],
        ['tplane:runtime_request_created', 'retry'],
        ['tplane:stream_started', undefined],
        ['tplane:stream_errored', 'InterruptedError'],
      ]);
      expect(
        telemetry.mock.calls[3][0].properties.durationMs
      ).toBeGreaterThanOrEqual(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it('names resumes, regenerates and client-tool continuations, and survives a sink that fails', async () => {
    const types: (string | undefined)[] = [];
    const telemetry = vi.fn(
      async (payload: { properties: { requestType?: string } }) => {
        if (payload.properties.requestType)
          types.push(payload.properties.requestType);
        throw new Error('collector offline');
      }
    );
    const fixture = bindingFixture({ telemetry });
    const paused = fixture.session.submit('Book');
    const first = await fixture.started();
    say(first, 'a1', 'Shall I?');
    first.emit({
      type: 'RUN_FINISHED',
      threadId: first.body.threadId,
      runId: first.body.runId,
      outcome: {
        type: 'interrupt',
        interrupts: [{ id: 'i1', reason: 'approval' }],
      },
    });
    expect(await paused).toBe('paused');
    const answered = fixture.session.resume([
      { interruptId: 'i1', status: 'resolved' },
    ]);
    finish(await fixture.started(1));
    expect(await answered).toBe('success');
    const regenerated = fixture.session.regenerate?.('a1');
    finish(await fixture.started(2));
    expect(await regenerated).toBe('success');
    await fixture.cleanup();
    expect(types).toEqual(['submit', 'resume', 'regenerate']);

    let call = 0;
    const tools = createSession(
      {
        url,
        threadId: 't',
        telemetry,
        fetch: async (_url, init) => {
          const body = JSON.parse(String(init?.body));
          const life = (type: string) => ({
            type,
            threadId: body.threadId,
            runId: body.runId,
          });
          return sse(
            call++ === 0
              ? [
                  life('RUN_STARTED'),
                  {
                    type: 'TOOL_CALL_START',
                    toolCallId: 'c1',
                    toolCallName: 'f',
                    parentMessageId: 'a1',
                  },
                  { type: 'TOOL_CALL_ARGS', toolCallId: 'c1', delta: '{}' },
                  { type: 'TOOL_CALL_END', toolCallId: 'c1' },
                  life('RUN_FINISHED'),
                ]
              : [life('RUN_STARTED'), life('RUN_FINISHED')]
          );
        },
      },
      { f: { description: 'f', parameters: {}, handler: () => 1 } }
    );
    expect(await tools.submit('Go')).toBe('success');
    expect(types.slice(3)).toEqual(['submit', 'client-tool-continuation']);
    await tools.dispose();
  });

  it('reports nothing when absent or false', async () => {
    const fixture = bindingFixture({ telemetry: false });
    const run = fixture.session.submit('Go');
    finish(await fixture.started());
    expect(await run).toBe('success');
    await fixture.cleanup();
  });
});

describe('reportOperationFailure', () => {
  it('shows one message for a backend error, in the snapshot, its evidence and the raw stream', async () => {
    const reportOperationFailure = vi.fn();
    const fixture = bindingFixture({ reportOperationFailure });
    try {
      const raw: AGUIEvent[] = [];
      fixture.session.onRawEvent?.((event) => raw.push(event));
      const run = fixture.session.submit('Go');
      const first = await fixture.started();
      first.emit({
        type: 'RUN_ERROR',
        message: 'db password rejected',
        code: 'E_SECRET',
      });
      expect(await run).toBe('error');
      const snapshot = fixture.session.getSnapshot();
      expect(snapshot.error).toEqual({
        kind: 'server',
        message: PROTECTED_COPY,
        retryable: true,
        recovery: 'retry',
      });
      expect(snapshot.run?.terminal).toEqual({
        type: 'RUN_ERROR',
        message: PROTECTED_COPY,
      });
      expect(raw.at(-1)).toEqual({
        type: 'RUN_ERROR',
        message: PROTECTED_COPY,
      });
      expect(JSON.stringify([snapshot, raw])).not.toMatch(
        /db password|E_SECRET/
      );
      // A backend error is not an operation failure.
      expect(reportOperationFailure).not.toHaveBeenCalled();
    } finally {
      await fixture.cleanup();
    }
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [500, undefined],
  ])(
    'reports a %i response as %s and hides the status and body',
    async (status, code) => {
      const reportOperationFailure = vi.fn();
      const session = createSession({
        url,
        threadId: 't',
        reportOperationFailure,
        fetch: async () => new Response('token=abc123', { status }),
      });
      expect(await session.submit('Go')).toBe('error');
      const snapshot = session.getSnapshot();
      expect(snapshot.error).toEqual({
        kind: 'server',
        message: PROTECTED_COPY,
        retryable: false,
        recovery: 'none',
      });
      expect(snapshot.run?.failure).toBeUndefined();
      expect(JSON.stringify(snapshot)).not.toContain('abc123');
      if (code) expect(reportOperationFailure.mock.calls).toEqual([[code]]);
      else expect(reportOperationFailure).not.toHaveBeenCalled();
      await session.dispose();
    }
  );

  it('reports a request that gets no response, and survives a reporter that throws', async () => {
    const reportOperationFailure = vi.fn(() => {
      throw new Error('reporter failed');
    });
    const session = createSession({
      url,
      threadId: 't',
      reportOperationFailure,
      fetch: async () => {
        throw new TypeError('getaddrinfo ENOTFOUND internal-host');
      },
    });
    expect(await session.submit('Go')).toBe('error');
    expect(reportOperationFailure.mock.calls).toEqual([['network_blocked']]);
    expect(JSON.stringify(session.getSnapshot())).not.toContain(
      'internal-host'
    );
    await session.dispose();
  });

  it('does not report a request the session stopped', async () => {
    const reportOperationFailure = vi.fn();
    const fixture = bindingFixture({ reportOperationFailure });
    const run = fixture.session.submit('Go');
    await fixture.started();
    await fixture.session.stop();
    expect(await run).toBe('aborted');
    expect(reportOperationFailure).not.toHaveBeenCalled();
    await fixture.cleanup();
  });

  it('keeps the classified error and status without a reporter', async () => {
    const session = createSession({
      url,
      threadId: 't',
      fetch: async () => new Response('nope', { status: 401 }),
    });
    await session.submit('Go');
    expect(session.getSnapshot().error).toMatchObject({
      kind: 'auth',
      status: 401,
    });
    expect(session.getSnapshot().run?.failure).toEqual({ status: 401 });
    await session.dispose();
  });
});

describe('protectedFetch', () => {
  it('passes a successful response through untouched', async () => {
    const response = new Response('ok');
    const report = vi.fn();
    expect(await protectedFetch(async () => response, report)('u')).toBe(
      response
    );
    expect(report).not.toHaveBeenCalled();
  });

  it('throws an AbortError, unreported, for an aborted signal before or after sending', async () => {
    const report = vi.fn();
    const controller = new AbortController();
    const send = vi.fn(async () => {
      controller.abort();
      throw new Error('aborted by caller');
    });
    await expect(
      protectedFetch(send, report)('u', { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
    await expect(
      protectedFetch(send, report)('u', { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(send).toHaveBeenCalledOnce();
    expect(report).not.toHaveBeenCalled();
  });
});

describe('devtools', () => {
  it('reports what caused each publication and which fields changed, never their values', async () => {
    const report = vi.fn();
    const fixture = bindingFixture({ devtools: { report } });
    try {
      const run = fixture.session.submit('Go');
      const first = await fixture.started();
      say(first, 'a1', 'Hi');
      finish(first);
      await run;
      const calls = report.mock.calls.map(([cause, changed]) => [
        cause,
        [...changed].sort(),
      ]);
      expect(calls[0]).toEqual(['run:start', ['messages', 'status']]);
      expect(calls).toContainEqual(['TEXT_MESSAGE_CONTENT', ['messages']]);
      expect(calls.at(-1)).toEqual(['run:end', ['messages', 'status']]);
      expect(JSON.stringify(report.mock.calls)).not.toContain('Hi');
    } finally {
      await fixture.cleanup();
    }
  });

  it('serves a scripted run in place of the network, once, under the request identifiers', async () => {
    const scripts = [
      {
        events: [
          {
            type: 'RUN_STARTED',
            threadId: 'captured-thread',
            runId: 'captured-run',
          },
          { type: 'TEXT_MESSAGE_START', messageId: 's1', role: 'assistant' },
          { type: 'TEXT_MESSAGE_CONTENT', messageId: 's1', delta: 'Scripted' },
          { type: 'TEXT_MESSAGE_END', messageId: 's1' },
          {
            type: 'RUN_FINISHED',
            threadId: 'captured-thread',
            runId: 'captured-run',
          },
        ],
      },
    ];
    const takeScriptedRun = vi.fn(() => scripts.shift() ?? null);
    const fixture = bindingFixture({ devtools: { takeScriptedRun } });
    try {
      expect(await fixture.session.submit('Go')).toBe('success');
      expect(fixture.exchanges).toHaveLength(0);
      expect(fixture.session.getSnapshot().messages.at(-1)?.content).toBe(
        'Scripted'
      );
      // Nothing is armed now: the next request reaches the network.
      const real = fixture.session.submit('Again');
      finish(await fixture.started());
      expect(await real).toBe('success');
      expect(takeScriptedRun).toHaveBeenCalledTimes(2);
    } finally {
      await fixture.cleanup();
    }
  });

  it('reports for a session with client tools too', async () => {
    const report = vi.fn();
    const session = createSession(
      {
        url,
        threadId: 't',
        devtools: { report },
        fetch: async (_url, init) => {
          const body = JSON.parse(String(init?.body));
          return sse([
            { type: 'RUN_STARTED', threadId: body.threadId, runId: body.runId },
            { type: 'RUN_ERROR', message: 'Busy' },
          ]);
        },
      },
      { f: { description: 'f', handler: () => 1 } }
    );
    expect(await session.submit('Go')).toBe('error');
    const causes = report.mock.calls.map(([cause]) => cause);
    expect(causes[0]).toBe('run:start');
    expect(causes.at(-1)).toBe('run:end');
    expect(report.mock.calls.at(-1)?.[1]).toEqual(
      expect.arrayContaining(['status', 'error', 'inputBlocked', 'clientTools'])
    );
    await session.dispose();
  });

  it('ignores a hook that throws', async () => {
    const fixture = bindingFixture({
      devtools: {
        report: () => {
          throw new Error('panel closed');
        },
        takeScriptedRun: () => {
          throw new Error('panel closed');
        },
      },
    });
    const run = fixture.session.submit('Go');
    finish(await fixture.started());
    expect(await run).toBe('success');
    await fixture.cleanup();
  });
});
