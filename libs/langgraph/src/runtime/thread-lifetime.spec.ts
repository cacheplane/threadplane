import { canonicalInvocation } from './tool-provenance';
import { describe, expect, it, vi } from 'vitest';
import type { ThreadState } from '@langchain/langgraph-sdk';
import type { ToolExecutionStore } from '@threadplane/core/tools';
import { setImmediate } from 'node:timers/promises';
import { createSession } from './create-session';
import type { AgentTransport, StreamEvent } from './transport.types';
import { controlledTransport } from './testing/controlled-transport';
import { deferred } from './testing/deferred';
import { finalText, weatherCall } from './testing/binding-fixture';

describe('application-owned fixed thread lifetime', () => {
  it('disposes a pending read without allowing its late result into either session', async () => {
    const pending = deferred<ThreadState[]>();
    const started = deferred<void>();
    let signal: AbortSignal | undefined;
    const transport: AgentTransport = {
      stream: async function* () {
        /* no run */
      },
      getHistory: async (thread, abort) => {
        expect(thread).toBe('a');
        signal = abort;
        started.resolve();
        return pending.promise;
      },
    };
    const a = createSession({ assistantId: 'agent', threadId: 'a', transport });
    const b = createSession({ assistantId: 'agent', threadId: 'b', transport });
    const pristineB = b.getSnapshot();
    const reading = a.load?.();
    await started.promise;
    await a.dispose();
    await reading;
    expect(signal?.aborted).toBe(true);
    const finalA = a.getSnapshot();
    pending.resolve([
      {
        values: { secret: 'A only', messages: [] },
        next: [],
        tasks: [],
        metadata: {},
        checkpoint: {
          thread_id: 'a',
          checkpoint_id: 'old',
          checkpoint_ns: '',
          checkpoint_map: {},
        },
        parent_checkpoint: null,
        created_at: '2026-09-22T00:00:00Z',
      },
    ]);
    // Let the deliberately noncooperative transport finish its read.
    await pending.promise;
    await setImmediate();
    expect(a.getSnapshot()).toBe(finalA);
    expect(b.getSnapshot()).toBe(pristineB);
    expect(await a.submit('stale UI')).toBe('aborted');
    await b.dispose();
  });

  it('keeps concurrent sessions independent when one is disposed during a stream', async () => {
    const streams = new Map<
      string,
      ReturnType<typeof controlledTransport<StreamEvent>>
    >();
    const signals = new Map<string, AbortSignal>();
    const started = { a: deferred<void>(), b: deferred<void>() };
    const transport: AgentTransport = {
      stream: (_assistant, thread, _payload, signal) => {
        const id = thread as 'a' | 'b';
        const stream = controlledTransport<StreamEvent>({
          signal,
          ignoreAbort: true,
        });
        streams.set(id, stream);
        signals.set(id, signal);
        started[id].resolve();
        return stream.stream;
      },
    };
    const a = createSession({ assistantId: 'agent', threadId: 'a', transport });
    const b = createSession({ assistantId: 'agent', threadId: 'b', transport });
    const runA = a.submit('A');
    const runB = b.submit('B');
    await Promise.all([started.a.promise, started.b.promise]);
    await a.dispose();
    expect(await runA).toBe('aborted');
    expect(signals.get('a')?.aborted).toBe(true);
    expect(signals.get('b')?.aborted).toBe(false);
    const finalA = a.getSnapshot();
    streams.get('a')?.release(finalText('late A'));
    streams.get('b')?.release(finalText('B complete'));
    streams.get('b')?.finish();
    expect(await runB).toBe('success');
    expect(a.getSnapshot()).toBe(finalA);
    expect(
      b.getSnapshot().messages.some((m) => m.content.includes('late A'))
    ).toBe(false);
    await b.dispose();
  });

  it('scopes durable claims by fixed thread even when servers reuse a tool call ID', async () => {
    const acquire = vi.fn<ToolExecutionStore['acquire']>(async () => ({
      status: 'acquired' as const,
      token: 'owner',
    }));
    const settle = vi.fn<ToolExecutionStore['settle']>(
      async () => 'accepted' as const
    );
    const handler = vi.fn(({ city }: { city: string }) => ({ city }));
    const transport: AgentTransport = {
      stream: async function* (_assistant, _thread, payload) {
        const input = payload as { messages: { type: string }[] };
        yield input.messages[0].type === 'tool'
          ? finalText('finished')
          : weatherCall;
      },
    };
    const create = (threadId: string) =>
      createSession({
        assistantId: 'agent',
        threadId,
        transport,
        executionStore: { acquire, settle },
        tools: { weather: { description: 'Weather', handler } },
      });
    const a = create('a');
    const b = create('b');
    try {
      expect(await a.submit('A')).toBe('success');
      expect(await b.submit('B')).toBe('success');
      expect(acquire.mock.calls.map((call) => call[0])).toEqual([
        { threadId: 'a', toolCallId: 'weather-call' },
        { threadId: 'b', toolCallId: 'weather-call' },
      ]);
      expect(settle.mock.calls.map((call) => call[0])).toEqual(
        acquire.mock.calls.map((call) => call[0])
      );
      expect(handler).toHaveBeenCalledTimes(2);
    } finally {
      await Promise.all([a.dispose(), b.dispose()]);
    }
  });

  it('settles a late durable acquire under the retired thread without executing its tool', async () => {
    const claiming = deferred<void>();
    const claimed = deferred<{ status: 'acquired'; token: string }>();
    const retiredFlushed = deferred<void>();
    const handler = vi.fn(({ city }: { city: string }) => ({ city }));
    const settle = vi.fn<ToolExecutionStore['settle']>(
      async () => 'accepted' as const
    );
    const flush = vi.fn<NonNullable<AgentTransport['updateState']>>(
      async (thread) => {
        expect(thread).toBe('a');
        retiredFlushed.resolve();
      }
    );
    const routes: string[] = [];
    const transport: AgentTransport = {
      stream: async function* (_assistant, thread, payload) {
        routes.push(thread ?? 'missing');
        const input = payload as { messages: { type: string }[] };
        yield input.messages[0].type === 'tool'
          ? finalText('B finished')
          : weatherCall;
      },
      updateState: flush,
    };
    const store: ToolExecutionStore = {
      acquire: async (key) => {
        if (key.threadId === 'a') {
          claiming.resolve();
          return claimed.promise;
        }
        return { status: 'acquired' as const, token: 'owner' };
      },
      settle,
    };
    const create = (threadId: string) =>
      createSession({
        assistantId: 'agent',
        threadId,
        transport,
        executionStore: store,
        tools: { weather: { description: 'Weather', handler } },
      });
    const a = create('a');
    const b = create('b');
    try {
      const oldRun = a.submit('A');
      await claiming.promise;
      await a.dispose();
      expect(await oldRun).toBe('aborted');
      expect(await b.submit('B')).toBe('success');
      const current = b.getSnapshot();
      claimed.resolve({ status: 'acquired' as const, token: 'owner' });
      await retiredFlushed.promise;
      expect(handler).toHaveBeenCalledTimes(1);
      expect(settle.mock.calls).toEqual([
        [
          { threadId: 'b', toolCallId: 'weather-call' },
          {
            invocation: canonicalInvocation('weather', { city: 'Paris' }),
            token: 'owner',
            result: JSON.stringify({ ok: true, value: { city: 'Paris' } }),
          },
        ],
        [
          { threadId: 'a', toolCallId: 'weather-call' },
          {
            invocation: canonicalInvocation('weather', { city: 'Paris' }),
            token: 'owner',
            result: expect.stringContaining('cancelled'),
          },
        ],
      ]);
      expect(routes).toEqual(['a', 'b', 'b']);
      expect(b.getSnapshot()).toBe(current);
    } finally {
      claimed.resolve({ status: 'acquired' as const, token: 'owner' });
      await Promise.all([a.dispose(), b.dispose()]);
    }
  });
});
