import {
  EventType,
  type BaseEvent,
  type HttpAgentConfig,
  type RunAgentInput,
} from '@ag-ui/client';
import type { CompleteOutcome } from '@threadplane/core';
import {
  createHttpRequest,
  type HttpRequestHandle,
} from './create-http-request';

export type RunResult =
  | { outcome: Exclude<CompleteOutcome, 'error'> }
  | { outcome: 'error'; error: unknown };

export interface RunHandle {
  abort(): void;
  done: Promise<RunResult>;
}

function finishedResult(outcome: unknown): RunResult {
  if (outcome == null) return { outcome: 'success' };
  if (typeof outcome === 'object' && 'type' in outcome) {
    if (outcome.type === 'success') return { outcome: 'success' };
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
  config: Pick<HttpAgentConfig, 'url' | 'headers' | 'fetch'>
) {
  const request = createHttpRequest(config);
  return {
    start(
      input: RunAgentInput,
      onEvent: (event: BaseEvent) => void,
      signal?: AbortSignal
    ): RunHandle {
      let resolve!: (result: RunResult) => void;
      const done = new Promise<RunResult>((yes) => {
        resolve = yes;
      });
      let closed = false;
      let admitted = false;
      let physical: HttpRequestHandle | undefined;
      const cleanup = () => {
        try {
          physical?.abort();
        } catch {
          // Teardown cannot replace the first result or leave done pending.
        }
      };
      const settle = (result: RunResult) => {
        if (closed) return;
        closed = true;
        signal?.removeEventListener('abort', abort);
        cleanup();
        resolve(result);
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
        physical = request.start(capturedInput, (event) => {
          if (closed) return;
          const child = typeof event['subagentRunId'] === 'string';
          const rootLifecycle =
            event.type === EventType.RUN_STARTED ||
            event.type === EventType.RUN_FINISHED ||
            event.type === EventType.RUN_ERROR;
          if (child && rootLifecycle) {
            settle({
              outcome: 'error',
              error: new Error('Child-attributed RUN_* events are unsupported'),
            });
            return;
          }
          let candidate: RunResult | undefined;
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
          else if (
            !child &&
            event.type === EventType.CUSTOM &&
            event['name'] === 'on_interrupt'
          )
            candidate = { outcome: 'paused' };
          try {
            onEvent(event);
          } catch (error) {
            settle({ outcome: 'error', error });
            return;
          }
          // Evidence is captured before projection; reentrant abort still wins.
          if (candidate) settle(candidate);
        });
        // Synchronous SDK delivery may have settled before start returned.
        if (closed) cleanup();
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
