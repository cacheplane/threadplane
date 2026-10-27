import { createServer, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@threadplane/core/tools';
import type { BookingArguments } from './tools';
import { createSession } from '@threadplane/ag-ui';
import type { RunAgentInput } from '@ag-ui/client';
import {
  createClientToolsApplication,
  type Tools,
  type NativeSnapshot,
} from './application';

const disposals: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
  vi.restoreAllMocks();
});
async function until(check: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Synthetic native fixture milestone timeout');
}
// Controlled SDK fetch/SSE seam, deliberately synthetic. Canonical provider proof belongs to B3.
function fixture(
  transform?: (snapshot: NativeSnapshot) => NativeSnapshot,
  onBooking?: () => void
) {
  const requests: {
    body: RunAgentInput;
    send: (...events: unknown[]) => void;
    end: () => void;
  }[] = [];
  const fetch = vi.fn(
    async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as RunAgentInput;
      let stream!: ReadableStreamDefaultController<Uint8Array>;
      const response = new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            stream = c;
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } }
      );
      requests.push({
        body,
        end() {
          stream.close();
        },
        send(...events) {
          for (const event of events)
            stream.enqueue(
              new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)
            );
        },
      });
      return response;
    }
  );
  const factory = vi.fn((threadId: string, tools: Tools) => {
    const session = createSession(
      { threadId, url: 'http://synthetic.invalid/agent', fetch },
      onBooking
        ? {
            ...tools,
            confirm_booking: {
              ...tools.confirm_booking,
              handler(input: BookingArguments, context: ExecutionContext) {
                onBooking();
                return tools.confirm_booking.handler(input, context);
              },
            },
          }
        : tools
    );
    return transform
      ? { ...session, getSnapshot: () => transform(session.getSnapshot()) }
      : session;
  });
  const app = createClientToolsApplication({ sessionFactory: factory });
  disposals.push(() => {
    void app.dispose();
  });
  async function next(index = 0) {
    await until(() => requests.length > index);
    return requests[index];
  }
  function finish(index: number, name?: string, args: unknown = {}) {
    const request = requests[index];
    const { threadId, runId, messages } = request.body;
    request.send(
      { type: 'RUN_STARTED', threadId, runId },
      {
        type: 'MESSAGES_SNAPSHOT',
        messages: [
          ...messages,
          name
            ? {
                id: `assistant-${index}`,
                role: 'assistant',
                toolCalls: [
                  {
                    id: `call-${index}`,
                    type: 'function',
                    function: { name, arguments: JSON.stringify(args) },
                  },
                ],
              }
            : {
                id: `answer-${index}`,
                role: 'assistant',
                content: 'Literal answer',
              },
        ],
      },
      { type: 'RUN_FINISHED', threadId, runId }
    );
  }
  return { app, factory, fetch, requests, next, finish };
}
const weather = {
  location: 'Paris',
  temperatureF: 68,
  conditions: 'Sunny',
  humidity: 55,
  windMph: 8,
};
describe('application with actual native owner and synthetic SDK SSE', () => {
  it('constructs and subscribes inertly, lazily creates exactly one typed catalog and UUID on explicit Send', async () => {
    const uuid = vi.spyOn(crypto, 'randomUUID');
    const f = fixture();
    const notify = vi.fn();
    f.app.subscribe(notify);
    expect(f.factory).not.toHaveBeenCalled();
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.app.getSnapshot().threadId).toBeNull();
    expect(uuid).not.toHaveBeenCalled();
    await f.app.submit('   ');
    expect(f.factory).not.toHaveBeenCalled();
    const done = f.app.submit('  authored text  ');
    await f.next();
    expect(f.factory).toHaveBeenCalledTimes(1);
    expect(f.factory.mock.calls[0][0]).toBe(uuid.mock.results[0].value);
    expect(Object.keys(f.factory.mock.calls[0][1])).toHaveLength(5);
    expect(f.requests[0].body.threadId).toMatch(/^[0-9a-f-]{36}$/);
    expect(f.requests[0].body.messages[0]).toMatchObject({
      role: 'user',
      content: '  authored text  ',
    });
    await f.app.submit('ignored busy');
    expect(f.requests).toHaveLength(1);
    f.finish(0);
    await done;
    expect(f.app.getSnapshot()).toMatchObject({
      busy: false,
      canSubmit: true,
      outcome: 'success',
    });
  });
  it.each([true, false])(
    'binds the actual running booking and sends exactly one native continuation after %s',
    async (confirmed) => {
      const f = fixture();
      const done = f.app.submit('Booking');
      await f.next();
      f.finish(0, 'confirm_booking', { summary: 'Fictional table' });
      await until(() => f.app.getSnapshot().bookings.length === 1);
      const panel = f.app.getSnapshot().bookings[0];
      expect(panel).toMatchObject({
        callId: 'call-0',
        assistantMessageId: 'assistant-0',
        sourceRunId: f.requests[0].body.runId,
        summary: 'Fictional table',
        status: 'pending',
      });
      expect(f.app.respond('wrong', confirmed)).toBe(false);
      expect(f.requests).toHaveLength(1);
      expect(f.app.respond(panel.token, confirmed)).toBe(true);
      expect(f.app.respond(panel.token, !confirmed)).toBe(false);
      await f.next(1);
      expect(f.requests[1].body.threadId).toBe(f.requests[0].body.threadId);
      expect(f.requests[1].body.runId).not.toBe(f.requests[0].body.runId);
      expect(
        f.requests[1].body.messages.filter((m) => m.role === 'user')
      ).toHaveLength(1);
      expect(
        f.requests[1].body.messages.filter((m) => m.role === 'tool')
      ).toEqual([
        expect.objectContaining({
          toolCallId: 'call-0',
          content: JSON.stringify({ confirmed }),
        }),
      ]);
      f.finish(1);
      await done;
      expect(f.app.getSnapshot().canSubmit).toBe(true);
    }
  );
  it('terminal snapshot succeeds with one POST and unsent local result retained in the next human request', async () => {
    const f = fixture();
    const done = f.app.submit('Snapshot');
    await f.next();
    f.finish(0, 'weather_snapshot', weather);
    await done;
    expect(f.requests).toHaveLength(1);
    expect(f.app.getSnapshot()).toMatchObject({
      canSubmit: true,
      outcome: 'success',
    });
    expect(f.app.getSnapshot().native?.clientTools.calls[0]).toMatchObject({
      status: 'complete',
      delivery: 'unsent',
      result: { displayed: true },
    });
    expect(f.app.getSnapshot().views[1].tools[0].weather).toEqual(weather);
    const next = f.app.submit('Next human');
    await f.next(1);
    expect(
      f.requests[1].body.messages.filter((m) => m.role === 'tool')
    ).toHaveLength(1);
    expect(
      f.requests[1].body.messages.filter((m) => m.role === 'user')
    ).toHaveLength(2);
    f.finish(1);
    await next;
  });
  it.each(['get_weather', 'weather_card'])(
    'projects completed local %s and leaves continuation entirely native',
    async (name) => {
      const f = fixture();
      const done = f.app.submit('Weather');
      await f.next();
      f.finish(
        0,
        name,
        name === 'get_weather' ? { location: 'Paris' } : weather
      );
      await f.next(1);
      f.finish(1);
      await done;
      expect(f.app.getSnapshot().views[1].tools[0].weather).toEqual(weather);
      expect(f.app.getSnapshot().native?.clientTools.calls[0].delivery).toBe(
        'observed'
      );
      expect(f.requests).toHaveLength(2);
    }
  );
  it('reentrant Stop during running publication revokes authority before native invokes booking', async () => {
    const invoked = vi.fn();
    const f = fixture(undefined, invoked);
    f.app.subscribe(() => {
      if (
        f.app
          .getSnapshot()
          .native?.clientTools.calls.some((c) => c.status === 'running')
      )
        void f.app.stop();
    });
    const done = f.app.submit('Booking');
    await f.next();
    f.finish(0, 'confirm_booking', { summary: 'Fictional' });
    await done;
    expect(f.app.getSnapshot().bookings).toHaveLength(0);
    expect(invoked).not.toHaveBeenCalled();
    expect(f.app.getSnapshot().canSubmit).toBe(false);
    expect(f.requests).toHaveLength(1);
  });
  it('Stop revokes pending controls, New clears ownership and old controls cannot affect the next session', async () => {
    const f = fixture();
    const done = f.app.submit('Booking');
    await f.next();
    f.finish(0, 'confirm_booking', { summary: 'Fictional' });
    await until(() => f.app.getSnapshot().bookings.length > 0);
    const old = f.app.getSnapshot().bookings[0];
    const thread = f.app.getSnapshot().threadId;
    await f.app.stop();
    await done;
    expect(f.app.respond(old.token, false)).toBe(false);
    expect(f.app.getSnapshot().bookings[0]).toMatchObject({
      status: 'aborted',
    });
    await f.app.newConversation();
    expect(f.app.getSnapshot()).toMatchObject({
      threadId: null,
      native: undefined,
      bookings: [],
      views: [],
      error: null,
      canSubmit: true,
      viewGeneration: 1,
    });
    const next = f.app.submit('new');
    await f.next(1);
    expect(f.app.getSnapshot().threadId).not.toBe(thread);
    expect(f.app.respond(old.token, true)).toBe(false);
    f.finish(1);
    await next;
  });
  it('Stop cancels a slow tool without stale result or native continuation', async () => {
    const f = fixture();
    const done = f.app.submit('Slow');
    await f.next();
    f.finish(0, 'slow_status_check', {});
    await until(
      () =>
        !!f.app
          .getSnapshot()
          .native?.clientTools.calls.some((c) => c.status === 'running')
    );
    await f.app.stop();
    await done;
    expect(f.requests).toHaveLength(1);
    expect(
      f.app.getSnapshot().native?.clientTools.calls[0].result
    ).toBeUndefined();
  });
  it.each([
    ['unknown', {}],
    ['weather_card', { location: 'partial' }],
  ])('requires New after unsupported or invalid %s', async (name, args) => {
    const f = fixture();
    const done = f.app.submit('negative');
    await f.next();
    f.finish(0, String(name), args);
    if (name === 'weather_card') {
      await f.next(1);
      f.finish(1);
    }
    await done;
    expect(f.app.getSnapshot().canSubmit).toBe(false);
    await f.app.submit('no replay');
    expect(f.requests).toHaveLength(name === 'weather_card' ? 2 : 1);
  });
  it('subscriber exceptions cannot strand command settlement or cleanup', async () => {
    const f = fixture();
    f.app.subscribe(() => {
      throw new Error('view error');
    });
    const done = f.app.submit('Plain');
    await f.next();
    f.finish(0);
    await done;
    expect(f.app.getSnapshot().busy).toBe(false);
    await f.app.dispose();
    await f.app.dispose();
  });
  it('reentrant disposal during admission prevents factory and transport effects', async () => {
    const f = fixture();
    f.app.subscribe(() => {
      if (f.app.getSnapshot().busy) void f.app.dispose();
    });
    await f.app.submit('never');
    expect(f.factory).not.toHaveBeenCalled();
    expect(f.fetch).not.toHaveBeenCalled();
  });
});

