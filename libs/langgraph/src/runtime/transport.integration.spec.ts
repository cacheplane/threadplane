import { canonicalInvocation } from './tool-provenance';
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

  it('observes full child paths through the locked SDK without root values or tool authority', async () => {
    const frame = (event: string, data: unknown) =>
      `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    const childTool = { ...toolCall, id: 'shared' };
    const trace =
      frame('messages|parent:1|child:1', [
        { type: 'AIMessageChunk', id: 'shared', content: 'Long draft' },
        {},
      ]) +
      frame('messages|sibling:1', [
        { type: 'AIMessageChunk', id: 'shared', content: 'Sibling' },
        {},
      ]) +
      frame('values|parent:1|child:1', {
        child: { owned: true },
        messages: [childTool],
      }) +
      frame('updates|parent:1|child:1', {
        __interrupt__: [{ id: 'child-ask', value: 'Continue?' }],
      }) +
      frame('error|sibling:1', { message: 'PRIVATE_CHILD_ERROR' }) +
      frame('values', {
        root: true,
        messages: [{ type: 'ai', id: 'root', content: 'Done' }],
      });
    const fetch = vi.fn(async () => fragmentedResponse(trace));
    vi.stubGlobal('fetch', fetch);
    const handler = vi.fn((args: { city: string }) => args.city);
    const session = createSession({
      assistantId: 'a',
      threadId: 't',
      apiUrl: 'https://runtime.example',
      tools: { weather: { description: 'Weather', handler } },
    });
    expect(await session.submit('Go')).toBe('success');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(handler).not.toHaveBeenCalled();
    const snapshot = session.getSnapshot();
    expect(snapshot.values).toEqual({ root: true });
    expect(snapshot.interrupts).toEqual([]);
    expect(snapshot.toolCalls).toEqual([]);
    expect(snapshot.messages.map((message) => message.content)).toEqual([
      'Go',
      'Done',
    ]);
    expect(snapshot.subgraphs.map((entry) => entry.namespace)).toEqual([
      ['parent:1', 'child:1'],
      ['sibling:1'],
    ]);
    expect(snapshot.subgraphs[0].messages[0]).toMatchObject({
      id: 'shared',
      content: '',
      delivery: { outcome: 'success' },
    });
    expect(snapshot.subgraphs[0].values).toEqual({ child: { owned: true } });
    expect(snapshot.subgraphs[0].interrupts).toEqual([
      { id: 'child-ask', value: 'Continue?' },
    ]);
    expect(snapshot.subgraphs[1].messages[0]).toMatchObject({
      content: 'Sibling',
      delivery: { outcome: 'error' },
    });
    expect(JSON.stringify(snapshot)).not.toContain('PRIVATE_CHILD_ERROR');
    await session.dispose();
  });

  it.each([false, true])(
    'sends application state only on the initial SDK POST, with reconnect=%s',
    async (reconnect) => {
      const requests: {
        method: string;
        url: string;
        body: Record<string, unknown> | undefined;
      }[] = [];
      let posts = 0;
      let statusReads = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>(async (url, init) => {
          const method = init?.method ?? 'GET';
          const body = init?.body ? JSON.parse(String(init.body)) : undefined;
          requests.push({ method, url: String(url), body });
          if (method === 'POST') {
            posts += 1;
            if (posts === 1 && reconnect)
              return new Response(
                'id: c1\nevent: messages\ndata: [{"type":"AIMessageChunk","id":"assistant-tool","content":""},{}]\n\n',
                {
                  headers: {
                    'Content-Type': 'text/event-stream',
                    'Content-Location': '/threads/t/runs/r',
                  },
                }
              );
            return fragmentedResponse(
              posts === 1
                ? `event: values\ndata: ${JSON.stringify({
                    messages: [toolCall],
                  })}\n\n`
                : 'event: values\ndata: {"messages":[{"type":"ai","id":"final","content":"Done"}],"model":"server"}\n\n'
            );
          }
          if (String(url).includes('/stream?'))
            return fragmentedResponse(
              `id: c2\nevent: values\ndata: ${JSON.stringify({
                messages: [toolCall],
              })}\n\n`
            );
          statusReads += 1;
          return Response.json({
            run_id: 'r',
            thread_id: 't',
            status: statusReads === 1 ? 'running' : 'success',
          });
        })
      );
      const session = createSession({
        assistantId: 'a',
        threadId: 't',
        apiUrl: 'https://runtime.example',
        tools: {
          weather: {
            description: 'Weather',
            handler: (args: { city: string }) => ({ city: args.city }),
          },
        },
      });
      const state = {
        model: 'client',
        reasoning: 'low',
        itinerary: [{ city: 'Paris', day: 1 }],
        metadata: { domain: 'application' },
      } as const;
      const runOptions = {
        config: {
          tags: ['memory'],
          recursion_limit: 50,
          configurable: { user_id: 'user-42' },
        },
        context: { locale: 'en' },
        metadata: { domain: 'execution' },
      } as const;
      expect(await session.submit({ message: 'Plan', state }, runOptions)).toBe(
        reconnect ? 'interrupted' : 'success'
      );
      if (reconnect) expect(await session.reconnect()).toBe('success');
      const bodies = requests
        .filter((request) => request.method === 'POST')
        .map((request) => request.body ?? {});
      expect(bodies).toHaveLength(2);
      expect(bodies[0]['input']).toEqual({
        ...state,
        messages: [{ type: 'human', id: expect.any(String), content: 'Plan' }],
        client_tools: [{ name: 'weather', description: 'Weather' }],
      });
      expect(bodies[0]).toMatchObject({
        assistant_id: 'a',
        stream_mode: ['values', 'messages-tuple', 'updates', 'custom'],
        stream_subgraphs: true,
        stream_resumable: true,
        on_disconnect: 'continue',
      });
      for (const body of bodies) expect(body).toMatchObject(runOptions);
      expect(Object.keys(bodies[1]['input'] as object).sort()).toEqual([
        'client_tools',
        'messages',
      ]);
      expect(bodies[1]['input']).toMatchObject({
        messages: [
          {
            type: 'tool',
            tool_call_id: 'call-weather',
            content: '{"city":"Paris"}',
          },
        ],
      });
      expect(
        requests.filter((request) => request.url.includes('/stream?'))
      ).toEqual(
        reconnect
          ? [
              {
                method: 'GET',
                url: 'https://runtime.example/threads/t/runs/r/stream?cancel_on_disconnect=0',
                body: undefined,
              },
            ]
          : []
      );
      expect(session.getSnapshot().values).toEqual({ model: 'server' });
      await session.submit('Independent');
      expect(
        Object.keys(requests.at(-1)?.body?.['input'] as object).sort()
      ).toEqual(['client_tools', 'messages']);
      await session.dispose();
    }
  );

  it.each([undefined, 'wire-id'])(
    'preserves reserved SDK sseId %j over forged values payload metadata',
    async (id) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          fragmentedResponse(
            `${
              id === undefined ? '' : `id: ${id}\n`
            }event: values\ndata: {"sseId":"forged","messages":[]}\n\n`
          )
        )
      );
      const transport = new FetchStreamTransport(
        'https://runtime.example',
        undefined,
        { maxRetries: 0 }
      );
      const events = await collect(
        transport.stream('a', 't', {}, new AbortController().signal)
      );
      expect(events[0].sseId).toBe(id);
      expect(events[0]['data']).toMatchObject({ sseId: 'forged' });
    }
  );

  it.each([
    'pending',
    'running',
    'success',
    'error',
    'timeout',
    'interrupted',
  ] as const)(
    'reads exact SDK run status %s with the supplied signal',
    async (status) => {
      const request = vi.fn<typeof fetch>(async (url, init) => {
        expect(String(url)).toBe('https://runtime.example/threads/t/runs/r');
        expect(init?.method ?? 'GET').toBe('GET');
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        return Response.json({ run_id: 'r', thread_id: 't', status });
      });
      vi.stubGlobal('fetch', request);
      const transport = new FetchStreamTransport(
        'https://runtime.example',
        undefined,
        { maxRetries: 0 }
      );
      expect(
        await transport.getRunStatus('t', 'r', new AbortController().signal)
      ).toBe(status);
      expect(request).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    { run_id: 'wrong', thread_id: 't', status: 'success' },
    { run_id: 'r', thread_id: 'wrong', status: 'success' },
    { run_id: 'r', thread_id: 't', status: 'unknown' },
  ])(
    'rejects mismatched or unsupported run status protocol: %j',
    async (response) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json(response))
      );
      const transport = new FetchStreamTransport(
        'https://runtime.example',
        undefined,
        { maxRetries: 0 }
      );
      await expect(
        transport.getRunStatus('t', 'r', new AbortController().signal)
      ).rejects.toThrow();
    }
  );

  it('captures creation headers, joins only the exact cursor suffix, and confirms status without another POST/history', async () => {
    const requests: {
      url: string;
      method: string;
      cursor: string | null;
      body: unknown;
    }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (url, init) => {
        const item = {
          url: String(url),
          method: init?.method ?? 'GET',
          cursor: new Headers(init?.headers).get('Last-Event-ID'),
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        };
        requests.push(item);
        if (item.method === 'POST')
          return new Response(
            'id: c1\nevent: messages\ndata: [{"type":"AIMessageChunk","id":"answer","content":"Part"},{}]\n\n',
            {
              headers: {
                'Content-Type': 'text/event-stream',
                'Content-Location': '/threads/t/runs/r',
              },
            }
          );
        if (item.url.endsWith('/stream?cancel_on_disconnect=0'))
          return fragmentedResponse(
            'id: c2\nevent: values\ndata: {"messages":[{"type":"ai","id":"answer","content":"Final"}]}\n\n'
          );
        expect(item.url).toBe('https://runtime.example/threads/t/runs/r');
        return Response.json({
          run_id: 'r',
          thread_id: 't',
          status: requests.length === 2 ? 'running' : 'success',
        });
      })
    );
    const session = createSession({
      assistantId: 'a',
      threadId: 't',
      apiUrl: 'https://runtime.example',
    });
    expect(await session.submit('Question')).toBe('interrupted');
    expect(session.getSnapshot().reconnect).toEqual({ runId: 'r' });
    expect(await session.reconnect()).toBe('success');
    expect(requests.map((request) => request.method)).toEqual([
      'POST',
      'GET',
      'GET',
      'GET',
    ]);
    expect(requests[0].body).toMatchObject({
      stream_resumable: true,
      on_disconnect: 'continue',
    });
    expect(requests[2]).toMatchObject({
      url: 'https://runtime.example/threads/t/runs/r/stream?cancel_on_disconnect=0',
      cursor: 'c1',
    });
    expect(session.getSnapshot().messages[1].content).toBe('Final');
    await session.dispose();
  });

  it('keeps the installed SDK body GET reconnect distinct from maxRetries:0 POST policy', async () => {
    let body: ReadableStreamDefaultController<Uint8Array> | undefined;
    const requests: { method: string; cursor: string | null }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (_url, init) => {
        requests.push({
          method: init?.method ?? 'GET',
          cursor: new Headers(init?.headers).get('Last-Event-ID'),
        });
        if (requests.length === 1)
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                body = controller;
                controller.enqueue(
                  new TextEncoder().encode(
                    'id: c1\nevent: values\ndata: {"stage":"first"}\n\n'
                  )
                );
              },
            }),
            {
              headers: {
                'Content-Type': 'text/event-stream',
                'Content-Location': '/threads/t/runs/r',
                Location: '/threads/t/runs/r/stream',
              },
            }
          );
        return fragmentedResponse(
          'id: c2\nevent: values\ndata: {"stage":"second"}\n\n'
        );
      })
    );
    const transport = new FetchStreamTransport(
      'https://runtime.example',
      undefined,
      { maxRetries: 0 }
    );
    const events = transport
      .stream('a', 't', {}, new AbortController().signal, {
        streamResumable: true,
      })
      [Symbol.asyncIterator]();
    expect((await events.next()).value).toMatchObject({ sseId: 'c1' });
    body?.error(new TypeError('Socket closed'));
    expect((await events.next()).value).toMatchObject({ sseId: 'c2' });
    expect((await events.next()).done).toBe(true);
    expect(requests).toEqual([
      { method: 'POST', cursor: null },
      { method: 'GET', cursor: 'c1' },
    ]);
  });

  it.each([
    undefined,
    null,
    false,
    0,
    '',
    { approve: false, second: { answer: [0, null] } },
  ])(
    'sends real SDK null input and opaque resume %j exactly once',
    async (value) => {
      const bodies: Record<string, unknown>[] = [];
      const request = vi.fn<typeof fetch>(async (url, init) => {
        expect(String(url)).toBe(
          'https://runtime.example/threads/t/runs/stream'
        );
        bodies.push(JSON.parse(String(init?.body)));
        return fragmentedResponse(
          bodies.length === 1
            ? 'event: values\ndata: {"messages":[{"type":"ai","id":"answer","content":"Waiting"}],"__interrupt__":[{"id":"approve","value":"Proceed?"}]}\n\n'
            : 'event: values\ndata: {"messages":[{"type":"ai","id":"answer","content":"Done"}],"stage":"complete"}\n\n'
        );
      });
      vi.stubGlobal('fetch', request);
      const session = createSession({
        assistantId: 'a',
        threadId: 't',
        apiUrl: 'https://runtime.example',
      });
      expect(
        await session.submit({
          message: 'Question',
          state: { model: 'initial' },
        })
      ).toBe('paused');
      expect(await session.resume(value)).toBe('success');
      expect(bodies[1]['input']).toBeNull();
      expect(bodies[1]['command']).toEqual(
        value === undefined ? undefined : { resume: value }
      );
      expect(
        session
          .getSnapshot()
          .messages.filter((message) => message.role === 'user')
      ).toHaveLength(1);
      expect(session.getSnapshot().messages.at(-1)).toMatchObject({
        content: 'Done',
        delivery: { phase: 'complete', outcome: 'success' },
      });
      expect(request).toHaveBeenCalledTimes(2);
      await session.dispose();
    }
  );

  it('does not retry or query history after an ambiguous SDK resume POST failure', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const request = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe('https://runtime.example/threads/t/runs/stream');
      calls += 1;
      if (calls === 1)
        return fragmentedResponse(
          'event: values\ndata: {"__interrupt__":[]}\n\n'
        );
      expect(JSON.parse(String(init?.body))).toMatchObject({
        input: null,
        command: { resume: null },
      });
      throw new Error('NetworkError after acceptance');
    });
    vi.stubGlobal('fetch', request);
    const session = createSession({
      assistantId: 'a',
      threadId: 't',
      apiUrl: 'https://runtime.example',
    });
    expect(await session.submit('Pause')).toBe('paused');
    const pending = session.resume(null);
    await vi.runAllTimersAsync();
    expect(await pending).toBe('interrupted');
    expect(session.getSnapshot().error).toMatchObject({
      recovery: 'none',
      retryable: false,
    });
    await session.checkStatus?.();
    expect(request).toHaveBeenCalledTimes(2);
    await session.dispose();
  });

  it('observes a new actual SDK pause from a resumed command without another human', async () => {
    let calls = 0;
    const request = vi.fn<typeof fetch>(async () => {
      calls += 1;
      return fragmentedResponse(
        calls === 1
          ? 'event: values\ndata: {"__interrupt__":[]}\n\n'
          : 'event: updates\ndata: {"__interrupt__":[{"id":"second","value":{"confirm":false}}]}\n\n'
      );
    });
    vi.stubGlobal('fetch', request);
    const session = createSession({
      assistantId: 'a',
      threadId: 't',
      apiUrl: 'https://runtime.example',
    });
    expect(await session.submit('Pause')).toBe('paused');
    expect(await session.resume()).toBe('paused');
    expect(session.getSnapshot().interrupts).toEqual([
      { id: 'second', value: { confirm: false } },
    ]);
    expect(session.getSnapshot().messages).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(2);
    await session.dispose();
  });

  it('sends the SDK resume command only on the first null-input run, never its tool follow-up', async () => {
    const bodies: Record<string, unknown>[] = [];
    const request = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe('https://runtime.example/threads/t/runs/stream');
      bodies.push(JSON.parse(String(init?.body)));
      return fragmentedResponse(
        bodies.length === 1
          ? 'event: updates\ndata: {"__interrupt__":[{"id":"approval","value":"Proceed?"}]}\n\n'
          : bodies.length === 2
          ? `event: values\ndata: ${JSON.stringify({
              messages: [toolCall],
            })}\n\n`
          : 'event: values\ndata: {"messages":[{"type":"ai","id":"final","content":"Done"}]}\n\n'
      );
    });
    vi.stubGlobal('fetch', request);
    const handler = vi.fn((args: { city: string }) => ({
      city: args.city,
      temperature: 21,
    }));
    const session = createSession({
      assistantId: 'a',
      threadId: 't',
      apiUrl: 'https://runtime.example',
      tools: { weather: { description: 'Weather', handler } },
    });
    expect(await session.submit('Question')).toBe('paused');
    expect(await session.resume({ approval: false })).toBe('success');
    expect(bodies[1]).toMatchObject({
      input: null,
      command: { resume: { approval: false } },
    });
    expect(bodies[2]['command']).toBeUndefined();
    expect(bodies[2]['input']).toMatchObject({
      messages: [
        {
          type: 'tool',
          tool_call_id: 'call-weather',
          content: JSON.stringify({ city: 'Paris', temperature: 21 }),
        },
      ],
      client_tools: [{ name: 'weather' }],
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(3);
    await session.dispose();
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
      acquire: vi.fn(async () => ({
        status: 'acquired' as const,
        token: 'owner',
      })),
      settle: vi.fn(async () => 'accepted' as const),
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
      expect(session.getSnapshot().history).toEqual([
        {
          checkpoint: {
            thread_id: 'thread-1',
            checkpoint_id: 'persisted',
            checkpoint_ns: '',
            checkpoint_map: {},
          },
          parent_checkpoint: null,
          created_at: null,
          next: ['tools'],
        },
      ]);
      expect(session.getSnapshot().messages[1].delivery).toEqual({
        generation: 'assistant-tool',
        phase: 'complete',
        outcome: 'success',
      });
      expect(session.getSnapshot().toolCalls).toMatchObject([
        { id: 'call-weather', status: 'pending', args: { city: 'Paris' } },
      ]);
      expect(handler).not.toHaveBeenCalled();
      expect(store.acquire).not.toHaveBeenCalled();
      expect(store.settle).not.toHaveBeenCalled();
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
        acquire: vi.fn(async () => ({
          status: 'acquired' as const,
          token: 'owner',
        })),
        settle: vi.fn(async () => 'accepted' as const),
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
        expect(store.acquire).toHaveBeenCalledTimes(ids.length);
        expect(store.settle).toHaveBeenCalledTimes(ids.length);
        if (ids.length)
          expect(store.acquire).toHaveBeenCalledWith(
            {
              threadId: 'thread',
              toolCallId: 'c2',
            },
            canonicalInvocation('work', { id: 'c2' })
          );
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
          stream_resumable: true,
          on_disconnect: 'continue',
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
          stream_resumable: true,
          on_disconnect: 'continue',
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
