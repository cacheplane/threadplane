/** Told when a request is refused as unauthorized or blocked by the network. */
export type RuntimeOperationFailureReporter = (
  code: 'unauthorized' | 'network_blocked'
) => void;

const networkFailures = new WeakSet<object>();
const RESPONSE_STATUS_GETTER =
  typeof Response === 'undefined'
    ? undefined
    : Object.getOwnPropertyDescriptor(Response.prototype, 'status')?.get;
const SIGNAL_ABORTED_GETTER =
  typeof AbortSignal === 'undefined'
    ? undefined
    : Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;

/**
 * What became of the run-creation requests made under one request signal:
 * `true` once any of them got a response of any status, `false` while every
 * one was rejected by `fetch` with no response at all. Only the default
 * transport's own fetch seam writes here, so the evidence cannot be forged by
 * a thrown value's name, message or fields.
 */
const creationAnswers = new WeakMap<AbortSignal, boolean>();
const unansweredCreations = new WeakSet<object>();

function creationSignal(
  input: Parameters<typeof fetch>[0],
  init: RequestInit | undefined
): AbortSignal | undefined {
  try {
    if (typeof init?.method !== 'string' || init.method.toUpperCase() !== 'POST')
      return undefined;
    const href =
      typeof input === 'string'
        ? input
        : input instanceof URL
        ? input.href
        : undefined;
    if (href === undefined || !new URL(href).pathname.endsWith('/runs/stream'))
      return undefined;
    const signal = init.signal;
    return inspectSignal(signal) === 'active' ? signal ?? undefined : undefined;
  } catch {
    return undefined;
  }
}

/** Records one run-creation request's fate. A response is never forgotten: a
 * later attempt that gets none does not make the request unanswered again. */
function noteCreation(signal: AbortSignal | undefined, answered: boolean) {
  if (!signal) return;
  if (answered) creationAnswers.set(signal, true);
  else if (!creationAnswers.has(signal)) creationAnswers.set(signal, false);
}

/** @internal Forgets what earlier creation requests under this signal met. */
export function beginRunCreation(signal: AbortSignal): void {
  creationAnswers.delete(signal);
}

/**
 * @internal Marks what a run-creation stream failed with when every request
 * it made was rejected by `fetch` before any response arrived, and the caller
 * did not abort it.
 */
export function markUnansweredRunCreation(
  error: unknown,
  signal: AbortSignal
): void {
  if (creationAnswers.get(signal) !== false) return;
  if (inspectSignal(signal) !== 'active') return;
  if ((typeof error === 'object' && error !== null) || typeof error === 'function')
    unansweredCreations.add(error);
}

/**
 * @internal True when the default transport's run-creation request got no
 * response from anything: `fetch` itself rejected, as it does offline, for a
 * refused connection or an unresolved host. No run id exists to ask about.
 */
export function isUnansweredRunCreation(error: unknown): boolean {
  try {
    return (typeof error === 'object' && error !== null) ||
      typeof error === 'function'
      ? unansweredCreations.has(error as object)
      : false;
  } catch {
    return false;
  }
}

/**
 * @internal SDK fetch seam of the default transport when it keeps the SDK's own
 * errors. It changes no request, response or failure: it only records whether
 * a run-creation request got any response.
 */
export function createLangGraphObservingFetch(): typeof fetch {
  return async (input, init) => {
    // The SDK's own choice of fetch: an implementation an application
    // installed through the SDK's override, or the global one.
    const overridden = (globalThis as Record<symbol, unknown>)[
      Symbol.for('lg:fetch_implementation')
    ];
    const request =
      typeof overridden === 'function'
        ? (overridden as typeof fetch)
        : globalThis.fetch;
    let response: Response;
    try {
      response = await request(input, init);
    } catch (error) {
      noteCreation(creationSignal(input, init), false);
      throw error;
    }
    noteCreation(creationSignal(input, init), true);
    return response;
  };
}

