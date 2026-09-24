import type { ThreadState } from '@langchain/langgraph-sdk';
import type { AgentSession } from '@threadplane/core';
import type { ToolExecutionStore } from '@threadplane/core/tools';
import { describe, expect, it, vi } from 'vitest';
import { createSession } from './create-session';
import type { AgentTransport, StreamEvent } from './transport.types';
import { deferred, type Deferred } from './testing/deferred';
import { controlledTransport } from './testing/controlled-transport';

type Loadable = AgentSession & {
  load?(options?: { signal?: AbortSignal }): Promise<void>;
};
function load(
  session: Loadable,
  options?: { signal?: AbortSignal }
): Promise<void> {
  expect(session.load).toBeTypeOf('function');
  return session.load?.(options) as Promise<void>;
}
function history(
  content = 'Persisted',
  messages: unknown[] = [
    { type: 'human', id: 'saved-user', content: 'Question' },
    { type: 'ai', id: 'saved-answer', content },
  ]
): ThreadState[] {
  return [
    {
      values: { messages } as ThreadState['values'],
      next: [],
      tasks: [],
      checkpoint: {
        thread_id: 'thread',
        checkpoint_id: 'checkpoint',
        checkpoint_ns: '',
        checkpoint_map: {},
      },
      metadata: null,
      created_at: null,
      parent_checkpoint: null,
    },
  ];
}
const toolMessage = {
  type: 'ai',
  id: 'tool-step',
  content: '',
  tool_calls: [{ id: 'call', name: 'work', args: {} }],
};
const answer: StreamEvent = {
  type: 'values',
  data: { messages: [{ type: 'ai', id: 'answer', content: 'Done' }] },
};
function fixture() {
  const reads: { result: Deferred<ThreadState[]>; signal: AbortSignal }[] = [];
  const started = Array.from({ length: 6 }, () => deferred<void>());
  const getHistory = vi.fn<NonNullable<AgentTransport['getHistory']>>(
    (_thread, signal) => {
      const result = deferred<ThreadState[]>();
      reads.push({ result, signal });
      started[reads.length - 1].resolve();
      return result.promise;
    }
  );
  const stream = vi.fn<AgentTransport['stream']>(async function* () {
    yield answer;
  });
  const updateState = vi.fn<NonNullable<AgentTransport['updateState']>>(
    async () => undefined
  );
  const session = createSession({
    assistantId: 'agent',
    threadId: 'thread',
    transport: { stream, getHistory, updateState },
  });
  return {
    session,
    reads,
    getHistory,
    stream,
    updateState,
    started: (index = 0) => started[index].promise,
  };
}

