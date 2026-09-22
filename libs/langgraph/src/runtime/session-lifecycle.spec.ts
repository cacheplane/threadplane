import { readFileSync } from 'node:fs';
import { ReadableStream } from 'node:stream/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentSession, AgentSnapshot } from '@threadplane/core';
import { createSession } from './create-session';
import { controlledTransport } from './testing/controlled-transport';
import { deferred } from './testing/deferred';
import type { AgentTransport, StreamEvent } from './transport.types';

function fixture() {
  const streams: ReturnType<typeof controlledTransport<StreamEvent>>[] = [];
  const starts = Array.from({ length: 3 }, () => deferred<void>());
  const stream = vi.fn<AgentTransport['stream']>((_a, _t, _p, signal) => {
    const next = controlledTransport<StreamEvent>({
      signal,
      ignoreAbort: true,
    });
    streams.push(next);
    starts[streams.length - 1].resolve();
    return next.stream;
  });
  return {
    streams,
    stream,
    started: (index = 0) => starts[index].promise,
    session: createSession({
      assistantId: 'agent',
      threadId: 'thread',
      transport: { stream },
    }),
  };
}

function changed(
  session: AgentSession,
  predicate: (value: AgentSnapshot) => boolean
) {
  const result = deferred<void>();
  const unsubscribe = session.subscribe(() => {
    if (predicate(session.getSnapshot())) {
      unsubscribe();
      result.resolve();
    }
  });
  return result.promise;
}

const delta = (content: string, id = 'answer'): StreamEvent => ({
  type: 'messages',
  messages: [{ type: 'AIMessageChunk', id, content }],
  messageMetadata: {},
});
const canonical = (content: string, id = 'answer'): StreamEvent => ({
  type: 'values',
  data: { messages: [{ type: 'ai', id, content }] },
});

