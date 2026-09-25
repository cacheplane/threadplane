import type {
  AGUIEvent,
  HttpAgentConfig,
  Message,
  RunAgentInput,
  ResumeEntry,
} from '@ag-ui/client';
import type { CompleteOutcome } from '@threadplane/core';
import { ownTranscript, requestMessages, type Transcript } from './transcript';
import { requestState } from './state';
import {
  applyObservation,
  initialObservation,
  type SessionSnapshot,
} from './session-observation';
import { createRun, type RunHandle } from './create-run';
import { createPublication } from './session-publication';
import type { InterruptMode } from './interrupt-mode';
import {
  assertResumeEligible,
  captureResponses,
  claimDecision,
  observeDecision,
  settleDecision,
  type NativeResponse,
  type PauseId,
} from './decision';
import { copyData } from '../lib/internal/copy-data';
import {
  captureSubmit,
  mergeSubmitState,
  type SubmitInput,
} from './submit-input';

export interface SessionOptions
  extends Pick<HttpAgentConfig, 'url' | 'headers' | 'fetch'> {
  readonly threadId: string;
  readonly messages?: readonly Message[] | Transcript;
  readonly state?: unknown;
  readonly interruptMode?: InterruptMode;
}
export interface Session {
  getSnapshot(): SessionSnapshot;
  subscribe(notify: () => void): () => void;
  submit(
    input: SubmitInput,
    options?: { readonly signal?: AbortSignal }
  ): Promise<CompleteOutcome>;
  resume(
    pause: PauseId,
    responses: readonly NativeResponse[],
    options?: { readonly signal?: AbortSignal }
  ): Promise<CompleteOutcome>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
}
interface Attempt {
  readonly id: string;
  readonly controller: AbortController;
  readonly done: Promise<CompleteOutcome>;
  readonly resolve: (outcome: CompleteOutcome) => void;
  cleanup: () => void;
  handle?: RunHandle;
  starting: boolean;
  finished: boolean;
}

