import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { BaseEvent, RunAgentInput } from '@ag-ui/client';
import { describe, expect, it } from 'vitest';
import { createSession, type Session } from './create-session';
import { createRun } from './create-run';
import type { InterruptMode } from './interrupt-mode';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
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
          () => reject(new Error('Interrupt HTTP milestone timed out')),
          2000
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
interface Exchange {
  body: RunAgentInput;
  response: ServerResponse;
  closed: Promise<void>;
  isClosed: boolean;
  send(...events: unknown[]): void;
}
async function serve() {
  const exchanges: Exchange[] = [];
  const arrivals = new Map<number, ReturnType<typeof deferred<Exchange>>>();
  const server = createServer(async (request, response) => {
    const closed = deferred<void>();
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const exchange: Exchange = {
      body: JSON.parse(Buffer.concat(chunks).toString()),
      response,
      closed: closed.promise,
      isClosed: false,
      send(...events) {
        for (const event of events)
          response.write(`data: ${JSON.stringify(event)}\n\n`);
      },
    };
    response.once('close', () => {
      exchange.isClosed = true;
      closed.resolve();
    });
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.flushHeaders();
    exchanges.push(exchange);
    arrivals.get(exchanges.length - 1)?.resolve(exchange);
  });
  server.listen(0, '127.0.0.1');
  await bounded(once(server, 'listening'));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/interrupt`,
    exchanges,
    next(index = 0) {
      if (exchanges[index]) return Promise.resolve(exchanges[index]);
      const arrival = arrivals.get(index) ?? deferred<Exchange>();
      arrivals.set(index, arrival);
      return bounded(arrival.promise);
    },
    async close() {
      const closed = once(server, 'close');
      server.close();
      server.closeAllConnections();
      await bounded(closed);
    },
  };
}
const notice = {
  type: 'CUSTOM',
  name: 'on_interrupt',
  value: '{"literal":"not parsed"}',
  timestamp: 1,
  metadata: { note: [1] },
};
function lifecycle(exchange: Exchange, type = 'RUN_STARTED') {
  return { type, threadId: exchange.body.threadId, runId: exchange.body.runId };
}
function until(owner: Session, predicate: () => boolean) {
  if (predicate()) return Promise.resolve();
  return bounded(
    new Promise<void>((resolve) => {
      const release = owner.subscribe(() => {
        if (predicate()) {
          release();
          resolve();
        }
      });
    })
  );
}

describe('owned interrupt evidence over held HTTP', () => {
  it.each(['native', 'legacy-observation'] as const)(
    '%s ignores child notices as root evidence',
    async (interruptMode) => {
      const server = await serve();
      const owner = createSession({
        threadId: 'thread',
        url: server.url,
        interruptMode,
      });
      try {
        const done = owner.submit('First');
        const exchange = await server.next();
        const terminal = {
          ...lifecycle(exchange, 'RUN_FINISHED'),
          outcome: { type: 'success' },
        };
        exchange.send(
          lifecycle(exchange),
          { type: 'SUBAGENT_STARTED', subagentRunId: 'child', name: 'Worker' },
          { ...notice, subagentRunId: 'child' },
          { type: 'SUBAGENT_FINISHED', subagentRunId: 'child' },
          terminal
        );
        expect(await bounded(done)).toBe('success');
        await bounded(exchange.closed);
        expect(owner.getSnapshot().run?.legacyInterrupt).toBeUndefined();
        expect(owner.getSnapshot().run?.terminal).toEqual(terminal);
      } finally {
        await owner.dispose();
        await server.close();
      }
    }
  );
  for (const interruptMode of [undefined, 'native'] satisfies (
    | InterruptMode
    | undefined
  )[]) {
    it.each(['pause', 'success', 'error', 'eof', 'stop'] as const)(
      `${interruptMode ?? 'default'} notice then %s retains honest evidence`,
      async (ending) => {
        const server = await serve();
        const owner = createSession({
          threadId: 'thread',
          url: server.url,
          interruptMode,
        });
        let settled = false;
        try {
          const done = owner.submit({
            message: 'First',
            state: { model: 'small' },
          });
          void done.then(() => {
            settled = true;
          });
          const exchange = await server.next();
          expect(exchange.body).toStrictEqual({
            threadId: 'thread',
            runId: owner.getSnapshot().run?.id,
            messages: [
              {
                id: owner.getSnapshot().transcript[0].id,
                role: 'user',
                content: 'First',
              },
            ],
            state: { model: 'small' },
            tools: [],
            context: [],
            forwardedProps: {},
          });
          exchange.send(lifecycle(exchange), notice);
          await until(owner, () =>
            Boolean(
              owner.getSnapshot().run?.legacyInterrupt ||
                owner.getSnapshot().run?.terminal
            )
          );
          const observed = owner.getSnapshot();
          expect(observed.run?.legacyInterrupt).toEqual(notice);
          expect(observed.run?.terminal).toBeUndefined();
          expect(observed.status).toBe('running');
          expect(settled).toBe(false);
          expect(exchange.isClosed).toBe(false);
          const terminal =
            ending === 'error'
              ? { type: 'RUN_ERROR', message: 'provider failed', code: 'E' }
              : {
                  ...lifecycle(exchange, 'RUN_FINISHED'),
                  outcome:
                    ending === 'pause'
                      ? {
                          type: 'interrupt',
                          interrupts: [{ id: 'approval', reason: 'Approve' }],
                        }
                      : { type: 'success' },
                };
          if (ending === 'stop') await owner.stop();
          else if (ending === 'eof') exchange.response.end();
          else exchange.send(terminal);
          expect(await bounded(done)).toBe(
            (
              {
                pause: 'paused',
                success: 'success',
                error: 'error',
                eof: 'interrupted',
                stop: 'aborted',
              } as const
            )[ending]
          );
          await bounded(exchange.closed);
          const final = owner.getSnapshot();
          expect(final.run?.legacyInterrupt).toBe(
            observed.run?.legacyInterrupt
          );
          expect(final.run?.terminal).toEqual(
            ending === 'stop' || ending === 'eof' ? undefined : terminal
          );
          expect(final.state).toBe(observed.state);
          expect(final.transcript).toBe(observed.transcript);
          expect(observed.run?.terminal).toBeUndefined();
          expect(observed.status).toBe('running');
          expect(server.exchanges).toHaveLength(1);
        } finally {
          await owner.dispose();
          await server.close();
        }
      }
    );
  }

  it('explicit legacy observation closes at the notice and shares its immutable selected evidence', async () => {
    const server = await serve();
    const owner = createSession({
      threadId: 'thread',
      url: server.url,
      interruptMode: 'legacy-observation',
    });
    try {
      const done = owner.submit('First');
      const exchange = await server.next();
      exchange.send(lifecycle(exchange), notice, {
        ...lifecycle(exchange, 'RUN_FINISHED'),
        outcome: { type: 'success' },
      });
      expect(await bounded(done)).toBe('paused');
      await bounded(exchange.closed);
      const value = owner.getSnapshot();
      expect(value.run?.legacyInterrupt).toEqual(notice);
      expect(value.run?.terminal).toBe(value.run?.legacyInterrupt);
      expect(
        Object.isFrozen(value.run?.legacyInterrupt?.metadata?.['note'])
      ).toBe(true);
    } finally {
      await owner.dispose();
      await server.close();
    }
  });

  it.each(['notice', 'terminal'] as const)(
    'callback stop at %s preserves accepted evidence and selects aborted',
    async (when) => {
      const server = await serve();
      const owner = createSession({ threadId: 'thread', url: server.url });
      let stopped = false;
      owner.subscribe(() => {
        const run = owner.getSnapshot().run;
        if (
          !stopped &&
          (when === 'notice' ? run?.legacyInterrupt : run?.terminal)
        ) {
          stopped = true;
          void owner.stop();
        }
      });
      try {
        const done = owner.submit('First');
        const exchange = await server.next();
        const terminal = {
          ...lifecycle(exchange, 'RUN_FINISHED'),
          outcome: {
            type: 'interrupt',
            interrupts: [{ id: 'approve', reason: 'Approve' }],
          },
        };
        exchange.send(lifecycle(exchange), notice, terminal);
        expect(await bounded(done)).toBe('aborted');
        await bounded(exchange.closed);
        expect(owner.getSnapshot().run?.legacyInterrupt).toEqual(notice);
        expect(owner.getSnapshot().run?.terminal).toEqual(
          when === 'terminal' ? terminal : undefined
        );
      } finally {
        await owner.dispose();
        await server.close();
      }
    }
  );

  it.each(['notice', 'terminal'] as const)(
    'replacement from %s cannot receive stale later evidence and resets run-local observations',
    async (when) => {
      const server = await serve();
      const owner = createSession({ threadId: 'thread', url: server.url });
      let replaced = false;
      let replacement: Promise<unknown> = Promise.resolve();
      let prior = owner.getSnapshot();
      owner.subscribe(() => {
        const snapshot = owner.getSnapshot();
        if (
          !replaced &&
          (when === 'notice'
            ? snapshot.run?.legacyInterrupt
            : snapshot.run?.terminal)
        ) {
          replaced = true;
          prior = snapshot;
          replacement = owner.submit('Second');
        }
      });
      try {
        const first = owner.submit({
          message: 'First',
          state: { model: 'small' },
        });
        const exchange = await server.next();
        exchange.send(lifecycle(exchange), notice, {
          ...lifecycle(exchange, 'RUN_FINISHED'),
          outcome: { type: 'success' },
        });
        const second = await server.next(1);
        expect(await bounded(first)).toBe('aborted');
        await bounded(exchange.closed);
        const current = owner.getSnapshot();
        expect(current.run?.legacyInterrupt).toBeUndefined();
        expect(current.run?.terminal).toBeUndefined();
        expect(current.run?.id).not.toBe(prior.run?.id);
        expect(current.state).toBe(prior.state);
        expect(second.body).toStrictEqual({
          threadId: 'thread',
          runId: current.run?.id,
          messages: [
            { id: prior.transcript[0].id, role: 'user', content: 'First' },
            { id: current.transcript[1].id, role: 'user', content: 'Second' },
          ],
          state: { model: 'small' },
          tools: [],
          context: [],
          forwardedProps: {},
        });
        expect(prior.run?.legacyInterrupt).toEqual(notice);
        expect(prior.run?.terminal?.type).toBe(
          when === 'terminal' ? 'RUN_FINISHED' : undefined
        );
        await owner.dispose();
        expect(await bounded(replacement)).toBe('aborted');
        await bounded(second.closed);
      } finally {
        await owner.dispose();
        await server.close();
      }
    }
  );

  it('replays captured Mastra notice/native ordering as evidence without claiming resume compatibility', async () => {
    const captured = readFileSync(
      new URL(
        '../../fixtures/runtime-transcripts/mastra-reinterrupt.sse',
        import.meta.url
      ),
      'utf8'
    );
    const server = await serve();
    const owner = createSession({ threadId: 'thread-hitl-1', url: server.url });
    try {
      const done = owner.submit('Observe');
      const exchange = await server.next();
      // Only the unpredictable run ID is rebased; the captured notice and batch stay literal.
      exchange.response.write(
        captured.replaceAll('run-hitl-2', exchange.body.runId)
      );
      expect(await bounded(done)).toBe('paused');
      await bounded(exchange.closed);
      const run = owner.getSnapshot().run;
      expect(typeof run?.legacyInterrupt?.value).toBe('string');
      expect(run?.terminal?.type).toBe('RUN_FINISHED');
      if (
        run?.terminal?.type !== 'RUN_FINISHED' ||
        run.terminal.outcome?.type !== 'interrupt'
      )
        throw new Error('Missing native interrupt batch');
      expect(run.terminal.outcome.interrupts[0].id).toBe(
        `${exchange.body.runId}::call_MYPy83hJNJl68Qe2HuX24UqT`
      );
    } finally {
      await owner.dispose();
      await server.close();
    }
  });

  it.each([undefined, 'native', 'legacy-observation'] satisfies (
    | InterruptMode
    | undefined
  )[])(
    'standalone runner uses %s interpretation consistently',
    async (interruptMode) => {
      const server = await serve();
      const events: BaseEvent[] = [];
      const input = {
        threadId: 'thread',
        runId: 'run',
        messages: [],
        state: {},
        tools: [],
        context: [],
        forwardedProps: {},
      };
      const handle = createRun({ url: server.url, interruptMode }).start(
        input,
        (event) => events.push(event)
      );
      try {
        const exchange = await server.next();
        expect(exchange.body).toStrictEqual(input);
        exchange.send(lifecycle(exchange), notice, {
          ...lifecycle(exchange, 'RUN_FINISHED'),
          outcome: { type: 'success' },
        });
        expect((await bounded(handle.done)).outcome).toBe(
          interruptMode === 'legacy-observation' ? 'paused' : 'success'
        );
        expect(events.map((event) => event.type)).toEqual(
          interruptMode === 'legacy-observation'
            ? ['RUN_STARTED', 'CUSTOM']
            : ['RUN_STARTED', 'CUSTOM', 'RUN_FINISHED']
        );
        await bounded(exchange.closed);
      } finally {
        handle.abort();
        await server.close();
      }
    }
  );

  it.each(['session', 'runner'] as const)(
    'captures %s mode once at construction',
    async (kind) => {
      const server = await serve();
      let mode: InterruptMode = 'legacy-observation';
      let reads = 0;
      const config = {
        threadId: 'thread',
        url: server.url,
        get interruptMode() {
          reads++;
          return mode;
        },
      };
      const owner = kind === 'session' ? createSession(config) : undefined;
      const runner = kind === 'runner' ? createRun(config) : undefined;
      mode = 'native';
      const handle = runner?.start(
        {
          threadId: 'thread',
          runId: 'run',
          messages: [],
          state: {},
          tools: [],
          context: [],
          forwardedProps: {},
        },
        () => undefined
      );
      try {
        const done = owner
          ? owner.submit('First')
          : handle?.done.then((result) => result.outcome);
        if (!done) throw new Error('Missing test owner');
        const exchange = await server.next();
        exchange.send(lifecycle(exchange), notice);
        expect(await bounded(done)).toBe('paused');
        await bounded(exchange.closed);
        expect(reads).toBe(1);
        if (owner)
          expect(owner.getSnapshot().run?.terminal).toBe(
            owner.getSnapshot().run?.legacyInterrupt
          );
      } finally {
        await owner?.dispose();
        handle?.abort();
        await server.close();
      }
    }
  );
});
