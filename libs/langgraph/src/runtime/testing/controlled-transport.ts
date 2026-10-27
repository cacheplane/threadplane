import { deferred, type Deferred } from './deferred';

export interface ControlledTransport<T> {
  stream: AsyncIterableIterator<T, undefined> & {
    return(): Promise<IteratorResult<T, undefined>>;
  };
  closed: Promise<void>;
  release(value: T): void;
  finish(): void;
}

/** A controllable async stream, independent of any runtime or SDK protocol. */
export function controlledTransport<T>(
  options: { signal?: AbortSignal; ignoreAbort?: boolean } = {}
): ControlledTransport<T> {
  const closed = deferred<void>();
  const queued: IteratorYieldResult<T>[] = [];
  const readers: Deferred<IteratorResult<T, undefined>>[] = [];
  const done: IteratorReturnResult<undefined> = {
    value: undefined,
    done: true,
  };
  let state: 'open' | 'finished' | 'aborted' = 'open';
  let abortReason: unknown;

  function cleanup() {
    options.signal?.removeEventListener('abort', abort);
    closed.resolve();
  }

  function abort() {
    if (state !== 'open') return;
    state = 'aborted';
    abortReason = options.signal?.reason;
    queued.length = 0;
    for (const reader of readers.splice(0)) reader.reject(abortReason);
    cleanup();
  }

  function finish() {
    if (state !== 'open') return;
    state = 'finished';
    for (const reader of readers.splice(0)) reader.resolve(done);
    cleanup();
  }

  const stream: ControlledTransport<T>['stream'] = {
    [Symbol.asyncIterator]() {
      return this;
    },
    next() {
      if (state === 'aborted') return Promise.reject(abortReason);
      const value = queued.shift();
      if (value) return Promise.resolve(value);
      if (state === 'finished') return Promise.resolve(done);
      const reader = deferred<IteratorResult<T, undefined>>();
      readers.push(reader);
      return reader.promise;
    },
    return() {
      queued.length = 0;
      state = 'finished';
      for (const reader of readers.splice(0)) reader.resolve(done);
      cleanup();
      return Promise.resolve(done);
    },
  };

  if (!options.ignoreAbort) {
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
  }

  return {
    stream,
    closed: closed.promise,
    release(value) {
      if (state !== 'open') return;
      const result: IteratorYieldResult<T> = { value, done: false };
      const reader = readers.shift();
      if (reader) reader.resolve(result);
      else queued.push(result);
    },
    finish,
  };
}