// Focused lifecycle seam negatives; these do not claim canonical provider proof.
it('throwing factory leaves a blocked idle app with no thread until explicit New', async () => {
  const app = createClientToolsApplication({
    sessionFactory() {
      throw new Error('SECRET factory');
    },
  });
  await app.submit('one');
  expect(app.getSnapshot()).toMatchObject({
    threadId: null,
    busy: false,
    canSubmit: false,
    outcome: 'error',
  });
  expect(app.getSnapshot().error).not.toContain('SECRET');
  await app.newConversation();
  expect(app.getSnapshot().canSubmit).toBe(true);
  await app.dispose();
});
it('throwing native read, subscription and lifecycle never prevents observed cleanup', async () => {
  const dispose = vi.fn(() => Promise.reject(new Error('cleanup')));
  const stop = vi.fn(() => {
    throw new Error('stop');
  });
  const app = createClientToolsApplication({
    sessionFactory(threadId, tools) {
      const native = createSession(
        { threadId, url: 'http://synthetic.invalid/never' },
        tools
      );
      return {
        ...native,
        subscribe() {
          throw new Error('subscribe');
        },
        getSnapshot() {
          throw new Error('read');
        },
        stop,
        dispose,
      };
    },
  });
  await app.submit('one');
  expect(app.getSnapshot()).toMatchObject({
    busy: false,
    canSubmit: false,
    outcome: 'error',
  });
  expect(dispose).toHaveBeenCalledOnce();
  expect(stop).toHaveBeenCalledOnce();
  await app.dispose();
});
it('reentrant Stop in submit method access prevents invoking that revoked method', async () => {
  const submit = vi.fn(async () => 'success' as const);
  const app = createClientToolsApplication({
    sessionFactory(threadId, tools) {
      const native = createSession(
        { threadId, url: 'http://synthetic.invalid/never' },
        tools
      );
      return {
        ...native,
        get submit() {
          void app.stop();
          return submit;
        },
      };
    },
  });
  await app.submit('one');
  expect(submit).not.toHaveBeenCalled();
  expect(app.getSnapshot().canSubmit).toBe(false);
  await app.dispose();
});
it('disposal promptly observes noncooperative lifecycle rejection without awaiting it', async () => {
  let reject!: (error: unknown) => void;
  const hung = new Promise<void>((_yes, no) => {
    reject = no;
  });
  const app = createClientToolsApplication({
    sessionFactory(threadId, tools) {
      const native = createSession(
        { threadId, url: 'http://synthetic.invalid/never' },
        tools
      );
      return {
        ...native,
        submit: async () => 'interrupted',
        stop: () => hung,
        dispose: () => hung,
      };
    },
  });
  await app.submit('one');
  await app.dispose();
  reject(new Error('late cleanup'));
  await Promise.resolve();
});

