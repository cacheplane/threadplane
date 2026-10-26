import { afterEach, describe, expect, it, vi } from 'vitest';
import { FetchStreamTransport } from '../lib/transport/fetch-stream.transport';
import { createSession } from './create-session';
import type { AgentTransport } from './transport.types';

const modes = ['values', 'messages-tuple', 'updates', 'custom', 'checkpoints'];
const legacyModes = modes.slice(0, -1);
const origin = 'https://runtime.example';
const answer = { type: 'ai', id: 'answer', content: 'Canonical answer' };
const frame = (event: string, data: unknown, cursor = 'last') =>
  `id: ${cursor}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const sse = (trace: string, identify = true, thread = 't', run = 'r') =>
  new Response(trace, {
    headers: {
      'content-type': 'text/event-stream',
      ...(identify
        ? { 'content-location': `/threads/${thread}/runs/${run}` }
        : {}),
    },
  });
function completion(
  messages: unknown[],
  requested: unknown,
  checkpoint: 'root' | 'child' | 'none' = 'root'
) {
  return (
    frame('values', { messages }) +
    // An auxiliary structured model callback is not a finalized graph tool.
    frame('messages', [
      {
        type: 'AIMessageChunk',
        id: 'unsaved-schema',
        content: '',
        tool_call_chunks: [
          {
            index: 0,
            id: 'schema-call',
            name: 'schema',
            args: '{"title":"Trip"}',
          },
        ],
      },
      { langgraph_node: 'generate_title' },
    ]) +
    frame('messages', [
      { type: 'AIMessageChunk', id: 'unsaved-title', content: 'Trip title' },
      { langgraph_node: 'generate_title' },
    ]) +
    (Array.isArray(requested) &&
    requested.includes('checkpoints') &&
    checkpoint !== 'none'
      ? frame(checkpoint === 'root' ? 'checkpoints' : 'checkpoints|child:1', {
          config: {
            configurable: {
              thread_id: 't',
              checkpoint_ns: '',
              checkpoint_id: 'final',
            },
          },
          values: { messages },
          next: [],
          tasks: [],
        })
      : '')
  );
}
interface Request {
  url: string;
  method: string;
  body?: Record<string, unknown>;
  cursor: string | null;
}
function server(
  options: {
    checkpoint?: 'root' | 'child' | 'none';
    status?: string;
    readFailure?: boolean;
    unsafeIdentity?: boolean;
    identify?: boolean;
    reconnect?: boolean;
    pause?: boolean;
    tool?: boolean;
    rejectMode?: boolean;
  } = {}
) {
  const requests: Request[] = [];
  let posts = 0;
  let statusReads = 0;
  let human: unknown;
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (url, init) => {
      const request: Request = {
        url: String(url),
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        cursor: new Headers(init?.headers).get('Last-Event-ID'),
      };
      requests.push(request);
      if (
        request.method === 'POST' &&
        request.url === `${origin}/threads/t/runs/stream`
      ) {
        posts += 1;
        const body = request.body ?? {};
        const input = body['input'] as { messages?: unknown[] } | null;
        human ??= input?.messages?.[0];
        if (
          options.rejectMode &&
          Array.isArray(body['stream_mode']) &&
          body['stream_mode'].includes('checkpoints')
        )
          return Response.json(
            { detail: 'Unsupported checkpoints stream mode' },
            { status: 422 }
          );
        if (posts === 1 && options.reconnect)
          return sse(
            frame(
              'messages',
              [
                { type: 'AIMessageChunk', id: 'answer', content: 'Partial' },
                {},
              ],
              'cursor-1'
            )
          );
        if (posts === 1 && options.pause)
          return sse(
            frame('values', {
              messages: [human, { ...answer, content: 'Waiting' }],
              __interrupt__: [{ id: 'approval', value: 'Proceed?' }],
            }),
            options.identify
          );
        if (posts === 1 && options.tool)
          return sse(
            frame('values', {
              messages: [
                human,
                {
                  type: 'ai',
                  id: 'tool-request',
                  content: '',
                  tool_calls: [{ id: 'work-call', name: 'work', args: {} }],
                },
              ],
            }),
            options.identify
          );
        const trace = completion(
          [human, answer],
          body['stream_mode'],
          options.checkpoint
        );
        return sse(
          trace,
          options.identify,
          options.unsafeIdentity ? 'foreign' : 't',
          posts > 1 ? 'r-2' : 'r'
        );
      }
      const parsed = new URL(request.url);
      if (
        request.method === 'GET' &&
        parsed.pathname === '/threads/t/runs/r/stream'
      )
        return sse(
          completion(
            [human, answer],
            JSON.parse(parsed.searchParams.get('stream_mode') ?? 'null'),
            options.checkpoint
          )
        );
      // The read-only recovery check answers with nothing conclusive.
      if (request.method === 'POST' && parsed.pathname === '/threads/t/history')
        return Response.json([]);
      // Exact-run inspection only: any other state read is an unexpected failure.
      const run = posts > 1 ? 'r-2' : 'r';
      expect(request.url).toBe(`${origin}/threads/t/runs/${run}`);
      expect(request.method).toBe('GET');
      statusReads += 1;
      if (options.readFailure) return Response.json({}, { status: 503 });
      return Response.json({
        run_id: run,
        thread_id: 't',
        status:
          options.reconnect && statusReads === 1
            ? 'running'
            : options.status ?? 'success',
      });
    })
  );
  return requests;
}
const native = () =>
  createSession({ assistantId: 'a', threadId: 't', apiUrl: origin });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('owned native checkpoint stream through the real SDK', () => {
  it('requests a restoring root checkpoint after unsaved callbacks and completes without replay/history/schema execution', async () => {
    const requests = server();
    const handler = vi.fn(() => 'must not execute');
    const session = createSession({
      assistantId: 'a',
      threadId: 't',
      apiUrl: origin,
      tools: { schema: { description: 'Schema', handler } },
    });
    expect(await session.submit('Question')).toBe('success');
    expect(session.getSnapshot().status).toBe('idle');
    expect(
      session.getSnapshot().messages.find((m) => m.id === 'answer')
    ).toMatchObject({
      content: 'Canonical answer',
      delivery: { outcome: 'success' },
    });
    expect(requests.map((r) => [r.method, r.url])).toEqual([
      ['POST', `${origin}/threads/t/runs/stream`],
      ['GET', `${origin}/threads/t/runs/r`],
    ]);
    expect(requests[0].body?.['stream_mode']).toEqual(modes);
    expect(requests[0].body?.['checkpoint']).toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
    await session.dispose();
  });

  it('requests checkpoints on native resume without replaying the original input', async () => {
    const requests = server({ pause: true });
    const session = native();
    expect(await session.submit('Question')).toBe('paused');
    expect(await session.resume({ approve: false })).toBe('success');
    const posts = requests.filter((r) => r.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts.map((r) => r.body?.['stream_mode'])).toEqual([modes, modes]);
    expect(posts[1].body).toMatchObject({
      input: null,
      command: { resume: { approve: false } },
    });
    expect(requests.filter((r) => r.method === 'GET')).toHaveLength(2);
    await session.dispose();
  });

  it('requests checkpoints on each physical client tool follow-up POST', async () => {
    const requests = server({ tool: true });
    const handler = vi.fn(() => 'worked');
    const session = createSession({
      assistantId: 'a',
      threadId: 't',
      apiUrl: origin,
      tools: { work: { description: 'Work', handler } },
    });
    expect(await session.submit('Question')).toBe('success');
    const posts = requests.filter((r) => r.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts.map((r) => r.body?.['stream_mode'])).toEqual([modes, modes]);
    expect(posts[1].body?.['input']).toMatchObject({
      messages: [
        { type: 'tool', tool_call_id: 'work-call', content: 'worked' },
      ],
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(requests.filter((r) => r.method === 'GET')).toHaveLength(2);
    await session.dispose();
  });

  it('joins the same physical run with actual SDK checkpoint query and exact cursor, without a second POST', async () => {
    const requests = server({ reconnect: true });
    const session = native();
    expect(await session.submit('Question')).toBe('interrupted');
    expect(session.getSnapshot().reconnect).toEqual({ runId: 'r' });
    expect(await session.reconnect()).toBe('success');
    expect(session.getSnapshot().status).toBe('idle');
    expect(requests.map((r) => r.method)).toEqual([
      'POST',
      'GET',
      'GET',
      'GET',
    ]);
    const joined = new URL(requests[2].url);
    expect(joined.pathname).toBe('/threads/t/runs/r/stream');
    expect(joined.searchParams.get('cancel_on_disconnect')).toBe('0');
    expect(
      JSON.parse(joined.searchParams.get('stream_mode') ?? 'null')
    ).toEqual(modes);
    expect(requests[2].cursor).toBe('cursor-1');
    expect(requests[3].url).toBe(`${origin}/threads/t/runs/r`);
    await session.dispose();
  });

  it.each(['none', 'child'] as const)(
    'remains interrupted with %s restoring root checkpoint despite exact success',
    async (checkpoint) => {
      const requests = server({ checkpoint });
      const session = native();
      expect(await session.submit('Question')).toBe('interrupted');
      // Exact success without the final frames: history is read once, read-only.
      expect(requests.map((r) => [r.method, new URL(r.url).pathname])).toEqual([
        ['POST', '/threads/t/runs/stream'],
        ['GET', '/threads/t/runs/r'],
        ['POST', '/threads/t/history'],
      ]);
      expect(session.getSnapshot().error?.recovery).toBe('check');
      await session.dispose();
    }
  );

  it.each([
    'error',
    'timeout',
    'interrupted',
    'running',
    'pending',
    'read-failure',
    'unsafe-identity',
  ])(
    'cannot settle success from a checkpoint when the exact physical run is %s',
    async (status) => {
      const requests = server({
        status,
        readFailure: status === 'read-failure',
        unsafeIdentity: status === 'unsafe-identity',
      });
      const session = native();
      expect(await session.submit('Question')).toBe(
        status === 'error' || status === 'timeout' ? 'error' : 'interrupted'
      );
      // A failed or in-flight exact run is never second-guessed from history;
      // an ambiguous or unreadable one is disambiguated by one read-only read.
      const history =
        status === 'interrupted' || status === 'read-failure' ? ['POST'] : [];
      expect(requests.map((r) => r.method)).toEqual(
        status === 'unsafe-identity' ? ['POST'] : ['POST', 'GET', ...history]
      );
      await session.dispose();
    }
  );

  it('preserves identity-absent terminal checkpoint behavior', async () => {
    const requests = server({ identify: false });
    const session = native();
    expect(await session.submit('Question')).toBe('success');
    expect(requests.map((r) => r.method)).toEqual(['POST']);
    await session.dispose();
  });

  it('honestly fails a rejected checkpoint request with one POST and no mode fallback/retry', async () => {
    const requests = server({ rejectMode: true });
    const session = native();
    expect(await session.submit('Question')).toBe('error');
    expect(session.getSnapshot().status).toBe('error');
    expect(requests).toHaveLength(1);
    expect(requests[0].body?.['stream_mode']).toEqual(modes);
    await session.dispose();
  });
});

describe('supplied transport and legacy contracts', () => {
  it('keeps ordinary supplied stream arguments unchanged', async () => {
    const stream = vi.fn<AgentTransport['stream']>(async function* () {
      yield { type: 'values', data: { messages: [answer] } };
    });
    const session = createSession({
      assistantId: 'a',
      threadId: 't',
      transport: { stream },
    });
    expect(await session.submit('Question')).toBe('success');
    expect(stream.mock.calls[0]).toEqual([
      'a',
      't',
      expect.objectContaining({ messages: expect.any(Array) }),
      expect.any(AbortSignal),
      undefined,
    ]);
    await session.dispose();
  });

  it('keeps supplied reconnect arguments unchanged with no fifth join argument', async () => {
    const stream = vi.fn<AgentTransport['stream']>(async function* (
      _a,
      _t,
      _input,
      _signal,
      options
    ) {
      options?.onRunCreated?.({ run_id: 'r', thread_id: 't' });
      yield {
        type: 'messages',
        sseId: 'cursor-1',
        messageMetadata: {},
        messages: [
          { type: 'AIMessageChunk', id: 'answer', content: 'Partial' },
        ],
      };
    });
    const joinStream = vi.fn<NonNullable<AgentTransport['joinStream']>>(
      async function* () {
        yield { type: 'values', data: { messages: [answer] } };
      }
    );
    const getRunStatus = vi.fn(async () => 'running' as const);
    const session = createSession({
      assistantId: 'a',
      threadId: 't',
      transport: { stream, joinStream, getRunStatus },
    });
    expect(await session.submit('Question')).toBe('interrupted');
    expect(stream.mock.calls[0]).toHaveLength(5);
    expect(stream.mock.calls[0][4]).toEqual({
      streamResumable: true,
      onDisconnect: 'continue',
      onRunCreated: expect.any(Function),
    });
    expect(await session.reconnect()).toBe('interrupted');
    expect(joinStream.mock.calls[0]).toEqual([
      't',
      'r',
      'cursor-1',
      expect.any(AbortSignal),
    ]);
    await session.dispose();
  });

  it('treats a caller supplied FetchStreamTransport as supplied for stream and join', async () => {
    const requests = server({ reconnect: true });
    const transport = new FetchStreamTransport(origin, undefined, {
      maxRetries: 0,
    });
    const stream = vi.spyOn(transport, 'stream');
    const join = vi.spyOn(transport, 'joinStream');
    const session = createSession({
      assistantId: 'a',
      threadId: 't',
      transport,
    });
    expect(await session.submit('Question')).toBe('interrupted');
    expect(await session.reconnect()).toBe('interrupted');
    expect(stream.mock.calls[0][4]).toEqual({
      streamResumable: true,
      onDisconnect: 'continue',
      onRunCreated: expect.any(Function),
    });
    expect(join.mock.calls[0]).toEqual([
      't',
      'r',
      'cursor-1',
      expect.any(AbortSignal),
    ]);
    expect(requests[0].body?.['stream_mode']).toEqual(legacyModes);
    expect(new URL(requests[2].url).searchParams.has('stream_mode')).toBe(
      false
    );
    expect(
      requests.filter((r) => r.url === `${origin}/threads/t/runs/stream`)
    ).toHaveLength(1);
    await session.dispose();
  });

  it('leaves the direct legacy FetchStreamTransport default at four modes', async () => {
    const requests = server({ identify: false });
    const transport = new FetchStreamTransport(origin, undefined, {
      maxRetries: 0,
    });
    for await (const event of transport.stream(
      'a',
      't',
      { messages: [] },
      new AbortController().signal
    ))
      void event;
    expect(requests).toHaveLength(1);
    expect(requests[0].body?.['stream_mode']).toEqual(legacyModes);
  });
});
