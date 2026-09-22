import { readFileSync } from 'node:fs';
import { ReadableStream, ReadableStreamDefaultReader } from 'node:stream/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FetchStreamTransport } from '../lib/transport/fetch-stream.transport';
import type { StreamEvent } from './transport.types';
import { createSession, type SessionOptions } from './create-session';
import type { ToolExecutionStore } from '@threadplane/core/tools';

const textTrace = readFileSync(
  new URL(
    '../../../../fixtures/react-parity/traces/langgraph-text-state.sse',
    import.meta.url
  ),
  'utf8'
);
const toolCall = {
  type: 'ai',
  id: 'assistant-tool',
  content: '',
  tool_calls: [
    {
      id: 'call-weather',
      name: 'weather',
      args: { city: 'Paris' },
      type: 'tool_call',
    },
  ],
};
const toolResult = {
  type: 'tool',
  id: 'tool-result',
  tool_call_id: 'call-weather',
  name: 'weather',
  content: 'Sunny',
};
const toolTrace = `event: messages\ndata: ${JSON.stringify([
  toolCall,
  { langgraph_node: 'assistant' },
])}\n\nevent: values\ndata: ${JSON.stringify({
  messages: [toolCall, toolResult],
})}\n\n`;

function fragmentedResponse(trace: string): Response {
  const bytes = new TextEncoder().encode(trace);
  let offset = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (offset === bytes.length) return controller.close();
        controller.enqueue(bytes.slice(offset, offset + 3));
        offset = Math.min(offset + 3, bytes.length);
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } }
  );
}

async function collect(
  events: AsyncIterable<StreamEvent>
): Promise<StreamEvent[]> {
  const result: StreamEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}

