import {
  EventType,
  type BaseEvent,
  type RunAgentInput,
} from '@ag-ui/client';
import type { CompleteOutcome } from '@threadplane/core';
import {
  isLegacyInterruptTerminal,
  type InterruptMode,
} from './interrupt-mode.js';
import {
  createHttpRequest,
  type HttpRequestHandle,
  type RequestSource,
} from './create-http-request.js';

type RunOutcome =
  | { outcome: Exclude<CompleteOutcome, 'error'> }
  | { outcome: 'error'; error: unknown };
export type RunResult = RunOutcome & { readonly fetchInvoked: boolean };

/** The HTTP status the SDK put on its error for a response that was not OK. */
export function httpFailure(
  result: RunResult
): { readonly status: number } | undefined {
  if (result.outcome !== 'error') return undefined;
  const status =
    typeof result.error === 'object' && result.error !== null
      ? (result.error as { status?: unknown }).status
      : undefined;
  return typeof status === 'number' &&
    Number.isInteger(status) &&
    status >= 100 &&
    status <= 599
    ? Object.freeze({ status })
    : undefined;
}

export interface RunHandle {
  abort(): void;
  done: Promise<RunResult>;
}

/**
 * What a `RUN_FINISHED` outcome settles a run as. An outcome this runtime does
 * not know settles `error`.
 */
export function finishedOutcome(outcome: unknown): CompleteOutcome {
  return finishedResult(outcome).outcome;
}

function finishedResult(outcome: unknown): RunOutcome {
  if (outcome == null) return { outcome: 'success' };
  if (typeof outcome === 'object' && 'type' in outcome) {
    if (outcome.type === 'success') return { outcome: 'success' };
    // AG-UI 1.0 reports a deliberate stop as cancelled; the public adapter
    // surfaces the same terminal as aborted.
    if (outcome.type === 'cancelled') return { outcome: 'aborted' };
    if (
      outcome.type === 'interrupt' &&
      'interrupts' in outcome &&
      Array.isArray(outcome.interrupts)
    )
      return { outcome: 'paused' };
  }
  return {
    outcome: 'error',
    error: new Error('Unsupported RUN_FINISHED outcome'),
  };
}

/** Owns one domain result; physical HTTP completion alone is not success. */
export function createRun(
  config: RequestSource & {
    readonly interruptMode?: InterruptMode;
  }
) {
  const interruptMode = config.interruptMode ?? 'native';
  const request = createHttpRequest(config);
  return {
    start(
      input: RunAgentInput,
      onEvent: (event: BaseEvent) => void,
      signal?: AbortSignal,
      invocationGuard?: () => boolean
    ): RunHandle {
      let resolve!: (result: RunResult) => void;
      const done = new Promise<RunResult>((yes) => {
        resolve = yes;
      });
      let closed = false;
      let fetchInvoked = false;
      let admitted = false;
      let physical: HttpRequestHandle | undefined;
      /** `ended`: the run's own terminal event arrived, so nothing is cancelled. */
      const cleanup = (ended = false) => {
        try {
          if (ended) physical?.close();
          else physical?.abort();
        } catch {
          // Teardown cannot replace the first result or leave done pending.
        }
      };
      let endedByTerminal = false;
      const settle = (result: RunOutcome, ended = false) => {
        if (closed) return;
        closed = true;
        endedByTerminal = ended;
        signal?.removeEventListener('abort', abort);
        cleanup(ended);
        resolve({ ...result, fetchInvoked });
      };
      const abort = () => settle({ outcome: 'aborted' });
      if (signal?.aborted) abort();
      if (closed) return { abort, done };
      // Own cancellation synchronously, including abort inside a terminal
      // callback before either physical handle or terminal result is assigned.
      signal?.addEventListener('abort', abort, { once: true });
      try {
        const { threadId, runId } = input;
        if (!threadId || !runId)
          settle({
            outcome: 'error',
            error: new Error('Caller-assigned threadId and runId are required'),
          });
        if (closed) return { abort, done };
        const capturedInput = { ...input, threadId, runId };
        if (closed) return { abort, done };
        physical = request.start(
          capturedInput,
          (event) => {
            if (closed) return;
            // RUN_* events are not attributable in 1.0: the client's
            // enforcement stage strips any `subagentRunId` before delivery.
            let candidate: RunOutcome | undefined;
            if (
              event.type === EventType.RUN_STARTED ||
              event.type === EventType.RUN_FINISHED
            ) {
              if (event['threadId'] !== threadId || event['runId'] !== runId) {
                settle({
                  outcome: 'error',
                  error: new Error(
                    'Root run identity does not match the requested operation'
                  ),
                });
                return;
              }
              if (event.type === EventType.RUN_STARTED) admitted = true;
            }
            if (event.type === EventType.RUN_ERROR) {
              // Copy scalar evidence before application code can mutate the event.
              candidate = {
                outcome: 'error',
                error: new Error(String(event['message'])),
              };
            } else if (!admitted) return;
            else if (event.type === EventType.RUN_FINISHED)
              candidate = finishedResult(event['outcome']);
            else if (isLegacyInterruptTerminal(event, interruptMode))
              candidate = { outcome: 'paused' };
            try {
              onEvent(event);
            } catch (error) {
              settle({ outcome: 'error', error });
              return;
            }
            // Evidence is captured before projection; reentrant abort still wins.
            if (candidate) settle(candidate, true);
          },
          undefined,
          () => {
            if (closed) return false;
            if (invocationGuard && !invocationGuard()) {
              abort();
              return false;
            }
            if (closed) return false;
            fetchInvoked = true;
            return true;
          }
        );
        // Synchronous SDK delivery may have settled before start returned.
        if (closed) cleanup(endedByTerminal);
        void physical.done
          .then((result) => {
            if (result.status === 'failed')
              settle({ outcome: 'error', error: result.error });
            else
              settle({
                outcome: result.status === 'closed' ? 'interrupted' : 'aborted',
              });
          })
          .catch((error) => settle({ outcome: 'error', error }));
      } catch (error) {
        settle({ outcome: 'error', error });
      }
      return { abort, done };
    },
  };
}
