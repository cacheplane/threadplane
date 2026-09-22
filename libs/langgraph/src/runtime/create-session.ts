import {
  completeDelivery,
  type AgentError,
  type AgentSession,
  type CompleteOutcome,
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
import type { LangGraphSnapshot, LangGraphValues } from './langgraph-snapshot';
import { projectHistoryValues, projectValues } from './values-projection';
import { ownMessage } from './ownership';
import { createSafeRequestError } from './operation-errors';
import {
  failureProjection,
  finalizeProjection,
  hasPause,
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
> = Omit<AgentSession<TTools>, 'getSnapshot'> & {
  getSnapshot(): LangGraphSnapshot<TTools>;
  load?(options?: { readonly signal?: AbortSignal }): Promise<void>;
};

interface HistoryRead {
  readonly controller: AbortController;
  readonly result: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
  unlink?: () => void;
}

interface Attempt {
  readonly controller: AbortController;
  readonly generation: string;
  readonly result: Promise<CompleteOutcome>;
  readonly resolve: (outcome: CompleteOutcome) => void;
  readonly input: {
    messages: { type: 'human'; id: string; content: string }[];
  };
  projection: StreamProjection;
  readonly calls: Map<string, ToolCall>;
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
  const publication = createPublication({
    status: 'idle',
    messages: [],
    toolCalls: [],
    values: undefined,
  });
  let state = initialMessageState();
  let values: LangGraphValues | undefined;
  let owner: Attempt | undefined;
  let recoveryAttempt: Attempt | undefined;
  let disposed = false;
  let revision = 0;
  let checkController: AbortController | undefined;
  let loading: HistoryRead | undefined;
  let pendingToolSettlements = 0;
  let pendingToolWrites = 0;

  const owns = (attempt: Attempt) => owner === attempt && !disposed;
  function publish(status: 'idle' | 'running' | 'error', error?: AgentError) {
    publication.publish({
      status,
      values,
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
    error?: AgentError
  ) {
    if (!owns(attempt)) return;
    detach(outcome);
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
    for (const call of attempt.calls.values()) {
      const current = state.toolCalls.find((entry) => entry.id === call.id);
      if (current?.status !== 'running') continue;
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
    if (!calls.length) return false;
    // Capture all calls before publication: observers may synchronously stop.
    for (const call of calls) {
      attempt.calls.set(call.id, call);
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
          const result = await executeTool(
            definition,
            call,
            attempt.controller.signal,
            { threadId, toolCallId: call.id },
            store,
            groups >= 10
          );
          resolvedTools.add(call.id);
          authoredTools.add(call.id);
          buffer.stage(call.id, result);
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
    return (
      groups < 10 && calls.some((call) => definitions.get(call.name)?.followUp)
    );
  }
  function stopExecution() {
    const reading = detachLoad();
    const checking = invalidateCheck();
    const attempt = detach('aborted');
    if (attempt) publish('idle');
    checking?.abort();
    if (attempt) close(attempt, true);
    closeLoad(reading);
  }

  function reconcile(attempt: Attempt, history: ThreadState[]) {
    const previousState = state;
    const previousValues = values;
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
      (value) => record(value)?.['id'] === attempt.projection.userId
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
    const paused =
      nextUser < 0 &&
      (hasPause(checkpointValues) ||
        latest.tasks?.some((task) => (task.interrupts?.length ?? 0) > 0));
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
    const projected = projectStream(previousState, attempt.projection, {
      type: 'values',
      data: { ...checkpointValues, messages: [messages[anchor], ...turn] },
    });
    const projectedValues = projectHistoryValues(previousValues, history);
    return {
      state: finalizeProjection(projected.state, projected.projection),
      projection: projected.projection,
      values: projectedValues,
      outcome: paused ? ('paused' as const) : ('success' as const),
    };
  }

  async function execute(attempt: Attempt): Promise<void> {
    if (!owns(attempt)) return;
    try {
      let groups = 0;
      let input: { readonly messages: readonly unknown[] } = attempt.input;
      while (owns(attempt)) {
        const batch = buffer.snapshot();
        attempt.handoffIds =
          groups > 0 ? batch.messages.map((message) => message.id) : [];
        const payload = {
          messages: [...batch.messages, ...input.messages],
          ...(catalog.length ? { client_tools: catalog } : {}),
        };
        // Ownership is captured before the first effect. The signal always belongs
        // to us, even when the caller also supplied an external AbortSignal.
        attempt.iterator = transport
          .stream(assistantId, threadId, payload, attempt.controller.signal)
          [Symbol.asyncIterator]();
        if (!owns(attempt)) {
          close(attempt);
          return;
        }
        while (owns(attempt)) {
          const next = await attempt.iterator.next();
          if (!owns(attempt)) return;
          if (next.done) break;
          const event = next.value;
          if (event.type === 'error' && !event.namespace?.length) {
            const error = failureProjection(
              event['data'] ?? event,
              protectedTransport,
              true,
              canCheck
            );
            settle(attempt, 'error', error);
            return;
          }
          const projected = projectStream(state, attempt.projection, event);
          const projectedValues = projectValues(values, event);
          // Both projections may invoke transport-owned getters. Commit neither
          // candidate if projection failed or a getter changed the owner.
          if (!owns(attempt)) return;
          state = projected.state;
          values = projectedValues;
          attempt.projection = projected.projection;
          publish('running');
          // publish drains observer commands before returning. Never dispatch or
          // read on behalf of an attempt a listener just stopped/superseded.
          if (!owns(attempt)) return;
        }
        if (!owns(attempt)) return;
        let outcome: CompleteOutcome = attempt.projection.paused
          ? 'paused'
          : attempt.projection.terminal
          ? 'success'
          : 'interrupted';
        if (outcome === 'interrupted' && transport.getHistory) {
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
              attempt.projection = recovered.projection;
              outcome = recovered.outcome;
            }
          } catch {
            if (!owns(attempt)) return;
          }
        }
        if (!owns(attempt)) return;
        if (outcome === 'success' || outcome === 'paused')
          state = finalizeProjection(state, attempt.projection);
        if (outcome === 'success') {
          state = reduceMessages(state, {
            type: 'complete',
            generation: attempt.generation,
            outcome: 'success',
          });
          batch.acknowledge();
          const followUp = await executeTools(attempt, groups);
          if (!owns(attempt)) return;
          if (followUp) {
            groups += 1;
            close(attempt, false, false);
            if (!owns(attempt)) return;
            attempt.closed = false;
            attempt.iterator = undefined;
            attempt.projection = {
              generation: attempt.generation,
              userId: attempt.projection.userId,
              baselineIds: state.messages.map((message) => message.id),
              sawAssistant: false,
              terminal: false,
              paused: false,
              canonical: [],
            };
            input = { messages: [] };
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
          outcome === 'interrupted' ? interruptionError(canCheck) : undefined
        );
        return;
      }
    } catch (raw) {
      if (!owns(attempt)) return;
      const error = failureProjection(raw, protectedTransport, false, canCheck);
      settle(
        attempt,
        error.kind === 'interrupted' ? 'interrupted' : 'error',
        error
      );
    }
  }

  function submit(
    input: string,
    submitOptions?: { signal?: AbortSignal }
  ): Promise<CompleteOutcome> {
    let attempt: Attempt | undefined;
    const beginning = publication.command(() => {
      if (disposed || submitOptions?.signal?.aborted) return;
      const reading = detachLoad();
      const checking = invalidateCheck();
      const previous = detach('interrupted');
      const generation = crypto.randomUUID();
      const userId = crypto.randomUUID();
      let resolve!: Attempt['resolve'];
      const result = new Promise<CompleteOutcome>((done) => {
        resolve = done;
      });
      attempt = {
        controller: new AbortController(),
        generation,
        result,
        resolve,
        calls: new Map(),
        handoffIds: [],
        input: { messages: [{ type: 'human', id: userId, content: input }] },
        projection: {
          generation,
          userId,
          baselineIds: state.messages.map((m) => m.id),
          sawAssistant: false,
          terminal: false,
          paused: false,
          canonical: [],
        },
      };
      const created = attempt;
      owner = created;
      recoveryAttempt = undefined;
      const external = submitOptions?.signal;
      if (external) {
        const abort = () => {
          void publication.command(() => {
            if (owns(created)) {
              stopExecution();
            }
          });
        };
        external.addEventListener('abort', abort, { once: true });
        created.unlink = () => external.removeEventListener('abort', abort);
      }
      state = reduceMessages(state, {
        type: 'message',
        mode: 'snapshot',
        message: {
          id: userId,
          role: 'user',
          content: input,
          delivery: completeDelivery(generation, 'success'),
        },
      });
      publish('running');
      checking?.abort();
      if (previous) close(previous, true);
      closeLoad(reading);
    });
    // Even nested observer commands finish draining before this continuation can
    // issue I/O. A stop/dispose from the running publication can prevent it.
    return beginning.then(() => {
      if (!attempt) return 'aborted';
      void execute(attempt);
      return attempt.result;
    });
  }

  async function readHistory(read: HistoryRead) {
    if (!ownsLoad(read) || !getHistory) return;
    try {
      const history = await getHistory(threadId, read.controller.signal);
      await publication.command(() => {
        if (!ownsLoad(read)) return;
        const projected = projectHistory(
          state,
          history,
          typedTools
            ? { registeredTools: new Set(definitions.keys()) }
            : undefined
        );
        const projectedValues = projectHistoryValues(values, history);
        // Even a plain projection can invoke getters supplied by a transport.
        // Such a getter can submit/stop/dispose; never commit its stale result.
        if (!ownsLoad(read)) return;
        state = projected;
        values = projectedValues;
        authoredTools.clear();
        loading = undefined;
        read.resolve();
        publish('idle');
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
        pendingToolSettlements ||
        pendingToolWrites ||
        buffer.snapshot().messages.length
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
        // Projection and delivery ownership must finish before clearing this
        // check: a raw getter can synchronously start a replacement operation.
        if (disposed || captured.revision !== revision) return;
        recoveryAttempt = undefined;
        checkController = undefined;
        state = recoveredState;
        values = recovered.values;
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
