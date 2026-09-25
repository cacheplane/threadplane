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
import { createRun } from './create-run';

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

describe('private run authority', () => {
  it('pre-aborted valid admission dispatches zero requests', async () => {
    const server = await serve();
    const fetcher = vi.fn((url: string, init: RequestInit) => fetch(url, init));
    const handle = createRun({ url: server.url, fetch: fetcher }).start(
      input(),
      () => undefined,
      AbortSignal.abort()
    );
    try {
      expect(await bounded(handle.done)).toEqual({ outcome: 'aborted' });
      expect(fetcher).not.toHaveBeenCalled();
      expect(server.exchanges).toHaveLength(0);
    } finally {
      handle.abort();
      await server.close();
    }
  });

  it('preserves an opaque request failure and detaches the external listener', async () => {
    const error = { opaque: 'fetch failure' };
    const external = new AbortController();
    const remove = vi.spyOn(external.signal, 'removeEventListener');
    const handle = createRun({
      url: 'http://unused.invalid',
      fetch: async () => {
        throw error;
      },
    }).start(input(), () => undefined, external.signal);
    const result = await bounded(handle.done);
    expect(result).toEqual({ outcome: 'error', error });
    if (result.outcome === 'error') expect(result.error).toBe(error);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('contains synchronous SDK setup failure without throwing from start', async () => {
    const error = { opaque: 'SDK setup failure' };
    const run = vi.spyOn(HttpAgent.prototype, 'run').mockImplementation(() => {
      throw error;
    });
    try {
      const handle = createRun({ url: 'http://unused.invalid' }).start(
        input(),
        () => undefined
      );
      expect(await bounded(handle.done)).toEqual({ outcome: 'error', error });
    } finally {
      run.mockRestore();
    }
  });

  it('settles a synchronous terminal even when SDK teardown throws', async () => {
    const teardown = vi.fn(() => {
      throw new Error('teardown');
    });
    let source: HttpAgent | undefined;
    const run = vi
      .spyOn(HttpAgent.prototype, 'run')
      .mockImplementation(function (this: HttpAgent) {
        // eslint-disable-next-line @typescript-eslint/no-this-alias -- Test-only SDK resource observation.
        source = this;
        return new Observable<BaseEvent>((subscriber) => {
          subscriber.next(started);
          subscriber.next(finished);
          return teardown;
        });
      });
    try {
      const handle = createRun({ url: 'http://unused.invalid' }).start(
        input(),
        () => undefined
      );
      expect(await bounded(handle.done)).toEqual({ outcome: 'success' });
      expect(teardown).toHaveBeenCalledOnce();
      expect(source?.abortController.signal.aborted).toBe(true);
    } finally {
      source?.abortController.abort();
      run.mockRestore();
    }
  });
  for (const mode of [
    'pre-aborted',
    'throwing-identity',
    'abort-identity',
    'abort-spread',
  ] as const) {
    it(`local admission handles ${mode} without dispatch or throwing`, async () => {
      const external = new AbortController();
      const error = { opaque: 'input getter' };
      const admitted = input();
      const getter = vi.fn(() => {
        if (mode === 'abort-identity' || mode === 'abort-spread')
          external.abort();
        else throw error;
        return mode === 'abort-spread' ? {} : 'thread';
      });
      Object.defineProperty(
        admitted,
        mode === 'abort-spread' ? 'state' : 'threadId',
        { enumerable: true, get: getter }
      );
      const fetcher = vi.fn(() => {
        throw new Error('must not dispatch');
      });
      if (mode === 'pre-aborted') external.abort();
      const handle = createRun({
        url: 'http://unused.invalid',
        fetch: fetcher,
      }).start(admitted, () => undefined, external.signal);
      expect(await bounded(handle.done)).toEqual(
        mode === 'throwing-identity'
          ? { outcome: 'error', error }
          : { outcome: 'aborted' }
      );
      expect(fetcher).not.toHaveBeenCalled();
      if (mode === 'pre-aborted') expect(getter).not.toHaveBeenCalled();
    });
  }

  for (const invalid of [
    { threadId: '', runId: 'run' },
    { threadId: 'thread', runId: '' },
  ]) {
    for (const preAborted of [false, true]) {
      it(`empty identity admission ${JSON.stringify(
        invalid
      )}, pre-aborted=${preAborted} dispatches zero requests`, async () => {
        const server = await serve();
        const fetcher = vi.fn((url: string, init: RequestInit) =>
          fetch(url, init)
        );
        const external = new AbortController();
        if (preAborted) external.abort();
        const handle = createRun({ url: server.url, fetch: fetcher }).start(
          { ...input(), ...invalid },
          () => undefined,
          external.signal
        );
        try {
          expect((await bounded(handle.done)).outcome).toBe(
            preAborted ? 'aborted' : 'error'
          );
          expect(fetcher).not.toHaveBeenCalled();
          expect(server.exchanges).toHaveLength(0);
        } finally {
          handle.abort();
          await server.close();
        }
      });
    }
  }

  it('captures configuration and serialized input before caller mutation', async () => {
    const server = await serve();
    const config: Pick<HttpAgentConfig, 'url' | 'headers' | 'fetch'> = {
      url: server.url,
      headers: { 'x-captured': 'original' },
    };
    const factory = createRun(config);
    config.url = 'http://unused.invalid';
    ok(config.headers);
    config.headers['x-captured'] = 'mutated';
    config.fetch = () => {
      throw new Error('late fetch');
    };
    const admitted = input();
    const expected = structuredClone(admitted);
    const handle = factory.start(admitted, () => undefined);
    admitted.threadId = 'mutated';
    admitted.runId = 'mutated';
    admitted.state.count = 42;
    admitted.messages[0].content = 'mutated';
    try {
      const exchange = await server.next();
      expect(exchange.body).toEqual(expected);
      expect(exchange.request.headers['x-captured']).toBe('original');
      exchange.send(started, finished);
      expect(await bounded(handle.done)).toEqual({ outcome: 'success' });
      await bounded(exchange.closed);
      expect(server.exchanges).toHaveLength(1);
    } finally {
      handle.abort();
      await server.close();
    }
  });

  it('isolates overlapping operations, external stop, stale abort and a fresh completion', async () => {
    const server = await serve();
    const factory = createRun({ url: server.url });
    const external = new AbortController();
    const firstEvents: BaseEvent[] = [];
    const first = factory.start(
      input('first'),
      (event) => firstEvents.push(event),
      external.signal
    );
    const second = factory.start(input('second'), () => undefined);
    let fresh: ReturnType<typeof factory.start> | undefined;
    try {
      const exchanges = await Promise.all([server.next(0), server.next(1)]);
      const firstExchange = exchanges.find(
        (exchange) => (exchange.body as RunAgentInput).runId === 'first'
      );
      const secondExchange = exchanges.find(
        (exchange) => (exchange.body as RunAgentInput).runId === 'second'
      );
      ok(firstExchange);
      ok(secondExchange);
      external.abort();
      expect(await bounded(first.done)).toEqual({ outcome: 'aborted' });
      await bounded(firstExchange.closed);
      fresh = factory.start(input('fresh'), () => undefined);
      const freshExchange = await server.next(2);
      first.abort();
      secondExchange.send(
        { ...started, runId: 'second' },
        { ...finished, runId: 'second' }
      );
      freshExchange.send(
        { ...started, runId: 'fresh' },
        { ...finished, runId: 'fresh' }
      );
      expect(await bounded(second.done)).toEqual({ outcome: 'success' });
      expect(await bounded(fresh.done)).toEqual({ outcome: 'success' });
      await bounded(Promise.all([secondExchange.closed, freshExchange.closed]));
      expect(firstEvents).toEqual([]);
      expect(server.exchanges).toHaveLength(3);
    } finally {
      first.abort();
      second.abort();
      fresh?.abort();
      await server.close();
    }
  });

  it('allows a terminal callback to create a replacement and abort its old operation', async () => {
    const server = await serve();
    const factory = createRun({ url: server.url });
    let replacement: ReturnType<typeof factory.start> | undefined;
    const first = factory.start(input(), (event) => {
      if (event.type !== EventType.RUN_FINISHED) return;
      replacement = factory.start(input('replacement'), () => undefined);
      first.abort();
    });
    try {
      const exchange = await server.next();
      exchange.send(started, finished);
      expect(await bounded(first.done)).toEqual({ outcome: 'aborted' });
      await bounded(exchange.closed);
      const fresh = await server.next(1);
      first.abort();
      fresh.send(
        { ...started, runId: 'replacement' },
        { ...finished, runId: 'replacement' }
      );
      ok(replacement);
      expect(await bounded(replacement.done)).toEqual({ outcome: 'success' });
      await bounded(fresh.closed);
    } finally {
      first.abort();
      replacement?.abort();
      await server.close();
    }
  });
  const pause = {
    ...finished,
    outcome: {
      type: 'interrupt',
      interrupts: [
        { id: 'pause', reason: 'confirm', extra: 'stripped by SDK' },
      ],
    },
  };
  const failure = {
    type: EventType.RUN_ERROR,
    message: 'provider failure',
    code: 'provider',
  };

  for (const scenario of [
    {
      name: 'snapshot then finish',
      wire: [
        started,
        {
          type: 'MESSAGES_SNAPSHOT',
          messages: [{ id: 'answer', role: 'assistant', content: 'answer' }],
        },
        finished,
      ],
      outcome: 'success',
      types: ['RUN_STARTED', 'MESSAGES_SNAPSHOT', 'RUN_FINISHED'],
    },
    {
      name: 'explicit success',
      wire: [started, { ...finished, outcome: { type: 'success' } }],
      outcome: 'success',
      types: ['RUN_STARTED', 'RUN_FINISHED'],
    },
    {
      name: 'null success',
      wire: [started, { ...finished, outcome: null }],
      outcome: 'success',
      types: ['RUN_STARTED', 'RUN_FINISHED'],
    },
    {
      name: 'parentRunId alone is an explicitly requested root',
      wire: [{ ...started, parentRunId: 'outer' }, finished],
      outcome: 'success',
      types: ['RUN_STARTED', 'RUN_FINISHED'],
    },
    {
      name: 'error before start',
      wire: [failure],
      outcome: 'error',
      types: ['RUN_ERROR'],
    },
    {
      name: 'error after start',
      wire: [started, failure],
      outcome: 'error',
      types: ['RUN_STARTED', 'RUN_ERROR'],
    },
    {
      name: 'success then error',
      wire: [started, finished, failure],
      outcome: 'success',
      types: ['RUN_STARTED', 'RUN_FINISHED'],
    },
    {
      name: 'native pause then finish',
      wire: [started, pause, finished],
      outcome: 'paused',
      types: ['RUN_STARTED', 'RUN_FINISHED'],
    },
    {
      name: 'wrong start thread',
      wire: [{ ...started, threadId: 'wrong' }, finished],
      outcome: 'error',
      types: [],
    },
    {
      name: 'wrong finish run',
      wire: [started, { ...finished, runId: 'wrong' }],
      outcome: 'error',
      types: ['RUN_STARTED'],
    },
    {
      name: 'unknown finished outcome',
      wire: [started, { ...finished, outcome: { type: 'future' } }],
      outcome: 'error',
      types: ['RUN_STARTED'],
    },
    {
      name: 'empty native interrupts rejected by SDK',
      wire: [
        started,
        { ...finished, outcome: { type: 'interrupt', interrupts: [] } },
      ],
      outcome: 'error',
      types: ['RUN_STARTED'],
    },
    {
      name: 'invalid native interrupt rejected by SDK',
      wire: [
        started,
        {
          ...finished,
          outcome: {
            type: 'interrupt',
            interrupts: [{ id: 'missing-reason' }],
          },
        },
      ],
      outcome: 'error',
      types: ['RUN_STARTED'],
    },
    // The locked verifier rejects this sequence before the coordinator sees it.
    {
      name: 'observations before root admission are rejected without delivery',
      wire: [
        { type: 'CUSTOM', name: 'on_interrupt', value: 'early' },
        { type: 'MESSAGES_SNAPSHOT', messages: [] },
        started,
        finished,
      ],
      outcome: 'error',
      types: [],
    },
  ]) {
    it(`held SSE: ${scenario.name}`, async () => {
      const server = await serve();
      const external = new AbortController();
      const add = vi.spyOn(external.signal, 'addEventListener');
      const remove = vi.spyOn(external.signal, 'removeEventListener');
      let physicalSignal: AbortSignal | null | undefined;
      const events: BaseEvent[] = [];
      const handle = createRun({
        url: server.url,
        fetch: (url, init) => {
          physicalSignal = init.signal;
          return fetch(url, init);
        },
      }).start(input(), (event) => events.push(event), external.signal);
      try {
        const exchange = await server.next();
        exchange.send(...scenario.wire);
        const result = await bounded(handle.done);
        expect(result.outcome).toBe(scenario.outcome);
        expect(events.map((event) => event.type)).toEqual(scenario.types);
        expect(physicalSignal?.aborted).toBe(true);
        await bounded(exchange.closed);
        expect(exchange.response.destroyed).toBe(true);
        expect(server.exchanges).toHaveLength(1);
        expect(add).toHaveBeenCalledOnce();
        expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0][1]);
        if (scenario.name === 'snapshot then finish')
          expect(events[1]).toEqual(scenario.wire[1]);
        if (scenario.name === 'native pause then finish')
          expect(events[1].outcome).toEqual({
            type: 'interrupt',
            interrupts: [{ id: 'pause', reason: 'confirm' }],
          });
        if (scenario.name.startsWith('error')) {
          expect(result.outcome).toBe('error');
          if (result.outcome === 'error')
            expect(result.error).toEqual(new Error('provider failure'));
        }
        external.abort();
        handle.abort();
        expect(await handle.done).toBe(result);
      } finally {
        handle.abort();
        await server.close();
      }
    });
  }

  for (const childId of ['child', '']) {
    for (const childTerminal of ['SUBAGENT_FINISHED', 'SUBAGENT_ERROR']) {
      it(`native ${childTerminal} with child ID ${JSON.stringify(
        childId
      )} cannot settle the root`, async () => {
        const server = await serve();
        const childSeen = deferred<void>();
        const events: BaseEvent[] = [];
        let settled = false;
        const handle = createRun({ url: server.url }).start(
          input(),
          (event) => {
            events.push(event);
            if (event.type === childTerminal) childSeen.resolve();
          }
        );
        const done = handle.done.then((result) => {
          settled = true;
          return result;
        });
        try {
          const exchange = await server.next();
          const wire = [
            started,
            {
              type: 'SUBAGENT_STARTED',
              subagentRunId: childId,
              name: 'worker',
            },
            {
              type: 'TEXT_MESSAGE_START',
              messageId: 'child-message',
              role: 'assistant',
              subagentRunId: childId,
            },
            {
              type: 'TEXT_MESSAGE_CONTENT',
              messageId: 'child-message',
              delta: 'child',
              subagentRunId: childId,
            },
            {
              type: 'TEXT_MESSAGE_END',
              messageId: 'child-message',
              subagentRunId: childId,
            },
            {
              type: 'CUSTOM',
              name: 'on_interrupt',
              value: 'child pause',
              subagentRunId: childId,
            },
            {
              type: childTerminal,
              subagentRunId: childId,
              message: 'child failure',
            },
          ];
          exchange.send(...wire);
          await bounded(childSeen.promise);
          expect(settled).toBe(false);
          expect(events).toEqual(wire);
          exchange.send(finished);
          expect(await bounded(done)).toEqual({ outcome: 'success' });
          await bounded(exchange.closed);
        } finally {
          handle.abort();
          await server.close();
        }
      });
    }
    for (const terminal of [started, finished, failure]) {
      it(`rejects SSE ${terminal.type} tagged with ${JSON.stringify(
        childId
      )}, including matching root IDs`, async () => {
        const server = await serve();
        const events: BaseEvent[] = [];
        const handle = createRun({ url: server.url }).start(input(), (event) =>
          events.push(event)
        );
        try {
          const exchange = await server.next();
          if (terminal.type !== EventType.RUN_STARTED) exchange.send(started);
          exchange.send({ ...terminal, subagentRunId: childId }, finished);
          expect((await bounded(handle.done)).outcome).toBe('error');
          expect(events).toEqual(
            terminal.type === EventType.RUN_STARTED ? [] : [started]
          );
          await bounded(exchange.closed);
        } finally {
          handle.abort();
          await server.close();
        }
      });
    }
  }

  for (const mode of [
    'throw',
    'abort',
    'abort-throw',
    'external',
    'external-throw',
  ] as const) {
    it(`terminal callback ${mode} keeps the first outcome and closes HTTP`, async () => {
      const server = await serve();
      const external = new AbortController();
      const remove = vi.spyOn(external.signal, 'removeEventListener');
      const error = { opaque: 'projection failure' };
      const events: BaseEvent[] = [];
      const handle = createRun({ url: server.url }).start(
        input(),
        (event) => {
          events.push(event);
          if (event.type !== EventType.RUN_FINISHED) return;
          if (mode.startsWith('abort')) handle.abort();
          if (mode.startsWith('external')) external.abort();
          if (mode.includes('throw')) throw error;
        },
        external.signal
      );
      try {
        const exchange = await server.next();
        exchange.send(started, finished, failure);
        expect(await bounded(handle.done)).toEqual(
          mode === 'throw'
            ? { outcome: 'error', error }
            : { outcome: 'aborted' }
        );
        expect(events).toEqual([started, finished]);
        expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
        await bounded(exchange.closed);
      } finally {
        handle.abort();
        await server.close();
      }
    });
  }

  for (const terminal of [
    finished,
    pause,
    failure,
    { type: EventType.CUSTOM, name: 'on_interrupt', value: 'confirm' },
  ]) {
    it(`captures ${terminal.type} authority before callback mutation`, async () => {
      const server = await serve();
      const handle = createRun({
        url: server.url,
        interruptMode: 'legacy-observation',
      }).start(input(), (event) => {
        event.threadId = 'mutated';
        event.runId = 'mutated';
        event.message = 'mutated';
        event.subagentRunId = 'mutated';
        event.name = 'mutated';
        event.outcome = { type: 'future' };
        event.type = EventType.RAW;
      });
      try {
        const exchange = await server.next();
        exchange.send(started, terminal);
        const result = await bounded(handle.done);
        expect(result.outcome).toBe(
          terminal === finished
            ? 'success'
            : terminal === failure
            ? 'error'
            : 'paused'
        );
        if (result.outcome === 'error')
          expect(result.error).toEqual(new Error('provider failure'));
        await bounded(exchange.closed);
      } finally {
        handle.abort();
        await server.close();
      }
    });
  }
  for (const throwAfterAbort of [false, true]) {
    it(`external abort in synchronous terminal callback wins before handle assignment (throw=${throwAfterAbort})`, async () => {
      const external = new AbortController();
      const remove = vi.spyOn(external.signal, 'removeEventListener');
      const teardown = vi.fn();
      let source: HttpAgent | undefined;
      const run = vi
        .spyOn(HttpAgent.prototype, 'run')
        .mockImplementation(function (this: HttpAgent) {
          // eslint-disable-next-line @typescript-eslint/no-this-alias -- Test-only SDK resource observation.
          source = this;
          return new Observable<BaseEvent>((subscriber) => {
            subscriber.next(started);
            subscriber.next(finished);
            subscriber.next({ type: EventType.RUN_ERROR, message: 'late' });
            return teardown;
          });
        });
      const events: BaseEvent[] = [];
      try {
        const handle = createRun({ url: 'http://unused.invalid' }).start(
          input(),
          (event) => {
            events.push(event);
            if (event.type === EventType.RUN_FINISHED) {
              external.abort();
              if (throwAfterAbort) throw new Error('after abort');
            }
          },
          external.signal
        );
        expect(await bounded(handle.done)).toEqual({ outcome: 'aborted' });
        expect(events).toEqual([started, finished]);
        expect(source?.abortController.signal.aborted).toBe(true);
        expect(teardown).toHaveBeenCalledOnce();
        expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
      } finally {
        source?.abortController.abort();
        run.mockRestore();
      }
    });
  }
  for (const scenario of [
    {
      name: 'matching completion',
      events: [started, finished],
      outcome: 'success',
    },
    {
      name: 'EOF after text',
      events: [
        started,
        { type: 'TEXT_MESSAGE_CHUNK', messageId: 'answer', delta: 'hello' },
      ],
      outcome: 'interrupted',
    },
    {
      name: 'wrong start run',
      events: [{ ...started, runId: 'wrong' }, finished],
      outcome: 'error',
    },
    {
      name: 'wrong finish thread',
      events: [started, { ...finished, threadId: 'wrong' }],
      outcome: 'error',
    },
    {
      name: 'legacy pause before finish',
      events: [
        started,
        { type: 'CUSTOM', name: 'on_interrupt', value: [{ value: 'confirm' }] },
        finished,
      ],
      outcome: 'paused',
    },
    {
      name: 'native pause',
      events: [
        started,
        {
          ...finished,
          outcome: {
            type: 'interrupt',
            interrupts: [{ id: 'pause', reason: 'confirm' }],
          },
        },
      ],
      outcome: 'paused',
    },
  ]) {
    it(scenario.name, async () => {
      const server = await serve();
      const events: BaseEvent[] = [];
      const external = new AbortController();
      const remove = vi.spyOn(external.signal, 'removeEventListener');
      const handle = createRun({
        url: server.url,
        interruptMode:
          scenario.name === 'legacy pause before finish'
            ? 'legacy-observation'
            : 'native',
      }).start(input(), (event) => events.push(event), external.signal);
      try {
        const exchange = await server.next();
        exchange.send(...scenario.events);
        exchange.response.end();
        expect((await bounded(handle.done)).outcome).toBe(scenario.outcome);
        expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
        expect(server.exchanges).toHaveLength(1);
        if (scenario.outcome === 'success')
          expect(events).toEqual([started, finished]);
        if (scenario.outcome === 'paused')
          expect(events.map((event) => event.type)).toEqual([
            'RUN_STARTED',
            scenario.events[1].type,
          ]);
      } finally {
        handle.abort();
        await server.close();
      }
    });
  }
});
