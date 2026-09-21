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
      const failure = new Error('The LangGraph request failed.');
      networkFailures.add(failure);
      throw failure;
    }

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
