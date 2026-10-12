import { it, expect, vi, afterEach } from 'vitest';
import { createMemoryClient } from './connection';
afterEach(() => vi.unstubAllGlobals());
it('real SDK lazily creates UUID with raise, captured headers and no retry, then uses genuine native protocol', async () => {
  const requests: { path: string; body: any; headers: Headers }[] = [];
  const id = '11111111-1111-4111-8111-111111111111';
  vi.stubGlobal('crypto', { randomUUID: () => id });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: any, init: any) => {
      const path = new URL(String(url)).pathname;
      const body = init?.body ? JSON.parse(init.body) : undefined;
      requests.push({ path, body, headers: new Headers(init?.headers) });
      if (path === '/threads') return Response.json({ thread_id: id });
      if (path.endsWith('/runs/stream')) {
        const messages = [
          {
            id: 'call',
            type: 'ai',
            content: '',
            tool_calls: [
              {
                id: 'tool',
                name: 'write_file',
                args: { content: 'literal\n\n' },
                type: 'tool_call',
              },
            ],
          },
          {
            id: 'result',
            type: 'tool',
            name: 'write_file',
            tool_call_id: 'tool',
            content: 'done',
            status: 'success',
          },
          { id: 'final', type: 'ai', content: 'Answer.', tool_calls: [] },
        ];
        return new Response(
          'event: custom\ndata: ' +
            JSON.stringify({
              name: 'deep_agents.memory',
              data: { phase: 'initial' },
            }) +
            '\n\nevent: values\ndata: ' +
            JSON.stringify({ messages, files: {} }) +
            '\n\n',
          { headers: { 'content-type': 'text/event-stream' } }
        );
      }
      return Response.json([]);
    })
  );
  const headers = { 'x-api-key': 'captured' };
  const client = createMemoryClient({
    apiUrl: 'http://offline.invalid',
    headers,
  });
  headers['x-api-key'] = 'changed';
  expect(requests).toEqual([]);
  const signal = new AbortController().signal;
  await expect(client.readCurrent('foreign', signal)).rejects.toThrow();
  expect(requests).toEqual([]);
  const created = await client.createThread(signal);
  expect(created).toBe(id);
  expect(requests[0].body).toEqual({
    metadata: {},
    thread_id: id,
    if_exists: 'raise',
  });
  expect(requests[0].headers.get('x-api-key')).toBe('captured');
  const events: unknown[] = [];
  client.observeMemory(id, (e: unknown) => events.push(e));
  const session = client.sessionFactory(id);
  expect(
    await session.submit('Teach.', { context: { memory_scope: id }, signal })
  ).toBe('success');
  expect(events).toEqual([
    { name: 'deep_agents.memory', data: { phase: 'initial' } },
  ]);
  expect(session.getSnapshot().values).toEqual({ files: {} });
  expect(session.getSnapshot().messages.at(-1)?.content).toBe('Answer.');
  expect(session.getSnapshot().toolCalls[0]).toMatchObject({
    args: { content: 'literal\n\n' },
    result: 'done',
    status: 'complete',
  });
  expect(requests[1].body.context).toEqual({ memory_scope: id });
  await session.load?.();
  expect(requests.at(-1)?.path).toContain('/history');
  await session.dispose();
});
it('checkpoint getters are rejected without evaluation', async () => {
  const client = createMemoryClient({
    apiUrl: 'http://offline.invalid',
    headers: {},
  });
  let reads = 0;
  const bad = Object.defineProperty({}, 'thread_id', {
    enumerable: true,
    get() {
      reads++;
      return 'bad';
    },
  });
  await expect(
    client.readCheckpoint(bad as never, new AbortController().signal)
  ).rejects.toThrow();
  expect(reads).toBe(0);
});
it.each(['messages', 'messages/partial', 'messages/complete'])(
  'actual SDK %s events deliver native messages while custom stays separate',
  async (mode) => {
    const id = '11111111-1111-4111-8111-111111111111';
    vi.stubGlobal('crypto', { randomUUID: () => id });
    const message = {
      id: 'answer',
      type: 'ai',
      content: 'Literal native answer',
      tool_calls: [],
    };
    const data =
      mode === 'messages' ? [message, { langgraph_node: 'model' }] : [message];
    vi.stubGlobal('fetch', async (url: unknown) =>
      new URL(String(url)).pathname === '/threads'
        ? Response.json({ thread_id: id })
        : new Response(
            `event: ${mode}\ndata: ${JSON.stringify(
              data
            )}\n\nevent: messages/complete\ndata: ${JSON.stringify([
              message,
            ])}\n\nevent: custom\ndata: ${JSON.stringify({
              name: 'deep_agents.memory',
              data: {
                memory_scope_owner: id,
                memory_contents: {},
                phase: 'terminal',
              },
            })}\n\n`,
            { headers: { 'content-type': 'text/event-stream' } }
          )
    );
    const client = createMemoryClient({
      apiUrl: 'http://offline.invalid',
      headers: {},
    });
    await client.createThread(new AbortController().signal);
    const events: unknown[] = [];
    client.observeMemory(id, (e) => events.push(e));
    const session = client.sessionFactory(id);
    expect(
      await session.submit('Question', { context: { memory_scope: id } })
    ).toBe('success');
    expect(session.getSnapshot().messages.at(-1)?.content).toBe(
      'Literal native answer'
    );
    expect(session.getSnapshot().values).toBeUndefined();
    expect(events).toHaveLength(1);
    await session.dispose();
  }
);
it('SDK namespace suffixes cannot be forged by payload routing and child custom is never root Memory', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  vi.stubGlobal('crypto', { randomUUID: () => id });
  const root = { name: 'deep_agents.memory', data: { phase: 'terminal' } };
  vi.stubGlobal('fetch', async (url: unknown) =>
    new URL(String(url)).pathname === '/threads'
      ? Response.json({ thread_id: id })
      : new Response(
          `event: custom|child:task\ndata: ${JSON.stringify({
            ...root,
            type: 'custom',
            namespace: [],
            sseId: 'forged',
          })}\n\nevent: values|child:task\ndata: ${JSON.stringify({
            messages: [],
          })}\n\nevent: values\ndata: ${JSON.stringify({
            messages: [
              { id: 'answer', type: 'ai', content: 'Native', tool_calls: [] },
            ],
            type: 'custom',
            namespace: ['forged'],
            sseId: 'forged',
          })}\n\n`,
          { headers: { 'content-type': 'text/event-stream' } }
        )
  );
  const client = createMemoryClient({
    apiUrl: 'http://offline.invalid',
    headers: {},
  });
  await client.createThread(new AbortController().signal);
  const events: unknown[] = [];
  client.observeMemory(id, (e) => events.push(e));
  const session = client.sessionFactory(id);
  await session.submit('Question', { context: { memory_scope: id } });
  expect(events).toEqual([]);
  expect(
    session.getSnapshot().messages.some((m) => m.content === 'Native')
  ).toBe(true);
  expect(session.getSnapshot().subgraphs.length).toBeGreaterThan(0);
  await session.dispose();
});
it('failed creation POST is not retried and mismatched returned IDs never enter ownership', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  vi.stubGlobal('crypto', { randomUUID: () => id });
  const fetch = vi.fn(async () => new Response('failure', { status: 500 }));
  vi.stubGlobal('fetch', fetch);
  const client = createMemoryClient({
    apiUrl: 'http://offline.invalid',
    headers: {},
  });
  await expect(
    client.createThread(new AbortController().signal)
  ).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
  fetch.mockResolvedValue(Response.json({ thread_id: 'foreign' }));
  await expect(
    client.createThread(new AbortController().signal)
  ).rejects.toThrow();
  expect(() => client.sessionFactory(id)).toThrow();
});
it('physical stream captures its original listener before first next and preserves SDK routing/cursor', async () => {
  vi.resetModules();
  let transport:
    | NonNullable<
        Parameters<
          typeof import('@threadplane/langgraph').createSession
        >[0]['transport']
      >
    | undefined;
  vi.doMock('@threadplane/langgraph', () => ({
    createSession: (options: { transport: typeof transport }) => {
      transport = options.transport;
      return {
        getSnapshot: () => ({
          messages: [],
          toolCalls: [],
          interrupts: [],
          subgraphs: [],
        }),
        subscribe: () => () => undefined,
        submit: async () => 'success',
        load: async () => undefined,
        stop: async () => undefined,
        dispose: async () => undefined,
      };
    },
  }));
  const { createMemoryClient: create } = await import('./connection');
  const id = '11111111-1111-4111-8111-111111111111';
  vi.stubGlobal('crypto', { randomUUID: () => id });
  vi.stubGlobal('fetch', async (url: unknown) =>
    new URL(String(url)).pathname === '/threads'
      ? Response.json({ thread_id: id })
      : new Response(
          'id: sdk-cursor\nevent: custom\ndata: ' +
            JSON.stringify({
              name: 'deep_agents.memory',
              data: { phase: 'initial' },
              type: 'values',
              namespace: ['forged'],
              sseId: 'forged',
            }) +
            '\n\n',
          { headers: { 'content-type': 'text/event-stream' } }
        )
  );
  try {
    const client = create({ apiUrl: 'http://offline.invalid', headers: {} });
    const signal = new AbortController().signal;
    await client.createThread(signal);
    const first = vi.fn(),
      replacement = vi.fn();
    const release = client.observeMemory(id, first);
    client.sessionFactory(id);
    if (!transport) throw Error('Missing captured transport');
    const iterator = transport
      .stream('da-memory', id, { messages: [] }, signal, {
        context: { memory_scope: id },
      })
      [Symbol.asyncIterator]();
    release();
    client.observeMemory(id, replacement);
    const next = await iterator.next();
    expect(first).toHaveBeenCalledTimes(1);
    expect(replacement).not.toHaveBeenCalled();
    expect(next.value).toMatchObject({ type: 'custom', sseId: 'sdk-cursor' });
    expect(next.value?.namespace).toBeUndefined();
    await iterator.return?.();
  } finally {
    vi.doUnmock('@threadplane/langgraph');
    vi.resetModules();
  }
});
it('genuine SDK/native application confirms filtered live values against full raw/exact/history/native load', async () => {
  const { createMemoryApplication } = await import('./application');
  const { createBrowserScope } = await import('./browser-scope');
  const id = '11111111-1111-4111-8111-111111111111';
  vi.stubGlobal('crypto', { randomUUID: () => id });
  const calls: string[] = [];
  const args = {
      file_path: '/memories/AGENTS.md',
      content: '  Literal\n\nMemory\n',
    },
    result = 'created';
  const messages = [
    { id, type: 'human', content: 'Teach.' },
    {
      id: 'call',
      type: 'ai',
      content: '',
      tool_calls: [
        { id: 'write', name: 'write_file', args, type: 'tool_call' },
      ],
    },
    {
      id: 'result',
      type: 'tool',
      name: 'write_file',
      tool_call_id: 'write',
      content: result,
      status: 'success',
    },
    { id: 'final', type: 'ai', content: 'Remembered.', tool_calls: [] },
  ];
  const values = {
    messages,
    files: {},
    memory_scope_owner: id,
    memory_contents: { '/memories/AGENTS.md': args.content },
  };
  const saved = {
    values,
    next: [],
    tasks: [],
    checkpoint: {
      thread_id: id,
      checkpoint_ns: '',
      checkpoint_id: 'exact-checkpoint',
    },
  };
  vi.stubGlobal('fetch', async (url: unknown, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    calls.push(path);
    if (path === '/threads') return Response.json({ thread_id: id });
    if (path.endsWith('/runs/stream'))
      return new Response(
        'event: values\ndata: ' +
          JSON.stringify({ messages, files: {} }) +
          '\n\nevent: custom\ndata: ' +
          JSON.stringify({
            name: 'deep_agents.memory',
            data: {
              memory_scope_owner: id,
              memory_contents: values.memory_contents,
              phase: 'terminal',
            },
          }) +
          '\n\n',
        { headers: { 'content-type': 'text/event-stream' } }
      );
    if (path.endsWith('/state/checkpoint'))
      expect(JSON.parse(String(init?.body)).checkpoint).toEqual(
        saved.checkpoint
      );
    return Response.json(path.endsWith('/history') ? [saved] : saved);
  });
  const client = createMemoryClient({
    apiUrl: 'http://offline.invalid',
    headers: {},
  });
  const scope = createBrowserScope({
    storage: () => ({ getItem: () => id, setItem: () => undefined }),
    uuid: () => id,
  });
  const app = createMemoryApplication(client, scope);
  await app.submit('Teach.');
  expect(app.getSnapshot()).toMatchObject({
    canSubmit: true,
    outcome: 'success',
    authority: { kind: 'terminal' },
    memory: { kind: 'checkpoint', contents: args.content },
  });
  expect(app.getSnapshot().toolCalls[0]).toMatchObject({
    args,
    result,
    status: 'complete',
  });
  expect(calls.filter((p) => p.endsWith('/history'))).toHaveLength(2);
  expect(calls.filter((p) => p.endsWith('/state/checkpoint'))).toHaveLength(1);
  await app.dispose();
});
it('confirms two successful genuine native turns on one owned thread with fresh full-prefix checkpoint evidence', async () => {
  const { createMemoryApplication } = await import('./application');
  const { createBrowserScope } = await import('./browser-scope');
  const memoryScope = '77777777-7777-4777-8777-777777777777';
  let uuidSerial = 0;
  vi.stubGlobal('crypto', {
    randomUUID: () =>
      `00000000-0000-4000-8000-${String(++uuidSerial).padStart(12, '0')}`,
  });
  type RawMessage = {
    id: string;
    type: 'human' | 'ai' | 'tool';
    content: string;
    tool_calls?: {
      id: string;
      name: string;
      args: { file_path: string; content: string };
      type: 'tool_call';
    }[];
    name?: string;
    tool_call_id?: string;
    status?: string;
  };
  type RunBody = {
    input: { messages: RawMessage[] };
    context: unknown;
    command?: unknown;
  };
  const requests: {
    path: string;
    method: string;
    turn: number;
    body: unknown;
  }[] = [];
  const runs: RunBody[] = [];
  const rawMessages: RawMessage[] = [];
  const contents = [
    '  first memory\n\n  literal one\n',
    '  second memory\n\n  literal two\n',
  ];
  let threadId: string | undefined;
  let turn = 0;
  let current:
    | {
        values: {
          messages: RawMessage[];
          files: Record<string, never>;
          memory_scope_owner: string;
          memory_contents: Record<string, string>;
        };
        next: never[];
        tasks: never[];
        checkpoint: {
          thread_id: string;
          checkpoint_ns: '';
          checkpoint_id: string;
        };
      }
    | undefined;
  const client = createMemoryClient({
    apiUrl: 'http://offline.invalid',
    headers: {},
  });
  let nativeSession: ReturnType<typeof client.sessionFactory> | undefined;
  const liveBeforeLoad: ReturnType<
    NonNullable<typeof nativeSession>['getSnapshot']
  >[] = [];
  const nativeClient = {
    ...client,
    sessionFactory(id: string) {
      nativeSession = client.sessionFactory(id);
      return nativeSession;
    },
  };
  vi.stubGlobal('fetch', async (url: unknown, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const method = init?.method ?? 'GET';
    const body: unknown = init?.body
      ? JSON.parse(String(init.body))
      : undefined;
    if (path === '/threads') {
      const requested = body as { thread_id: string; if_exists: string };
      expect(requested.if_exists).toBe('raise');
      threadId = requested.thread_id;
      requests.push({ path, method, turn, body });
      return Response.json({ thread_id: threadId });
    }
    expect(threadId).toBeDefined();
    if (!threadId) throw Error('Missing confirmed owned thread');
    expect(path.startsWith(`/threads/${threadId}/`)).toBe(true);
    if (path.endsWith('/runs/stream')) {
      turn++;
      expect(turn).toBeLessThanOrEqual(2);
      const run = body as RunBody;
      expect(run.context).toEqual({ memory_scope: memoryScope });
      expect(run).not.toHaveProperty('command');
      expect(run.input.messages).toHaveLength(1);
      const human = run.input.messages[0];
      expect(human.type).toBe('human');
      expect(human.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      );
      expect(human.content).toBe(
        turn === 1 ? 'Teach the first memory.' : 'Update that memory.'
      );
      runs.push(structuredClone(run));
      const args = {
        file_path: '/memories/AGENTS.md',
        content: contents[turn - 1],
      };
      rawMessages.push(
        structuredClone(human),
        {
          id: `call-${turn}`,
          type: 'ai',
          content: '',
          tool_calls: [
            {
              id: `write-${turn}`,
              name: 'write_file',
              args,
              type: 'tool_call',
            },
          ],
        },
        {
          id: `result-${turn}`,
          type: 'tool',
          name: 'write_file',
          tool_call_id: `write-${turn}`,
          content: `  literal result ${turn}\n\n`,
          status: 'success',
        },
        {
          id: `answer-${turn}`,
          type: 'ai',
          content: `Memory observation ${turn}.`,
          tool_calls: [],
        }
      );
      current = {
        values: {
          messages: structuredClone(rawMessages),
          files: {},
          memory_scope_owner: memoryScope,
          memory_contents: { '/memories/AGENTS.md': args.content },
        },
        next: [],
        tasks: [],
        checkpoint: {
          thread_id: threadId,
          checkpoint_ns: '',
          checkpoint_id: `checkpoint-${turn}`,
        },
      };
      requests.push({ path, method, turn, body });
      return new Response(
        'event: values\ndata: ' +
          JSON.stringify({ messages: current.values.messages, files: {} }) +
          '\n\nevent: custom\ndata: ' +
          JSON.stringify({
            name: 'deep_agents.memory',
            data: {
              memory_scope_owner: memoryScope,
              memory_contents: current.values.memory_contents,
              phase: 'terminal',
            },
          }) +
          '\n\n',
        { headers: { 'content-type': 'text/event-stream' } }
      );
    }
    if (!current || !nativeSession)
      throw Error('Read before actual native run');
    requests.push({ path, method, turn, body });
    if (path.endsWith('/state')) {
      liveBeforeLoad.push(structuredClone(nativeSession.getSnapshot()));
      return Response.json(current);
    }
    if (path.endsWith('/history')) {
      expect(body).toMatchObject({ limit: 1 });
      return Response.json([current]);
    }
    if (path.endsWith('/state/checkpoint')) {
      expect(body).toEqual({ checkpoint: current.checkpoint });
      return Response.json(current);
    }
    throw Error(`Unexpected offline route: ${path}`);
  });
  const scope = createBrowserScope({
    storage: () => ({ getItem: () => memoryScope, setItem: () => undefined }),
    uuid: () => memoryScope,
  });
  const app = createMemoryApplication(nativeClient, scope);
  try {
    await app.submit('Teach the first memory.');
    const first = app.getSnapshot();
    expect(first).toMatchObject({
      canSubmit: true,
      outcome: 'success',
      authority: {
        kind: 'terminal',
        checkpoint: { checkpoint_id: 'checkpoint-1' },
      },
      memory: { kind: 'checkpoint', contents: contents[0] },
    });
    if (first.authority.kind !== 'terminal' || !nativeSession)
      throw Error('Unconfirmed first real native turn');
    const firstRaw = structuredClone(first.authority.messages);
    const firstLoaded = structuredClone(nativeSession.getSnapshot());
    await app.submit('Update that memory.');
    const second = app.getSnapshot();
    expect(second).toMatchObject({
      threadId,
      canSubmit: true,
      outcome: 'success',
      authority: {
        kind: 'terminal',
        checkpoint: { checkpoint_id: 'checkpoint-2' },
      },
      memory: { kind: 'checkpoint', contents: contents[1] },
      history: [{ id: threadId }],
    });
    if (second.authority.kind !== 'terminal')
      throw Error('Unconfirmed second real native turn');
    expect(second.authority.messages.slice(0, firstRaw.length)).toEqual(
      firstRaw
    );
    expect(second.authority.turn.baseline.messages).toEqual(firstRaw);
    expect(runs[0].input.messages[0].id).not.toBe(runs[1].input.messages[0].id);
    expect(liveBeforeLoad).toHaveLength(2);
    const firstLive = liveBeforeLoad[0],
      secondLive = liveBeforeLoad[1];
    expect(firstLive.messages[0].id).toBe(runs[0].input.messages[0].id);
    expect(secondLive.messages[firstLoaded.messages.length].id).toBe(
      runs[1].input.messages[0].id
    );
    const firstGeneration = firstLive.messages[0].delivery.generation;
    const secondGeneration =
      secondLive.messages[firstLoaded.messages.length].delivery.generation;
    expect(firstGeneration).toBeTruthy();
    expect(secondGeneration).toBeTruthy();
    expect(firstGeneration).not.toBe(secondGeneration);
    expect(
      firstLive.messages.every(
        (m) =>
          m.delivery.generation === firstGeneration &&
          m.delivery.phase === 'complete' &&
          m.delivery.outcome === 'success'
      )
    ).toBe(true);
    expect(
      secondLive.messages
        .slice(firstLoaded.messages.length)
        .every(
          (m) =>
            m.delivery.generation === secondGeneration &&
            m.delivery.phase === 'complete' &&
            m.delivery.outcome === 'success'
        )
    ).toBe(true);
    const semantics = (messages: typeof firstLive.messages) =>
      messages.map((message) => ({ ...message, delivery: undefined }));
    expect(
      semantics(secondLive.messages.slice(0, firstLoaded.messages.length))
    ).toEqual(semantics(firstLoaded.messages));
    expect(secondLive.toolCalls.slice(0, firstLoaded.toolCalls.length)).toEqual(
      firstLoaded.toolCalls
    );
    expect(second.toolCalls).toEqual(
      [1, 2].map((i) => ({
        id: `write-${i}`,
        name: 'write_file',
        args: { file_path: '/memories/AGENTS.md', content: contents[i - 1] },
        result: `  literal result ${i}\n\n`,
        status: 'complete',
      }))
    );
    expect(nativeSession.getSnapshot().values).toEqual({
      files: {},
      memory_scope_owner: memoryScope,
      memory_contents: { '/memories/AGENTS.md': contents[1] },
    });
    expect(
      requests.filter((r) => r.path === '/threads' && r.method === 'POST')
    ).toHaveLength(1);
    expect(
      requests.filter(
        (r) => r.path.endsWith('/runs/stream') && r.method === 'POST'
      )
    ).toHaveLength(2);
    for (const i of [1, 2]) {
      const reads = requests.filter(
        (r) => r.turn === i && !r.path.endsWith('/runs/stream')
      );
      expect(reads.map((r) => r.path)).toEqual([
        `/threads/${threadId}/state`,
        `/threads/${threadId}/history`,
        `/threads/${threadId}/state/checkpoint`,
        `/threads/${threadId}/history`,
      ]);
    }
  } finally {
    await app.dispose();
  }
});