describe('neutral real SDK transport', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('recognizes an actual SDK empty interrupt control as a messageless breakpoint', async () => {
    const request = vi.fn<typeof fetch>(async (url) => {
      expect(String(url)).toBe('https://runtime.example/threads/t/runs/stream');
      return fragmentedResponse(
        'event: values\ndata: {"__interrupt__":[]}\n\n'
      );
    });
    vi.stubGlobal('fetch', request);
    const session = createSession({
      assistantId: 'a',
      threadId: 't',
      apiUrl: 'https://runtime.example',
    });
    try {
      expect(await session.submit('Pause')).toBe('paused');
      expect(session.getSnapshot().interrupts).toEqual([
        { when: 'breakpoint' },
      ]);
      expect(session.getSnapshot().status).toBe('idle');
      expect(session.getSnapshot().messages).toHaveLength(1);
      expect(request).toHaveBeenCalledTimes(1);
    } finally {
      await session.dispose();
    }
  });

  it('observes real SDK values and updates interrupt batches and history tasks without extra I/O', async () => {
    const item = {
      id: 'a',
      value: { prompt: ['Approve'] },
      namespace: ['root'],
      when: 'during',
      resumable: false,
      ns: ['legacy'],
    };
    const history = [
      {
        values: {
          count: 2,
          messages: [{ type: 'ai', id: 'saved', content: 'Saved' }],
        },
        next: ['approval'],
        tasks: [
          {
            id: 'task-a',
            name: 'a',
            interrupts: [{ id: 'history-a', value: false }],
          },
          {
            id: 'task-b',
            name: 'b',
            interrupts: [{ id: 'history-b', value: 0 }],
          },
        ],
        metadata: null,
        created_at: null,
        checkpoint: {
          thread_id: 't',
          checkpoint_id: 'c',
          checkpoint_ns: '',
          checkpoint_map: {},
        },
        parent_checkpoint: null,
      },
    ];
    const trace = [
      [
        'values',
        { type: 'domain', namespace: ['application'], __interrupt__: [item] },
      ],
      [
        'updates',
        {
          __interrupt__: [
            { id: 'a', value: 'duplicate' },
            { id: 'b', value: 0 },
          ],
        },
      ],
      ['values|child', { namespace: [], __interrupt__: [{ id: 'ignored' }] }],
    ]
      .map(
        ([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
      )
      .join('');
    const request = vi.fn<typeof fetch>(async (url, init) => {
      expect(init?.method).toBe('POST');
      if (String(url).endsWith('/history')) {
        expect(JSON.parse(String(init?.body))).toEqual({ limit: 10 });
        return new Response(JSON.stringify(history), {
          headers: { 'content-type': 'application/json' },
        });
      }
      expect(String(url)).toBe('https://runtime.example/threads/t/runs/stream');
      return fragmentedResponse(trace);
    });
    vi.stubGlobal('fetch', request);
    const session = createSession({
      assistantId: 'a',
      threadId: 't',
      apiUrl: 'https://runtime.example',
    });
    try {
      expect(await session.submit('Go')).toBe('paused');
      expect(session.getSnapshot().interrupts).toEqual([
        item,
        { id: 'b', value: 0 },
      ]);
      expect(request).toHaveBeenCalledTimes(1);
      await session.load?.();
      expect(session.getSnapshot().interrupts).toEqual([
        { id: 'history-a', value: false },
        { id: 'history-b', value: 0 },
      ]);
      expect(session.getSnapshot().values).toEqual({ count: 2 });
      expect(session.getSnapshot().messages[0].delivery).toMatchObject({
        outcome: 'paused',
      });
      expect(request).toHaveBeenCalledTimes(2);
    } finally {
      await session.dispose();
    }
  });

  it('keeps SDK routing authoritative while exposing colliding application keys', async () => {
    const root = {
      type: 'domain',
      namespace: ['application'],
      stage: 'root',
      messages: [{ type: 'ai', id: 'answer', content: 'Root' }],
    };
    const child = {
      type: 'values',
      namespace: [],
      stage: 'child',
      messages: [{ type: 'ai', id: 'child', content: 'Child' }],
    };
    const request = vi.fn<typeof fetch>(async (url) =>
      String(url).endsWith('/history')
        ? new Response('[]')
        : fragmentedResponse(
            `event: values\ndata: ${JSON.stringify(
              root
            )}\n\nevent: values|child\ndata: ${JSON.stringify(child)}\n\n`
          )
    );
    vi.stubGlobal('fetch', request);
    const session = createSession({
      assistantId: 'a',
      threadId: 't',
      apiUrl: 'https://runtime.example',
    });
    try {
      expect(await session.submit('Go')).toBe('success');
      expect(session.getSnapshot()).toMatchObject({
        values: { type: 'domain', namespace: ['application'], stage: 'root' },
      });
      expect(session.getSnapshot().messages.at(-1)?.content).toBe('Root');
      expect(request).toHaveBeenCalledTimes(1);
    } finally {
      await session.dispose();
    }
  });

  it('does not treat application messageMetadata as message-chunk routing', async () => {
    const request = vi.fn<typeof fetch>(async () =>
      fragmentedResponse(
        ['First', 'Second']
          .map(
            (content) =>
              `event: values\ndata: ${JSON.stringify({
                messageMetadata: { domain: true },
                count: content,
                messages: [{ type: 'ai', id: 'answer', content }],
              })}\n\n`
          )
          .join('')
      )
    );
    vi.stubGlobal('fetch', request);
    const session = createSession({
      assistantId: 'a',
      threadId: 't',
      apiUrl: 'https://runtime.example',
    });
    const text: string[] = [];
    session.subscribe(() => {
      const last = session.getSnapshot().messages.at(-1);
      if (last?.role === 'assistant') text.push(last.content);
    });
    try {
      expect(await session.submit('Go')).toBe('success');
      expect(text).toContain('Second');
      expect(text).not.toContain('FirstSecond');
      expect(session.getSnapshot()).toMatchObject({
        values: { messageMetadata: { domain: true }, count: 'Second' },
      });
      expect(request).toHaveBeenCalledTimes(1);
    } finally {
      await session.dispose();
    }
  });

  it('loads decoded history through the real SDK endpoint without issuing runs, writes or tools', async () => {
    const request = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify([
            {
              values: {
                messages: [
                  { type: 'human', id: 'persisted-user', content: 'Weather?' },
                  toolCall,
                ],
              },
              next: ['tools'],
              tasks: [],
              checkpoint: {
                thread_id: 'thread-1',
                checkpoint_id: 'persisted',
                checkpoint_ns: '',
                checkpoint_map: {},
              },
              metadata: null,
              created_at: null,
              parent_checkpoint: null,
            },
          ]),
          { headers: { 'content-type': 'application/json' } }
        )
    );
    vi.stubGlobal('fetch', request);
    const handler = vi.fn(() => 'Never');
    const store: ToolExecutionStore = {
      claim: vi.fn(async () => 'claimed' as const),
      record: vi.fn(async () => undefined),
    };
    const session = createSession({
      assistantId: 'assistant-1',
      threadId: 'thread-1',
      apiUrl: 'https://runtime.example/api',
      clientOptions: { defaultHeaders: { authorization: 'session-token' } },
      executionStore: store,
      tools: { weather: { description: 'Weather', handler } },
    });
    const external = new AbortController();
    const notify = vi.fn();
    const off = session.subscribe(notify);
    try {
      session.getSnapshot();
      expect(request).not.toHaveBeenCalled();
      expect(session.load).toBeTypeOf('function');
      await session.load?.({ signal: external.signal });
      expect(request).toHaveBeenCalledTimes(1);
      const [url, init] = request.mock.calls[0];
      expect(String(url)).toBe(
        'https://runtime.example/api/threads/thread-1/history'
      );
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual({ limit: 10 });
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'session-token'
      );
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(init?.signal).not.toBe(external.signal);
      expect(
        session.getSnapshot().messages.map((message) => message.id)
      ).toEqual(['persisted-user', 'assistant-tool']);
      expect(session.getSnapshot().messages[1].delivery).toEqual({
        generation: 'assistant-tool',
        phase: 'complete',
        outcome: 'success',
      });
      expect(session.getSnapshot().toolCalls).toMatchObject([
        { id: 'call-weather', status: 'pending', args: { city: 'Paris' } },
      ]);
      expect(handler).not.toHaveBeenCalled();
      expect(store.claim).not.toHaveBeenCalled();
      expect(store.record).not.toHaveBeenCalled();
      expect(notify).toHaveBeenCalledTimes(1);
    } finally {
      off();
      await session.dispose();
    }
  });

  it.each([
    ['missing options', undefined, 1],
    ['empty options', {}, 1],
    ['headers only', { defaultHeaders: { authorization: 'session-token' } }, 1],
    ['undefined retries', { maxRetries: undefined }, 1],
    [
      'explicit retry opt-in',
      { maxRetries: 1, defaultHeaders: { authorization: 'session-token' } },
      2,
    ],
  ] as [string, SessionOptions['clientOptions'], number][])(
    'does not replay an ambiguous run-creation POST unless opted in: %s',
    async (_label, clientOptions, expectedPosts) => {
      vi.useFakeTimers();
      const posts: RequestInit[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>(async (url, init) => {
          if (!String(url).endsWith('/runs/stream'))
            return new Response('[]', {
              headers: { 'content-type': 'application/json' },
            });
          posts.push(init ?? {});
          // The server may already have accepted this POST. No known run ID is
          // available to join: replaying it can create a second logical run.
          if (posts.length === 1)
            throw new Error('NetworkError after accepted POST');
          return fragmentedResponse(textTrace);
        })
      );
      const session = createSession({
        assistantId: 'assistant-1',
        threadId: 'thread-1',
        apiUrl: 'https://runtime.example/api',
        clientOptions,
      });
      try {
        const submitted = session.submit('One logical submission');
        await vi.runAllTimersAsync();
        const outcome = await submitted;
        expect(posts).toHaveLength(expectedPosts);
        expect(outcome).toBe(
          expectedPosts === 2
            ? 'success'
            : clientOptions?.defaultHeaders
            ? 'error'
            : 'interrupted'
        );
        expect(posts.every((post) => post.method === 'POST')).toBe(true);
        for (const post of posts)
          expect(new Headers(post.headers).get('authorization')).toBe(
            clientOptions?.defaultHeaders?.['authorization'] ?? null
          );
        if (expectedPosts === 2) expect(posts[1].body).toBe(posts[0].body);
      } finally {
        await session.dispose();
      }
    }
  );

  it.each([
    { ids: [], followUp: false },
    { ids: [], followUp: true },
    { ids: ['c2'], followUp: false },
  ])(
    'honors a real SSE correction to tool calls $ids before any effects (followUp=$followUp)',
    async ({ ids, followUp }) => {
      const requests: { url: string; body: Record<string, unknown> }[] = [];
      const handler = vi.fn((args: { id: string }) => args.id);
      const store: ToolExecutionStore = {
        claim: vi.fn(async () => 'claimed' as const),
        record: vi.fn(async () => undefined),
      };
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>(async (url, init) => {
          const body = JSON.parse(String(init?.body)) as Record<
            string,
            unknown
          >;
          requests.push({ url: String(url), body });
          if (!String(url).endsWith('/runs/stream'))
            return new Response('{}', {
              headers: { 'content-type': 'application/json' },
            });
          const user = (body['input'] as { messages: unknown[] }).messages[0];
          const values = [['c1'], ids].map((calls, index) => ({
            messages: [
              user,
              {
                type: 'ai',
                id: 'same-assistant',
                content: index ? 'Corrected' : '',
                tool_calls: calls.map((id) => ({
                  id,
                  name: 'work',
                  args: { id },
                })),
              },
            ],
          }));
          return fragmentedResponse(
            values
              .map(
                (value) => `event: values\ndata: ${JSON.stringify(value)}\n\n`
              )
              .join('')
          );
        })
      );
      const session = createSession({
        assistantId: 'agent',
        threadId: 'thread',
        apiUrl: 'https://runtime.example',
        executionStore: store,
        tools: { work: { description: 'Work', followUp, handler } },
      });
      const pending: string[][] = [];
      const off = session.subscribe(() => {
        const snapshot = session.getSnapshot();
        if (
          snapshot.messages.some((message) => message.content === 'Corrected')
        )
          pending.push(
            snapshot.toolCalls
              .filter((call) => call.status === 'pending')
              .map((call) => call.id)
          );
      });
      try {
        await expect(session.submit('Work')).resolves.toBe('success');
        expect(pending[0]).toEqual(ids);
        expect(
          session
            .getSnapshot()
            .messages.find((message) => message.id === 'same-assistant')
            ?.toolCallIds
        ).toEqual(ids);
        expect(session.getSnapshot().toolCalls.map((call) => call.id)).toEqual(
          ids
        );
        expect(handler.mock.calls.map(([args]) => args.id)).toEqual(ids);
        expect(store.claim).toHaveBeenCalledTimes(ids.length);
        expect(store.record).toHaveBeenCalledTimes(ids.length);
        if (ids.length)
          expect(store.claim).toHaveBeenCalledWith({
            threadId: 'thread',
            toolCallId: 'c2',
          });
        expect(
          requests.filter((request) => request.url.endsWith('/runs/stream'))
        ).toHaveLength(1);
        const persisted = requests.filter((request) =>
          request.url.endsWith('/state')
        );
        expect(persisted).toHaveLength(ids.length);
        if (ids.length)
          expect(persisted[0].body).toMatchObject({
            values: { messages: [{ tool_call_id: 'c2', content: 'c2' }] },
          });
      } finally {
        off();
        await session.dispose();
      }
    }
  );

  it('roundtrips an owned function tool through the real SDK and preserves authored results across server echoes', async () => {
    const requests: { url: string; body: Record<string, unknown> }[] = [];
    const parameters = {
      type: 'object',
      properties: { city: { type: 'string', enum: ['London'] } },
      additionalProperties: false,
    };
    const handler = vi.fn((args: { city: string }) => ({
      city: args.city,
      temperature: 20,
    }));
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (url, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        requests.push({ url: String(url), body });
        const input = body['input'] as { messages: unknown[] };
        const messages =
          requests.length === 1
            ? [...input.messages, toolCall]
            : [
                toolCall,
                ...input.messages,
                { type: 'ai', id: 'answer', content: '20 degrees' },
              ];
        return fragmentedResponse(
          `event: values\ndata: ${JSON.stringify({ messages })}\n\n`
        );
      })
    );
    const session = createSession({
      assistantId: 'assistant-1',
      threadId: 'thread-1',
      apiUrl: 'https://runtime.example/api',
      clientOptions: { maxRetries: 0 },
      tools: {
        weather: { description: 'Current weather', parameters, handler },
      },
    });
    try {
      await expect(session.submit('Weather?')).resolves.toBe('success');
      expect(requests).toHaveLength(2);
      expect(handler).toHaveBeenCalledTimes(1);
      // Paris deliberately disagrees with the optional metadata enum: metadata
      // does not validate or transform caller-authored arguments.
      expect(handler.mock.calls[0][0]).toEqual({ city: 'Paris' });
      const catalog = [
        { name: 'weather', description: 'Current weather', parameters },
      ];
      expect(requests[0]).toEqual({
        url: 'https://runtime.example/api/threads/thread-1/runs/stream',
        body: {
          assistant_id: 'assistant-1',
          input: {
            messages: [
              { id: expect.any(String), type: 'human', content: 'Weather?' },
            ],
            client_tools: catalog,
          },
          stream_mode: ['values', 'messages-tuple', 'updates', 'custom'],
          stream_subgraphs: true,
        },
      });
      expect(requests[1]).toEqual({
        url: 'https://runtime.example/api/threads/thread-1/runs/stream',
        body: {
          assistant_id: 'assistant-1',
          input: {
            messages: [
              {
                id: 'client-tool-result-call-weather',
                type: 'tool',
                role: 'tool',
                tool_call_id: 'call-weather',
                content: '{"city":"Paris","temperature":20}',
              },
            ],
            client_tools: catalog,
          },
          stream_mode: ['values', 'messages-tuple', 'updates', 'custom'],
          stream_subgraphs: true,
        },
      });
      expect(session.getSnapshot().toolCalls).toEqual([
        {
          id: 'call-weather',
          name: 'weather',
          args: { city: 'Paris' },
          status: 'complete',
          result: { city: 'Paris', temperature: 20 },
        },
      ]);
    } finally {
      await session.dispose();
    }
  });

  it('decodes fragmented UTF-8 and forwards exact run input, catalog and options', async () => {
    const request = vi.fn<typeof fetch>(async () =>
      fragmentedResponse(textTrace)
    );
    vi.stubGlobal('fetch', request);
    const transport = new FetchStreamTransport(
      'https://runtime.example/api',
      undefined,
      { maxRetries: 0, defaultHeaders: { authorization: 'session-token' } }
    );
    const catalog = [
      {
        name: 'weather',
        description: 'Current weather',
        parameters: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
      },
    ];
    const input = {
      messages: [{ type: 'human', content: 'Hello' }],
      client_tools: catalog,
    };
    const events = await collect(
      transport.stream(
        'assistant-1',
        'thread-1',
        input,
        new AbortController().signal,
        {
          config: { configurable: { locale: 'fr' } },
          metadata: { source: 'test' },
          context: { tenant: 'local' },
          command: { resume: 'approved' },
          streamMode: ['messages-tuple', 'values'],
          streamSubgraphs: false,
          multitaskStrategy: 'reject',
          onDisconnect: 'cancel',
          durability: 'sync',
        }
      )
    );
    expect(request).toHaveBeenCalledTimes(1);
    const [url, init] = request.mock.calls[0];
    expect(String(url)).toBe(
      'https://runtime.example/api/threads/thread-1/runs/stream'
    );
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('authorization')).toBe(
      'session-token'
    );
    expect(new Headers(init?.headers).has('x-api-key')).toBe(false);
    expect(JSON.parse(String(init?.body))).toEqual({
      assistant_id: 'assistant-1',
      input,
      config: { configurable: { locale: 'fr' } },
      metadata: { source: 'test' },
      context: { tenant: 'local' },
      command: { resume: 'approved' },
      stream_mode: ['messages-tuple', 'values'],
      stream_subgraphs: false,
      multitask_strategy: 'reject',
      on_disconnect: 'cancel',
      durability: 'sync',
    });
    expect(events).toEqual([
      {
        type: 'metadata',
        run_id: 'run-parity',
        attempt: 1,
        data: { run_id: 'run-parity', attempt: 1 },
      },
      ...['Hello ', '🌍.'].map((content) => {
        const message = {
          type: 'AIMessageChunk',
          id: 'message-parity',
          content,
        };
        const metadata = { langgraph_node: 'assistant' };
        return {
          type: 'messages',
          messages: [message],
          messageMetadata: metadata,
          data: [message, metadata],
        };
      }),
      {
        type: 'values',
        messages: [{ type: 'ai', id: 'message-parity', content: 'Hello 🌍.' }],
        stage: 'complete',
        data: {
          messages: [
            { type: 'ai', id: 'message-parity', content: 'Hello 🌍.' },
          ],
          stage: 'complete',
        },
      },
    ]);
  });

  it('routes real tool call and tool result data through the messages and values streams', async () => {
    const request = vi.fn<typeof fetch>(async () =>
      fragmentedResponse(toolTrace)
    );
    vi.stubGlobal('fetch', request);
    const transport = new FetchStreamTransport(
      'https://runtime.example',
      undefined,
      { maxRetries: 0 }
    );
    const events = await collect(
      transport.stream(
        'assistant-1',
        'thread-1',
        null,
        new AbortController().signal
      )
    );
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({
      assistant_id: 'assistant-1',
      input: null,
      stream_mode: ['values', 'messages-tuple', 'updates', 'custom'],
      stream_subgraphs: true,
    });
    expect(events).toEqual([
      {
        type: 'messages',
        messages: [toolCall],
        messageMetadata: { langgraph_node: 'assistant' },
        data: [toolCall, { langgraph_node: 'assistant' }],
      },
      {
        type: 'values',
        messages: [toolCall, toolResult],
        data: { messages: [toolCall, toolResult] },
      },
    ]);
  });

  it('closes the SDK iterator and releases its reader on early consumer return', async () => {
    const release = vi.spyOn(
      ReadableStreamDefaultReader.prototype,
      'releaseLock'
    );
    const cancel = vi.fn();
    let closeBody: () => void = () => undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        closeBody = () => controller.close();
        controller.enqueue(
          new TextEncoder().encode(
            'event: metadata\ndata: {"run_id":"early"}\n\n'
          )
        );
      },
      cancel,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(
        async () =>
          new Response(body, {
            headers: { 'content-type': 'text/event-stream' },
          })
      )
    );
    const transport = new FetchStreamTransport(
      'https://runtime.example',
      undefined,
      { maxRetries: 0 }
    );
    try {
      for await (const event of transport.stream(
        'assistant-1',
        'thread-1',
        {},
        new AbortController().signal
      )) {
        expect(event.type).toBe('metadata');
        break;
      }
      expect(release).toHaveBeenCalledTimes(1);
      // SDK iterator return releases its decoded reader; it does not cancel fetch.
      expect(cancel).not.toHaveBeenCalled();
    } finally {
      closeBody();
    }
  });

  it('aborts an outstanding real SDK read via the owned request signal and releases the reader', async () => {
    const release = vi.spyOn(
      ReadableStreamDefaultReader.prototype,
      'releaseLock'
    );
    const read = vi.spyOn(ReadableStreamDefaultReader.prototype, 'read');
    const aborted = vi.fn();
    const cancel = vi.fn();
    let closeBody: () => void = () => undefined;
    const request = vi.fn<typeof fetch>(async (_url, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          closeBody = () => controller.error(new Error('Fixture cleanup'));
          init?.signal?.addEventListener(
            'abort',
            () => {
              aborted();
              controller.error(init.signal?.reason);
            },
            { once: true }
          );
          controller.enqueue(
            new TextEncoder().encode(
              'event: metadata\ndata: {"run_id":"cancel"}\n\n'
            )
          );
        },
        cancel,
      });
      return new Response(body, {
        headers: { 'content-type': 'text/event-stream' },
      });
    });
    vi.stubGlobal('fetch', request);
    const transport = new FetchStreamTransport(
      'https://runtime.example',
      undefined,
      { maxRetries: 0, defaultHeaders: {} }
    );
    const controller = new AbortController();
    const iterator = transport
      .stream('assistant-1', 'thread-1', {}, controller.signal)
      [Symbol.asyncIterator]();
    let rejection: Promise<void> | undefined;
    try {
      await expect(iterator.next()).resolves.toMatchObject({
        value: { type: 'metadata' },
        done: false,
      });
      rejection = expect(iterator.next()).rejects.toMatchObject({
        name: 'AbortError',
      });
      await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
      controller.abort();
      await rejection;
      expect(request).toHaveBeenCalledTimes(1);
      expect(aborted).toHaveBeenCalledTimes(1);
      expect(release).toHaveBeenCalledTimes(1);
      expect(cancel).not.toHaveBeenCalled();
    } finally {
      // Close the fixture even if signal forwarding or an earlier assertion fails.
      void rejection?.catch(() => undefined);
      controller.abort();
      closeBody();
      await rejection?.catch(() => undefined);
      // Do not block a failed test on a noncooperative iterator's cleanup.
      void iterator.return?.().catch(() => undefined);
    }
  });
});