/** @internal SDK fetch seam used only by the default transport. */
export function createLangGraphRuntimeFetch(
  reportOperationFailure: RuntimeOperationFailureReporter | undefined
): typeof fetch {
  return async (input, init) => {
    const signalState = inspectRequestSignal(init);
    if (signalState === 'invalid') throw createSafeRequestError();
    if (signalState === 'aborted') throw createAbortError();

    let response: Response;
    try {
      response = await globalThis.fetch(input, init);
    } catch {
      const rejectedSignalState = inspectRequestSignal(init);
      if (rejectedSignalState === 'invalid') throw createSafeRequestError();
      if (rejectedSignalState === 'aborted') throw createAbortError();
      noteCreation(creationSignal(input, init), false);
      const failure = new Error('The LangGraph request failed.');
      networkFailures.add(failure);
      throw failure;
    }
    noteCreation(creationSignal(input, init), true);

    const status = readResponseStatus(response);
    if (status !== null && status >= 200 && status < 300) return response;
    if (status === 401 || status === 403) {
      safeReport(reportOperationFailure, 'unauthorized');
    }
    return sanitizedFailureResponse(status);
  };
}

/** @internal Projects failures proven to originate at the default SDK boundary. */
export function projectLangGraphOperationFailure(
  error: unknown,
  signal: AbortSignal,
  reportOperationFailure: RuntimeOperationFailureReporter | undefined
): never {
  const signalState = inspectSignal(signal);
  if (signalState === 'aborted') throw createAbortError();
  // Branding happened at the owned fetch boundary. The final SDK catch may
  // recognize only that unforgeable brand; it never inspects
  // arbitrary status, name, message, body, or header fields.
  if (isNetworkFailure(error))
    safeReport(reportOperationFailure, 'network_blocked');
  throw createSafeRequestError();
}

/** @internal Projects a completed SDK client operation at the owned fetch seam. */
export function sanitizeLangGraphClientOperationFailure(
  error: unknown,
  reportOperationFailure: RuntimeOperationFailureReporter | undefined
): Error {
  if (isNetworkFailure(error)) {
    safeReport(reportOperationFailure, 'network_blocked');
  }
  return createSafeRequestError();
}

export function createSafeRequestError(): Error {
  const safe = new Error('The LangGraph request failed.');
  safe.name = 'LangGraphRequestError';
  return safe;
}

function readResponseStatus(response: Response): number | null {
  try {
    if (!RESPONSE_STATUS_GETTER) return null;
    const status = RESPONSE_STATUS_GETTER.call(response) as unknown;
    return typeof status === 'number' ? status : null;
  } catch {
    return null;
  }
}

function sanitizedFailureResponse(status: number | null): Response {
  const safeStatus =
    status !== null && status >= 200 && status <= 599 ? status : 500;
  return new Response(null, { status: safeStatus });
}

type SignalState = 'absent' | 'active' | 'aborted' | 'invalid';

function inspectRequestSignal(init: RequestInit | undefined): SignalState {
  try {
    return inspectSignal(init?.signal);
  } catch {
    return 'invalid';
  }
}

function inspectSignal(signal: AbortSignal | null | undefined): SignalState {
  if (signal == null) return 'absent';
  if (!SIGNAL_ABORTED_GETTER) return 'invalid';
  try {
    const aborted = SIGNAL_ABORTED_GETTER.call(signal) as unknown;
    if (typeof aborted !== 'boolean') return 'invalid';
    return aborted ? 'aborted' : 'active';
  } catch {
    return 'invalid';
  }
}

function isNetworkFailure(error: unknown): boolean {
  try {
    return (typeof error === 'object' && error !== null) ||
      typeof error === 'function'
      ? networkFailures.has(error as object)
      : false;
  } catch {
    return false;
  }
}

function createAbortError(): Error {
  const error = new Error('AbortError');
  error.name = 'AbortError';
  return error;
}

function safeReport(
  reporter: RuntimeOperationFailureReporter | undefined,
  code: 'unauthorized' | 'network_blocked'
): void {
  if (!reporter) return;
  try {
    reporter(code);
  } catch {
    // Reporting is isolated from request control flow.
  }
}
