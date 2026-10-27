import {
  PROTOCOL_VERSION,
  type AGUIEvent,
  type HttpAgentConfig,
  type Message,
  type RunAgentInput,
  type ResumeEntry,
} from '@ag-ui/client';
import type { CompleteOutcome, ToolContract } from '@threadplane/core';
import type {
  CheckedTools,
  FunctionToolDefinition,
  ToolContracts,
} from '@threadplane/core/tools';
import {
  captureClientTools,
  requestClientTools,
  type ClientToolSessionSnapshot,
} from './client-tools.js';
import { createClientToolLedger } from './client-tool-ledger.js';
import {
  ownTranscript,
  requestMessages,
  type Transcript,
} from './transcript.js';
import { requestState } from './state.js';
import {
  applyObservation,
  initialObservation,
  type SessionSnapshot,
} from './session-observation.js';
import { createRun, type RunHandle } from './create-run.js';
import { createPublication } from './session-publication.js';
import type { InterruptMode } from './interrupt-mode.js';
import {
  assertResumeEligible,
  captureResponses,
  claimDecision,
  observeDecision,
  settleDecision,
  type NativeResponse,
  type PauseId,
} from './decision.js';
import { copyData } from '../lib/internal/copy-data.js';
import {
  captureSubmit,
  mergeSubmitState,
  type SubmitInput,
} from './submit-input.js';

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
export type ClientToolSession<C extends Record<string, ToolContract>> = Omit<
  Session,
  'getSnapshot'
