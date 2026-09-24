import {
  completeDelivery,
  type AgentError,
  type AgentSession,
  type CompleteOutcome,
  type PlainValue,
  type ToolCall,
  type ToolContract,
} from '@threadplane/core';
import type {
  CheckedTools,
  FunctionToolDefinition,
  ToolContracts,
  ToolExecutionStore,
} from '@threadplane/core/tools';
import type { ThreadState } from '@langchain/langgraph-sdk';
import { FetchStreamTransport } from '../lib/transport/fetch-stream.transport';
import { initialMessageState, reduceMessages } from './message-reducer';
import { createPublication } from './publication';
import { projectHistory } from './history-projection';
import { projectCheckpointHistory } from './checkpoint-history';
import type {
  LangGraphInterrupt,
  LangGraphSnapshot,
  LangGraphValues,
} from './langgraph-snapshot';
import { projectHistoryValues, projectValues } from './values-projection';
import {
  projectHistoryInterrupts,
  projectInterrupts,
} from './interrupt-projection';
import { ownMessage, ownValue } from './ownership';
import {
  captureStreamEvent,
  initialSubgraphs,
  projectSubgraphs,
  rebaseSubgraphs,
  settleSubgraphs,
  type SubgraphObservation,
} from './subgraph-projection';
import {
  captureSubmitInput,
  createSubmitPayload,
  type LangGraphInputState,
  type LangGraphSubmitInput,
} from './submit-input';
export type { LangGraphInputState, LangGraphSubmitInput } from './submit-input';
import {
  captureRunOptions,
  type CapturedRunOptions,
  type LangGraphRunOptions,
} from './run-options';
export type { LangGraphRunOptions } from './run-options';
import {
  advanceCursor,
  captureRun,
  rebaseRun,
  type RunEvidence,
} from './run-recovery';
import { createSafeRequestError } from './operation-errors';
import {
  failureProjection,
  finalizeProjection,
  interruptionError,
  projectStream,
  record,
  type StreamProjection,
} from './stream-projection';
import type {
  AgentTransport,
  LangGraphClientOptions,
  StreamEvent,
} from './transport.types';
import {
  cancelledResult,
  captureTools,
  createToolBuffer,
  executeTool,
  resultCall,
} from './function-tools';

export interface SessionOptions {
  readonly assistantId: string;
  readonly threadId: string;
  readonly transport?: AgentTransport;
  readonly apiUrl?: string;
  /** The owned SDK transport defaults maxRetries to 0: an ambiguous failed
   * run-creation POST must not silently create another run. A supplied numeric
   * maxRetries explicitly opts into SDK request retries. Custom transports own
   * their retry policy; joining a known run is separate from replaying submit. */
  readonly clientOptions?: LangGraphClientOptions;
  readonly executionStore?: ToolExecutionStore;
}

/** Backend-private capability; core sessions and borrowed observers stay minimal. */
export type LangGraphSession<
  TTools extends { [K in keyof TTools]: ToolContract } = Record<
    string,
    ToolContract
  >
> = Omit<AgentSession<TTools>, 'getSnapshot' | 'submit'> & {
  getSnapshot(): LangGraphSnapshot<TTools>;
  submit(
    input: LangGraphSubmitInput,
    options?: LangGraphRunOptions
  ): Promise<CompleteOutcome>;
  reconnect(options?: {
    readonly signal?: AbortSignal;
  }): Promise<CompleteOutcome>;
  resume(
    value?: PlainValue,
    options?: LangGraphRunOptions
  ): Promise<CompleteOutcome>;
  load?(options?: { readonly signal?: AbortSignal }): Promise<void>;
};

interface HistoryRead {
  readonly controller: AbortController;
  readonly result: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
  unlink?: () => void;
}

type AttemptInput =
  | {
      readonly kind: 'submit';
      readonly messages: { type: 'human'; id: string; content: string }[];
      readonly state?: LangGraphInputState;
    }
  | { readonly kind: 'resume'; readonly value: PlainValue | undefined };

interface PhysicalRun {
  readonly batch: ReturnType<ReturnType<typeof createToolBuffer>['snapshot']>;
  evidence: RunEvidence;
  captureOpen: boolean;
  received: boolean;
  confirmed: boolean;
}

interface Attempt {
  readonly controller: AbortController;
  readonly generation: string;
  readonly result: Promise<CompleteOutcome>;
  readonly resolve: (outcome: CompleteOutcome) => void;
  readonly input: AttemptInput;
  readonly runOptions: CapturedRunOptions | undefined;
  projection: StreamProjection;
  subgraphs: SubgraphObservation;
  readonly calls: Map<string, ToolCall>;
  groups: number;
  physical?: PhysicalRun;
  joinCursor?: string;
  handoffIds: readonly string[];
  iterator?: AsyncIterator<StreamEvent>;
  unlink?: () => void;
  closed?: boolean;
}

/** Private development composition. Construction/observation perform no I/O.
 * stop settles local ownership, not remote side effects. dispose is permanent:
 * submits resolve aborted, subscriptions are inert, reads retain the final
 * snapshot, stop/dispose are idempotent. checkStatus rejects after disposal or
 * during a run; it only reads history and never creates another logical run. */
