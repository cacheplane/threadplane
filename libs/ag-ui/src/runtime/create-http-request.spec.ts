import { ok } from 'node:assert/strict';
import { once } from 'node:events';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import {
  EventType,
  HttpAgent,
  type BaseEvent,
  type HttpAgentConfig,
  type RunAgentInput,
} from '@ag-ui/client';
import { Observable } from 'rxjs';
import { createHttpRequest } from './create-http-request';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('HTTP milestone timed out')),
          1500
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

interface Exchange {
  request: IncomingMessage;
  response: ServerResponse;
  body: unknown;
  closed: Promise<void>;
  send: (...events: unknown[]) => void;
}

async function serve(status = 200, headers: Record<string, string> = {}) {
  const exchanges: Exchange[] = [];
  const arrivals = new Map<number, ReturnType<typeof deferred<Exchange>>>();
  const server = createServer(async (request, response) => {
    const closed = deferred<void>();
    response.on('close', () => closed.resolve());
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const exchange = {
      request,
      response,
      closed: closed.promise,
      body: JSON.parse(Buffer.concat(chunks).toString()),
      send: (...events: unknown[]) => {
        for (const event of events)
          response.write(`data: ${JSON.stringify(event)}\n\n`);
      },
    };
    response.writeHead(status, {
      'content-type': 'text/event-stream',
      ...headers,
    });
    response.flushHeaders();
    exchanges.push(exchange);
    arrivals.get(exchanges.length - 1)?.resolve(exchange);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/events`,
    exchanges,
    next: (index = 0) => {
      if (exchanges[index]) return Promise.resolve(exchanges[index]);
      const arrival = arrivals.get(index) ?? deferred<Exchange>();
      arrivals.set(index, arrival);
      return bounded(arrival.promise);
    },
    close: async () => {
      const closed = once(server, 'close');
      server.close();
      server.closeAllConnections();
      await bounded(closed);
    },
  };
}

function input(runId = 'run'): RunAgentInput {
  return {
    threadId: 'thread',
    runId,
    state: { count: 1 },
    messages: [{ id: 'user', role: 'user', content: 'hello' }],
    tools: [],
    context: [],
    forwardedProps: { mode: 'test' },
  };
}

const started = {
  type: EventType.RUN_STARTED,
  threadId: 'thread',
  runId: 'run',
};
const finished = {
  type: EventType.RUN_FINISHED,
  threadId: 'thread',
  runId: 'run',
};

describe('private HTTP request owner', () => {
  it('pre-aborted admission makes zero fetches or POSTs', async () => {
    const server = await serve();
    const fetcher = vi.fn((url: string, init: RequestInit) => fetch(url, init));
    const signal = AbortSignal.abort('already left');
    const handle = createHttpRequest({ url: server.url, fetch: fetcher }).start(
      input(),
      () => {
        throw new Error('unexpected event');
      },
      signal
    );
    try {
      expect(fetcher).not.toHaveBeenCalled();
      expect(await bounded(handle.done)).toEqual({ status: 'aborted' });
      expect(server.exchanges).toHaveLength(0);
    } finally {
      handle.abort();
      await server.close();
    }
  });

  it('abort detaches events, aborts the source signal, settles locally and closes the open response before cleanup', async () => {
    const server = await serve();
    // Test-only emergency cleanup keeps the negative control bounded without
    // confusing cleanup closure with the closure asserted before finally.
    let source: HttpAgent | undefined;
    const rawRun = HttpAgent.prototype.run;
    const run = vi
      .spyOn(HttpAgent.prototype, 'run')
      .mockImplementation(function (this: HttpAgent, value) {
        // eslint-disable-next-line @typescript-eslint/no-this-alias -- Test-only SDK resource observation.
        source = this;
        return rawRun.call(this, value);
      });
    let sourceSignal: AbortSignal | null | undefined;
    const observed = deferred<void>();
    const events: BaseEvent[] = [];
    const handle = createHttpRequest({
      url: server.url,
      fetch: (url, init) => {
        sourceSignal = init.signal;
        return fetch(url, init);
      },
    }).start(input(), (event) => {
      events.push(event);
      observed.resolve();
    });
    const done = handle.done.then((outcome) => outcome);
    try {
      const exchange = await server.next();
      exchange.send(started);
      await bounded(observed.promise);
      handle.abort();
      expect(await bounded(done)).toEqual({ status: 'aborted' });
      await bounded(exchange.closed);
      expect(sourceSignal?.aborted).toBe(true);
      expect(exchange.response.destroyed).toBe(true);
      exchange.send(finished);
      handle.abort();
      expect(await done).toEqual({ status: 'aborted' });
      expect(events).toEqual([started]);
    } finally {
      handle.abort();
      source?.abortController.abort();
      run.mockRestore();
      await server.close();
    }
  });

  it('normalizes text and reasoning chunks without writing SDK messages or state', async () => {
    const server = await serve();
    let source: HttpAgent | undefined;
    const rawRun = HttpAgent.prototype.run;
    const run = vi
      .spyOn(HttpAgent.prototype, 'run')
      .mockImplementation(function (this: HttpAgent, value) {
        // eslint-disable-next-line @typescript-eslint/no-this-alias -- Test-only SDK state observation.
        source = this;
        const fetchResponse = this.fetch;
        this.fetch = async (...args) => {
          const response = await fetchResponse(...args);
          expect(response).toBeInstanceOf(Response);
          expect(response.url).toBe(server.url);
          expect(response.status).toBe(200);
          expect(response.ok).toBe(true);
          expect(response.redirected).toBe(false);
          expect(response.headers).toBeInstanceOf(Headers);
          expect(response.headers.get('content-type')).toBe(
            'text/event-stream'
          );
          expect(response.body).toBeInstanceOf(ReadableStream);
          expect(response.body).toBe(response.body);
          expect(response.body?.locked).toBe(false);
          return response;
        };
        return rawRun.call(this, value);
      });
    const events: BaseEvent[] = [];
    const handle = createHttpRequest({ url: server.url }).start(
      input(),
      (event) => events.push(event)
    );
    const done = handle.done.then((outcome) => outcome);
    try {
      const exchange = await server.next();
      exchange.send(
        started,
        { type: 'STATE_SNAPSHOT', snapshot: { count: 3 } },
        {
          type: 'TEXT_MESSAGE_CHUNK',
          messageId: 'answer',
          role: 'assistant',
          delta: 'hello',
        },
        { type: 'TEXT_MESSAGE_CHUNK', messageId: 'answer', delta: ' world' },
        {
          type: 'REASONING_MESSAGE_CHUNK',
          messageId: 'reason',
          delta: 'thinking',
        },
        finished
      );
      exchange.response.end();
      expect(await bounded(done)).toEqual({ status: 'closed' });
      expect(events.map((event) => event.type)).toEqual([
        'RUN_STARTED',
        'STATE_SNAPSHOT',
        'TEXT_MESSAGE_START',
        'TEXT_MESSAGE_CONTENT',
        'TEXT_MESSAGE_CONTENT',
        'TEXT_MESSAGE_END',
        'REASONING_MESSAGE_START',
        'REASONING_MESSAGE_CONTENT',
        'REASONING_MESSAGE_END',
        'RUN_FINISHED',
      ]);
      expect(events[2]).toMatchObject({
        messageId: 'answer',
        role: 'assistant',
      });
      expect(events[3]).toMatchObject({ delta: 'hello' });
      expect(events[4]).toMatchObject({ delta: ' world' });
      expect(events[7]).toMatchObject({
        messageId: 'reason',
        delta: 'thinking',
      });
      expect(source?.messages).toEqual([]);
      expect(source?.state).toEqual({});
    } finally {
      handle.abort();
      run.mockRestore();
      await server.close();
    }
  });

  for (const domainEvent of [
    undefined,
    finished,
    { type: 'RUN_ERROR', message: 'domain failure', code: 'domain' },
  ]) {
    it(`separates physical EOF from ${
      domainEvent?.type ?? 'missing terminal event'
    }`, async () => {
      const server = await serve();
      const received = deferred<void>();
      const events: BaseEvent[] = [];
      let settled = false;
      const handle = createHttpRequest({ url: server.url }).start(
        input(),
        (event) => {
          events.push(event);
          if (event.type === (domainEvent?.type ?? 'RUN_STARTED'))
            received.resolve();
        }
      );
      const done = handle.done.then((outcome) => {
        settled = true;
        return outcome;
      });
      try {
        const exchange = await server.next();
        exchange.send(started, ...(domainEvent ? [domainEvent] : []));
        await bounded(received.promise);
        expect(settled).toBe(false);
        exchange.response.end();
        expect(await bounded(done)).toEqual({ status: 'closed' });
        expect(events).toEqual([
          started,
          ...(domainEvent ? [domainEvent] : []),
        ]);
      } finally {
        handle.abort();
        await server.close();
      }
    });
  }

  for (const failure of [
    'decoder',
    'schema',
    'verifier',
    'http-json',
    'http-text',
  ] as const) {
    it(`contains ${failure} failure and aborts its captured source`, async () => {
      const server = await serve(
        failure.startsWith('http') ? 503 : 200,
        failure === 'http-json' ? { 'content-type': 'application/json' } : {}
      );
      let signal: AbortSignal | null | undefined;
      const external = new AbortController();
      const remove = vi.spyOn(external.signal, 'removeEventListener');
      const handle = createHttpRequest({
        url: server.url,
        fetch: (url, init) => {
          signal = init.signal;
          return fetch(url, init);
        },
      }).start(input(), () => undefined, external.signal);
      const done = handle.done.then((outcome) => outcome);
      try {
        const exchange = await server.next();
        if (failure === 'decoder')
          exchange.response.write('data: {invalid json}\n\n');
        if (failure === 'schema')
          exchange.send({ type: 'TEXT_MESSAGE_CONTENT', delta: 42 });
        if (failure === 'verifier')
          exchange.send({
            type: 'TEXT_MESSAGE_CONTENT',
            messageId: 'missing-start',
            delta: 'invalid',
          });
        if (failure === 'http-json')
          exchange.response.end(JSON.stringify({ message: 'unavailable' }));
        if (failure === 'http-text') exchange.response.end('unavailable');
        const outcome = await bounded(done);
        expect(outcome.status).toBe('failed');
        if (outcome.status === 'failed') {
          expect(outcome.error).toBeDefined();
          if (failure.startsWith('http'))
            expect(outcome.error).toMatchObject({
              status: 503,
              payload:
                failure === 'http-json'
                  ? { message: 'unavailable' }
                  : 'unavailable',
            });
        }
        expect(signal?.aborted).toBe(true);
        expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
        await bounded(exchange.closed);
        expect(exchange.response.destroyed).toBe(true);
        handle.abort();
        external.abort();
        expect(await done).toBe(outcome);
      } finally {
        handle.abort();
        await server.close();
      }
    });
  }

  for (const abortFirst of [false, true]) {
    it(`contains consumer throw${
      abortFirst ? ' after reentrant abort' : ''
    } and closes the still-open HTTP response`, async () => {
      const server = await serve();
      const error = { opaque: 'consumer failure' };
      let signal: AbortSignal | null | undefined;
      const external = new AbortController();
      const remove = vi.spyOn(external.signal, 'removeEventListener');
      const events: BaseEvent[] = [];
      const cleanupAbort = vi.fn(() => {
        external.abort();
        handle.abort();
      });
      const handle = createHttpRequest({
        url: server.url,
        fetch: (url, init) => {
          signal = init.signal;
          signal?.addEventListener('abort', cleanupAbort, { once: true });
          return fetch(url, init);
        },
      }).start(
        input(),
        (event) => {
          events.push(event);
          if (abortFirst) handle.abort();
          throw error;
        },
        external.signal
      );
      const done = handle.done.then((outcome) => outcome);
      try {
        const exchange = await server.next();
        exchange.send(started, finished);
        const outcome = await bounded(done);
        expect(outcome).toEqual(
          abortFirst ? { status: 'aborted' } : { status: 'failed', error }
        );
        if (outcome.status === 'failed') expect(outcome.error).toBe(error);
        expect(signal?.aborted).toBe(true);
        expect(cleanupAbort).toHaveBeenCalledOnce();
        await bounded(exchange.closed);
        expect(exchange.response.destroyed).toBe(true);
        expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
        handle.abort();
        expect(await done).toBe(outcome);
        expect(events).toEqual([started]);
      } finally {
        handle.abort();
        await server.close();
      }
    });
  }

  it('captures the default fetch at factory construction', async () => {
    const server = await serve();
    const factory = createHttpRequest({ url: server.url });
    const replaced = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('late replacement'));
    const handle = factory.start(input(), () => undefined);
    const done = handle.done.then((outcome) => outcome);
    try {
      expect(replaced).not.toHaveBeenCalled();
      const exchange = await server.next();
      exchange.send(started, finished);
      exchange.response.end();
      expect(await bounded(done)).toEqual({ status: 'closed' });
    } finally {
      replaced.mockRestore();
      handle.abort();
      await server.close();
    }
  });

  it('contains an abrupt socket failure after SSE delivery without an unhandled reader cleanup rejection', async () => {
    const server = await serve();
    const received = deferred<void>();
    let signal: AbortSignal | null | undefined;
    const cancelObserved = deferred<boolean>();
    let readFailure: unknown;
    const factory = createHttpRequest({
      url: server.url,
      fetch: async (url, init) => {
        signal = init.signal;
        const response = await fetch(url, init);
        const body = response.body;
        ok(body);
        const getReader = body.getReader.bind(body);
        vi.spyOn(body, 'getReader').mockImplementation(() => {
          const reader = getReader();
          const read = reader.read.bind(reader);
          vi.spyOn(reader, 'read').mockImplementation(() =>
            read().catch((error: unknown) => {
              readFailure = error;
              throw error;
            })
          );
          const cancel = reader.cancel.bind(reader);
          vi.spyOn(reader, 'cancel').mockImplementation((reason) => {
            cancelObserved.resolve(signal?.aborted === true);
            return cancel(reason);
          });
          return reader;
        });
        return response;
      },
    });
    const handle = factory.start(input(), () => received.resolve());
    let fresh: ReturnType<typeof factory.start> | undefined;
    const done = handle.done.then((outcome) => outcome);
    try {
      const exchange = await server.next();
      exchange.send(started);
      await bounded(received.promise);
      exchange.response.destroy();
      const outcome = await bounded(done);
      expect(outcome.status).toBe('failed');
      if (outcome.status === 'failed') {
        expect(outcome.error).toBeInstanceOf(TypeError);
        expect(outcome.error).toBe(readFailure);
      }
      expect(await bounded(cancelObserved.promise)).toBe(true);
      await bounded(exchange.closed);
      handle.abort();
      expect(await done).toBe(outcome);
      fresh = factory.start(input('fresh'), () => undefined);
      const freshDone = fresh.done.then((value) => value);
      const freshExchange = await server.next(1);
      handle.abort();
      freshExchange.send(
        { ...started, runId: 'fresh' },
        { ...finished, runId: 'fresh' }
      );
      freshExchange.response.end();
      expect(await bounded(freshDone)).toEqual({ status: 'closed' });
    } finally {
      handle.abort();
      fresh?.abort();
      await server.close();
    }
  });

  it('keeps the first failure and aborts even if subscription cleanup throws', async () => {
    const failure = { opaque: 'consumer' };
    const cleanupFailure = { opaque: 'cleanup' };
    let emit!: () => void;
    let source: HttpAgent | undefined;
    const run = vi
      .spyOn(HttpAgent.prototype, 'run')
      .mockImplementation(function (this: HttpAgent) {
        // eslint-disable-next-line @typescript-eslint/no-this-alias -- Test-only SDK resource observation.
        source = this;
        return new Observable<BaseEvent>((subscriber) => {
          emit = () => subscriber.next(started);
          return () => {
            throw cleanupFailure;
          };
        });
      });
    const handle = createHttpRequest({ url: 'http://unused.invalid' }).start(
      input(),
      () => {
        throw failure;
      }
    );
    const done = handle.done.then((outcome) => outcome);
    try {
      emit();
      expect(await bounded(done)).toEqual({ status: 'failed', error: failure });
      expect(source?.abortController.signal.aborted).toBe(true);
      handle.abort();
    } finally {
      source?.abortController.abort();
      run.mockRestore();
    }
  });

  it('does not suppress cancellation begun before settlement when it rejects afterward', async () => {
    // A real HTTP reader does not expose control of the underlying cancel
    // promise; this local stream pins the cleanup correction's timing boundary.
    const error = { opaque: 'earlier cancellation' };
    let rejectCancel!: (reason: unknown) => void;
    const cancellation = new Promise<void>((_, reject) => {
      rejectCancel = reject;
    });
    const body = new ReadableStream<Uint8Array>({ cancel: () => cancellation });
    const response = new Response(body, {
      headers: { 'content-type': 'text/event-stream' },
    });
    const originalGetReader = body.getReader;
    let cancelResult: Promise<unknown> | undefined;
    const rawRun = HttpAgent.prototype.run;
    const run = vi
      .spyOn(HttpAgent.prototype, 'run')
      .mockImplementation(function (this: HttpAgent, value) {
        const fetchResponse = this.fetch;
        this.fetch = async (...args) => {
          const ownedResponse = await fetchResponse(...args);
          const reader = ownedResponse.body?.getReader();
          ok(reader);
          cancelResult = reader.cancel().then(
            () => 'resolved',
            (error: unknown) => error
          );
          reader.releaseLock();
          expect(response.body).toBe(body);
          expect(body.getReader).toBe(originalGetReader);
          return ownedResponse;
        };
        return rawRun.call(this, value);
      });
    const handle = createHttpRequest({
      url: 'http://unused.invalid',
      fetch: async () => response,
    }).start(input(), () => undefined);
    try {
      expect(await bounded(handle.done)).toEqual({ status: 'closed' });
      rejectCancel(error);
      ok(cancelResult);
      expect(await bounded(cancelResult)).toBe(error);
    } finally {
      handle.abort();
      rejectCancel(error);
      run.mockRestore();
    }
  });

  it('isolates overlapping starts, external abort, stale abort and a fresh request after cancellation', async () => {
    const server = await serve();
    const signals: AbortSignal[] = [];
    const factory = createHttpRequest({
      url: server.url,
      fetch: (url, init) => {
        ok(init.signal);
        signals.push(init.signal);
        return fetch(url, init);
      },
    });
    const external = new AbortController();
    const remove = vi.spyOn(external.signal, 'removeEventListener');
    const firstEvents: BaseEvent[] = [];
    const secondEvents: BaseEvent[] = [];
    const first = factory.start(
      input('first'),
      (event) => firstEvents.push(event),
      external.signal
    );
    const second = factory.start(input('second'), (event) =>
      secondEvents.push(event)
    );
    const firstDone = first.done.then((outcome) => outcome);
    const secondDone = second.done.then((outcome) => outcome);
    let fresh: ReturnType<typeof factory.start> | undefined;
    try {
      const requests = await Promise.all([server.next(0), server.next(1)]);
      const firstExchange = requests.find(
        (exchange) => (exchange.body as RunAgentInput).runId === 'first'
      );
      const secondExchange = requests.find(
        (exchange) => (exchange.body as RunAgentInput).runId === 'second'
      );
      ok(firstExchange);
      ok(secondExchange);
      external.abort();
      expect(await bounded(firstDone)).toEqual({ status: 'aborted' });
      await bounded(firstExchange.closed);
      expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
      expect(signals[0].aborted).toBe(true);
      expect(signals[1].aborted).toBe(false);
      fresh = factory.start(input('fresh'), () => undefined);
      const freshDone = fresh.done.then((outcome) => outcome);
      const freshExchange = await server.next(2);
      first.abort();
      secondExchange.send(
        { ...started, runId: 'second' },
        { ...finished, runId: 'second' }
      );
      secondExchange.response.end();
      freshExchange.send(
        { ...started, runId: 'fresh' },
        { ...finished, runId: 'fresh' }
      );
      freshExchange.response.end();
      expect(await bounded(secondDone)).toEqual({ status: 'closed' });
      expect(await bounded(freshDone)).toEqual({ status: 'closed' });
      expect(firstEvents).toEqual([]);
      expect(secondEvents).toHaveLength(2);
      expect(new Set(signals).size).toBe(3);
      expect(signals.slice(1).every((signal) => !signal.aborted)).toBe(true);
    } finally {
      first.abort();
      second.abort();
      fresh?.abort();
      await server.close();
    }
  });

  it('lets a callback start a replacement before aborting its old physical request', async () => {
    const server = await serve();
    const factory = createHttpRequest({ url: server.url });
    let replacement: ReturnType<typeof factory.start> | undefined;
    let replacementDone: Promise<unknown> | undefined;
    const replacementEvents: BaseEvent[] = [];
    const first = factory.start(input(), () => {
      replacement = factory.start(input('replacement'), (event) =>
        replacementEvents.push(event)
      );
      replacementDone = replacement.done.then((outcome) => outcome);
      first.abort();
    });
    const firstDone = first.done.then((outcome) => outcome);
    try {
      const oldExchange = await server.next();
      oldExchange.send(started);
      expect(await bounded(firstDone)).toEqual({ status: 'aborted' });
      await bounded(oldExchange.closed);
      const exchange = await server.next(1);
      first.abort();
      exchange.send(
        { ...started, runId: 'replacement' },
        { ...finished, runId: 'replacement' }
      );
      exchange.response.end();
      ok(replacementDone);
      expect(await bounded(replacementDone)).toEqual({ status: 'closed' });
      expect(replacementEvents).toHaveLength(2);
    } finally {
      first.abort();
      replacement?.abort();
      await server.close();
    }
  });

  for (const mode of [
    'setup',
    'synchronous-consumer',
    'synchronous-abort',
    'synchronous-error',
    'synchronous-complete',
  ] as const) {
    it(`settles ${mode} before subscription assignment without leaking delivery or cleanup`, async () => {
      // HTTP cannot synchronously emit inside subscribe. Keep this timing seam
      // local to the test while retaining the actual SDK normalization/verifier.
      const error = { opaque: mode };
      const external = new AbortController();
      const remove = vi.spyOn(external.signal, 'removeEventListener');
      const teardown = vi.fn();
      let source: HttpAgent | undefined;
      const run = vi
        .spyOn(HttpAgent.prototype, 'run')
        .mockImplementation(function (this: HttpAgent) {
          // eslint-disable-next-line @typescript-eslint/no-this-alias -- Test-only SDK resource observation.
          source = this;
          if (mode === 'setup') throw error;
          return new Observable<BaseEvent>((subscriber) => {
            if (mode === 'synchronous-error') subscriber.error(error);
            else {
              subscriber.next(started);
              subscriber.next(finished);
              subscriber.complete();
              subscriber.error({ late: true });
            }
            return teardown;
          });
        });
      const events: BaseEvent[] = [];
      try {
        const handle = createHttpRequest({
          url: 'http://unused.invalid',
        }).start(
          input(),
          (event) => {
            events.push(event);
            if (mode === 'synchronous-abort') external.abort();
            if (mode === 'synchronous-consumer' || mode === 'synchronous-abort')
              throw error;
          },
          external.signal
        );
        const expected =
          mode === 'synchronous-abort'
            ? { status: 'aborted' }
            : mode === 'synchronous-complete'
            ? { status: 'closed' }
            : { status: 'failed', error };
        const outcome = await bounded(handle.done);
        expect(outcome).toEqual(expected);
        if (outcome.status === 'failed') expect(outcome.error).toBe(error);
        expect(source?.abortController.signal.aborted).toBe(
          mode !== 'synchronous-complete'
        );
        expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
        expect(teardown).toHaveBeenCalledTimes(mode === 'setup' ? 0 : 1);
        expect(events).toHaveLength(
          mode === 'setup' || mode === 'synchronous-error'
            ? 0
            : mode === 'synchronous-complete'
            ? 2
            : 1
        );
        handle.abort();
        expect(await handle.done).toBe(outcome);
      } finally {
        run.mockRestore();
      }
    });
  }

  it('is inert until start, then serializes one POST from captured configuration and admitted input', async () => {
    const server = await serve();
    const signals: AbortSignal[] = [];
    const config: Pick<HttpAgentConfig, 'url' | 'headers' | 'fetch'> = {
      url: server.url,
      headers: { 'x-request': 'captured' },
      fetch: (url, init) => {
        ok(init.signal);
        signals.push(init.signal);
        return fetch(url, init);
      },
    };
    const factory = createHttpRequest(config);
    const start = factory.start;
    expect(signals).toHaveLength(0);
    expect(server.exchanges).toHaveLength(0);
    config.url = 'http://127.0.0.1:1/wrong';
    ok(config.headers);
    config.headers['x-request'] = 'changed';
    config.fetch = () => {
      throw new Error('replacement fetch');
    };
    const admitted = input();
    const expected = structuredClone(admitted);
    const events: BaseEvent[] = [];
    const handle = start(admitted, (event) => events.push(event));
    const done = handle.done.then((outcome) => outcome);
    admitted.messages[0].content = 'changed';
    admitted.state.count = 2;
    try {
      const exchange = await server.next();
      expect(exchange.request.method).toBe('POST');
      expect(exchange.request.url).toBe('/events');
      expect(exchange.request.headers['x-request']).toBe('captured');
      expect(exchange.body).toEqual(expected);
      exchange.send(started, finished);
      exchange.response.end();
      expect(await bounded(done)).toEqual({ status: 'closed' });
      expect(events).toEqual([started, finished]);
      expect(signals).toHaveLength(1);
      expect(server.exchanges).toHaveLength(1);
    } finally {
      handle.abort();
      await server.close();
    }
  });
});
