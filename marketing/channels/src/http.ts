export interface HttpOpts {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  /**
   * A factory is evaluated per attempt, so the request sent after `on401`
   * refreshed a token carries the new token instead of the rejected one.
   */
  headers?: Record<string, string> | (() => Record<string, string>);
  body?: BodyInit;
  timeoutMs?: number;
  /**
   * `false` disables every automatic retry: 5xx, network errors, and the
   * per-request timeout. Creates must pass `false`, since a retried create can
   * double-post after an ambiguous failure. The `on401` retry still applies;
   * a 401 means nothing was created.
   */
  retryOn5xx?: boolean;
  on401?: () => Promise<{ retry: true } | { retry: false }>;
  /** Called with the response headers of a successful (2xx) response. */
  onHeaders?: (headers: Headers) => void;
  /** Caller budget: aborts the in-flight request and any pending retry. */
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const RETRY_DELAYS_MS = [500, 1500];

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function doFetch(opts: HttpOpts): Promise<Response> {
  opts.signal?.throwIfAborted();
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  const headers = typeof opts.headers === 'function' ? opts.headers() : opts.headers;
  return fetch(opts.url, {
    method: opts.method,
    headers,
    body: opts.body,
    signal,
  });
}

export async function http<T = unknown>(opts: HttpOpts): Promise<T> {
  const retryOn5xx = opts.retryOn5xx !== false;
  let lastError: Error | undefined;

  // Initial attempt + retries on 5xx and network errors (never with retryOn5xx: false).
  const maxAttempts = retryOn5xx ? RETRY_DELAYS_MS.length + 1 : 1;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let res: Response;
    try {
      res = await doFetch(opts);
    } catch (err) {
      lastError = err as Error;
      // The caller's budget ran out: stop, do not retry.
      if (opts.signal?.aborted) throw lastError;
      if (attempt < maxAttempts - 1) {
        await sleep(RETRY_DELAYS_MS[attempt], opts.signal);
        continue;
      }
      throw lastError;
    }

    if (res.status === 401 && opts.on401) {
      const result = await opts.on401();
      if (result.retry) {
        const retryRes = await doFetch(opts);
        return await parseOrThrow<T>(retryRes, opts.onHeaders);
      }
      throw await toError(res);
    }

    if (res.status >= 500 && retryOn5xx && attempt < maxAttempts - 1) {
      lastError = await toError(res);
      await sleep(RETRY_DELAYS_MS[attempt], opts.signal);
      continue;
    }

    return await parseOrThrow<T>(res, opts.onHeaders);
  }

  throw lastError ?? new Error('http: exhausted retries without an error');
}

async function parseOrThrow<T>(
  res: Response,
  onHeaders?: (headers: Headers) => void,
): Promise<T> {
  if (res.status >= 200 && res.status < 300) {
    onHeaders?.(res.headers);
    const text = await res.text();
    if (text.length === 0) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`HTTP ${res.status}: non-JSON response: ${text.slice(0, 200)}`);
    }
  }
  throw await toError(res);
}

async function toError(res: Response): Promise<Error> {
  const body = await res.text().catch(() => '');
  return new Error(`HTTP ${res.status}: ${body.slice(0, 500)}`);
}