export function createSession<T extends Record<string, FunctionToolDefinition>>(
  options: SessionOptions & { readonly tools: T & CheckedTools<T> }
): LangGraphSession<ToolContracts<T>>;
export function createSession(
  options: SessionOptions & { readonly tools?: undefined }
): LangGraphSession;
export function createSession(
  options: SessionOptions & {
    readonly tools?: Record<string, FunctionToolDefinition>;
  }
): LangGraphSession {
  const { assistantId, threadId } = options;
  const { definitions, catalog } = captureTools(options.tools);
  const typedTools = options.tools !== undefined;
  const store = options.executionStore && {
    claim: options.executionStore.claim.bind(options.executionStore),
    record: options.executionStore.record.bind(options.executionStore),
  };
  const buffer = createToolBuffer();
  const resolvedTools = new Set<string>();
  // Provisional guarded claims and unavailable results survive command stop.
  // Only conclusive execution or explicit graph evidence releases admission.
  const unsettledTools = new Set<string>();
  // Execution dedupe survives transcript replacement. Authored result provenance
  // belongs only to the current transcript; a wire string cannot restore it.
  const authoredTools = new Set<string>();
  const transport =
    options.transport ??
    new FetchStreamTransport(options.apiUrl ?? '', undefined, {
      ...options.clientOptions,
      maxRetries: options.clientOptions?.maxRetries ?? 0,
    });
  const protectedTransport =
    transport instanceof FetchStreamTransport &&
    transport.protectsOperationErrors;
  const getHistory =
    typeof transport.getHistory === 'function'
      ? transport.getHistory.bind(transport)
      : undefined;
  const canCheck = !!getHistory;
  const joinStream = transport.joinStream?.bind(transport);
  const getRunStatus = transport.getRunStatus?.bind(transport);
  const canReconnect = !!joinStream && !!getRunStatus;
  const publication = createPublication({
    status: 'idle',
    messages: [],
    toolCalls: [],
    values: undefined,
    interrupts: [],
    subgraphs: [],
    history: undefined,
  });
  let historyPage: LangGraphSnapshot['history'];
  let subgraphs = initialSubgraphs(publication.getSnapshot().subgraphs);
  let state = initialMessageState();
  let values: LangGraphValues | undefined;
  let interrupts: readonly LangGraphInterrupt[] =
    publication.getSnapshot().interrupts;
  let owner: Attempt | undefined;
  let recoveryAttempt: Attempt | undefined;
  let retained: { attempt: Attempt; run: PhysicalRun } | undefined;
  let disposed = false;
  let revision = 0;
  let checkController: AbortController | undefined;
  let loading: HistoryRead | undefined;
  let pendingToolSettlements = 0;
  let pendingToolWrites = 0;

  function unsettledToolError(): AgentError {
    return {
      kind: 'interrupted',
      message:
        'Tool execution is unresolved. Reconcile the result externally, then load history before submitting again.' +
        (buffer.snapshot().messages.length
          ? ' Completed tool results remain staged.'
          : ''),
      retryable: false,
      recovery: 'none',
    };
  }
  function admitSubmission() {
    if (unsettledTools.size)
      throw new Error('Submission cannot replace unsettled tool execution.');
  }

  const owns = (attempt: Attempt) => owner === attempt && !disposed;
  function publish(status: 'idle' | 'running' | 'error', error?: AgentError) {
    publication.publish({
      status,
      history: historyPage,
      values,
      interrupts,
      subgraphs: subgraphs.subgraphs,
      ...(retained?.run.evidence.runId
        ? { reconnect: { runId: retained.run.evidence.runId } }
        : {}),
      messages: state.messages,
      toolCalls: typedTools
        ? state.toolCalls.filter(
            (call) =>
              definitions.has(call.name) &&
              (authoredTools.has(call.id) ||
                !state.messages.some(
                  (message) =>
                    message.role === 'tool' && message.toolCallId === call.id
                ))
          )
        : state.toolCalls,
      ...(error ? { error } : {}),
    });
  }
  function invalidateCheck() {
    revision += 1;
    const previous = checkController;
    checkController = undefined;
    return previous;
  }
  const ownsLoad = (read: HistoryRead) => loading === read && !disposed;
  function detachLoad() {
    const previous = loading;
    loading = undefined;
    previous?.resolve();
    return previous;
  }
  function closeLoad(read: HistoryRead | undefined, abort = true) {
    if (!read) return;
    const unlink = read.unlink;
    read.unlink = undefined;
    // Ownership must already be committed: abort/remove-listener hooks may
    // synchronously start another command. Cleanup never owns its replacement.
    if (abort) read.controller.abort();
    unlink?.();
  }
  function close(attempt: Attempt, abort = false, final = true) {
    const unlink = final ? attempt.unlink : undefined;
    if (final) attempt.unlink = undefined;
    const iterator = attempt.closed ? undefined : attempt.iterator;
    if (iterator) attempt.closed = true;
    // Cleanup can synchronously call session commands. Callers must commit all
    // ownership/state changes before invoking it, and never overwrite afterward.
    if (abort) attempt.controller.abort();
    unlink?.();
    if (!iterator) return;
    // return() may wait for a noncooperative next(); local settlement never does.
    try {
      void Promise.resolve(iterator.return?.()).catch(() => undefined);
    } catch {
      /* Cleanup cannot revive a settled attempt. */
    }
  }
  function settle(
    attempt: Attempt,
    outcome: CompleteOutcome,
    error?: AgentError,
    retainRun = false
  ) {
    if (!owns(attempt)) return;
    const run = attempt.physical;
    const candidate =
      retainRun &&
      canReconnect &&
      run &&
      !run.confirmed &&
      !run.evidence.unsafe &&
      run.evidence.runId &&
      run.evidence.cursor
        ? { attempt, run }
        : undefined;
    detach(outcome);
    retained = candidate;
    recoveryAttempt = error?.recovery === 'check' ? attempt : undefined;
    publish(error ? 'error' : 'idle', error);
    // An error can end local consumption before the HTTP body closes. SDK
    // iterator return releases its reader; abort also cancels our request.
    close(attempt, outcome === 'error');
  }
  function detach(outcome: CompleteOutcome): Attempt | undefined {
    const attempt = owner;
    if (!attempt) return;
    owner = undefined;
    recoveryAttempt = undefined;
    retained = undefined;
    for (const call of attempt.calls.values()) {
      const current = state.toolCalls.find((entry) => entry.id === call.id);
      if (current?.status !== 'running') continue;
      if (unsettledTools.has(call.id)) {
        state = reduceMessages(state, { type: 'tool-unsettled', id: call.id });
        continue;
      }
      resolvedTools.add(call.id);
      authoredTools.add(call.id);
      state = reduceMessages(state, {
        type: 'tool',
        toolCall: resultCall(call, cancelledResult(call.id)),
      });
    }
    state = reduceMessages(state, {
      type: 'complete',
      generation: attempt.generation,
      outcome,
    });
    subgraphs = settleSubgraphs(subgraphs, outcome);
    attempt.subgraphs = subgraphs;
    attempt.resolve(outcome);
    return attempt;
  }

  async function flushTools(signal: AbortSignal) {
    const batch = buffer.snapshot();
    if (!batch.messages.length) return;
    if (!transport.updateState)
      throw new Error(
        'Persisting terminal tool results requires transport.updateState().'
      );
    pendingToolWrites += 1;
    try {
      await transport.updateState(
        threadId,
        { messages: batch.messages },
        signal
      );
      batch.acknowledge();
    } finally {
      pendingToolWrites -= 1;
    }
  }

  async function executeTools(attempt: Attempt, groups: number) {
    const calls = state.toolCalls.filter(
      (call) =>
        call.status === 'pending' &&
        definitions.has(call.name) &&
        attempt.projection.toolCallIds?.includes(call.id) &&
        !resolvedTools.has(call.id)
    );
    if (!calls.length) return 'complete';
    // Capture all calls before publication: observers may synchronously stop.
    for (const call of calls) {
      attempt.calls.set(call.id, call);
      if (store && !definitions.get(call.name)?.idempotent)
        unsettledTools.add(call.id);
      state = reduceMessages(state, {
        type: 'tool',
        toolCall: { ...call, status: 'running' },
      });
    }
    pendingToolSettlements += calls.length;
    publish('running');
    await Promise.all(
      calls.map(async (call) => {
        try {
          const definition = definitions.get(call.name);
          if (!definition) return;
          const outcome = await executeTool(
            definition,
            call,
            attempt.controller.signal,
            { threadId, toolCallId: call.id },
            store,
            groups >= 10
          );
          if (outcome.type !== 'settled') {
            if (outcome.type === 'not-started') unsettledTools.delete(call.id);
            if (owns(attempt)) {
              state = reduceMessages(state, {
                type: 'tool-unsettled',
                id: call.id,
              });
              publish('running');
            }
            return;
          }
          const result = outcome.result;
          resolvedTools.add(call.id);
          authoredTools.add(call.id);
          buffer.stage(call.id, result);
          unsettledTools.delete(call.id);
          if (owns(attempt)) {
            state = reduceMessages(state, {
              type: 'tool',
              toolCall: resultCall(call, result),
            });
            publish('running');
          }
          if (!owns(attempt)) {
            // Required durable cleanup may finish after stop/dispose. It can only
            // persist results; it has no route back to publication or run creation.
            try {
              await flushTools(new AbortController().signal);
            } catch {
              /* The staged result remains available for explicit handoff. */
            }
          }
        } finally {
          pendingToolSettlements -= 1;
        }
      })
    );
    if (unsettledTools.size) return 'blocked';
    return groups < 10 &&
      calls.some((call) => definitions.get(call.name)?.followUp)
      ? 'follow-up'
      : 'complete';
  }
  function stopExecution() {
    const hadRetained = !!retained;
    retained = undefined;
    const reading = detachLoad();
    const checking = invalidateCheck();
    const attempt = detach('aborted');
    if (attempt || hadRetained) publish('idle');
    checking?.abort();
    if (attempt) close(attempt, true);
    closeLoad(reading);
  }

  function reconcile(attempt: Attempt, history: ThreadState[]) {
    if (attempt.input.kind === 'resume') return undefined;
    const previousState = state;
    const previousValues = values;
    const previousInterrupts = interrupts;
    const previousProjection = attempt.projection;
    const latest = history[0];
    if (!latest) return undefined;
    const checkpointValues = record(latest.values);
    const messages = Array.isArray(checkpointValues?.['messages'])
      ? checkpointValues['messages']
      : [];
    // Inert construction gives us no server baseline. Only our unique submitted
    // user ID can correlate this checkpoint to this request, including when the
    // persisted assistant retains the ID of its earlier streamed partial.
    const anchor = messages.findIndex(
      (value) => record(value)?.['id'] === previousProjection.userId
    );
    if (anchor < 0) return undefined;
    const after = messages.slice(anchor + 1);
    const nextUser = after.findIndex((value) => {
      const message = record(value);
      return message?.['type'] === 'human' || message?.['role'] === 'user';
    });
    const turn = nextUser < 0 ? after : after.slice(0, nextUser);
    // A continuation cannot be recovered from the earlier tool-producing step.
    // Its exact handoff must be present, with conclusive activity after it.
    const handoffs = attempt.handoffIds.map((id) =>
      turn.findIndex((value) => record(value)?.['id'] === id)
    );
    if (handoffs.some((index) => index < 0)) return undefined;
    const evidence = handoffs.length
      ? turn.slice(Math.max(...handoffs) + 1)
      : turn;
    const projectedInterrupts = projectHistoryInterrupts(
      previousInterrupts,
      history
    );
    const paused = nextUser < 0 && projectedInterrupts.length > 0;
    const committed =
      (nextUser >= 0 || latest.next.length === 0) &&
      evidence.some((value) => {
        const message = record(value);
        return (
          message &&
          (message['type'] === 'ai' ||
            (attempt.handoffIds.length === 0 && message['type'] === 'tool') ||
            message['role'] === 'assistant') &&
          typeof message['id'] === 'string'
        );
      });
    if (!paused && !committed) return undefined;
    const projected = projectStream(previousState, previousProjection, {
      type: 'values',
      data: { messages: [messages[anchor], ...turn] },
    });
    const projectedValues = projectHistoryValues(previousValues, history);
    return {
      state: finalizeProjection(projected.state, projected.projection),
      projection: { ...projected.projection, paused },
      values: projectedValues,
      interrupts: projectedInterrupts,
      outcome: paused ? ('paused' as const) : ('success' as const),
    };
  }

  async function execute(attempt: Attempt): Promise<void> {
    if (!owns(attempt)) return;
    const attemptCanCheck = () =>
      attempt.input.kind === 'submit' &&
      canCheck &&
      !attempt.physical?.evidence.runId &&
      !attempt.physical?.evidence.unsafe;
    try {
      let groups = attempt.groups;
      let input = attempt.input.kind === 'submit' ? attempt.input.messages : [];
      while (owns(attempt)) {
        const joining = attempt.joinCursor;
        const run: PhysicalRun =
          joining && attempt.physical
            ? attempt.physical
            : {
                batch: buffer.snapshot(),
                evidence: {},
                captureOpen: true,
                received: false,
                confirmed: false,
              };
        attempt.physical = run;
        const batch = run.batch;
        attempt.handoffIds =
          groups > 0 ? batch.messages.map((message) => message.id) : [];
        const resuming = groups === 0 && attempt.input.kind === 'resume';
        const payload = resuming
          ? null
          : createSubmitPayload(
              [...batch.messages, ...input],
              catalog,
              !joining && groups === 0 && attempt.input.kind === 'submit'
                ? attempt.input.state
                : undefined
            );
        // Ownership is captured before the first effect. The signal always belongs
        // to us, even when the caller also supplied an external AbortSignal.
        const capture = (metadata: { run_id: string; thread_id?: string }) => {
          if (!owns(attempt) || attempt.physical !== run || !run.captureOpen)
            return;
          const previous = run.evidence;
          let evidence: RunEvidence;
          try {
            evidence = run.received
              ? { unsafe: true }
              : captureRun(previous, metadata, threadId);
          } catch {
            evidence = { unsafe: true };
          }
          if (owns(attempt) && attempt.physical === run && run.captureOpen)
            run.evidence =
              run.evidence === previous ? evidence : { unsafe: true };
        };
        const events =
          joining && joinStream && run.evidence.runId
            ? joinStream(
                threadId,
                run.evidence.runId,
                joining,
                attempt.controller.signal
              )
            : transport.stream(
                assistantId,
                threadId,
                payload,
                attempt.controller.signal,
                attempt.runOptions ||
                  canReconnect ||
                  (resuming &&
                    attempt.input.kind === 'resume' &&
                    attempt.input.value !== undefined)
                  ? {
                      ...attempt.runOptions,
                      ...(canReconnect
                        ? {
                            streamResumable: true,
                            onDisconnect: 'continue' as const,
                            onRunCreated: capture,
                          }
                        : {}),
                      ...(resuming &&
                      attempt.input.kind === 'resume' &&
                      attempt.input.value !== undefined
                        ? { command: { resume: attempt.input.value } }
                        : {}),
                    }
                  : undefined
              );
        attempt.iterator = events[Symbol.asyncIterator]();
        if (!owns(attempt)) {
          close(attempt);
          return;
        }
        while (owns(attempt)) {
          const next = await attempt.iterator.next();
          if (!owns(attempt)) return;
          if (next.done) break;
          // Run creation precedes stream frames. A later callback cannot safely
          // attach an identity to already consumed data, including reentrant getters.
          run.received = true;
          const event = captureStreamEvent(next.value);
          if (!owns(attempt)) return;
          const previousState = state;
          const previousValues = values;
          const previousInterrupts = interrupts;
          const previousProjection = attempt.projection;
          if (event.type === 'error' && !event.namespace?.length) {
            const error = failureProjection(
              event['data'] ?? event,
              protectedTransport,
              true,
              attemptCanCheck()
            );
            settle(attempt, 'error', error);
            return;
          }
          const previousEvidence = run.evidence;
          const cursor = advanceCursor(previousEvidence, event, joining);
          if (!owns(attempt)) return;
          if (cursor.replay) {
            run.evidence = cursor.evidence;
            throw new Error('The joined stream repeated its requested cursor.');
          }
          const projected = projectStream(
            previousState,
            previousProjection,
            event
          );
          const projectedValues = projectValues(previousValues, event);
          const projectedInterrupts = projectInterrupts(
            previousInterrupts,
            event
          );
          const projectedSubgraphs = projectSubgraphs(
            subgraphs,
            event,
            groups === 0
              ? attempt.generation
              : `${attempt.generation}-step-${groups}`,
            attempt.projection.messageIdPrefix
          );
          // All projections may invoke transport-owned getters. Commit no
          // candidate if projection failed or a getter changed the owner.
          if (!owns(attempt)) return;
          run.evidence =
            run.evidence === previousEvidence
              ? cursor.evidence
              : { unsafe: true };
          state = projected.state;
          values = projectedValues;
          interrupts = projectedInterrupts;
          subgraphs = projectedSubgraphs;
          attempt.subgraphs = subgraphs;
          attempt.projection = {
            ...projected.projection,
            paused: projectedInterrupts.length > 0,
          };
          publish('running');
          // publish drains observer commands before returning. Never dispatch or
          // read on behalf of an attempt a listener just stopped/superseded.
          if (!owns(attempt)) return;
        }
        if (!owns(attempt)) return;
        run.captureOpen = false;
        let outcome: CompleteOutcome = attempt.projection.paused
          ? 'paused'
          : attempt.projection.terminal
          ? 'success'
          : 'interrupted';
        if (run.evidence.runId && !run.evidence.unsafe && getRunStatus) {
          let status: Awaited<ReturnType<typeof getRunStatus>> | undefined;
          try {
            status = await getRunStatus(
              threadId,
              run.evidence.runId,
              attempt.controller.signal
            );
          } catch {
            /* Exact-run inspection failed; history cannot replace it. */
          }
          if (!owns(attempt)) return;
          if (
            (status === 'success' || status === 'interrupted') &&
            attempt.projection.paused
          ) {
            outcome = 'paused';
            run.confirmed = true;
          } else if (status === 'success' && attempt.projection.terminal) {
            outcome = 'success';
            run.confirmed = true;
          } else if (
            status === 'error' ||
            status === 'timeout' ||
            status === 'interrupted'
          ) {
            run.confirmed = true;
            settle(
              attempt,
              status === 'interrupted' ? 'interrupted' : 'error',
              {
                kind: status === 'interrupted' ? 'interrupted' : 'server',
                message: 'The LangGraph run did not complete successfully.',
                retryable: false,
                recovery: 'none',
              }
            );
            return;
          } else outcome = 'interrupted';
        } else if (run.evidence.unsafe) outcome = 'interrupted';
        if (
          outcome === 'interrupted' &&
          attemptCanCheck() &&
          transport.getHistory
        ) {
          try {
            const history = await transport.getHistory(
              threadId,
              attempt.controller.signal
            );
            if (!owns(attempt)) return;
            const recovered = reconcile(attempt, history);
            if (!owns(attempt)) return;
            if (recovered) {
              state = recovered.state;
              values = recovered.values;
              interrupts = recovered.interrupts;
              attempt.projection = recovered.projection;
              outcome = recovered.outcome;
            }
          } catch {
            if (!owns(attempt)) return;
          }
        }
        if (!owns(attempt)) return;
        if (outcome === 'success' || outcome === 'paused') {
          state = finalizeProjection(state, attempt.projection);
          subgraphs = settleSubgraphs(subgraphs, outcome, true);
          attempt.subgraphs = subgraphs;
        }
        if (outcome === 'success') {
          state = reduceMessages(state, {
            type: 'complete',
            generation: attempt.generation,
            outcome: 'success',
          });
          batch.acknowledge();
          const followUp = await executeTools(attempt, groups);
          if (!owns(attempt)) return;
          if (followUp === 'blocked') {
            // Persist legitimate mixed-group results without continuing past
            // an unavailable call. Failed writes keep the exact staged buffer.
            try {
              await flushTools(attempt.controller.signal);
            } catch {
              /* retained */
            }
            if (owns(attempt))
              settle(attempt, 'interrupted', unsettledToolError());
            return;
          }
          if (followUp === 'follow-up') {
            groups += 1;
            attempt.groups = groups;
            attempt.joinCursor = undefined;
            attempt.physical = undefined;
            subgraphs = initialSubgraphs(subgraphs.subgraphs);
            attempt.subgraphs = subgraphs;
            close(attempt, false, false);
            if (!owns(attempt)) return;
            attempt.closed = false;
            attempt.iterator = undefined;
            attempt.projection = {
              generation: attempt.generation,
              messageIdPrefix: `${attempt.generation}-step-${groups}`,
              userId: attempt.projection.userId,
              baselineIds: state.messages.map((message) => message.id),
              sawAssistant: false,
              terminal: false,
              paused: false,
              canonical: [],
              ...(attempt.input.kind === 'resume'
                ? {
                    resume: {
                      ...attempt.projection.resume,
                      turnIds: turnIds(attempt.projection.userId),
                    },
                  }
                : {}),
            };
            input = [];
            continue;
          }
          try {
            await flushTools(attempt.controller.signal);
          } catch {
            if (owns(attempt))
              settle(attempt, 'error', {
                kind: 'server',
                message:
                  'Tool results could not be persisted. They remain staged for the next submission.',
                retryable: false,
                recovery: 'none',
              });
            return;
          }
          if (!owns(attempt)) return;
        }
        settle(
          attempt,
          outcome,
          outcome === 'interrupted'
            ? interruptionError(attemptCanCheck())
            : undefined,
          outcome === 'interrupted'
        );
        return;
      }
    } catch (raw) {
      if (!owns(attempt)) return;
      if (attempt.physical) attempt.physical.captureOpen = false;
      const error = failureProjection(
        raw,
        protectedTransport,
        false,
        attemptCanCheck()
      );
      settle(
        attempt,
        error.kind === 'interrupted' ? 'interrupted' : 'error',
        error,
        true
      );
    }
  }

  function turnIds(userId: string | undefined) {
    const anchor = state.messages.findIndex((message) => message.id === userId);
    const after = state.messages.slice(anchor + 1);
    const nextUser = after.findIndex((message) => message.role === 'user');
    return (nextUser < 0 ? after : after.slice(0, nextUser)).map(
      (message) => message.id
    );
  }

  function beginAttempt(
    input: AttemptInput,
    external?: AbortSignal,
    runOptions?: CapturedRunOptions
  ): Attempt {
    const reading = detachLoad();
    const checking = invalidateCheck();
    const previous = detach('interrupted');
    subgraphs = initialSubgraphs(
      input.kind === 'submit' ? undefined : subgraphs.subgraphs
    );
    const generation = crypto.randomUUID();
    const userId =
      input.kind === 'submit'
        ? input.messages[0].id
        : state.messages.filter((message) => message.role === 'user').at(-1)
            ?.id;
    let resolve!: Attempt['resolve'];
    const result = new Promise<CompleteOutcome>((done) => {
      resolve = done;
    });
    const created: Attempt = {
      controller: new AbortController(),
      generation,
      result,
      resolve,
      calls: new Map(),
      groups: 0,
      handoffIds: [],
      input,
      runOptions,
      subgraphs,
      projection: {
        generation,
        userId,
        baselineIds: state.messages.map((m) => m.id),
        sawAssistant: false,
        terminal: false,
        paused: false,
        canonical: [],
        ...(input.kind === 'resume'
          ? { resume: { turnIds: turnIds(userId) } }
          : {}),
      },
    };
    owner = created;
    recoveryAttempt = undefined;
    retained = undefined;

    if (input.kind === 'submit')
      state = reduceMessages(state, {
        type: 'message',
        mode: 'snapshot',
        message: {
          id: input.messages[0].id,
          role: 'user',
          content: input.messages[0].content,
          delivery: completeDelivery(generation, 'success'),
        },
      });
    interrupts = projectHistoryInterrupts(interrupts, []);
    if (external) {
      const abort = () => {
        void publication.command(() => {
          if (owns(created)) {
            stopExecution();
          }
        });
      };
      created.unlink = () => external.removeEventListener('abort', abort);
      external.addEventListener('abort', abort, { once: true });
      if (external.aborted) abort();
    }
    if (owns(created)) publish('running');
    checking?.abort();
    if (previous) close(previous, true);
    closeLoad(reading);
    return created;
  }

  function dispatch(
    beginning: Promise<void>,
    readAttempt: () => Attempt | undefined
  ): Promise<CompleteOutcome> {
    // Observer commands finish draining before this continuation can issue I/O.
    return beginning.then(() => {
      const attempt = readAttempt();
      if (!attempt) return 'aborted';
      void execute(attempt);
      return attempt.result;
    });
  }

  function submit(
    input: LangGraphSubmitInput,
    options?: LangGraphRunOptions
  ): Promise<CompleteOutcome> {
    let attempt: Attempt | undefined;
    const beginning = publication.command(() => {
      if (disposed) return;
      admitSubmission();
      const capturedRevision = revision;
      const capturedLoad = loading;
      const external = options?.signal;
      // Even the signal getter can synchronously stop or replace this command.
      if (
        disposed ||
        external?.aborted ||
        capturedRevision !== revision ||
        capturedLoad !== loading
      )
        return;
      const captured = captureSubmitInput(input);
      if (
        disposed ||
        external?.aborted ||
        capturedRevision !== revision ||
        capturedLoad !== loading
      )
        return;
      const runOptions = captureRunOptions(options);
      if (
        disposed ||
        external?.aborted ||
        capturedRevision !== revision ||
        capturedLoad !== loading
      )
        return;
      admitSubmission();
      attempt = beginAttempt(
        {
          kind: 'submit',
          state: captured.state,
          messages: [
            {
              type: 'human',
              id: crypto.randomUUID(),
              content: captured.message,
            },
          ],
        },
        external,
        runOptions
      );
    });
    return dispatch(beginning, () => attempt);
  }

  function resume(
    value?: PlainValue,
    options?: LangGraphRunOptions
  ): Promise<CompleteOutcome> {
    let attempt: Attempt | undefined;
    const beginning = publication.command(() => {
      const capturedRevision = revision;
      const capturedLoad = loading;
      const external = options?.signal;
      if (
        disposed ||
        external?.aborted ||
        capturedRevision !== revision ||
        capturedLoad !== loading
      )
        return;
      const admit = () => {
        if (
          owner ||
          loading ||
          recoveryAttempt ||
          retained ||
          pendingToolSettlements ||
          pendingToolWrites ||
          unsettledTools.size ||
          buffer.snapshot().messages.length
        )
          throw new Error(
            'Resume cannot replace an active request, history load, recovery, or unsettled tool results.'
          );
        if (!interrupts.length)
          throw new Error('Resume requires an observed interrupt.');
      };
      admit();
      const captured = ownValue(value);
      if (
        disposed ||
        external?.aborted ||
        capturedRevision !== revision ||
        capturedLoad !== loading
      )
        return;
      const runOptions = captureRunOptions(options);
      // Response getters are caller effects, not a lock-protected projection.
      if (
        disposed ||
        external?.aborted ||
        capturedRevision !== revision ||
        capturedLoad !== loading
      )
        return;
      admit();
      attempt = beginAttempt(
        { kind: 'resume', value: captured },
        external,
        runOptions
      );
    });
    return dispatch(beginning, () => attempt);
  }

  function reconnect(options?: {
    readonly signal?: AbortSignal;
  }): Promise<CompleteOutcome> {
    let attempt: Attempt | undefined;
    const beginning = publication.command(() => {
      const capturedRevision = revision;
      const external = options?.signal;
      if (disposed || external?.aborted) return;
      const candidate = retained;
      if (
        owner ||
        loading ||
        checkController ||
        pendingToolSettlements ||
        pendingToolWrites ||
        unsettledTools.size ||
        !candidate ||
        !canReconnect
      )
        throw new Error(
          'Reconnect requires an idle retained run with no unsettled work.'
        );
      if (
        buffer
          .snapshot()
          .messages.some(
            (message) => !candidate.run.batch.messages.includes(message)
          )
      )
        throw new Error('Reconnect cannot hand off unrelated staged results.');
      const generation = crypto.randomUUID();
      const projected = rebaseRun(
        state,
        candidate.attempt.projection,
        generation
      );
      const projectedSubgraphs = rebaseSubgraphs(
        candidate.attempt.subgraphs,
        generation
      );
      if (
        disposed ||
        external?.aborted ||
        revision !== capturedRevision ||
        retained !== candidate
      )
        return;
      const checking = invalidateCheck();
      let resolve!: Attempt['resolve'];
      const result = new Promise<CompleteOutcome>((done) => {
        resolve = done;
      });
      const created: Attempt = {
        controller: new AbortController(),
        generation,
        result,
        resolve,
        input: candidate.attempt.input,
        runOptions: candidate.attempt.runOptions,
        calls: new Map(),
        groups: candidate.attempt.groups,
        handoffIds: candidate.attempt.handoffIds,
        projection: projected.projection,
        subgraphs: projectedSubgraphs,
        physical: { ...candidate.run, captureOpen: false },
        joinCursor: candidate.run.evidence.cursor,
      };
      attempt = created;
      retained = undefined;
      recoveryAttempt = undefined;
      state = projected.state;
      subgraphs = projectedSubgraphs;
      owner = created;
      if (external) {
        const abort = () => {
          void publication.command(() => {
            if (owns(created)) stopExecution();
          });
        };
        created.unlink = () => external.removeEventListener('abort', abort);
        external.addEventListener('abort', abort, { once: true });
        if (external.aborted) abort();
      }
      if (owns(created)) publish('running');
      checking?.abort();
    });
    return dispatch(beginning, () => attempt);
  }

  async function readHistory(read: HistoryRead) {
    if (!ownsLoad(read) || !getHistory) return;
    try {
      const history = await getHistory(threadId, read.controller.signal);
      await publication.command(() => {
        if (!ownsLoad(read)) return;
        const previousState = state;
        const previousValues = values;
        const previousInterrupts = interrupts;
        const projectedInterrupts = projectHistoryInterrupts(
          previousInterrupts,
          history
        );
        const projected = projectHistory(previousState, history, {
          interrupts: projectedInterrupts,
          ...(typedTools
            ? { registeredTools: new Set(definitions.keys()) }
            : {}),
        });
        const projectedValues = projectHistoryValues(previousValues, history);
        const projectedHistory = projectCheckpointHistory(historyPage, history);
        // Even a plain projection can invoke getters supplied by a transport.
        // Such a getter can submit/stop/dispose; never commit its stale result.
        if (!ownsLoad(read)) return;
        // Use the owned latest transcript only. An empty read or an older
        // checkpoint cannot clear authority; wire text is not a typed result.
        for (const message of projected.messages) {
          if (
            message.role === 'tool' &&
            message.toolCallId &&
            unsettledTools.delete(message.toolCallId)
          )
            resolvedTools.add(message.toolCallId);
        }
        state = projected;
        values = projectedValues;
        interrupts = projectedInterrupts;
        historyPage = projectedHistory;
        subgraphs = initialSubgraphs();
        authoredTools.clear();
        loading = undefined;
        read.resolve();
        publish(
          unsettledTools.size ? 'error' : 'idle',
          unsettledTools.size ? unsettledToolError() : undefined
        );
        closeLoad(read, false);
      });
    } catch {
      await publication.command(() => {
        if (!ownsLoad(read)) return;
        loading = undefined;
        read.reject(createSafeRequestError());
        closeLoad(read);
      });
    }
  }

  function load(options?: { readonly signal?: AbortSignal }): Promise<void> {
    let read: HistoryRead | undefined;
    const beginning = publication.command(() => {
      if (disposed || options?.signal?.aborted) return;
      if (
        owner ||
        recoveryAttempt ||
        retained ||
        pendingToolSettlements ||
        pendingToolWrites ||
        (buffer.snapshot().messages.length && !unsettledTools.size)
      )
        throw new Error(
          'History cannot replace an active request, recovery, or unsettled tool results.'
        );
      const previous = detachLoad();
      let resolve!: HistoryRead['resolve'];
      let reject!: HistoryRead['reject'];
      const result = new Promise<void>((done, failed) => {
        resolve = done;
        reject = failed;
      });
      const created: HistoryRead = {
        controller: new AbortController(),
        result,
        resolve,
        reject,
      };
      read = created;
      loading = created;
      const external = options?.signal;
      if (external) {
        const abort = () => {
          void publication.command(() => {
            if (ownsLoad(created)) closeLoad(detachLoad());
          });
        };
        created.unlink = () => external.removeEventListener('abort', abort);
        external.addEventListener('abort', abort, { once: true });
        if (external.aborted) abort();
      }
      closeLoad(previous);
    });
    return beginning.then(() => {
      if (!read) return;
      void readHistory(read);
      return read.result;
    });
  }

  async function checkStatus() {
    let checking:
      | { revision: number; attempt: Attempt; controller: AbortController }
      | undefined;
    await publication.command(() => {
      if (disposed) throw new Error('Agent has been disposed');
      if (owner)
        throw new Error('Stop the active request before checking status');
      if (!recoveryAttempt) return;
      const previous = invalidateCheck();
      checkController = new AbortController();
      checking = {
        revision,
        attempt: recoveryAttempt,
        controller: checkController,
      };
      previous?.abort();
    });
    if (!checking || disposed || checking.revision !== revision) return;
    const captured = checking;
    try {
      const history = await transport.getHistory?.(
        threadId,
        captured.controller.signal
      );
      await publication.command(() => {
        if (disposed || captured.revision !== revision || !history) return;
        const recovered = reconcile(captured.attempt, history);
        if (!recovered) return;
        // Interrupted deliveries are already complete: recovered canonical
        // history carries the conclusive success stamp in this aggregate.
        const recoveredState = {
          ...recovered.state,
          messages: recovered.state.messages.map((message) =>
            message.delivery.generation === captured.attempt.generation
              ? ownMessage({
                  ...message,
                  delivery: completeDelivery(
                    captured.attempt.generation,
                    recovered.outcome
                  ),
                })
              : message
          ),
        };
        const recoveredSubgraphs = settleSubgraphs(
          captured.attempt.subgraphs,
          recovered.outcome,
          true,
          true
        );
        // Projection and delivery ownership must finish before clearing this
        // check: a raw getter can synchronously start a replacement operation.
        if (disposed || captured.revision !== revision) return;
        recoveryAttempt = undefined;
        checkController = undefined;
        state = recoveredState;
        values = recovered.values;
        interrupts = recovered.interrupts;
        subgraphs = recoveredSubgraphs;
        captured.attempt.subgraphs = subgraphs;
        captured.attempt.projection = recovered.projection;
        publish('idle');
      });
    } finally {
      if (checkController === captured.controller) checkController = undefined;
    }
  }

  return {
    getSnapshot: publication.getSnapshot,
    subscribe: (notify) =>
      disposed ? () => undefined : publication.subscribe(notify),
    submit,
    resume,
    reconnect,
    stop: () =>
      publication.command(() => {
        if (disposed) return;
        stopExecution();
      }),
    ...(canCheck ? { checkStatus, load } : {}),
    dispose: () =>
      publication.command(() => {
        if (disposed) return;
        disposed = true;
        retained = undefined;
        const reading = detachLoad();
        const checking = invalidateCheck();
        const attempt = detach('aborted');
        recoveryAttempt = undefined;
        publish('idle');
        publication.clearListeners();
        checking?.abort();
        if (attempt) close(attempt, true);
        closeLoad(reading);
      }),
  };
}