/** Private protocol owner. This does not yet implement core AgentSession. */
export function createSession(options: SessionOptions): Session {
  const {
    threadId,
    url,
    headers,
    fetch,
    messages,
    state,
    interruptMode = 'native',
  } = options;
  if (!threadId) throw new TypeError('A nonempty threadId is required');
  const factory = createRun({ url, headers, fetch, interruptMode });
  const publication = createPublication(initialObservation(messages, state));
  let active: Attempt | undefined;
  let disposed = false;
  let revision = 0;
  const current = (attempt: Attempt) =>
    active === attempt &&
    !disposed &&
    !attempt.controller.signal.aborted &&
    !attempt.finished;
  const finish = (
    attempt: Attempt,
    outcome: CompleteOutcome,
    fetchInvoked: boolean
  ) => {
    if (attempt.finished) return;
    attempt.finished = true;
    attempt.cleanup();
    if (active === attempt) {
      active = undefined;
      const previous = publication.getSnapshot();
      publication.publish(
        Object.freeze({
          ...previous,
          decision: settleDecision(
            previous.decision,
            { id: attempt.id, outcome, terminal: previous.run?.terminal },
            fetchInvoked
          ),
          status:
            outcome === 'error' || outcome === 'interrupted' ? 'error' : 'idle',
          run: Object.freeze({ ...previous.run, id: attempt.id, outcome }),
        })
      );
      if (disposed) publication.clear();
    }
    attempt.resolve(outcome);
  };
  const cancel = (attempt: Attempt) => {
    attempt.controller.abort();
    attempt.handle?.abort();
    // A start in progress already owns first-result authority even though its
    // handle is not assigned. Its done promise must select the local outcome.
    if (!attempt.starting && !attempt.handle) finish(attempt, 'aborted', false);
  };
  const dispatch = (attempt: Attempt) => {
    if (!current(attempt)) return;
    let input: RunAgentInput;
    try {
      const value = publication.getSnapshot();
      const decision = value.decision;
      input = {
        threadId,
        runId: attempt.id,
        messages: requestMessages(value.transcript),
        state: requestState(value.state),
        tools: [],
        context: [],
        forwardedProps: {},
        ...(decision?.kind === 'native' &&
          decision.attempt?.runId === attempt.id && {
            resume: copyData(
              decision.attempt.responses,
              false
            ) as ResumeEntry[],
          }),
      };
    } catch {
      publication.command(() =>
        finish(
          attempt,
          attempt.controller.signal.aborted ? 'aborted' : 'error',
          false
        )
      );
      return;
    }
    if (!current(attempt)) return;
    attempt.starting = true;
    // createRun owns all first-result and invocation facts once start is called.
    attempt.handle = factory.start(
      input,
      (event) => {
        if (!current(attempt)) return;
        // createRun delivers the SDK's normalized/verified union through its
        // BaseEvent callback. No second schema parse or sequence verifier.
        const previous = publication.getSnapshot();
        let next = applyObservation(
          previous,
          event as AGUIEvent,
          interruptMode
        );
        const terminal = next.run?.terminal;
        const notice = next.run?.legacyInterrupt;
        const evidence =
          terminal !== previous.run?.terminal
            ? terminal
            : notice !== previous.run?.legacyInterrupt
            ? notice
            : undefined;
        if (evidence) {
          const pause =
            evidence.type === 'RUN_FINISHED' &&
            evidence.outcome?.type === 'interrupt'
              ? (crypto.randomUUID() as PauseId)
              : undefined;
          next = Object.freeze({
            ...next,
            decision: observeDecision(
              previous.decision,
              attempt.id,
              evidence,
              pause
            ),
          });
        }
        if (current(attempt)) publication.publish(next);
      },
      attempt.controller.signal
    );
    attempt.starting = false;
    if (!current(attempt)) attempt.handle.abort();
    void attempt.handle.done.then((result) =>
      publication.command(() =>
        finish(attempt, result.outcome, result.fetchInvoked)
      )
    );
  };
  const admit = (
    id: string,
    next: SessionSnapshot,
    signal: AbortSignal | undefined,
    resolve: (outcome: CompleteOutcome) => void
  ) => {
    revision++;
    let settle!: (outcome: CompleteOutcome) => void;
    const done = new Promise<CompleteOutcome>((yes) => {
      settle = yes;
    });
    const attempt: Attempt = {
      id,
      controller: new AbortController(),
      done,
      resolve: settle,
      cleanup: () => undefined,
      starting: false,
      finished: false,
    };
    void done.then(resolve);
    const previous = active;
    active = attempt;
    if (previous) cancel(previous);
    const abort = () =>
      publication.command(() => {
        if (active === attempt) {
          revision++;
          cancel(attempt);
        }
      });
    signal?.addEventListener('abort', abort, { once: true });
    attempt.cleanup = () => signal?.removeEventListener('abort', abort);
    publication.publish(next);
    // Dispatch only after commands queued by this publication have drained.
    if (current(attempt)) queueMicrotask(() => dispatch(attempt));
  };
  const close = (permanent: boolean): Promise<void> => {
    // Track command intent even while notification defers its mutation. A
    // reentrant caller getter must not make an older capture current again.
    revision++;
    return new Promise((resolve) => {
      publication.command(() => {
        if (permanent) disposed = true;
        const attempt = active;
        if (attempt) {
          cancel(attempt);
          void attempt.done.then(() => resolve());
        } else {
          if (disposed) publication.clear();
          resolve();
        }
      });
    });
  };
  return {
    getSnapshot: publication.getSnapshot,
    subscribe: (notify) =>
      disposed ? () => undefined : publication.subscribe(notify),
    resume: (pause, responses, options) =>
      new Promise<CompleteOutcome>((resolve) => {
        const beforeSignal = revision;
        let signal: AbortSignal | undefined;
        try {
          signal = options?.signal;
        } catch {
          resolve(disposed || revision !== beforeSignal ? 'aborted' : 'error');
          return;
        }
        if (disposed || signal?.aborted || revision !== beforeSignal) {
          resolve('aborted');
          return;
        }
        const beforeInput = ++revision;
        let captured: readonly NativeResponse[];
        try {
          const previous = publication.getSnapshot();
          if (interruptMode !== 'native' || active)
            throw new TypeError('Resume requires a settled native owner');
          assertResumeEligible(
            previous.decision,
            previous.run,
            pause,
            Date.now()
          );
          captured = captureResponses(responses);
        } catch {
          resolve(
            disposed || signal?.aborted || revision !== beforeInput
              ? 'aborted'
              : 'error'
          );
          return;
        }
        if (disposed || signal?.aborted || revision !== beforeInput) {
          resolve('aborted');
          return;
        }
        publication.command(() => {
          if (disposed || signal?.aborted) {
            resolve('aborted');
            return;
          }
          const beforeAdmission = revision;
          let next: SessionSnapshot;
          let id: string;
          try {
            const previous = publication.getSnapshot();
            if (active || interruptMode !== 'native')
              throw new TypeError('Resume requires a settled native owner');
            const decision = assertResumeEligible(
              previous.decision,
              previous.run,
              pause,
              Date.now()
            );
            id = crypto.randomUUID();
            next = Object.freeze({
              ...previous,
              decision: claimDecision(decision, captured, id),
              status: 'running',
              subagents: Object.freeze([]),
              run: Object.freeze({ id }),
            });
          } catch {
            resolve(
              disposed || signal?.aborted || revision !== beforeAdmission
                ? 'aborted'
                : 'error'
            );
            return;
          }
          if (disposed || signal?.aborted || revision !== beforeAdmission) {
            resolve('aborted');
            return;
          }
          admit(id, next, signal, resolve);
        });
      }),
    submit: (input, options) =>
      new Promise<CompleteOutcome>((resolve) => {
        const capturedRevision = revision;
        let signal: AbortSignal | undefined;
        try {
          signal = options?.signal;
        } catch {
          resolve(
            disposed || revision !== capturedRevision ? 'aborted' : 'error'
          );
          return;
        }
        if (disposed || signal?.aborted || revision !== capturedRevision) {
          resolve('aborted');
          return;
        }
        if (publication.getSnapshot().decision) {
          resolve('error');
          return;
        }
        const beforeInput = ++revision;
        let captured;
        try {
          captured = captureSubmit(input);
        } catch {
          resolve(
            disposed || signal?.aborted || revision !== beforeInput
              ? 'aborted'
              : 'error'
          );
          return;
        }
        if (disposed || signal?.aborted || revision !== beforeInput) {
          resolve('aborted');
          return;
        }
        publication.command(() => {
          if (disposed || signal?.aborted) {
            resolve('aborted');
            return;
          }
          if (publication.getSnapshot().decision) {
            resolve('error');
            return;
          }
          const beforeCapture = revision;
          let next: SessionSnapshot;
          let id: string;
          try {
            const previous = publication.getSnapshot();
            // Capture precedes queueing, but admission uses the latest state.
            // Incompatible patches fail before transferring the active run.
            const state = mergeSubmitState(previous.state, captured.state);
            const userId = crypto.randomUUID();
            if (previous.transcript.some((message) => message.id === userId))
              throw new TypeError('Generated message ID collides with history');
            id = crypto.randomUUID();
            const user = ownTranscript([
              { id: userId, role: 'user', content: captured.message },
            ])[0];
            next = Object.freeze({
              ...previous,
              status: 'running',
              state,
              transcript: Object.freeze([...previous.transcript, user]),
              subagents: Object.freeze([]),
              run: Object.freeze({ id }),
            });
          } catch {
            resolve(
              disposed || signal?.aborted || revision !== beforeCapture
                ? 'aborted'
                : 'error'
            );
            return;
          }
          if (disposed || signal?.aborted || revision !== beforeCapture) {
            resolve('aborted');
            return;
          }
          admit(id, next, signal, resolve);
        });
      }),
    stop: () => close(false),
    dispose: () => close(true),
  };
}