it.each(['ambiguous', 'wrong-run', 'missing', 'invalid-args'] as const)(
  'actual booking invocation rejects %s current native accessor evidence',
  async (mode) => {
    const f = fixture((native) => {
      const running = native.clientTools.calls.find(
        (call) => call.name === 'confirm_booking' && call.status === 'running'
      );
      if (!running || running.name !== 'confirm_booking') return native;
      const calls =
        mode === 'ambiguous'
          ? [...native.clientTools.calls, running]
          : mode === 'missing'
          ? []
          : [
              {
                ...running,
                ...(mode === 'wrong-run'
                  ? { sourceRunId: 'outsider-run' }
                  : { args: { summary: '' } }),
              },
            ];
      return { ...native, clientTools: { ...native.clientTools, calls } };
    });
    const done = f.app.submit('Booking');
    await f.next();
    f.finish(0, 'confirm_booking', { summary: 'Fictional' });
    await f.next(1);
    f.finish(1);
    await done;
    expect(f.app.getSnapshot().bookings).toHaveLength(0);
    expect(f.app.getSnapshot().canSubmit).toBe(false);
  }
);
it('native pause requires explicit New and application never resumes it', async () => {
  const f = fixture();
  const done = f.app.submit('Pause');
  const first = await f.next();
  first.send(
    {
      type: 'RUN_STARTED',
      threadId: first.body.threadId,
      runId: first.body.runId,
    },
    {
      type: 'RUN_FINISHED',
      threadId: first.body.threadId,
      runId: first.body.runId,
      outcome: {
        type: 'interrupt',
        interrupts: [{ id: 'pause', reason: 'Approval' }],
      },
    }
  );
  await done;
  expect(f.app.getSnapshot().native?.decision?.kind).toBe('native');
  expect(f.app.getSnapshot().canSubmit).toBe(false);
  await f.app.submit('no resume');
  expect(f.requests).toHaveLength(1);
});
it('uncertain native continuation preserves local sent-unconfirmed evidence and requires New', async () => {
  const f = fixture();
  const done = f.app.submit('Weather');
  await f.next();
  f.finish(0, 'get_weather', { location: 'Paris' });
  const next = await f.next(1);
  next.end();
  await done;
  expect(f.app.getSnapshot().canSubmit).toBe(false);
  expect(f.app.getSnapshot().native?.clientTools.calls[0]).toMatchObject({
    status: 'complete',
    delivery: 'sent-unconfirmed',
  });
  expect(f.app.getSnapshot().native?.clientTools.blocker?.reason).toBe(
    'uncertain'
  );
});
it('child-attributed native calls remain observations and do not authorize local weather', async () => {
  const f = fixture();
  const done = f.app.submit('Child');
  const first = await f.next();
  first.send(
    {
      type: 'RUN_STARTED',
      threadId: first.body.threadId,
      runId: first.body.runId,
    },
    {
      type: 'MESSAGES_SNAPSHOT',
      messages: [
        ...first.body.messages,
        {
          id: 'child-assistant',
          role: 'assistant',
          subagentRunId: 'child',
          toolCalls: [
            {
              id: 'child-call',
              type: 'function',
              function: {
                name: 'weather_snapshot',
                arguments: JSON.stringify(weather),
              },
            },
          ],
        },
      ],
    },
    {
      type: 'RUN_FINISHED',
      threadId: first.body.threadId,
      runId: first.body.runId,
    }
  );
  await done;
  expect(f.app.getSnapshot().native?.clientTools.calls).toHaveLength(0);
  expect(f.app.getSnapshot().views.flatMap((row) => row.tools)).toEqual([
    expect.objectContaining({ id: 'child-call', name: 'weather_snapshot' }),
  ]);
  expect(
    f.app.getSnapshot().views.flatMap((row) => row.tools)[0].local
  ).toBeUndefined();
  expect(f.app.getSnapshot().canSubmit).toBe(false);
});
it('factory reentrant Stop disposes the returned native candidate without submitting', async () => {
  const submit = vi.fn(async () => 'success' as const),
    dispose = vi.fn(async () => undefined);
  const app = createClientToolsApplication({
    sessionFactory(threadId, tools) {
      void app.stop();
      const native = createSession(
        { threadId, url: 'http://synthetic.invalid/never' },
        tools
      );
      return { ...native, submit, dispose };
    },
  });
  await app.submit('one');
  expect(submit).not.toHaveBeenCalled();
  expect(dispose).toHaveBeenCalledOnce();
  await app.newConversation();
  expect(app.getSnapshot().threadId).toBeNull();
  await app.dispose();
});
it('getSnapshot method access that stops the app cannot invoke a revoked read', async () => {
  let armed = false;
  const read = vi.fn(() => {
    throw new Error('revoked read');
  });
  const app = createClientToolsApplication({
    sessionFactory(threadId, tools) {
      const native = createSession(
        { threadId, url: 'http://synthetic.invalid/never' },
        tools
      );
      return {
        ...native,
        get getSnapshot() {
          if (armed) {
            void app.stop();
            return read;
          }
          return native.getSnapshot;
        },
        submit() {
          armed = true;
          return Promise.resolve('success' as const);
        },
      };
    },
  });
  await app.submit('one');
  expect(read).not.toHaveBeenCalled();
  expect(app.getSnapshot().canSubmit).toBe(false);
  await app.dispose();
});
// Compile-only frozen application and heterogeneous native contracts proof.
export function checkApplicationTypes(
  app: ReturnType<typeof createClientToolsApplication>
) {
  const state = app.getSnapshot();
  // @ts-expect-error App snapshots are readonly.
  state.busy = false;
  // @ts-expect-error Booking observations are readonly arrays.
  state.bookings.push({});
  // @ts-expect-error Message projections are readonly arrays.
  state.views.push({});
  for (const call of state.native?.clientTools.calls ?? []) {
    if (call.name === 'confirm_booking') {
      const confirmed: boolean | undefined = call.result?.confirmed;
      void confirmed;
      // @ts-expect-error Booking does not widen to weather fields.
      void call.args?.location;
    }
  }
}