describe('explicit owned history loading', () => {
  it('exposes only the optional transport capability, with inert construction and observation', async () => {
    const f = fixture();
    const notify = vi.fn();
    const before = f.session.getSnapshot();
    const off = f.session.subscribe(notify);
    expect(f.session.getSnapshot()).toBe(before);
    expect(f.getHistory).not.toHaveBeenCalled();
    expect(f.stream).not.toHaveBeenCalled();
    expect(f.updateState).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect((f.session as Loadable).load).toBeTypeOf('function');
    const unsupported = createSession({
      assistantId: 'a',
      threadId: 't',
      transport: { stream: f.stream },
    });
    expect('load' in unsupported).toBe(false);
    off();
    await f.session.dispose();
    await unsupported.dispose();
  });

  it('reads once with an owned signal, atomically replaces on success, shares equal reads and clears empty history', async () => {
    const f = fixture();
    const external = new AbortController();
    const notify = vi.fn();
    f.session.subscribe(notify);
    const before = f.session.getSnapshot();
    const pending = load(f.session, { signal: external.signal });
    await f.started();
    expect(f.getHistory).toHaveBeenCalledWith('thread', f.reads[0].signal);
    expect(f.reads[0].signal).not.toBe(external.signal);
    expect(f.session.getSnapshot()).toBe(before);
    expect(notify).not.toHaveBeenCalled();
    f.reads[0].result.resolve(history());
    await pending;
    const loaded = f.session.getSnapshot();
    expect(loaded.messages.map((message) => message.content)).toEqual([
      'Question',
      'Persisted',
    ]);
    expect(loaded.status).toBe('idle');
    expect(notify).toHaveBeenCalledTimes(1);
    const equal = load(f.session);
    await f.started(1);
    f.reads[1].result.resolve(history());
    await equal;
    expect(f.session.getSnapshot()).toBe(loaded);
    expect(notify).toHaveBeenCalledTimes(1);
    const empty = load(f.session);
    await f.started(2);
    f.reads[2].result.resolve([]);
    await empty;
    expect(f.session.getSnapshot().messages).toEqual([]);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(f.stream).not.toHaveBeenCalled();
    expect(f.updateState).not.toHaveBeenCalled();
    await f.session.dispose();
  });

  it('keeps loaded snapshot on failure, rejects sanitized diagnostics and permits explicit retry', async () => {
    const f = fixture();
    const first = load(f.session);
    await f.started();
    f.reads[0].result.resolve(history());
    await first;
    const before = f.session.getSnapshot();
    const notify = vi.fn();
    f.session.subscribe(notify);
    const failed = load(f.session);
    const rejected = expect(failed).rejects.toMatchObject({
      name: 'LangGraphRequestError',
      message: 'The LangGraph request failed.',
    });
    await f.started(1);
    f.reads[1].result.reject({
      get message() {
        throw new Error('Never inspect secrets');
      },
      body: 'secret',
      cause: 'secret',
    });
    await rejected;
    expect(f.reads[1].signal.aborted).toBe(true);
    expect(f.session.getSnapshot()).toBe(before);
    expect(notify).not.toHaveBeenCalled();
    const retry = load(f.session);
    await f.started(2);
    f.reads[2].result.resolve(history('Retried'));
    await retry;
    expect(f.session.getSnapshot().messages[1].content).toBe('Retried');
    await f.session.dispose();
  });

  it('clears a prior non-recovery error only after successful history projection', async () => {
    const f = fixture();
    f.stream.mockImplementation(async function* () {
      yield { type: 'error', data: { status: 401, message: 'Login' } };
    });
    await expect(f.session.submit('Fail')).resolves.toBe('error');
    const before = f.session.getSnapshot();
    expect(before.error?.recovery).toBe('none');
    const pending = load(f.session);
    await f.started();
    expect(f.session.getSnapshot()).toBe(before);
    f.reads[0].result.resolve(history());
    await pending;
    expect(f.session.getSnapshot()).toMatchObject({
      status: 'idle',
      error: undefined,
    });
    await f.session.dispose();
  });

  it.each(['resolve', 'reject'] as const)(
    'supersedes an ignored-abort read and ignores its late %s',
    async (completion) => {
      const f = fixture();
      const first = load(f.session);
      await f.started();
      const second = load(f.session);
      await first;
      await f.started(1);
      expect(f.reads[0].signal.aborted).toBe(true);
      f.reads[1].result.resolve(history('Newest'));
      await second;
      const committed = f.session.getSnapshot();
      if (completion === 'resolve') f.reads[0].result.resolve(history('Stale'));
      else f.reads[0].result.reject(new Error('secret stale rejection'));
      await f.reads[0].result.promise.catch(() => undefined);
      await Promise.resolve();
      expect(f.session.getSnapshot()).toBe(committed);
      await f.session.dispose();
    }
  );

  it.each(
    (['stop', 'dispose', 'submit', 'abort'] as const).flatMap((command) =>
      (['resolve', 'reject'] as const).map((completion) => ({
        command,
        completion,
      }))
    )
  )(
    'settles promptly on $command and ignores late $completion',
    async ({ command, completion }) => {
      const f = fixture();
      const controller = new AbortController();
      const pending = load(f.session, { signal: controller.signal });
      await f.started();
      if (command === 'abort') controller.abort();
      else if (command === 'submit') await f.session.submit('New request');
      else await f.session[command]();
      await pending;
      expect(f.reads[0].signal.aborted).toBe(true);
      const current = f.session.getSnapshot();
      if (completion === 'resolve') f.reads[0].result.resolve(history('Stale'));
      else f.reads[0].result.reject(new Error('Late failure with raw secrets'));
      await f.reads[0].result.promise.catch(() => undefined);
      await Promise.resolve();
      expect(f.session.getSnapshot()).toBe(current);
      await f.session.dispose();
    }
  );

  it('does no I/O for pre-aborted or disposed loads and detaches caller abort listeners on success', async () => {
    const f = fixture();
    const aborted = new AbortController();
    aborted.abort();
    await load(f.session, { signal: aborted.signal });
    expect(f.getHistory).not.toHaveBeenCalled();
    const external = new AbortController();
    const remove = vi.spyOn(external.signal, 'removeEventListener');
    const pending = load(f.session, { signal: external.signal });
    await f.started();
    f.reads[0].result.resolve(history());
    await pending;
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    const current = f.session.getSnapshot();
    external.abort();
    expect(f.session.getSnapshot()).toBe(current);
    await f.session.dispose();
    await load(f.session);
    expect(f.getHistory).toHaveBeenCalledTimes(1);
  });

  it('rejects active execution and recovery admission before requesting history', async () => {
    const f = fixture();
    const running = controlledTransport<StreamEvent>();
    f.stream.mockReturnValue(running.stream);
    const submit = f.session.submit('Running');
    await expect(load(f.session)).rejects.toThrow();
    expect(f.getHistory).not.toHaveBeenCalled();
    await f.session.stop();
    await submit;
    f.stream.mockImplementation(async function* () {
      yield { type: 'error', data: { status: 500 } };
    });
    await f.session.submit('Uncertain');
    expect(f.session.getSnapshot().error?.recovery).toBe('check');
    await expect(load(f.session)).rejects.toThrow();
    expect(f.getHistory).not.toHaveBeenCalled();
    await f.session.dispose();
  });

  it('isolates concurrent reads in two sessions', async () => {
    const a = fixture();
    const b = fixture();
    const first = load(a.session);
    const second = load(b.session);
    await a.started();
    await b.started();
    await a.session.stop();
    await first;
    expect(b.reads[0].signal.aborted).toBe(false);
    b.reads[0].result.resolve(history('B'));
    await second;
    a.reads[0].result.resolve(history('A'));
    await a.reads[0].result.promise;
    expect(a.session.getSnapshot().messages).toEqual([]);
    expect(b.session.getSnapshot().messages[1].content).toBe('B');
    await a.session.dispose();
    await b.session.dispose();
  });

  it('commits a new read owner before aborting the old resource and prevents stale reentrant I/O', async () => {
    const f = fixture();
    const first = load(f.session);
    await f.started();
    f.reads[0].signal.addEventListener('abort', () => {
      void f.session.stop();
    });
    const superseding = load(f.session);
    await first;
    await superseding;
    expect(f.getHistory).toHaveBeenCalledTimes(1);
    f.reads[0].result.resolve(history('Old'));
    await f.reads[0].result.promise;
    expect(f.session.getSnapshot().messages).toEqual([]);
    await f.session.dispose();
  });

  it('allows a reentrant transport stop without publishing its eventual history', async () => {
    const f = fixture();
    const result = deferred<ThreadState[]>();
    f.getHistory.mockImplementation(() => {
      void f.session.stop();
      return result.promise;
    });
    await load(f.session);
    result.resolve(history('Never'));
    await result.promise;
    await Promise.resolve();
    expect(f.session.getSnapshot().messages).toEqual([]);
    await f.session.dispose();
  });

  it('lets an old abort callback start a newer read without dispatching the superseded middle read', async () => {
    const f = fixture();
    const first = load(f.session);
    await f.started();
    let newest: Promise<void> | undefined;
    f.reads[0].signal.addEventListener('abort', () => {
      newest = load(f.session);
    });
    const middle = load(f.session);
    await first;
    await middle;
    await f.started(1);
    expect(f.getHistory).toHaveBeenCalledTimes(2);
    f.reads[1].result.resolve(history('Newest'));
    await newest;
    f.reads[0].result.reject(new Error('Old failure'));
    await f.reads[0].result.promise.catch(() => undefined);
    expect(f.session.getSnapshot().messages[1].content).toBe('Newest');
    await f.session.dispose();
  });

  it('sanitizes a projection failure and preserves the exact previous snapshot', async () => {
    const f = fixture();
    const before = f.session.getSnapshot();
    const pending = load(f.session);
    const rejected = expect(pending).rejects.toMatchObject({
      name: 'LangGraphRequestError',
      message: 'The LangGraph request failed.',
    });
    await f.started();
    const checkpoint = history()[0];
    Object.defineProperty(checkpoint, 'values', {
      get() {
        throw new Error('Private checkpoint contents');
      },
    });
    f.reads[0].result.resolve([checkpoint]);
    await rejected;
    expect(f.session.getSnapshot()).toBe(before);
    await f.session.dispose();
  });

  it('aborts a failed read only after detaching it so its abort callback can own a replacement', async () => {
    const f = fixture();
    const failed = load(f.session);
    const rejection = expect(failed).rejects.toMatchObject({
      name: 'LangGraphRequestError',
    });
    await f.started();
    let replacement: Promise<void> | undefined;
    f.reads[0].signal.addEventListener('abort', () => {
      replacement = load(f.session);
    });
    f.reads[0].result.reject(new Error('Failed read'));
    await rejection;
    expect(replacement).toBeDefined();
    await f.started(1);
    expect(f.reads[1].signal.aborted).toBe(false);
    f.reads[1].result.resolve(history('Replacement'));
    await replacement;
    expect(f.session.getSnapshot().messages[1].content).toBe('Replacement');
    await f.session.dispose();
  });

  it('rechecks read ownership after projection invokes a raw getter', async () => {
    const f = fixture();
    const pending = load(f.session);
    await f.started();
    const checkpoint = history()[0];
    Object.defineProperty(checkpoint, 'values', {
      get() {
        void f.session.submit('New owner');
        return { messages: [{ type: 'ai', id: 'stale', content: 'Never' }] };
      },
    });
    f.reads[0].result.resolve([checkpoint]);
    await pending;
    expect(
      f.session.getSnapshot().messages.some((message) => message.id === 'stale')
    ).toBe(false);
    expect(
      f.session
        .getSnapshot()
        .messages.some((message) => message.content === 'New owner')
    ).toBe(true);
    await f.session.dispose();
  });

  it('allows a publication listener to submit after loading without stale owner cleanup cancelling it', async () => {
    const f = fixture();
    let run: Promise<unknown> | undefined;
    const off = f.session.subscribe(() => {
      if (
        !run &&
        f.session
          .getSnapshot()
          .messages.some((message) => message.id === 'saved-answer')
      )
        run = f.session.submit('Next');
    });
    const pending = load(f.session);
    await f.started();
    f.reads[0].result.resolve(history());
    await pending;
    await run;
    expect(f.stream).toHaveBeenCalledTimes(1);
    expect(
      f.session
        .getSnapshot()
        .messages.some((message) => message.content === 'Next')
    ).toBe(true);
    off();
    await f.session.dispose();
  });

  it('binds the captured history method to its transport receiver', async () => {
    const stream = vi.fn<AgentTransport['stream']>(async function* () {
      yield answer;
    });
    const transport = {
      stream,
      marker: history(),
      getHistory() {
        return Promise.resolve(this.marker);
      },
    };
    const session = createSession({
      assistantId: 'a',
      threadId: 't',
      transport,
    });
    transport.getHistory = () => Promise.reject(new Error('Replaced method'));
    await load(session);
    expect(session.getSnapshot().messages[1].content).toBe('Persisted');
    await session.dispose();
  });
});

