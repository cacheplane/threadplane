import { TestBed } from '@angular/core/testing';
import { FetchStreamTransport } from '@threadplane/langgraph';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { MemoryTransport } from './memory-transport';
import { MemoryScope, SCOPE_KEY } from './memory-scope';
const scope = '12345678-1234-4234-8234-123456789abc';
const calls: { path: string; method: string; body: any; headers: Headers }[] =
  [];
const signal = () => new AbortController().signal;
async function collect(iterable: AsyncIterable<unknown>) {
  const events = [];
  for await (const event of iterable) events.push(event);
  return events;
}
function json(value: unknown) {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
  });
}
function sse() {
  return new Response(
    'event: metadata\ndata: {"run_id":"fixture-run","thread_id":"fixture-thread"}\n\nevent: values\ndata: {"messages":[]}\n\n',
    { headers: { 'content-type': 'text/event-stream' } }
  );
}
beforeEach(() => {
  calls.length = 0;
  localStorage.setItem(SCOPE_KEY, scope);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      if (new URL(request.url).hostname !== 'memory.test.invalid')
        throw new Error('Offline fixture forbids other destinations');
      const body = request.method === 'GET' ? null : await request.text();
      calls.push({
        path,
        method: request.method,
        body: body ? JSON.parse(body) : null,
        headers: request.headers,
      });
      if (path.endsWith('/stream')) return sse();
      if (path.endsWith('/history')) return json([]);
      if (path.endsWith('/cancel')) return json(null);
      if (path === '/api/threads') return json({ thread_id: 'fixture-thread' });
      if (path.endsWith('/runs'))
        return json({
          run_id: 'fixture-run',
          thread_id: 'fixture-thread',
          assistant_id: 'da-memory',
          status: 'pending',
        });
      throw new Error('Unexpected fixture request: ' + path);
    })
  );
});
afterEach(() => vi.unstubAllGlobals());
function transport(
  created = vi.fn(),
  reporter?: ConstructorParameters<typeof MemoryTransport>[4]
) {
  return new MemoryTransport(
    'http://memory.test.invalid/api',
    TestBed.inject(MemoryScope),
    created,
    { defaultHeaders: { 'x-fixture-session': 'synthetic' }, maxRetries: 9 },
    reporter
  );
}
it('uses genuine SDK HTTP serialization, creation callback, headers, scope-last merge and inherited read/join/cancel APIs', async () => {
  const created = vi.fn();
  const t = transport(created);
  expect(t).toBeInstanceOf(FetchStreamTransport);
  await collect(
    t.stream('da-memory', null, { messages: [] }, signal(), {
      context: {
        memory_scope: 'override',
        extra: 'retained-but-backend-rejects',
      },
      metadata: { probe: 'retained' },
      streamMode: ['custom'],
    })
  );
  expect(created).toHaveBeenCalledExactlyOnceWith('fixture-thread');
  const request = calls.find((c) => c.path.endsWith('/runs/stream'))!;
  expect(request.body).toMatchObject({
    context: { memory_scope: scope, extra: 'retained-but-backend-rejects' },
    metadata: { probe: 'retained' },
    stream_mode: ['custom'],
  });
  expect(
    calls.every((c) => c.headers.get('x-fixture-session') === 'synthetic')
  ).toBe(true);
  expect(calls.every((c) => !c.headers.has('x-api-key'))).toBe(true);
  await t.getHistory('fixture-thread', signal());
  await collect(
    t.joinStream('fixture-thread', 'fixture-run', 'last-id', signal())
  );
  await t.cancelRun('fixture-thread', 'fixture-run', signal());
  expect(calls.some((c) => c.path.endsWith('/history'))).toBe(true);
  expect(
    calls
      .find((c) => c.path.endsWith('/fixture-run/stream'))
      ?.headers.get('last-event-id')
  ).toBe('last-id');
  expect(calls.some((c) => c.path.endsWith('/cancel'))).toBe(true);
  expect(calls.filter((c) => c.path === '/api/threads')).toHaveLength(1);
});
it('scopes queued runs and preserves enqueue, durability, metadata and checkpoint normalization', async () => {
  const t = transport();
  const entry = await t.createQueuedRun(
    'da-memory',
    'fixture-thread',
    {},
    signal(),
    {
      context: { memory_scope: 'wrong' },
      durability: 'sync',
      metadata: { keep: true },
      checkpointId: 'checkpoint-1',
    }
  );
  expect(entry.id).toBe('fixture-run');
  expect(calls[0].body).toMatchObject({
    context: { memory_scope: scope },
    multitask_strategy: 'enqueue',
    durability: 'sync',
    metadata: { keep: true },
    checkpoint: {
      checkpoint_id: 'checkpoint-1',
      checkpoint_ns: '',
      checkpoint_map: {},
    },
  });
});
it('denies transport bypass and queued authorship before any actual SDK HTTP request', async () => {
  const t = transport();
  localStorage.removeItem(SCOPE_KEY);
  await expect(
    collect(t.stream('da-memory', null, {}, signal()))
  ).rejects.toThrow('Browser memory identity');
  expect(() =>
    t.createQueuedRun('da-memory', 'fixture-thread', {}, signal())
  ).toThrow('Browser memory identity');
  expect(calls).toEqual([]);
});
it('preserves genuine protected reporter behavior and forces zero SDK retries', async () => {
  const reporter = vi.fn();
  const t = transport(undefined, reporter);
  const fetch = vi
    .fn()
    .mockRejectedValue(new TypeError('synthetic-offline-error'));
  vi.stubGlobal('fetch', fetch);
  await expect(
    collect(t.stream('da-memory', null, {}, signal()))
  ).rejects.toThrow('LangGraph');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(reporter).toHaveBeenCalledWith('network_blocked');
  expect(t.protectsOperationErrors).toBe(true);
});