it('actual native SDK over loopback HTTP preserves terminal result and owns exactly one booking continuation (synthetic HTTP fixture)', async () => {
  const requests: { body: RunAgentInput; response: ServerResponse }[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.flushHeaders();
    requests.push({
      body: JSON.parse(Buffer.concat(chunks).toString()) as RunAgentInput,
      response,
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const app = createClientToolsApplication({
    sessionFactory(threadId, tools) {
      return createSession(
        {
          threadId,
          url: `http://127.0.0.1:${
            (server.address() as AddressInfo).port
          }/synthetic`,
        },
        tools
      );
    },
  });
  function finish(index: number, name?: string, args: unknown = {}) {
    const { body, response } = requests[index];
    const message = name
      ? {
          id: `http-assistant-${index}`,
          role: 'assistant',
          toolCalls: [
            {
              id: `http-call-${index}`,
              type: 'function',
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        }
      : {
          id: `http-answer-${index}`,
          role: 'assistant',
          content: 'Synthetic HTTP answer',
        };
    for (const event of [
      { type: 'RUN_STARTED', threadId: body.threadId, runId: body.runId },
      { type: 'MESSAGES_SNAPSHOT', messages: [...body.messages, message] },
      { type: 'RUN_FINISHED', threadId: body.threadId, runId: body.runId },
    ])
      response.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  try {
    expect(requests).toHaveLength(0);
    const first = app.submit('Terminal');
    await until(() => requests.length === 1);
    finish(0, 'weather_snapshot', weather);
    await first;
    expect(requests).toHaveLength(1);
    expect(app.getSnapshot().canSubmit).toBe(true);
    expect(app.getSnapshot().native?.clientTools.calls[0].delivery).toBe(
      'unsent'
    );
    const second = app.submit('Booking');
    await until(() => requests.length === 2);
    expect(
      requests[1].body.messages.filter((message) => message.role === 'tool')
    ).toHaveLength(1);
    finish(1, 'confirm_booking', { summary: 'HTTP fictional table' });
    await until(() => app.getSnapshot().bookings.length === 1);
    const panel = app.getSnapshot().bookings[0];
    expect(panel.callId).toBe('http-call-1');
    expect(app.respond(panel.token, true)).toBe(true);
    await until(() => requests.length === 3);
    expect(requests[2].body.threadId).toBe(requests[1].body.threadId);
    expect(requests[2].body.runId).not.toBe(requests[1].body.runId);
    expect(
      requests[2].body.messages.filter((message) => message.role === 'user')
    ).toHaveLength(2);
    expect(requests[2].body.tools.map((tool) => tool.name)).toEqual([
      'get_weather',
      'slow_status_check',
      'weather_card',
      'weather_snapshot',
      'confirm_booking',
    ]);
    finish(2);
    await second;
    expect(app.getSnapshot().canSubmit).toBe(true);
  } finally {
    await app.dispose();
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
  }
});
it('New excludes reentrant Send from native lifecycle before clearing the old display (focused lifecycle seam)', async () => {
  const submit = vi.fn(async () => 'success' as const),
    factory = vi.fn();
  let armed = false;
  const app = createClientToolsApplication({
    sessionFactory(threadId, tools) {
      factory();
      const native = createSession(
        { threadId, url: 'http://synthetic.invalid/never' },
        tools
      );
      return {
        ...native,
        getSnapshot() {
          const snapshot = native.getSnapshot();
          return {
            ...snapshot,
            clientTools: {
              ...snapshot.clientTools,
              commandOutcome: 'success' as const,
            },
          };
        },
        submit,
        stop: async () => {
          if (armed) void app.submit('reentrant lifecycle');
        },
        dispose: async () => {
          if (armed) void app.submit('reentrant cleanup');
        },
      };
    },
  });
  await app.submit('first');
  expect(app.getSnapshot().canSubmit).toBe(true);
  armed = true;
  await app.newConversation();
  expect(submit).toHaveBeenCalledTimes(1);
  expect(factory).toHaveBeenCalledTimes(1);
  expect(app.getSnapshot()).toMatchObject({
    threadId: null,
    native: undefined,
    busy: false,
    canSubmit: true,
  });
  await app.dispose();
});
it('settlement eligibility getter Stop cannot be overwritten by stale successful publication (synthetic SDK seam)', async () => {
  let armed = true;
  const f = fixture(
    (native) =>
      new Proxy(native, {
        get(target, key, receiver) {
          if (
            key === 'status' &&
            armed &&
            target.status === 'idle' &&
            target.clientTools.commandOutcome === 'success'
          ) {
            armed = false;
            void f.app.stop();
          }
          return Reflect.get(target, key, receiver);
        },
      })
  );
  const done = f.app.submit('settle');
  await f.next();
  f.finish(0);
  await done;
  expect(armed).toBe(false);
  expect(f.app.getSnapshot()).toMatchObject({
    busy: false,
    canSubmit: false,
    outcome: 'aborted',
  });
  expect(f.app.getSnapshot().error).toContain('stopped');
});
it('initial admission eligibility getter New cannot be overwritten by stale rejection (synthetic SDK seam)', async () => {
  let armed = false;
  const f = fixture(
    (native) =>
      new Proxy(native, {
        get(target, key, receiver) {
          if (key === 'status' && armed && target.status === 'idle') {
            armed = false;
            void f.app.newConversation();
            return 'error';
          }
          return Reflect.get(target, key, receiver);
        },
      })
  );
  const done = f.app.submit('first');
  await f.next();
  f.finish(0);
  await done;
  armed = true;
  await f.app.submit('revoked');
  expect(armed).toBe(false);
  expect(f.app.getSnapshot()).toMatchObject({
    busy: false,
    canSubmit: true,
    outcome: null,
    error: null,
    threadId: null,
    native: undefined,
    viewGeneration: 1,
  });
  expect(f.requests).toHaveLength(1);
});
it('subscribe method access Stop prevents invoking a revoked subscription (focused lifecycle seam)', async () => {
  const subscribe = vi.fn((notify: () => void) => {
    void notify;
    return () => undefined;
  });
  const app = createClientToolsApplication({
    sessionFactory(threadId, tools) {
      const native = createSession(
        { threadId, url: 'http://synthetic.invalid/never' },
        tools
      );
      return {
        ...native,
        get subscribe() {
          void app.stop();
          return subscribe;
        },
      };
    },
  });
  await app.submit('one');
  expect(subscribe).not.toHaveBeenCalled();
  await app.dispose();
});
it('factory method access Stop prevents invoking a revoked factory (focused lifecycle seam)', async () => {
  const factory = vi.fn((threadId: string, tools: Tools) =>
    createSession({ threadId, url: 'http://synthetic.invalid/never' }, tools)
  );
  const app = createClientToolsApplication({
    get sessionFactory() {
      void app.stop();
      return factory;
    },
  });
  await app.submit('one');
  expect(factory).not.toHaveBeenCalled();
  await app.dispose();
});

it('reentrant Stop during replacement publication retains Stop and a later New resets explicitly', async () => {
  const factory = vi.fn((threadId: string, tools: Tools) =>
    createSession({ threadId, url: 'http://synthetic.invalid/never' }, tools)
  );
  const app = createClientToolsApplication({ sessionFactory: factory });
  let armed = true;
  app.subscribe(() => {
    if (armed && app.getSnapshot().activity === 'replacing') {
      armed = false;
      void app.stop();
    }
  });
  await app.newConversation();
  expect(factory).not.toHaveBeenCalled();
  expect(app.getSnapshot()).toMatchObject({
    busy: false,
    canSubmit: false,
    outcome: 'aborted',
    viewGeneration: 0,
  });
  await app.newConversation();
  expect(app.getSnapshot()).toMatchObject({
    busy: false,
    canSubmit: true,
    outcome: null,
    viewGeneration: 1,
  });
  await app.dispose();
});