describe('history admission around tool ownership', () => {
  it('never runs registered historical pending tools during load or later baseline replay', async () => {
    const handler = vi.fn(() => 'Never');
    const store: ToolExecutionStore = {
      claim: vi.fn(async () => 'claimed' as const),
      record: vi.fn(async () => undefined),
    };
    const getHistory = vi.fn(async () => history('', [toolMessage]));
    const stream = vi.fn<AgentTransport['stream']>(async function* () {
      yield {
        type: 'values',
        data: {
          messages: [
            toolMessage,
            { type: 'ai', id: 'fresh', content: 'Fresh' },
          ],
        },
      };
    });
    const updateState = vi.fn(async () => undefined);
    const session = createSession({
      assistantId: 'a',
      threadId: 't',
      transport: { stream, getHistory, updateState },
      executionStore: store,
      tools: { work: { description: 'Work', handler } },
    });
    await load(session);
    expect(session.getSnapshot().toolCalls).toMatchObject([
      { id: 'call', status: 'pending' },
    ]);
    expect(stream).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    expect(store.claim).not.toHaveBeenCalled();
    expect(updateState).not.toHaveBeenCalled();
    await session.submit('New turn');
    expect(handler).not.toHaveBeenCalled();
    expect(store.claim).not.toHaveBeenCalled();
    expect(store.record).not.toHaveBeenCalled();
    expect(updateState).not.toHaveBeenCalled();
    await session.dispose();
  });

  it('keeps execution dedupe after load while dropping authored-result provenance on later wire replay', async () => {
    const handler = vi.fn(() => ({ authored: true }));
    const wire = {
      type: 'tool',
      id: 'wire',
      tool_call_id: 'call',
      content: 'Wire string cannot be authored object',
    };
    const getHistory = vi.fn(async () => history('', [toolMessage, wire]));
    let streams = 0;
    const stream = vi.fn<AgentTransport['stream']>(async function* () {
      yield {
        type: 'values',
        data: {
          messages:
            ++streams === 1
              ? [toolMessage]
              : [
                  toolMessage,
                  wire,
                  { type: 'ai', id: 'fresh', content: 'Fresh' },
                ],
        },
      };
    });
    const session = createSession({
      assistantId: 'a',
      threadId: 't',
      transport: { stream, getHistory, updateState: async () => undefined },
      tools: { work: { description: 'Work', followUp: false, handler } },
    });
    await session.submit('First');
    expect(session.getSnapshot().toolCalls).toMatchObject([
      { status: 'complete', result: { authored: true } },
    ]);
    await load(session);
    expect(session.getSnapshot().toolCalls).toEqual([]);
    const seen: unknown[] = [];
    const off = session.subscribe(() =>
      seen.push(...session.getSnapshot().toolCalls)
    );
    await session.submit('Next');
    expect(seen).toEqual([]);
    expect(session.getSnapshot().toolCalls).toEqual([]);
    expect(handler).toHaveBeenCalledTimes(1);
    // An empty replacement also cannot authorize an already executed call ID.
    getHistory.mockResolvedValue([]);
    await load(session);
    stream.mockImplementation(async function* () {
      yield { type: 'values', data: { messages: [toolMessage] } };
    });
    await session.submit('Replay old id');
    expect(handler).toHaveBeenCalledTimes(1);
    off();
    await session.dispose();
  });

  it('rejects staged results after a failed write before any history request', async () => {
    const getHistory = vi.fn(async () => history());
    const session = createSession({
      assistantId: 'a',
      threadId: 't',
      transport: {
        getHistory,
        stream: async function* () {
          yield { type: 'values', data: { messages: [toolMessage] } };
        },
        updateState: async () => {
          throw new Error('Failed persistence');
        },
      },
      tools: {
        work: { description: 'Work', followUp: false, handler: () => 'Done' },
      },
    });
    await expect(session.submit('Work')).resolves.toBe('error');
    expect(session.getSnapshot().error?.recovery).toBe('none');
    await expect(load(session)).rejects.toThrow();
    expect(getHistory).not.toHaveBeenCalled();
    await session.dispose();
  });

  it.each(['claim', 'record', 'write'] as const)(
    'blocks replacement until late %s and persistence settle after stop',
    async (phase) => {
      const claim = deferred<'claimed'>();
      const recorded = deferred<void>();
      const written = deferred<void>();
      const claimStarted = deferred<void>();
      const recordStarted = deferred<void>();
      const writeStarted = deferred<void>();
      const getHistory = vi.fn(async () => history('After settlement'));
      const store: ToolExecutionStore = {
        claim: vi.fn(() => {
          claimStarted.resolve();
          return phase === 'claim'
            ? claim.promise
            : Promise.resolve('claimed' as const);
        }),
        record: vi.fn(() => {
          recordStarted.resolve();
          return phase === 'record' ? recorded.promise : Promise.resolve();
        }),
      };
      const session = createSession({
        assistantId: 'a',
        threadId: 't',
        transport: {
          getHistory,
          stream: async function* () {
            yield { type: 'values', data: { messages: [toolMessage] } };
          },
          updateState: () => {
            writeStarted.resolve();
            return written.promise;
          },
        },
        executionStore: store,
        tools: {
          work: { description: 'Work', followUp: false, handler: () => 'Done' },
        },
      });
      const submitted = session.submit('Work');
      await (phase === 'claim'
        ? claimStarted.promise
        : phase === 'record'
        ? recordStarted.promise
        : writeStarted.promise);
      await session.stop();
      await expect(submitted).resolves.toBe('aborted');
      await expect(load(session)).rejects.toThrow();
      expect(getHistory).not.toHaveBeenCalled();
      claim.resolve('claimed');
      recorded.resolve();
      await writeStarted.promise;
      await expect(load(session)).rejects.toThrow();
      expect(getHistory).not.toHaveBeenCalled();
      written.resolve();
      // Drain acknowledged cleanup without depending on its promise-chain depth.
      await new Promise<void>((resolve) => setImmediate(resolve));
      await load(session);
      expect(session.getSnapshot().messages[1].content).toBe(
        'After settlement'
      );
      await session.dispose();
    }
  );
});
