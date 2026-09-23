import { createServer } from 'node:http';
import { test, expect } from '@playwright/test';
import { Client, type Checkpoint, type ThreadState } from '@langchain/langgraph-sdk';

// This lane uses the published middleware from python/uv.lock (0.1.0), not a
// PYTHONPATH override to packages/threadplane-middleware. It proves the actual
// client-tools graph/API protocol, not browser tool execution or store claims.
const prompt = 'Checkpoint protocol weather in Paris';
const input = {
  messages: [{ type: 'human', content: prompt }],
  client_tools: [{
    name: 'get_weather',
    description: 'Get weather for a location',
    parameters: { type: 'object', properties: { location: { type: 'string' } } },
  }],
};
type ToolCall = { id: string; name: string; args: Record<string, unknown> };
type State = { messages: { type: string; content: unknown; tool_calls?: ToolCall[]; tool_call_id?: string }[] };
type CheckpointEvent = {
  id?: string;
  event: string;
  data: { config: { configurable?: Record<string, unknown> }; values: State; next: string[]; metadata: Record<string, unknown> };
};

function backendUrl(): string {
  const url = process.env['CLIENT_TOOLS_API_URL'];
  if (!url) throw new Error('Global setup must expose the local client-tools API URL');
  return url;
}

function client() {
  return new Client<State>({ apiUrl: backendUrl(), apiKey: null, callerOptions: { maxRetries: 0 }, timeoutMs: 20_000 });
}

// Copy only supported routing fields, never the complete event configurable
// object (which may also contain run identity or request-specific metadata).
function position(config: Record<string, unknown> | undefined): Checkpoint & { checkpoint_id: string } {
  if (!config) throw new Error('Checkpoint event must include routing configuration');
  expect(config['thread_id']).toEqual(expect.any(String));
  expect(config['checkpoint_ns']).toEqual(expect.any(String));
  expect(config['checkpoint_id']).toEqual(expect.any(String));
  return {
    thread_id: config['thread_id'] as string,
    checkpoint_ns: config['checkpoint_ns'] as string,
    checkpoint_id: config['checkpoint_id'] as string,
    checkpoint_map: undefined,
  };
}

async function run(api: Client<State>, threadId: string, checkpoint?: Checkpoint, values: Record<string, unknown> | null = null) {
  let final: CheckpointEvent | undefined;
  for await (const event of api.runs.stream(threadId, 'client-tools', {
    input: values, checkpoint, streamMode: ['values', 'checkpoints'], signal: AbortSignal.timeout(20_000),
  })) {
    expect(event.event).not.toBe('error');
    if (event.event === 'checkpoints') final = event as CheckpointEvent;
  }
  if (!final) throw new Error('Run must emit a checkpoint event');
  const saved = await api.threads.getState(threadId, position(final.data.config.configurable));
  expect(saved.values).toEqual(final.data.values);
  expect(saved.next).toEqual(final.data.next);
  return saved;
}

function calls(state: ThreadState<State>) {
  return state.values.messages.flatMap((message) => message.tool_calls ?? []);
}

async function modelRequests() {
  const url = process.env['CLIENT_TOOLS_AIMOCK_URL'];
  if (!url) throw new Error('Global setup must expose the local aimock journal URL');
  const response = await fetch(`${url}/__aimock/journal`, { signal: AbortSignal.timeout(5_000) });
  expect(response.ok).toBe(true);
  const entries = await response.json() as { body?: { messages?: { role: string; content: unknown }[] } }[];
  return entries.filter((entry) => entry.body?.messages?.some((message) => message.role === 'user' && message.content === prompt)).length;
}

