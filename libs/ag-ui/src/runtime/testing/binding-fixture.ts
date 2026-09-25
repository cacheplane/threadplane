import type { RunAgentInput } from '@ag-ui/client';
import { createSession, type SessionOptions } from '../create-session';
import type { SessionSnapshot } from '../session-observation';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Fetch API bytes only; this fixture does not claim physical HTTP closure. */
function controlledFetchResponse(
  body: RunAgentInput,
  signal?: AbortSignal | null
) {
  const closed = deferred<void>();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let ended = false;
  let cancels = 0;
  let aborts = 0;
  const abort = () => {
    if (ended) return;
    ended = true;
    aborts += 1;
    controller.error(
      signal?.reason ?? new DOMException('Aborted', 'AbortError')
    );
    closed.resolve();
  };
  const stream = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
    cancel() {
      ended = true;
      cancels += 1;
      signal?.removeEventListener('abort', abort);
      closed.resolve();
    },
  });
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  return {
    body,
    response: new Response(stream, {
      headers: { 'content-type': 'text/event-stream' },
    }),
    closed: closed.promise,
    get cancels() {
      return cancels;
    },
    get aborts() {
      return aborts;
    },
    emit(event: unknown) {
      if (ended) throw new Error('The fixture response is closed');
      controller.enqueue(
        new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)
      );
    },
  };
}

/** Browser-safe test composition. All snapshots and commands belong to the real
 * private session; the fixture controls only its physical Fetch API response. */
export function bindingFixture(
  options: Pick<SessionOptions, 'messages' | 'state'> & {
    threadId?: string;
  } = {}
) {
  const exchanges: ReturnType<typeof controlledFetchResponse>[] = [];
  const starts = new Map<
    number,
    ReturnType<typeof deferred<ReturnType<typeof controlledFetchResponse>>>
  >();
  const listeners = new Set<() => void>();
  const session = createSession({
    url: 'https://native-fixture.invalid/run',
    ...options,
    threadId: options.threadId ?? 'native-thread',
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as RunAgentInput;
      const exchange = controlledFetchResponse(body, init?.signal);
      const index = exchanges.push(exchange) - 1;
      exchange.emit({
        type: 'RUN_STARTED',
        threadId: body.threadId,
        runId: body.runId,
      });
      starts.get(index)?.resolve(exchange);
      return exchange.response;
    },
  });
  return {
    session,
    exchanges,
    started(index = 0) {
      const exchange = exchanges[index];
      if (exchange) return Promise.resolve(exchange);
      let start = starts.get(index);
      if (!start) {
        start = deferred<ReturnType<typeof controlledFetchResponse>>();
        starts.set(index, start);
      }
      return start.promise;
    },
    changed(predicate: (snapshot: SessionSnapshot) => boolean) {
      const snapshot = session.getSnapshot();
      if (predicate(snapshot)) return Promise.resolve(snapshot);
      return new Promise<SessionSnapshot>((resolve) => {
        const release = session.subscribe(() => {
          const next = session.getSnapshot();
          if (predicate(next)) {
            release();
            listeners.delete(release);
            resolve(next);
          }
        });
        listeners.add(release);
      });
    },
    async cleanup() {
      for (const release of listeners) release();
      listeners.clear();
      await session.dispose();
    },
  };
}