> & {
  getSnapshot(): ClientToolSessionSnapshot<C>;
};
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
export function createSession<T extends Record<string, FunctionToolDefinition>>(
  options: SessionOptions,
  tools: T & CheckedTools<T>
): ClientToolSession<ToolContracts<T>>;
export function createSession(options: SessionOptions): Session;
export function createSession(
  options: SessionOptions,
  tools?: Record<string, FunctionToolDefinition>
): Session {
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
  const catalog = tools === undefined ? undefined : captureClientTools(tools);
  if (catalog !== undefined)
    return createToolsOwner(
      { threadId, url, headers, fetch, messages, state, interruptMode },
      catalog
    );
  const factory = createRun({ url, headers, fetch, interruptMode });
  const initial = initialObservation(messages, state);
  const publication = createPublication(
    catalog === undefined
      ? initial
      : Object.freeze({
          ...initial,
          clientTools: Object.freeze({ calls: Object.freeze([]) }),
        })
  );
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
        protocolVersion: PROTOCOL_VERSION,
        messages: requestMessages(value.transcript),
        state: requestState(value.state),
        tools: catalog === undefined ? [] : requestClientTools(catalog),
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

/** A command can own several physical runs, but never lends execution authority
 * to a superseding submit. The legacy no-catalog owner above remains separate. */
function createToolsOwner(
  options: SessionOptions,
  catalog: ReturnType<typeof captureClientTools>
): Session {
  const { threadId, interruptMode = 'native' } = options;
  const factory = createRun(options);
  const initial = initialObservation(options.messages, options.state);
  const ledger = createClientToolLedger<Record<string, ToolContract>>(
    [...catalog.keys()],
    initial.transcript
  );
  const publication = createPublication(
    Object.freeze({
      ...initial,
      clientTools: ledger.snapshot(),
    })
  );
  interface Physical {
    readonly id: string;
    readonly token: object;
    handle?: RunHandle;
    starting: boolean;
    settled: boolean;
    fetchInvoked: boolean;
  }
  interface Command {
    readonly controller: AbortController;
    readonly done: Promise<CompleteOutcome>;
    readonly resolve: (outcome: CompleteOutcome) => void;
    cleanup: () => void;
    physical?: Physical;
    groups: number;
    finished: boolean;
  }
  let active: Command | undefined;
  let disposed = false;
  let revision = 0;
  let pausedPhysical:
    | { readonly id: string; readonly token: object }
    | undefined;
  const owns = (command: Command, physical?: Physical) =>
    active === command &&
    !command.finished &&
    (!physical || command.physical === physical);
  const eligible = (command: Command, physical?: Physical) =>
    owns(command, physical) &&
    !disposed &&
    !command.controller.signal.aborted &&
    !ledger.snapshot().blocker &&
    !publication.getSnapshot().decision;
  const publishLedger = (outcome?: CompleteOutcome) => {
    const previous = publication.getSnapshot();
    publication.publish(
      Object.freeze({
        ...previous,
        transcript: ledger.retainHistory(previous.transcript),
        clientTools: Object.freeze({
          ...ledger.snapshot(),
          ...(outcome && { commandOutcome: outcome }),
        }),
      })
    );
  };
  const block = (
    reason: 'cancelled' | 'uncertain' | 'limit',
    command: Command,
    ids: readonly string[] = []
  ) => {
    ledger.installBlocker({
      reason,
      callIds: ids,
      sourceRunId: command.physical?.id ?? '',
    });
  };
  const unresolvedRootIds = () => {
    const history = publication.getSnapshot().transcript;
    return history.flatMap((message) =>
      message.role === 'assistant' && typeof message.subagentRunId !== 'string'
        ? (message.toolCalls ?? [])
            .filter(
              (call) =>
                !history.some(
                  (row) =>
                    row.role === 'tool' &&
                    row.toolCallId === call.id &&
                    typeof row.subagentRunId !== 'string'
                )
            )
            .map((call) => call.id)
        : []
    );
  };
  const protectCancellation = (command: Command, physical: Physical) => {
    ledger.cancelIncomplete(physical.id);
    const snapshot = publication.getSnapshot();
    if (snapshot.decision) return;
    const terminal = snapshot.run?.terminal;
    const conclusive =
      terminal?.type === 'RUN_FINISHED' &&
      (terminal.outcome == null ||
        terminal.outcome.type === 'success' ||
        terminal.outcome.type === 'cancelled');
    if (conclusive) {
      const unresolved = unresolvedRootIds();
      if (unresolved.length) block('cancelled', command, unresolved);
    } else if (physical.fetchInvoked || command.groups > 0)
      block('uncertain', command);
  };
  const finish = (command: Command, outcome: CompleteOutcome) => {
    if (!owns(command)) return;
    command.finished = true;
    command.cleanup();
    // Keep admission busy through final notification; reentrant submit cannot
    // append a new human while this command's result is being published.
    const previous = publication.getSnapshot();
    publication.publish(
      Object.freeze({
        ...previous,
        transcript: ledger.retainHistory(previous.transcript),
        status:
          outcome === 'error' || outcome === 'interrupted' ? 'error' : 'idle',
        clientTools: Object.freeze({
          ...ledger.snapshot(),
          commandOutcome: outcome,
        }),
      })
    );
    active = undefined;
    if (disposed) publication.clear();
    command.resolve(outcome);
  };
  const cancel = (command: Command) => {
    if (!owns(command)) return;
    command.controller.abort();
    const physical = command.physical;
    if (physical && !physical.settled) {
      physical.handle?.abort();
      // Its result callback owns native decision settlement, including starts
      // whose physical handle is not assigned yet.
      if (physical.starting || physical.handle) return;
    }
    if (physical?.settled) protectCancellation(command, physical);
    else ledger.cancelIncomplete(physical?.id ?? '');
    finish(command, 'aborted');
  };
  const cancelledResult = Symbol('cancelled handler');
  const admittedDefinition = (id: string) => {
    const call = ledger.snapshot().calls.find((call) => call.callId === id);
    const definition = call && catalog.get(call.name);
    if (!call || !definition) throw new TypeError('No admitted client tool');
    return { call, definition };
  };
  const invoke = async (command: Command, action: () => unknown) => {
    const signal = command.controller.signal;
    if (signal.aborted) return cancelledResult;
    let abort!: () => void;
    const cancelled = new Promise<typeof cancelledResult>((resolve) => {
      abort = () => resolve(cancelledResult);
      signal.addEventListener('abort', abort, { once: true });
    });
    // Promise adoption observes late rejection even when cancellation wins.
    const result = Promise.resolve().then(() => {
      if (!eligible(command)) return cancelledResult;
      return action();
    });
    try {
      return await Promise.race([result, cancelled]);
    } finally {
      signal.removeEventListener('abort', abort);
    }
  };
  const execute = async (
    command: Command,
    physical: Physical,
    group: readonly string[]
  ) => {
    for (const id of group) {
      if (!eligible(command, physical)) return;
      const { call, definition } = admittedDefinition(id);
      let value: unknown;
      let error = call.error;
      if (error === undefined) {
        publication.command(() => {
          if (eligible(command, physical)) {
            ledger.markRunning(id);
            publishLedger();
          }
        });
        // Publications have drained all queued stop/dispose/submit commands.
        if (!eligible(command, physical)) return;
        try {
          value = await invoke(command, () =>
            definition.handler(ledger.argumentsFor(id) as never, {
              signal: command.controller.signal,
            })
          );
        } catch (failure) {
          try {
            const message =
              failure instanceof Error ? failure.message : undefined;
            error =
              typeof message === 'string'
                ? message
                : 'Client tool handler failed';
          } catch {
            error = 'Client tool handler failed';
          }
        }
      }
      if (value === cancelledResult || !eligible(command, physical)) return;
      publication.command(() => {
        if (!eligible(command, physical)) return;
        // Result getters run while this command queue is draining. Stop,
        // disposal and caller abort register intent synchronously via revision,
        // before their queued cancellation can mutate the command or ledger.
        const completionRevision = revision;
        const completionAuthority = () =>
          revision === completionRevision && eligible(command, physical);
        try {
          const history = publication.getSnapshot().transcript;
          if (error !== undefined)
            ledger.fail(
              id,
              crypto.randomUUID(),
              error,
              history,
              completionAuthority
            );
          else
            ledger.complete(
              id,
              crypto.randomUUID(),
              value,
              history,
              completionAuthority
            );
          if (completionAuthority()) publishLedger();
        } catch {
          // A queued cancellation owns settlement; do not relabel that intent
          // as a conflict or retain a result authored during its ownership copy.
          if (revision !== completionRevision) return;
          if (
            owns(command, physical) &&
            !command.controller.signal.aborted &&
            !disposed
          ) {
            ledger.installBlocker({
              reason: 'conflict',
              sourceRunId: physical.id,
              callIds: [id],
            });
            ledger.cancelIncomplete(physical.id);
            finish(command, 'interrupted');
          }
        }
      });
      if (!eligible(command, physical)) return;
    }
    publication.command(() => {
      if (!eligible(command, physical)) return;
      if (!group.some((id) => admittedDefinition(id).definition.followUp)) {
        finish(command, 'success');
        return;
      }
      startPhysical(command, crypto.randomUUID());
    });
  };
  const settlePhysical = (
    command: Command,
    physical: Physical,
    outcome: CompleteOutcome,
    fetchInvoked: boolean
  ) => {
    if (physical.settled) return;
    physical.settled = true;
    physical.fetchInvoked = fetchInvoked;
    if (!owns(command, physical)) return;
    const previous = publication.getSnapshot();
    const terminal = previous.run?.terminal;
    if (
      previous.decision?.kind === 'native' &&
      terminal?.type === 'RUN_FINISHED' &&
      terminal.outcome?.type === 'interrupt'
    )
      pausedPhysical = physical;
    const nativeSuccess =
      terminal?.type === 'RUN_FINISHED' &&
      (terminal.outcome == null || terminal.outcome.type === 'success');
    publication.publish(
      Object.freeze({
        ...previous,
        decision: settleDecision(
          previous.decision,
          { id: physical.id, outcome, terminal },
          fetchInvoked
        ),
        run: Object.freeze({
          ...previous.run,
          id: physical.id,
          outcome: nativeSuccess ? 'success' : outcome,
        }),
        clientTools: ledger.snapshot(),
      })
    );
    // Observer commands queued by native result publication precede local tool
    // admission or command completion, including stop on a success callback.
    publication.command(() => {
      if (!owns(command, physical)) return;
      if (command.controller.signal.aborted || disposed) {
        protectCancellation(command, physical);
        finish(command, 'aborted');
        return;
      }
      if (publication.getSnapshot().decision || outcome === 'paused') {
        finish(command, outcome);
        return;
      }
      if (outcome !== 'success') {
        if (
          terminal?.type === 'RUN_FINISHED' &&
          terminal.outcome?.type === 'cancelled'
        )
          protectCancellation(command, physical);
        else if (fetchInvoked || command.groups > 0)
          block('uncertain', command);
        finish(command, outcome);
        return;
      }
      if (ledger.snapshot().blocker) {
        finish(command, 'interrupted');
        return;
      }
      // The ledger consumes the whole group before observers can issue commands.
      const group = ledger.admitSuccess(physical.token, command.groups < 10);
      if (ledger.snapshot().blocker) {
        finish(command, 'interrupted');
        return;
      }
      if (!group.length) {
        finish(command, 'success');
        return;
      }
      command.groups++;
      publishLedger();
      queueMicrotask(() => {
        if (eligible(command, physical))
          void execute(command, physical, group).catch(() => {
            publication.command(() => {
              if (
                !owns(command, physical) ||
                command.controller.signal.aborted ||
                disposed
              )
                return;
              ledger.installBlocker({
                reason: 'conflict',
                sourceRunId: physical.id,
                callIds: group,
              });
              ledger.cancelIncomplete(physical.id);
              finish(command, 'interrupted');
            });
          });
      });
    });
  };
  const dispatch = (command: Command, physical: Physical) => {
    if (
      !owns(command, physical) ||
      command.controller.signal.aborted ||
      disposed
    )
      return;
    let input: RunAgentInput;
    let capture: ReturnType<typeof ledger.captureRequest>;
    try {
      const snapshot = publication.getSnapshot();
      const resuming =
        snapshot.decision?.kind === 'native' &&
        snapshot.decision.attempt?.runId === physical.id;
      if (
        resuming &&
        (!pausedPhysical ||
          snapshot.decision?.sourceRunId !== pausedPhysical.id)
      )
        throw new TypeError('Resume does not match owned physical pause');
      capture =
        resuming && pausedPhysical
          ? ledger.captureNativeResumeRequest(
              snapshot.transcript,
              pausedPhysical.token
            )
          : ledger.captureRequest(snapshot.transcript);
      input = {
        threadId,
        runId: physical.id,
        protocolVersion: PROTOCOL_VERSION,
        messages: requestMessages(capture.transcript),
        state: requestState(snapshot.state),
        tools: requestClientTools(catalog),
        context: [],
        forwardedProps: {},
        ...(snapshot.decision?.kind === 'native' &&
          snapshot.decision.attempt?.runId === physical.id && {
            resume: copyData(
              snapshot.decision.attempt.responses,
              false
            ) as ResumeEntry[],
          }),
      };
    } catch {
      publication.command(() =>
        settlePhysical(
          command,
          physical,
          command.controller.signal.aborted ? 'aborted' : 'error',
          false
        )
      );
      return;
    }
    if (
      !owns(command, physical) ||
      command.controller.signal.aborted ||
      disposed
    )
      return;
    physical.starting = true;
    physical.handle = factory.start(
      input,
      (event) => {
        publication.command(() => {
          if (
            !owns(command, physical) ||
            command.controller.signal.aborted ||
            disposed
          )
            return;
          const previous = publication.getSnapshot();
          let next = applyObservation(
            previous,
            event as AGUIEvent,
            interruptMode
          );
          ledger.observe(physical.token, event as AGUIEvent, next.transcript);
          const evidence =
            next.run?.terminal !== previous.run?.terminal
              ? next.run?.terminal
              : next.run?.legacyInterrupt !== previous.run?.legacyInterrupt
              ? next.run?.legacyInterrupt
              : undefined;
          if (evidence)
            next = Object.freeze({
              ...next,
              decision: observeDecision(
                previous.decision,
                physical.id,
                evidence,
                evidence.type === 'RUN_FINISHED' &&
                  evidence.outcome?.type === 'interrupt'
                  ? (crypto.randomUUID() as PauseId)
                  : undefined
              ),
            });
          if (
            owns(command, physical) &&
            !command.controller.signal.aborted &&
            !disposed
          )
            publication.publish(
              Object.freeze({
                ...next,
                transcript: ledger.retainHistory(next.transcript),
                clientTools: ledger.snapshot(),
              })
            );
        });
      },
      command.controller.signal,
      () => {
        if (
          !owns(command, physical) ||
          disposed ||
          command.controller.signal.aborted ||
          ledger.snapshot().blocker
        )
          return false;
        const decision = publication.getSnapshot().decision;
        if (
          decision &&
          !(
            decision.kind === 'native' &&
            decision.attempt?.runId === physical.id
          )
        )
          return false;
        ledger.markFetchInvoked(capture);
        // No publication here: the guard is adjacent to actual fetch invocation.
        return (
          owns(command, physical) &&
          !disposed &&
          !command.controller.signal.aborted
        );
      }
    );
    physical.starting = false;
    if (
      owns(command, physical) &&
      !disposed &&
      !command.controller.signal.aborted
    )
      publication.command(() => {
        if (owns(command, physical)) publishLedger();
      });
    if (
      !owns(command, physical) ||
      command.controller.signal.aborted ||
      disposed
    )
      physical.handle.abort();
    void physical.handle.done.then((result) =>
      publication.command(() =>
        settlePhysical(command, physical, result.outcome, result.fetchInvoked)
      )
    );
  };
  const startPhysical = (command: Command, id: string) => {
    const previous = publication.getSnapshot();
    const physical: Physical = {
      id,
      token: ledger.startPhysical({
        runId: id,
        threadId,
        transcript: previous.transcript,
      }),
      starting: false,
      settled: false,
      fetchInvoked: false,
    };
    command.physical = physical;
    publication.publish(
      Object.freeze({
        ...previous,
        status: 'running',
        subagents: Object.freeze([]),
        run: Object.freeze({ id }),
        clientTools: ledger.snapshot(),
      })
    );
    queueMicrotask(() => dispatch(command, physical));
  };
  const admit = (
    next: SessionSnapshot,
    id: string,
    signal: AbortSignal | undefined,
    resolve: (outcome: CompleteOutcome) => void
  ) => {
    let settle!: (outcome: CompleteOutcome) => void;
    const done = new Promise<CompleteOutcome>((yes) => {
      settle = yes;
    });
    const command: Command = {
      controller: new AbortController(),
      done,
      resolve: settle,
      cleanup: () => undefined,
      groups: 0,
      finished: false,
    };
    active = command;
    revision++;
    void done.then(resolve);
    const abort = () => {
      revision++;
      publication.command(() => cancel(command));
    };
    signal?.addEventListener('abort', abort, { once: true });
    command.cleanup = () => signal?.removeEventListener('abort', abort);
    const physical: Physical = {
      id,
      token: ledger.startPhysical({
        runId: id,
        threadId,
        transcript: next.transcript,
      }),
      starting: false,
      settled: false,
      fetchInvoked: false,
    };
    command.physical = physical;
    publication.publish(
      Object.freeze({ ...next, clientTools: ledger.snapshot() })
    );
    queueMicrotask(() => dispatch(command, physical));
  };
  const close = (permanent: boolean) => {
    revision++;
    return new Promise<void>((resolve) =>
      publication.command(() => {
        if (permanent) disposed = true;
        const command = active;
        if (command) {
          cancel(command);
          void command.done.then(() => resolve());
        } else {
          if (disposed) publication.clear();
          resolve();
        }
      })
    );
  };
  return {
    getSnapshot: publication.getSnapshot,
    subscribe: (notify) =>
      disposed ? () => undefined : publication.subscribe(notify),
    stop: () => close(false),
    dispose: () => close(true),
    submit: (input, options) =>
      new Promise<CompleteOutcome>((resolve) => {
        if (disposed) {
          resolve('aborted');
          return;
        }
        // Even options.signal is caller code. Busy/blocker checks precede it.
        if (
          active ||
          ledger.snapshot().blocker ||
          publication.getSnapshot().decision
        ) {
          resolve('error');
          return;
        }
        const before = revision;
        let signal: AbortSignal | undefined;
        let captured: ReturnType<typeof captureSubmit>;
        try {
          signal = options?.signal;
          if (disposed || signal?.aborted || revision !== before) {
            resolve('aborted');
            return;
          }
          captured = captureSubmit(input);
        } catch {
          resolve(
            disposed || signal?.aborted || revision !== before
              ? 'aborted'
              : 'error'
          );
          return;
        }
        if (disposed || signal?.aborted || revision !== before) {
          resolve('aborted');
          return;
        }
        publication.command(() => {
          if (disposed || signal?.aborted || revision !== before) {
            resolve('aborted');
            return;
          }
          if (
            active ||
            ledger.snapshot().blocker ||
            publication.getSnapshot().decision
          ) {
            resolve('error');
            return;
          }
          try {
            const previous = publication.getSnapshot();
            if (!ledger.historyIntegrity(previous.transcript)) {
              publishLedger();
              resolve('error');
              return;
            }
            const state = mergeSubmitState(previous.state, captured.state);
            const userId = crypto.randomUUID();
            if (previous.transcript.some((message) => message.id === userId))
              throw new TypeError('Generated message ID collides with history');
            const id = crypto.randomUUID();
            const user = ownTranscript([
              { id: userId, role: 'user', content: captured.message },
            ])[0];
            admit(
              Object.freeze({
                ...previous,
                state,
                status: 'running',
                transcript: Object.freeze([...previous.transcript, user]),
                subagents: Object.freeze([]),
                run: Object.freeze({ id }),
              }),
              id,
              signal,
              resolve
            );
          } catch {
            resolve('error');
          }
        });
      }),
    resume: (pause, responses, options) =>
      new Promise<CompleteOutcome>((resolve) => {
        if (disposed) {
          resolve('aborted');
          return;
        }
        if (active || ledger.snapshot().blocker) {
          resolve('error');
          return;
        }
        const before = revision;
        let signal: AbortSignal | undefined;
        let captured: readonly NativeResponse[];
        try {
          signal = options?.signal;
          if (disposed || signal?.aborted || revision !== before) {
            resolve('aborted');
            return;
          }
          if (interruptMode !== 'native')
            throw new TypeError('Native resume required');
          const previous = publication.getSnapshot();
          assertResumeEligible(
            previous.decision,
            previous.run,
            pause,
            Date.now()
          );
          captured = captureResponses(responses);
        } catch {
          resolve(
            disposed || signal?.aborted || revision !== before
              ? 'aborted'
              : 'error'
          );
          return;
        }
        publication.command(() => {
          if (disposed || signal?.aborted || revision !== before) {
            resolve('aborted');
            return;
          }
          if (active || ledger.snapshot().blocker) {
            resolve('error');
            return;
          }
          try {
            const previous = publication.getSnapshot();
            const decision = assertResumeEligible(
              previous.decision,
              previous.run,
              pause,
              Date.now()
            );
            const id = crypto.randomUUID();
            admit(
              Object.freeze({
                ...previous,
                decision: claimDecision(decision, captured, id),
                status: 'running',
                subagents: Object.freeze([]),
                run: Object.freeze({ id }),
              }),
              id,
              signal,
              resolve
            );
          } catch {
            resolve('error');
          }
        });
      }),
  };
}
