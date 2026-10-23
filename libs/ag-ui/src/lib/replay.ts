import { isObservable, type Observable } from 'rxjs';
import type { BaseEvent } from '@ag-ui/client';

/**
 * Loads a thread's AG-UI protocol events from the server, in the order a live
 * stream delivered them, so the adapter can rebuild the thread exactly as the
 * live view showed it.
 *
 * Return the events as a Promise of an array or as an Observable that
 * completes. Resolve to an empty array when the server has nothing for the
 * thread; reject (or error) for any other failure. `signal` aborts when the
 * adapter is disposed; honour it to cancel the request.
 */
export type AgUiReplaySource = (
  threadId: string,
  signal: AbortSignal,
) => Promise<readonly BaseEvent[]> | Observable<BaseEvent>;

/** Options for {@link httpReplay}. */
export interface HttpReplayOptions {
  /** Builds the GET URL for a thread, e.g. `(id) => \`/api/threads/${id}/events\``. */
  url: (threadId: string) => string;
  /** Fetch implementation. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Extra request headers, e.g. auth tokens. */
  headers?: Record<string, string>;
}

/**
 * A replay source for the common HTTP shape: `GET url(threadId)` answering
 * JSON `{ events: BaseEvent[] }`.
 *
 * A `404` resolves to no events, so the adapter falls back to `persistence`
 * (or starts empty). Any other non-2xx status, a body without an `events`
 * array, or an entry without a string `type` rejects; the adapter treats that
 * as a failed replay and falls back the same way.
 *
 * @example
 * ```ts
 * provideAgent({
 *   url: '/api/agent',
 *   threadId,
 *   replay: httpReplay({ url: (id) => `/api/threads/${encodeURIComponent(id)}/events` }),
 * });
 * ```
 */
export function httpReplay(options: HttpReplayOptions): AgUiReplaySource {
  return async (threadId, signal) => {
    const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    const response = await fetchImpl(options.url(threadId), {
      method: 'GET',
      headers: { accept: 'application/json', ...options.headers },
      signal,
    });
    if (response.status === 404) return [];
    if (!response.ok) throw new Error(`Thread replay request failed with status ${response.status}`);
    const body: unknown = await response.json();
    if (!isRecord(body) || !Array.isArray(body['events'])) {
      throw new Error('Thread replay response must be a JSON object with an events array');
    }
    const events = body['events'] as unknown[];
    for (const event of events) {
      if (!isRecord(event) || typeof event['type'] !== 'string') {
        throw new Error('Thread replay events must be objects with a string type');
      }
    }
    return events as BaseEvent[];
  };
}

/**
 * @internal Runs a replay source to completion and returns its events.
 * Rejects with an `AbortError` when `signal` aborts first.
 */
export function collectReplay(
  source: AgUiReplaySource,
  threadId: string,
  signal: AbortSignal,
): Promise<readonly BaseEvent[]> {
  return new Promise<readonly BaseEvent[]>((resolve, reject) => {
    if (signal.aborted) { reject(abortError()); return; }
    const onAbort = () => { cleanup(); reject(abortError()); };
    let cleanup = () => signal.removeEventListener('abort', onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
    let result: Promise<readonly BaseEvent[]> | Observable<BaseEvent>;
    try {
      result = source(threadId, signal);
    } catch (error) {
      cleanup(); reject(error); return;
    }
    if (isObservable(result)) {
      const events: BaseEvent[] = [];
      const subscription = result.subscribe({
        next: event => events.push(event),
        error: error => { cleanup(); reject(error); },
        complete: () => { cleanup(); resolve(events); },
      });
      const removeListener = cleanup;
      cleanup = () => { removeListener(); subscription.unsubscribe(); };
      if (subscription.closed) removeListener();
      return;
    }
    Promise.resolve(result).then(
      events => {
        cleanup();
        if (!Array.isArray(events)) { reject(new Error('Thread replay must resolve to an array of events')); return; }
        resolve([...events]);
      },
      error => { cleanup(); reject(error); },
    );
  });
}

function abortError(): Error {
  const error = new Error('Thread replay aborted');
  error.name = 'AbortError';
  return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