test('checkpoint protocol: terminal replay preserves a pending call; pre-agent replay creates a new call', async () => {
  const api = client();
  const { thread_id: threadId } = await api.threads.create();
  try {
    const pending = await run(api, threadId, undefined, input);
    expect(pending.next).toEqual([]);
    expect(calls(pending)).toHaveLength(1);
    const original = calls(pending)[0];
    expect(original).toMatchObject({ id: expect.any(String), name: 'get_weather', args: { location: 'Paris' } });
    const beforeAgent = (await api.threads.getHistory(threadId)).find((state) => state.next.includes('agent'));
    if (!beforeAgent) throw new Error('History must include a checkpoint before the agent runs');
    expect(calls(beforeAgent)).toEqual([]);

    const count = await modelRequests();
    const replayed = await run(api, threadId, pending.checkpoint);
    expect(replayed.next).toEqual([]);
    expect(replayed.values).toEqual(pending.values);
    expect(calls(replayed)).toEqual([original]);
    expect(await modelRequests()).toBe(count);

    const regenerated = await run(api, threadId, beforeAgent.checkpoint);
    expect(calls(regenerated)).toHaveLength(1);
    expect(calls(regenerated)[0]).toMatchObject({ name: original.name, args: original.args });
    expect(calls(regenerated)[0].id).not.toBe(original.id);
    expect(await modelRequests()).toBe(count + 1);

    const completed = await run(api, threadId, pending.checkpoint, {
      messages: [{ type: 'tool', tool_call_id: original.id, content: '68°F' }],
    });
    expect(completed.next).toEqual([]);
    expect(completed.values.messages.filter((message) => message.type === 'tool')).toMatchObject([{ tool_call_id: original.id }]);
    expect(completed.values.messages.at(-1)).toMatchObject({ type: 'ai', content: 'Protocol weather complete: Paris is 68°F.' });
    expect(await modelRequests()).toBe(count + 2);
    const completedReplay = await run(api, threadId, completed.checkpoint);
    expect(completedReplay.next).toEqual([]);
    expect(completedReplay.values).toEqual(completed.values);
    expect(await modelRequests()).toBe(count + 2);
  } finally {
    await api.threads.delete(threadId);
  }
});

