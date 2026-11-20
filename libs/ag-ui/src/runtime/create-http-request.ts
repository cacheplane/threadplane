import {
  CompatibilityBoundary,
  enforceEvents,
  HttpAgent,
  transformChunks,
  verifyEvents,
  type AbstractAgent,
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
  /**
   * Leaves a stream whose run has already ended: the response is closed, and
   * a handed agent is not told to abort a run that is over.
   */
  close(): void;
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
          // A read rejection is the stream's failure; the SDK forwards that
          // same error as this request's `failed` outcome.
          let readFailure: { error: unknown } | undefined;
          return new Proxy(reader, {
            get(target, property) {
              if (property === 'read') {
                return (...readArgs: unknown[]) =>
                  (
                    Reflect.apply(
                      reader.read,
                      reader,
                      readArgs
                    ) as Promise<unknown>
                  ).catch((error: unknown) => {
                    readFailure ??= { error };
                    throw error;
                  });
              }
              if (property === 'cancel') {
                return (reason?: unknown) => {
                  const settledAtCancel = isSettled();
                  // The 1.0.1 client cancels the reader in its subscription
                  // teardown, on completion AND on stream failure, and rethrows
                  // a non-abort rejection from a detached promise. On failure
                  // the teardown runs before the error reaches this owner, so
                  // the request is not yet settled. An errored reader rejects
                  // cancel with the original read error, which is already
                  // selecting this request's outcome: contain that echo. A
                  // cancel begun before settlement that rejects with anything
                  // else still propagates.
                  return reader.cancel(reason).catch((error: unknown) => {
                    if (settledAtCancel) return;
                    if (readFailure && readFailure.error === error) return;
                    throw error;
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

/**
 * What a session needs of an AG-UI client agent it is handed: the protocol's
 * own `run`. Any `AbstractAgent` is one. The session sends each request's full
 * input itself and reads nothing from the agent's own messages or state.
 */
export interface SessionAgent {
  run(input: RunAgentInput): ReturnType<AbstractAgent['run']>;
  /** Called when a request is cancelled or fails after `run` was called. */
  abortRun?(): void;
  /** An HTTP agent's controller; replaced before each run, as `runAgent` does. */
  abortController?: AbortController;
  readonly agentId?: string;
  readonly threadId?: string;
}

/** Where requests go: an HTTP endpoint, or a client agent the caller built. */
export interface RequestSource {
  readonly url?: HttpAgentConfig['url'];
  readonly headers?: HttpAgentConfig['headers'];
  readonly fetch?: HttpAgentConfig['fetch'];
  readonly agent?: SessionAgent;
  /** Names the agent on the HTTP agent the request is sent with. */
  readonly agentId?: string;
}

export function createHttpRequest(config: RequestSource) {
  const agent = config.agent;
  const captured = {
    url: config.url as string,
    headers: { ...config.headers },
    // A client agent brings its own transport; the global fetch is not read.
    fetch: agent
      ? undefined
      : config.fetch ?? globalThis.fetch.bind(globalThis),
    ...(config.agentId !== undefined && { agentId: config.agentId }),
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
      /** The handed agent's `run` was called for this request. */
      let ran = false;
      /** The owner is leaving a run that ended; there is nothing to cancel. */
      let leaving = false;
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
        if (outcome.status !== 'closed') {
          controller?.abort();
          if (ran && !leaving)
            try {
              agent?.abortRun?.();
            } catch {
              /* The agent's own cleanup cannot replace the first outcome. */
            }
        }
        resolve(outcome);
      };
      const abort = () => settle({ status: 'aborted' });
      const close = () => {
        leaving = true;
        abort();
      };
      if (signal?.aborted) {
        abort();
        return { abort, close, done };
      }
      signal?.addEventListener('abort', abort, { once: true });
      try {
        // Raw run eagerly dispatches and cannot be reused after cancellation.
        // It does not apply SDK events to a second messages/state authority.
        const send = captured.fetch;
        const source = agent
          ? undefined
          : new HttpAgent({
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
                  await (send as NonNullable<typeof send>)(url, init),
                  () => settled
                );
              },
            });
        controller = source?.abortController;
        // A handed agent has no fetch to guard: calling its `run` is the
        // boundary the guard stands at, and what counts as invoked.
        const run = (admitted: RunAgentInput) => {
          if (source) return source.run(admitted);
          const handed = agent as SessionAgent;
          if (settled || signal?.aborted || beforeFetch?.() === false) {
            abort();
            throw new DOMException(
              'Request cancelled before run',
              'AbortError'
            );
          }
          if (handed.abortController)
            handed.abortController = new AbortController();
          ran = true;
          return handed.run(admitted);
        };
        // Same order as the SDK's own runAgent pipeline: boundary (translate
        // retired shapes), enforcement (drop/strip the unknown), chunk
        // expansion, verification. A bare HttpAgent.run() gets none of it.
        // The boundary only calls next.run(), so a run-only stub suffices.
        const boundary = new CompatibilityBoundary();
        const events = boundary
          // the boundary rewrites `messages` on the input it is given; keep the caller's object intact.
          .run({ ...input }, {
            run,
          } satisfies Pick<AbstractAgent, 'run'> as unknown as AbstractAgent)
          .pipe(enforceEvents(), transformChunks(), verifyEvents());
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
      return { abort, close, done };
    },
  };
}