describe('neutral session ownership', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('constructs and observes inertly with cached isolated aggregates', async () => {
    const a = fixture();
    const b = fixture();
    const initial = a.session.getSnapshot();
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribe = a.session.subscribe(first);
    a.session.subscribe(second);
    expect(a.session.getSnapshot()).toBe(initial);
    expect(initial).toEqual({
      status: 'idle',
      messages: [],
      toolCalls: [],
      values: undefined,
      interrupts: [],
    });
    expect(first).not.toHaveBeenCalled();
    expect(a.stream).not.toHaveBeenCalled();
    const run = a.session.submit('Hello');
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(b.session.getSnapshot().status).toBe('idle');
    expect(b.stream).not.toHaveBeenCalled();
    unsubscribe();
    await a.session.stop();
    expect(await run).toBe('aborted');
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
    await a.session.dispose();
    await b.session.dispose();
  });

  it.each(['Hello', ''])(
    'streams text, preserves IDs and publishes one coherent canonical correction to %j',
    async (finalContent) => {
      const { session, stream, streams, started } = fixture();
      const snapshots: AgentSnapshot[] = [];
      session.subscribe(() => snapshots.push(session.getSnapshot()));
      const run = session.submit('Hello');
      await started();
      const optimistic = session.getSnapshot().messages[0];
      expect(stream.mock.calls[0].slice(0, 3)).toEqual([
        'agent',
        'thread',
        { messages: [{ type: 'human', id: optimistic.id, content: 'Hello' }] },
      ]);
      const gotText = changed(
        session,
        (s) => s.messages.at(-1)?.content === 'Hello world'
      );
      streams[0].release(delta('Hello '));
      streams[0].release(delta('world'));
      await gotText;
      const streamedId = session.getSnapshot().messages.at(-1)?.id;
      streams[0].release({
        type: 'values',
        data: {
          messages: [
            { type: 'human', id: optimistic.id, content: 'Hello' },
            { type: 'ai', id: streamedId, content: finalContent },
          ],
        },
      });
      streams[0].finish();
      expect(await run).toBe('success');
      const final = session.getSnapshot();
      expect(final.status).toBe('idle');
      expect(final.messages).toHaveLength(2);
      expect(final.messages[0].id).toBe(optimistic.id);
      expect(final.messages[1]).toMatchObject({
        id: streamedId,
        content: finalContent,
        delivery: { phase: 'complete', outcome: 'success' },
      });
      expect(final).toBe(session.getSnapshot());
      expect(Object.isFrozen(final.messages[1])).toBe(true);
      expect(snapshots.filter((s) => s.status === 'idle')).toHaveLength(1);
      await session.dispose();
    }
  );

  it.each(['stop', 'dispose', 'supersede'] as const)(
    'settles %s despite a noncooperative read and ignores late success or failure',
    async (action) => {
      for (const rejection of [false, true]) {
        const reads = [
          deferred<IteratorResult<StreamEvent>>(),
          deferred<IteratorResult<StreamEvent>>(),
        ];
        const starts = [deferred<void>(), deferred<void>()];
        const returned = vi.fn(
          () => new Promise<IteratorResult<StreamEvent>>(() => undefined)
        );
        let index = 0;
        const transport: AgentTransport = {
          stream: () => {
            const read = reads[index];
            starts[index++].resolve();
            return {
              [Symbol.asyncIterator]: () => ({
                next: () => read.promise,
                return: returned,
              }),
            };
          },
        };
        const session = createSession({
          assistantId: 'a',
          threadId: 't',
          transport,
        });
        const old = session.submit('old');
        await starts[0].promise;
        let newer: Promise<unknown> | undefined;
        if (action === 'supersede') newer = session.submit('new');
        else await session[action]();
        if (newer) await starts[1].promise;
        expect(await old).toBe(
          action === 'supersede' ? 'interrupted' : 'aborted'
        );
        const stable = session.getSnapshot();
        if (rejection) reads[0].reject(new Error('late private failure'));
        else reads[0].resolve({ done: false, value: canonical('late') });
        await reads[0].promise.catch(() => undefined);
        expect(session.getSnapshot()).toBe(stable);
        if (newer) {
          expect(session.getSnapshot().status).toBe('running');
          await session.stop();
          await newer;
          reads[1].resolve({ done: true, value: undefined });
        }
        expect(returned).toHaveBeenCalled();
        await session.dispose();
      }
    }
  );

  it('isolates interleaved sessions and permits a fresh explicit run after stop', async () => {
    const a = fixture();
    const b = fixture();
    const old = a.session.submit('one');
    const other = b.session.submit('two');
    await a.started();
    await b.started();
    await a.session.stop();
    expect(await old).toBe('aborted');
    const next = a.session.submit('three');
    await a.started(1);
    a.streams[1].release(canonical('a'));
    a.streams[1].finish();
    b.streams[0].release(canonical('b'));
    b.streams[0].finish();
    expect(await next).toBe('success');
    expect(await other).toBe('success');
    expect(a.session.getSnapshot().messages.at(-1)?.content).toBe('a');
    expect(b.session.getSnapshot().messages.at(-1)?.content).toBe('b');
    await a.session.dispose();
    await b.session.dispose();
  });

  it.each(['abort', 'return'] as const)(
    'preserves reentrant ownership from synchronous %s cleanup',
    async (source) => {
      for (const action of ['stop', 'dispose', 'supersede', 'error'] as const) {
        const streams: ReturnType<typeof controlledTransport<StreamEvent>>[] =
          [];
        const started = deferred<void>();
        let nested: Promise<unknown> | undefined;
        const stream = vi.fn<AgentTransport['stream']>((_a, _t, _p, signal) => {
          const controlled = controlledTransport<StreamEvent>({
            ignoreAbort: true,
          });
          streams.push(controlled);
          if (streams.length === 1) {
            const reenter = () => {
              nested = session.submit('from cleanup');
            };
            if (source === 'abort')
              signal.addEventListener('abort', reenter, { once: true });
            else {
              const original = controlled.stream.return;
              controlled.stream.return = () => {
                reenter();
                return original();
              };
            }
            started.resolve();
          }
          return controlled.stream;
        });
        const session = createSession({
          assistantId: 'a',
          threadId: 't',
          transport: { stream },
        });
        const old = session.submit('old');
        await started.promise;
        let superseding: Promise<unknown> | undefined;
        if (action === 'supersede')
          superseding = session.submit('outer submit');
        else if (action === 'error')
          streams[0].release({ type: 'error', data: { message: 'failure' } });
        else await session[action]();
        expect(await old).toBe(
          action === 'supersede'
            ? 'interrupted'
            : action === 'error'
            ? 'error'
            : 'aborted'
        );
        expect(nested).toBeDefined();
        if (action === 'dispose') {
          expect(await nested).toBe('aborted');
          expect(session.getSnapshot().status).toBe('idle');
          expect(stream).toHaveBeenCalledTimes(1);
        } else {
          expect(session.getSnapshot().status).toBe('running');
          expect(session.getSnapshot().messages.at(-1)?.content).toBe(
            'from cleanup'
          );
          await session.stop();
          expect(await nested).toBe('aborted');
        }
        if (superseding) expect(await superseding).toBe('interrupted');
        await session.dispose();
      }
    }
  );

  it.each(['stop', 'supersede', 'dispose'] as const)(
    'handles reentrant %s before dispatch and never clears a newer owner',
    async (action) => {
      const { session, stream, streams } = fixture();
      let triggered = false;
      let nested: Promise<unknown> | undefined;
      session.subscribe(() => {
        if (!triggered && session.getSnapshot().status === 'running') {
          triggered = true;
          nested =
            action === 'supersede' ? session.submit('new') : session[action]();
        }
      });
      const old = session.submit('old');
      expect(await old).toBe(
        action === 'supersede' ? 'interrupted' : 'aborted'
      );
      expect(stream).toHaveBeenCalledTimes(action === 'supersede' ? 1 : 0);
      if (action === 'supersede') {
        streams[0].release(canonical('new'));
        streams[0].finish();
        expect(await nested).toBe('success');
      } else await nested;
      await session.dispose();
    }
  );

  it('links external abort to its own controller and releases listeners on every exit', async () => {
    for (const exit of ['external', 'stop', 'success', 'preaborted'] as const) {
      const { session, stream, streams, started } = fixture();
      const controller = new AbortController();
      const add = vi.spyOn(controller.signal, 'addEventListener');
      const remove = vi.spyOn(controller.signal, 'removeEventListener');
      if (exit === 'preaborted') controller.abort();
      const run = session.submit('hello', { signal: controller.signal });
      if (exit === 'preaborted') expect(stream).not.toHaveBeenCalled();
      else {
        await started();
        const owned = stream.mock.calls[0][3];
        expect(owned).not.toBe(controller.signal);
        if (exit === 'external') controller.abort();
        if (exit === 'stop') {
          await session.stop();
          expect(controller.signal.aborted).toBe(false);
        }
        if (exit === 'success') {
          streams[0].release(canonical('done'));
          streams[0].finish();
        } else expect(owned.aborted).toBe(true);
      }
      expect(await run).toBe(exit === 'success' ? 'success' : 'aborted');
      expect(remove.mock.calls.length).toBe(add.mock.calls.length);
      await session.dispose();
    }
  });

  it('releases subscriptions permanently without dropping queued command promises', async () => {
    const { session, stream } = fixture();
    let disposed: Promise<void> | undefined;
    let queued: Promise<unknown> | undefined;
    const listener = vi.fn(() => {
      if (session.getSnapshot().status === 'running') {
        disposed = session.dispose();
        queued = session.submit('queued');
      }
    });
    session.subscribe(listener);
    expect(await session.submit('first')).toBe('aborted');
    await disposed;
    expect(await queued).toBe('aborted');
    const final = session.getSnapshot();
    const after = vi.fn();
    session.subscribe(after);
    await session.stop();
    await session.dispose();
    expect(await session.submit('later')).toBe('aborted');
    expect(session.getSnapshot()).toBe(final);
    expect(after).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
  });

  it('requires fresh root terminal evidence and excludes child namespace content', async () => {
    const { session, streams, started } = fixture();
    const run = session.submit('hello');
    await started();
    streams[0].release(canonical('first'));
    streams[0].release(delta('unfinished', 'second'));
    streams[0].release({
      type: 'values|child',
      data: {
        messages: [{ type: 'ai', id: 'child', content: 'private child' }],
      },
    });
    streams[0].finish();
    expect(await run).toBe('interrupted');
    expect(session.getSnapshot().messages.map((m) => m.content)).not.toContain(
      'private child'
    );
    await session.dispose();
  });

  it.each([
    [delta('hello'), { type: 'messages/complete' }],
    [{ type: 'values', data: { completed: true } }],
    [
      {
        type: 'messages/partial',
        messages: [{ type: 'ai', id: 'a', content: 'Hel' }],
      },
      {
        type: 'messages/partial',
        messages: [{ type: 'ai', id: 'a', content: 'Hello' }],
      },
      { type: 'checkpoints' },
    ],
  ] satisfies StreamEvent[][])(
    'accepts root terminal proof %#',
    async (...events) => {
      const { session, streams, started } = fixture();
      const run = session.submit('hello');
      await started();
      for (const event of events) streams[0].release(event);
      streams[0].finish();
      expect(await run).toBe('success');
      await session.dispose();
    }
  );

  it('keeps finalized tool-only calls but never exposes partial argument fragments', async () => {
    const { session, streams, started } = fixture();
    const run = session.submit('weather');
    await started();
    const seen = changed(session, (s) =>
      s.messages.some((m) => m.id === 'tools')
    );
    streams[0].release({
      type: 'messages',
      messageMetadata: {},
      messages: [
        {
          type: 'AIMessageChunk',
          id: 'tools',
          content: '',
          tool_call_chunks: [{ id: 'c', name: 'weather', args: '{"city":' }],
        },
      ],
    });
    await seen;
    expect(session.getSnapshot().toolCalls).toEqual([]);
    streams[0].release({
      type: 'values',
      data: {
        messages: [
          {
            type: 'ai',
            id: 'tools',
            content: '',
            tool_calls: [{ id: 'c', name: 'weather', args: { city: 'Paris' } }],
          },
        ],
      },
    });
    streams[0].finish();
    expect(await run).toBe('success');
    expect(session.getSnapshot().messages.at(-1)?.content).toBe('');
    expect(session.getSnapshot().toolCalls).toEqual([
      { id: 'c', name: 'weather', args: { city: 'Paris' }, status: 'pending' },
    ]);
    await session.dispose();
  });

  it('treats values as interim until EOF and keeps subsequent same-ID text', async () => {
    const { session, streams, started } = fixture();
    const run = session.submit('hello');
    await started();
    streams[0].release(canonical('Hello'));
    streams[0].release(delta(' world'));
    streams[0].release({ type: 'messages/complete' });
    streams[0].finish();
    expect(await run).toBe('success');
    expect(session.getSnapshot().messages.at(-1)?.content).toBe('Hello world');
    await session.dispose();
  });

  it('preserves distinct assistant steps and does not guess draft aliases from singleton partials', async () => {
    const { session, streams, started } = fixture();
    const run = session.submit('hello');
    await started();
    streams[0].release(delta('first', 'a'));
    streams[0].release({
      type: 'messages/partial',
      messages: [{ type: 'ai', id: 'b', content: 'second' }],
    });
    streams[0].release(canonical('second', 'b'));
    streams[0].release(canonical('third', 'c'));
    streams[0].finish();
    expect(await run).toBe('success');
    expect(
      session
        .getSnapshot()
        .messages.filter((m) => m.role === 'assistant')
        .map((m) => [m.id, m.content])
    ).toEqual([
      ['a', 'first'],
      ['b', 'second'],
      ['c', 'third'],
    ]);
    await session.dispose();
  });

  it('does not infer assistant identity from a shared user turn', async () => {
    const { session, streams, started } = fixture();
    const run = session.submit('hello');
    await started();
    const user = session.getSnapshot().messages[0];
    streams[0].release(delta('first step', 'a'));
    streams[0].release({
      type: 'values',
      data: {
        messages: [
          { type: 'human', id: user.id, content: user.content },
          { type: 'ai', id: 'b', content: 'second step' },
        ],
      },
    });
    streams[0].finish();
    expect(await run).toBe('success');
    expect(
      session
        .getSnapshot()
        .messages.filter((m) => m.role === 'assistant')
        .map((m) => [m.id, m.content])
    ).toEqual([
      ['a', 'first step'],
      ['b', 'second step'],
    ]);
    await session.dispose();
  });

  it.each(['success', 'interrupted'] as const)(
    'retains earlier canonical text and finalized calls when the next step is %s',
    async (outcome) => {
      const { session, streams, started } = fixture();
      const run = session.submit('hello');
      await started();
      streams[0].release(delta('draft too long', 'a'));
      streams[0].release({
        type: 'messages/complete',
        messages: [
          {
            type: 'ai',
            id: 'a',
            content: '',
            tool_calls: [
              { id: 'call', name: 'lookup', args: { key: 'value' } },
            ],
          },
        ],
      });
      streams[0].release(delta('next', 'b'));
      if (outcome === 'success')
        streams[0].release({
          type: 'messages/complete',
          messages: [{ type: 'ai', id: 'b', content: 'next' }],
        });
      streams[0].finish();
      expect(await run).toBe(outcome);
      expect(
        session.getSnapshot().messages.find((m) => m.id === 'a')
      ).toMatchObject({
        content: '',
        delivery: { phase: 'complete', outcome: 'success' },
      });
      expect(
        session.getSnapshot().messages.find((m) => m.id === 'b')
      ).toMatchObject({
        content: 'next',
        delivery: { phase: 'complete', outcome },
      });
      expect(session.getSnapshot().toolCalls).toEqual([
        {
          id: 'call',
          name: 'lookup',
          args: { key: 'value' },
          status: 'pending',
        },
      ]);
      await session.dispose();
    }
  );

  it.each([false, true])(
    'finalizes every earlier assistant in one terminal batch before a later interrupted step (correct draft: %s)',
    async (correctDraft) => {
      const { session, streams, started } = fixture();
      const run = session.submit('hello');
      await started();
      if (correctDraft) streams[0].release(delta('draft too long', 'a'));
      streams[0].release({
        type: 'values',
        data: {
          messages: [
            { type: 'ai', id: 'a', content: correctDraft ? '' : 'first' },
            { type: 'ai', id: 'b', content: 'second' },
          ],
        },
      });
      streams[0].release(delta('unfinished', 'c'));
      streams[0].finish();
      expect(await run).toBe('interrupted');
      expect(
        session.getSnapshot().messages.find((message) => message.id === 'a')
          ?.content
      ).toBe(correctDraft ? '' : 'first');
      expect(
        session
          .getSnapshot()
          .messages.filter((message) => message.role === 'assistant')
          .map((message) => [message.id, message.delivery])
      ).toEqual([
        [
          'a',
          {
            generation: expect.any(String),
            phase: 'complete',
            outcome: 'success',
          },
        ],
        [
          'b',
          {
            generation: expect.any(String),
            phase: 'complete',
            outcome: 'success',
          },
        ],
        [
          'c',
          {
            generation: expect.any(String),
            phase: 'complete',
            outcome: 'interrupted',
          },
        ],
      ]);
      await session.dispose();
    }
  );

  it('projects standard text blocks and a final tool-only assistant without content', async () => {
    const { session, streams, started } = fixture();
    const run = session.submit('hello');
    await started();
    streams[0].release({
      type: 'messages',
      messageMetadata: {},
      messages: [
        {
          type: 'AIMessageChunk',
          id: 'text',
          content: [
            { type: 'text', text: 'Hello' },
            { type: 'reasoning', text: 'private' },
          ],
        },
      ],
    });
    streams[0].release({
      type: 'values',
      data: {
        messages: [
          {
            type: 'ai',
            id: 'tool',
            tool_calls: [{ id: 'call', name: 'lookup', args: {} }],
          },
        ],
      },
    });
    streams[0].finish();
    expect(await run).toBe('success');
    expect(
      session
        .getSnapshot()
        .messages.filter((m) => m.role === 'assistant')
        .map((m) => m.content)
    ).toEqual(['Hello', '']);
    expect(session.getSnapshot().toolCalls).toHaveLength(1);
    await session.dispose();
  });

  it('owns terminal candidates before retaining them across await boundaries', async () => {
    const { session, streams, started } = fixture();
    const run = session.submit('hello');
    await started();
    const raw = {
      type: 'ai',
      id: 'owned',
      content: 'original',
      tool_calls: [{ id: 'call', name: 'lookup', args: { key: 'original' } }],
    };
    const received = changed(session, (s) =>
      s.messages.some((m) => m.id === 'owned')
    );
    streams[0].release({ type: 'values', data: { messages: [raw] } });
    await received;
    raw.content = 'mutated';
    raw.tool_calls[0].args.key = 'mutated';
    streams[0].finish();
    expect(await run).toBe('success');
    expect(session.getSnapshot().messages.at(-1)?.content).toBe('original');
    expect(session.getSnapshot().toolCalls[0].args).toEqual({
      key: 'original',
    });
    await session.dispose();
  });

  it('uses unique optimistic and generation IDs across instances of the same server thread', async () => {
    const a = fixture();
    const b = fixture();
    const first = a.session.submit('same');
    const second = b.session.submit('same');
    expect(a.session.getSnapshot().messages[0].id).not.toBe(
      b.session.getSnapshot().messages[0].id
    );
    expect(a.session.getSnapshot().messages[0].delivery.generation).not.toBe(
      b.session.getSnapshot().messages[0].delivery.generation
    );
    await a.session.dispose();
    await b.session.dispose();
    await first;
    await second;
  });

  it('captures the fixed thread and assistant before callers mutate their options', async () => {
    const stream = vi.fn<AgentTransport['stream']>(() => ({
      async *[Symbol.asyncIterator]() {
        yield { type: 'values', data: { done: true } };
      },
    }));
    const options = {
      assistantId: 'original-agent',
      threadId: 'original-thread',
      transport: { stream },
    };
    const session = createSession(options);
    options.assistantId = 'changed';
    options.threadId = 'changed';
    expect(await session.submit('hello')).toBe('success');
    expect(stream.mock.calls[0].slice(0, 2)).toEqual([
      'original-agent',
      'original-thread',
    ]);
    await session.dispose();
  });

  it('keeps an advertised status check usable after a protected SDK network failure without retrying', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('SECRET network failure'));
    vi.stubGlobal('fetch', request);
    const session = createSession({
      assistantId: 'a',
      threadId: 't',
      apiUrl: 'https://runtime.example',
      clientOptions: { maxRetries: 0, defaultHeaders: {} },
    });
    expect(await session.submit('hello')).toBe('error');
    expect(session.getSnapshot().error).toMatchObject({
      kind: 'server',
      message: 'The LangGraph request failed.',
      retryable: false,
      recovery: 'check',
    });
    const input = JSON.parse(String(request.mock.calls[0][1]?.body)).input;
    request.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            values: {
              messages: [
                ...input.messages,
                { type: 'ai', id: 'answer', content: 'committed' },
              ],
            },
            next: [],
            tasks: [],
          },
        ]),
        { headers: { 'content-type': 'application/json' } }
      )
    );
    expect(session.checkStatus).toBeTypeOf('function');
    await session.checkStatus?.();
    expect(session.getSnapshot()).toMatchObject({
      status: 'idle',
      error: undefined,
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(String(request.mock.calls[1][0])).toContain('/history');
    expect(
      request.mock.calls.filter(([url]) => String(url).endsWith('/runs/stream'))
    ).toHaveLength(1);
    await session.dispose();
  });

  it.each(['happy', 'error', 'eof', 'decode'] as const)(
    'composes real fragmented SDK SSE into snapshots: %s',
    async (mode) => {
      const happy = readFileSync(
        new URL(
          '../../../../fixtures/react-parity/traces/langgraph-text-state.sse',
          import.meta.url
        ),
        'utf8'
      );
      const trace =
        mode === 'happy'
          ? happy
          : mode === 'error'
          ? 'event: error\ndata: {"message":"SECRET SSE body","status":401}\n\n'
          : mode === 'decode'
          ? 'event: values\ndata: not-json\n\n'
          : 'event: metadata\ndata: {"run_id":"early"}\n\n';
      const bytes = new TextEncoder().encode(trace);
      let offset = 0;
      const request = vi.fn<typeof fetch>(
        async () =>
          new Response(
            new ReadableStream({
              pull(controller) {
                if (offset === bytes.length) return controller.close();
                controller.enqueue(bytes.slice(offset, offset + 3));
                offset = Math.min(offset + 3, bytes.length);
              },
            }),
            { headers: { 'content-type': 'text/event-stream' } }
          )
      );
      vi.stubGlobal('fetch', request);
      const session = createSession({
        assistantId: 'agent',
        threadId: 'thread',
        apiUrl: 'https://runtime.example',
        clientOptions: {
          maxRetries: 0,
          defaultHeaders: { authorization: 'token' },
        },
      });
      // EOF recovery also makes a read-only history request; provide its response separately.
      if (mode === 'eof')
        request
          .mockImplementationOnce(
            async () =>
              new Response(trace, {
                headers: { 'content-type': 'text/event-stream' },
              })
          )
          .mockImplementationOnce(
            async () =>
              new Response('[]', {
                headers: { 'content-type': 'application/json' },
              })
          );
      const outcome = await session.submit('Hello');
      expect(outcome).toBe(
        mode === 'happy' ? 'success' : mode === 'eof' ? 'interrupted' : 'error'
      );
      expect(
        request.mock.calls.filter(([url]) =>
          String(url).endsWith('/runs/stream')
        )
      ).toHaveLength(1);
      expect(request).toHaveBeenCalledTimes(mode === 'eof' ? 2 : 1);
      const [url, init] = request.mock.calls[0];
      expect(String(url)).toBe(
        'https://runtime.example/threads/thread/runs/stream'
      );
      expect(init?.method).toBe('POST');
      expect(new Headers(init?.headers).get('authorization')).toBe('token');
      expect(JSON.parse(String(init?.body))).toMatchObject({
        assistant_id: 'agent',
        input: { messages: [{ type: 'human', content: 'Hello' }] },
      });
      if (mode === 'happy')
        expect(session.getSnapshot().messages.at(-1)).toMatchObject({
          content: 'Hello 🌍.',
          delivery: { outcome: 'success' },
        });
      else {
        expect(session.getSnapshot().status).toBe('error');
        expect(session.getSnapshot().error?.retryable).toBe(false);
        expect(JSON.stringify(session.getSnapshot())).not.toContain('SECRET');
        expect(session.getSnapshot().error).not.toBeInstanceOf(Error);
        if (mode === 'error') {
          expect(session.getSnapshot().error).toMatchObject({
            kind: 'server',
            message: 'The LangGraph request failed.',
          });
          expect(init?.signal?.aborted).toBe(true);
        }
      }
      await session.dispose();
    }
  );
});