test('checkpoint protocol: reconnect retains the run and exact saved checkpoint identity', async () => {
  const requests: { path: string; method: string }[] = [];
  const api = new Client<State>({
    apiUrl: backendUrl(), apiKey: null, callerOptions: { maxRetries: 0 }, timeoutMs: 20_000,
    onRequest: (url, init) => {
      requests.push({ path: url.pathname, method: init.method ?? 'GET' });
      return init;
    },
  });
  const { thread_id: threadId } = await api.threads.create();
  const controller = new AbortController();
  try {
    let runId: string | undefined;
    let cursor: string | undefined;
    let disconnectedCheckpoint: string | undefined;
    try {
      for await (const event of api.runs.stream(threadId, 'client-tools', {
        input, streamMode: ['values', 'checkpoints'], streamResumable: true,
        onDisconnect: 'continue', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
      })) {
        expect(event.event).not.toBe('error');
        if (event.event === 'metadata') runId = event.data.run_id;
        if (event.event === 'checkpoints' && event.id && event.data.next.includes('agent')) {
          cursor = event.id;
          disconnectedCheckpoint = position(event.data.config.configurable).checkpoint_id;
          controller.abort();
          break;
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    }
    if (!runId || !cursor) throw new Error('Disconnected stream must provide a run ID and checkpoint cursor');
    const checkpoints: CheckpointEvent[] = [];
    for await (const event of api.runs.joinStream(threadId, runId, {
      lastEventId: cursor, cancelOnDisconnect: false, streamMode: ['values', 'checkpoints'], signal: AbortSignal.timeout(20_000),
    })) {
      expect(event.event).not.toBe('error');
      expect(event.id).not.toBe(cursor);
      if (event.event === 'checkpoints') checkpoints.push(event as CheckpointEvent);
    }
    const final = checkpoints.at(-1);
    if (!final) throw new Error('Reconnected stream must emit a checkpoint event');
    const config = final.data.config.configurable;
    if (!config) throw new Error('Reconnected checkpoint must include routing configuration');
    expect(config['run_id']).toBe(runId);
    // Event metadata does not carry run_id; the retained config and the saved
    // checkpoint metadata are the two independently checked run identities.
    expect(final.data.metadata['run_id']).toBeUndefined();
    const exactPosition = position(config);
    expect(exactPosition.checkpoint_id).not.toBe(disconnectedCheckpoint);
    const saved = await api.threads.getState(threadId, exactPosition);
    expect(saved.checkpoint.checkpoint_id).toBe(exactPosition.checkpoint_id);
    expect(saved.metadata?.['run_id']).toBe(runId);
    expect(saved.values).toEqual(final.data.values);
    expect(saved.next).toEqual([]);
    expect((await api.runs.get(threadId, runId)).status).toBe('success');
    expect(requests.filter((request) => request.method === 'POST' && /^\/threads\/[^/]+\/runs(?:\/stream|\/wait)?$/.test(request.path)))
      .toEqual([{ method: 'POST', path: `/threads/${threadId}/runs/stream` }]);
    expect(requests).toContainEqual({ method: 'GET', path: `/threads/${threadId}/runs/${runId}/stream` });
  } finally {
    controller.abort();
    await api.threads.delete(threadId);
  }
});

test('checkpoint protocol: a lost write response is ambiguous even with retries disabled', async () => {
  const api = client();
  const { thread_id: threadId } = await api.threads.create();
  const accepted: Checkpoint[] = [];
  const proxyErrors: unknown[] = [];
  let writeRequests = 0;
  const proxy = createServer(async (request, response) => {
    try {
      expect(request.method).toBe('POST');
      expect(request.url).toBe(`/threads/${threadId}/state`);
      writeRequests++;
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const upstream = await fetch(`${backendUrl()}${request.url}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: Buffer.concat(chunks), signal: AbortSignal.timeout(10_000),
      });
      expect(upstream.status).toBe(200);
      const result = await upstream.json() as { configurable: Record<string, unknown> };
      accepted.push(position(result.configurable));
      // Upstream has accepted and returned the child position. Only this test
      // proxy knows it: the caller receives no successful response to adopt.
      response.destroy();
    } catch (error) {
      proxyErrors.push(error);
      response.writeHead(500).end();
    }
  });
  try {
    const parent = await run(api, threadId, undefined, input);
    await new Promise<void>((resolve, reject) => {
      proxy.once('error', reject);
      proxy.listen(0, '127.0.0.1', resolve);
    });
    const address = proxy.address();
    if (!address || typeof address === 'string') throw new Error('Proxy did not bind a TCP port');
    const caller = new Client({
      apiUrl: `http://127.0.0.1:${address.port}`, apiKey: null,
      // Mirrors the owned session default; standalone SDK defaults differ.
      callerOptions: { maxRetries: 0 },
    });
    await expect(caller.threads.updateState(threadId, {
      checkpoint: position(parent.checkpoint), values: { messages: [] }, asNode: 'agent', signal: AbortSignal.timeout(15_000),
    })).rejects.toThrow();
    expect(proxyErrors).toEqual([]);
    expect(writeRequests).toBe(1);
    expect(accepted).toHaveLength(1);
    expect(accepted[0].checkpoint_id).not.toBe(parent.checkpoint.checkpoint_id);
    // Read the proxy-observed child, never the thread's global latest tip.
    const child = await api.threads.getState(threadId, accepted[0]);
    expect(child.checkpoint.checkpoint_id).toBe(accepted[0].checkpoint_id);
    expect(child.parent_checkpoint?.checkpoint_id).toBe(parent.checkpoint.checkpoint_id);
    expect(child.values).toEqual(parent.values);
    expect(child.metadata?.['source']).toBe('update');
  } finally {
    proxy.closeAllConnections();
    if (proxy.listening) await new Promise<void>((resolve) => proxy.close(() => resolve()));
    await api.threads.delete(threadId);
  }
});
