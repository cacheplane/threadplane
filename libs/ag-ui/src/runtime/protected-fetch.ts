/** Why an operation failed, as far as a reporter is told. */
export type OperationFailureCode = 'unauthorized' | 'network_blocked';
/** Told when a request is refused for its credential or never gets a response. */
export type OperationFailureReporter = (code: OperationFailureCode) => void;

const RESPONSE_STATUS_GETTER =
  typeof Response === 'undefined'
    ? undefined
    : Object.getOwnPropertyDescriptor(Response.prototype, 'status')?.get;
const SIGNAL_ABORTED_GETTER =
  typeof AbortSignal === 'undefined'
    ? undefined
    : Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;

type SignalState = 'absent' | 'active' | 'aborted' | 'invalid';

function signalState(init: RequestInit | undefined): SignalState {
  try {
    const signal = init?.signal;
    if (signal == null) return 'absent';
    if (!SIGNAL_ABORTED_GETTER) return 'invalid';
    const aborted: unknown = SIGNAL_ABORTED_GETTER.call(signal);
    if (typeof aborted !== 'boolean') return 'invalid';
    return aborted ? 'aborted' : 'active';
  } catch {
    return 'invalid';
  }
}

function nativeStatus(response: Response): number | null {
  try {
    if (!RESPONSE_STATUS_GETTER) return null;
    const status: unknown = RESPONSE_STATUS_GETTER.call(response);
    return typeof status === 'number' ? status : null;
  } catch {
    return null;
  }
}

function abortError(): Error {
  const error = new Error('AbortError');
  error.name = 'AbortError';
  return error;
}

const FAILED = 'The runtime request failed.';

/**
 * The one fetch boundary of a session with an operation-failure reporter. A
 * request that gets no response reports `network_blocked` and fails with a
 * fixed message; a 401 or 403 reports `unauthorized`. A response that is not
 * OK is replaced by an empty one with the same status, so nothing the server
 * wrote in a failure reaches the session. Reporting never changes the outcome.
 */
export function protectedFetch(
  send: typeof fetch,
  report: OperationFailureReporter
): typeof fetch {
  const tell = (code: OperationFailureCode) => {
    try {
      report(code);
    } catch {
      /* Reporting must never change the request's outcome. */
    }
  };
  return async (input, init) => {
    const before = signalState(init);
    if (before === 'invalid') throw new Error(FAILED);
    if (before === 'aborted') throw abortError();
    let response: Response;
    try {
      response = await send(input, init);
    } catch {
      const after = signalState(init);
      if (after === 'invalid') throw new Error(FAILED);
      if (after === 'aborted') throw abortError();
      tell('network_blocked');
      throw new Error(FAILED);
    }
    const status = nativeStatus(response);
    if (status === null) return new Response(null, { status: 500 });
    if (status >= 200 && status < 300) return response;
    if (status === 401 || status === 403) tell('unauthorized');
    return new Response(null, { status });
  };
}
