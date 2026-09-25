import {
  HttpAgent,
  transformChunks,
  verifyEvents,
  type BaseEvent,
  type HttpAgentConfig,
  type RunAgentInput,
} from '@ag-ui/client';

// Transport completion is separate from RUN_FINISHED / RUN_ERROR domain events.
export type HttpRequestOutcome =
  | { status: 'closed' }
  | { status: 'aborted' }
  | { status: 'failed'; error: unknown };

export interface HttpRequestHandle {
  abort(): void;
  done: Promise<HttpRequestOutcome>;
}

function withOwnedReaderCleanup(
  response: Response,
  isSettled: () => boolean
): Response {
  const body = response.body;
  if (!body) return response;
  const ownedBody = new Proxy(body, {
    get(target, property) {
      if (property === 'getReader') {
        return (...args: Parameters<typeof body.getReader>) => {
          const reader = body.getReader(...args);
          return new Proxy(reader, {
            get(target, property) {
              if (property === 'cancel') {
                return (reason?: unknown) => {
                  const settledAtCancel = isSettled();
                  // SDK 0.0.59 rethrows a rejected cancel in a detached promise.
                  // An errored reader rejects again with the original read
                  // error, which has already selected this request's outcome.
                  return reader.cancel(reason).catch((error: unknown) => {
                    if (!settledAtCancel) throw error;
                  });
                };
              }
              const value = Reflect.get(target, property, target);
              return typeof value === 'function' ? value.bind(target) : value;
            },
          });
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return new Proxy(response, {
    get(target, property) {
      if (property === 'body') return ownedBody;
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export function createHttpRequest(
  config: Pick<HttpAgentConfig, 'url' | 'headers' | 'fetch'>
) {
  const captured = {
    url: config.url,
    headers: { ...config.headers },
    fetch: config.fetch ?? globalThis.fetch.bind(globalThis),
  };
  return {
    start(
      input: RunAgentInput,
      onEvent: (event: BaseEvent) => void,
      signal?: AbortSignal,
      beforeFetch?: () => boolean
    ): HttpRequestHandle {
      let resolve!: (outcome: HttpRequestOutcome) => void;
      const done = new Promise<HttpRequestOutcome>((yes) => {
        resolve = yes;
      });
      let settled = false;
      let controller: AbortController | undefined;
      let subscription:
        | ReturnType<ReturnType<HttpAgent['run']>['subscribe']>
        | undefined;
      const settle = (outcome: HttpRequestOutcome) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', abort);
        try {
          subscription?.unsubscribe();
        } catch {
          /* Cleanup cannot replace the first outcome or prevent abort. */
        }
        if (outcome.status !== 'closed') controller?.abort();
        resolve(outcome);
      };
      const abort = () => settle({ status: 'aborted' });
      if (signal?.aborted) {
        abort();
        return { abort, done };
      }
      signal?.addEventListener('abort', abort, { once: true });
      try {
        // Raw run eagerly dispatches and cannot be reused after cancellation.
        // It does not apply SDK events to a second messages/state authority.
        const source = new HttpAgent({
          ...captured,
          fetch: async (url, init) => {
            if (
              settled ||
              signal?.aborted ||
              controller?.signal.aborted ||
              beforeFetch?.() === false
            ) {
              abort();
              throw new DOMException(
                'Request cancelled before fetch',
                'AbortError'
              );
            }
            // The private gate and captured fetch are adjacent: no application
            // callback or asynchronous work may obscure the invocation boundary.
            return withOwnedReaderCleanup(
              await captured.fetch(url, init),
              () => settled
            );
          },
        });
        controller = source.abortController;
        const events = source
          .run(input)
          .pipe(transformChunks(), verifyEvents());
        if (!settled) {
          subscription = events.subscribe({
            next: (event) => {
              if (settled) return;
              try {
                onEvent(event);
              } catch (error) {
                settle({ status: 'failed', error });
              }
            },
            error: (error: unknown) => settle({ status: 'failed', error }),
            complete: () => settle({ status: 'closed' }),
          });
          // A synchronous callback can settle before subscribe returns.
          if (settled) subscription.unsubscribe();
        }
      } catch (error) {
        settle({ status: 'failed', error });
      }
      return { abort, done };
    },
  };
}
