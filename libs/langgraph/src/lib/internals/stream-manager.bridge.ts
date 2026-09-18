import { isDevMode, signal, type Signal } from '@angular/core';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Keep the postinstall module external through ng-packagr.
import { installationToken } from '#development-install';
declare const ngDevMode: boolean;
import { createDevelopmentRuntime } from '@threadplane/telemetry/browser';
import { THREADPLANE_PACKAGE_VERSION as packageVersion } from '../package-version';
import { Observable, takeUntil } from 'rxjs';
import {
  ResourceStatus,
  AgentOptions,
  StreamSubjects,
  StreamEvent,
  AgentTransport,
  SubagentStreamRef,
  AgentQueue,
  AgentQueueEntry,
  LangGraphSubmitOptions,
} from '../agent.types';
import { FetchStreamTransport } from '../transport/fetch-stream.transport';
import { BagTemplate } from '@langchain/langgraph-sdk';
import { getToolCallsWithResults } from '@langchain/langgraph-sdk/utils';
import type {
  AgentRuntimeTelemetryEvent,
  AgentRuntimeTelemetryProperties,
  AgentRuntimeTelemetrySink,
} from '@threadplane/chat';
import {
  AgentError,
  AGENT_ERROR_MESSAGES,
  AGENT_RECOVERY_MESSAGES,
  AGENT_RECOVERY_DETAILS,
  completeDelivery,
  isAbortError,
  staticDelivery,
  streamingDelivery,
  toAgentError,
  type CompleteOutcome,
  type MessageDelivery,
} from '@threadplane/chat';
import {
  SubagentTracker,
  TrackedSubagent,
  childStreamRefFromNamespace,
  isChildNamespace,
} from './subagent-tracker';
import type { BaseMessage } from '@langchain/core/messages';
import type { Interrupt, Message as LangGraphMessage, ThreadState, ToolCallWithResult, ToolProgress } from '@langchain/langgraph-sdk';

// Local copy of the trace harness — same gating as @threadplane/chat's trace.ts.
// Duplicated here to avoid an @threadplane/chat dep on the langgraph internals path.
function isLgTraceEnabled(): boolean {
  if (typeof globalThis === 'undefined') return false;
  const win = (globalThis as { window?: { __threadplaneChatTrace?: boolean; localStorage?: Storage } }).window;
  if (!win) return false;
  if (win.__threadplaneChatTrace === true) return true;
  try { return win.localStorage?.getItem('THREADPLANE_CHAT_STREAM_TRACE') === '1'; } catch { return false; }
}
function lgTrace(...args: unknown[]): void {
  if (isLgTraceEnabled()) {
    // eslint-disable-next-line no-console
    console.debug('[tplane-chat-stream]', ...args);
  }
}

function captureAgentRuntimeTelemetry(
  sink: AgentRuntimeTelemetrySink | false | undefined,
  event: AgentRuntimeTelemetryEvent,
  properties: AgentRuntimeTelemetryProperties,
): void {
  if (!sink) return;
  try {
    void Promise.resolve(sink({ event, properties })).catch(() => undefined);
  } catch {
    // Keep telemetry side effects isolated from stream control flow.
  }
}

function agentRuntimeTelemetryErrorClass(error: unknown): string {
  try {
    if (isAbortError(error)) return 'AbortError';
    if (error instanceof AgentError) return 'AgentError';
    if (error instanceof Error) return 'Error';
  } catch {
    return 'UnknownError';
  }
  return 'UnknownError';
}

function genericSafeAgentError(): AgentError {
  return new AgentError({
    kind: 'server',
    message: AGENT_ERROR_MESSAGES.server,
    retryable: true,
  });
}

function safeIsAbortError(error: unknown): boolean {
  try {
    return isAbortError(error);
  } catch {
    return false;
  }
}

function safeReadEventError(event: StreamEvent): unknown {
  try {
    return Object.getOwnPropertyDescriptor(event, 'error')?.value;
  } catch {
    return undefined;
  }
}

function safeReadRecordValue(record: Record<string, unknown>, key: string): unknown {
  try {
    return Object.getOwnPropertyDescriptor(record, key)?.value;
  } catch {
    return undefined;
  }
}

export interface StreamManagerBridgeOptions<T, ResolvedBag extends BagTemplate = BagTemplate> {
  options:   AgentOptions<T, ResolvedBag> & { apiUrl: string };
  subjects:  StreamSubjects<T, ResolvedBag>;
  threadId$: Observable<string | null>;
  destroy$:  Observable<void>;
  reportOperationFailure?: (code: 'unauthorized' | 'network_blocked') => void;
}

type ResubmitOutcome = CompleteOutcome | 'not-started';

/** Options for the bridge's internal `refreshHistory`. */
interface HistoryRefreshOptions {
  /**
   * Project the refreshed checkpoint even when `messages$` already has content.
   * Off for a first connect, where optimistic local state must not be clobbered;
   * on at run completion, where the server is authoritative.
   */
  force?: boolean;
  /**
   * Answers "does this refresh still speak for the request that asked for it?".
   * False once a newer request owns the signals, and the answer is then dropped
   * rather than written.
   */
  isRelevant?: () => boolean;
  /**
   * What a failed read does. `publish` puts it on `error$` (the default, for a
   * refresh the user implicitly asked for); `throw` rejects so an awaiting
   * caller can surface it without disturbing an error already on screen;
   * `ignore` does neither, for a refresh that is only a diagnostic.
   */
  onFailure?: 'publish' | 'throw' | 'ignore';
}

export interface StreamManagerBridge {
  submit:                (values: unknown, opts?: LangGraphSubmitOptions) => Promise<CompleteOutcome>;
  stop:                  () => Promise<void>;
  switchThread:          (id: string | null) => void;
  joinStream:            (runId: string, lastEventId?: string) => Promise<void>;
  resubmitLast:          () => Promise<ResubmitOutcome>;
  getReasoningDurationMs:(id: string) => number | undefined;
  getMessageDelivery:    (id: string) => MessageDelivery;
  getSubagentMessageDelivery: (toolCallId: string, message: BaseMessage) => MessageDelivery;
  deliveryRevision:      Signal<number>;
  /** Update server-side thread state (e.g. RemoveMessage for regenerate rollback). */
  updateState:           (values: Record<string, unknown>, opts?: { asNode?: string }) => Promise<void>;
  /**
   * Read-only reconciliation of an uncertain outcome, offered only when the
   * transport can answer — `transport.getHistory` is the check, so without one
   * the member is absent and `interrupted` errors report `recovery: 'none'`.
   */
  checkStatus?: () => Promise<void>;
  /** The current thread ID tracked by the bridge (null if not yet known). */
  readonly currentThreadId: string | null;
}

export function createStreamManagerBridge<T, ResolvedBag extends BagTemplate = BagTemplate>(
  { options, subjects, threadId$, destroy$, reportOperationFailure }: StreamManagerBridgeOptions<T, ResolvedBag>
): StreamManagerBridge {
  const developmentRuntime = createDevelopmentRuntime({
    integration: 'langgraph', packageName: '@threadplane/langgraph', packageVersion,
    installationToken: (typeof ngDevMode === 'undefined' || ngDevMode) && isDevMode() ? installationToken : null,
    enabled: () => options.telemetry === undefined,
  });
  // Intercept onThreadId so currentThreadId tracks a thread the DEFAULT
  // transport auto-creates. Without this, each submit() would create a new
  // thread because currentThreadId stays null. This wrapper only reaches the
  // transport the bridge constructs below — a consumer-supplied transport owns
  // its own creation callback, so it must report created ids through the
  // configured `onThreadId` or the thread-id signal (see AgentConfig.transport).
  // Either route is handled: the thread-id subscription treats a null
  // currentThreadId as adoption rather than a switch.
  const userOnThreadId = options.onThreadId;
  const wrappedOnThreadId = (id: string) => {
    currentThreadId = id;
    userOnThreadId?.(id);
  };
  const transport: AgentTransport =
    options.transport ?? new FetchStreamTransport(
      options.apiUrl,
      wrappedOnThreadId,
      options.clientOptions,
      reportOperationFailure,
    );

  // The only read-only status check this adapter has. Fixed for the bridge's
  // lifetime because `transport` is: both the `recovery` a closed stream
  // reports and whether `checkStatus` is exposed at all hang off it, so the
  // control is never offered when nothing could perform the check.
  const canCheckStatus = typeof transport.getHistory === 'function';

  let currentThreadId: string | null = null;
  // A resume command legitimately has a null payload. Absence of a request
  // must be represented separately so retry does not forget the decision.
  let lastRequest: { payload: unknown; options?: LangGraphSubmitOptions } | undefined;
  let disposed = false;
  let abortController: AbortController | null = null;
  let historyAbortController: AbortController | null = null;
  const userAbortedControllers = new WeakSet<AbortController>();
  const toolProgressMap = new Map<string, ToolProgress>();
  // Message ids whose content is known-final (installed by a canonical
  // replacement). Late streamed deltas for these ids are stale stragglers and
  // are ignored — decided by identity, never by comparing text to text.
  const canonicalMessageIds = new Set<string>();
  const queuedRuns: AgentQueueEntry[] = [];
  let queueDrainEpoch = 0;
  let activeQueueDrainEpoch: number | null = null;
  let attemptSequence = 0;
  const messageDeliveries = new Map<string, MessageDelivery>();
  const deliveryRevision = signal(0);
  type DeliveryAttempt = {
    startedAt: number;
    rootTerminalEvidence: boolean;
    resumedInterrupt: boolean;
    externalSignal?: AbortSignal;
    generation: string;
    messageIds: Set<string>;
    finalizedMessageIds: Set<string>;
    baselineMessageIds: Set<string>;
    eligibleBaselineAssistantId?: string;
    currentAssistantMessageId?: string;
    sawAssistantChunk: boolean;
    currentStepHasTerminalEvidence: boolean;
    awaitingFinalSync: boolean;
    terminalOutcome?: CompleteOutcome;
  };
  let activeAttempt: DeliveryAttempt | null = null;
  const subagentManager = new SubagentTracker({
    subagentToolNames: options.subagentToolNames,
    onSubagentChange: publishSubagents,
  });
  const telemetryProperties = { transport: 'langgraph' as const, surface: 'agent' };
  const redactOperationErrors = transport instanceof FetchStreamTransport
    && transport.protectsOperationErrors;

  function toSafeAgentError(error: unknown): AgentError {
    if (redactOperationErrors) return genericSafeAgentError();
    try {
      return toAgentError(error);
    } catch {
      return genericSafeAgentError();
    }
  }
  captureAgentRuntimeTelemetry(
    options.telemetry,
    'tplane:runtime_instance_created',
    telemetryProperties,
  );

  function captureRuntimeRequestTelemetry(requestType: string): void {
    developmentRuntime.touch();
    captureAgentRuntimeTelemetry(options.telemetry, 'tplane:runtime_request_created', {
      ...telemetryProperties,
      requestType,
    });
  }

  /**
   * Tracks reasoning timing per message id. Keys are message ids; values
   * record when reasoning content first arrived and when response text
   * first appeared (or the canonical message arrived). Cleared on
   * resetThreadState() and on bridge teardown.
   */
  const reasoningTimingMap = new Map<string, { startedAt: number; endedAt?: number }>();

  function notifyDeliveryChange(): void {
    deliveryRevision.update(revision => revision + 1);
  }

  function beginAttempt(allowBaselineTail = false): DeliveryAttempt {
    if (activeAttempt?.awaitingFinalSync) {
      historyAbortController?.abort();
    }
    if (activeAttempt && !activeAttempt.terminalOutcome) {
      finalizeAttempt(activeAttempt, 'interrupted');
    }
    const baselineMessageIds = new Set<string>();
    for (const message of subjects.messages$.value) {
      const id = (message as unknown as Record<string, unknown>)['id'];
      if (typeof id === 'string') baselineMessageIds.add(id);
    }
    attemptSequence += 1;
    const attempt: DeliveryAttempt = {
      startedAt: Date.now(),
      rootTerminalEvidence: false,
      resumedInterrupt: false,
      generation: `attempt-${attemptSequence}-${Math.random().toString(36).slice(2, 10)}`,
      messageIds: new Set(),
      finalizedMessageIds: new Set(),
      baselineMessageIds,
      eligibleBaselineAssistantId: allowBaselineTail
        ? getTailAssistantMessageId(subjects.messages$.value)
        : undefined,
      sawAssistantChunk: false,
      currentStepHasTerminalEvidence: false,
      awaitingFinalSync: false,
    };
    activeAttempt = attempt;
    return attempt;
  }

  function isCurrentExecution(controller: AbortController, attempt: DeliveryAttempt): boolean {
    return abortController === controller && activeAttempt === attempt;
  }

  function setDelivery(id: string, delivery: MessageDelivery): void {
    const previous = messageDeliveries.get(id);
    if (
      previous?.generation === delivery.generation
      && previous.phase === delivery.phase
      && (previous.phase !== 'complete' || delivery.phase !== 'complete' || previous.outcome === delivery.outcome)
    ) {
      return;
    }
    messageDeliveries.set(id, delivery);
    notifyDeliveryChange();
  }

  function finalizeMessage(attempt: DeliveryAttempt, id: string, outcome: CompleteOutcome): void {
    setDelivery(id, completeDelivery(attempt.generation, outcome));
    attempt.finalizedMessageIds.add(id);
  }

  function finalizeAttempt(attempt: DeliveryAttempt, outcome: CompleteOutcome): void {
    if (attempt.terminalOutcome) return;
    attempt.terminalOutcome = outcome;
    for (const id of attempt.messageIds) {
      if (attempt.finalizedMessageIds.has(id)) continue;
      finalizeMessage(attempt, id, outcome);
    }
    // Subgraph children have no tool result to settle them; the run's own
    // terminal outcome is their completion signal. Paused/interrupted runs
    // are excluded — a child can resume with the thread.
    if (outcome === 'success' || outcome === 'error' || outcome === 'aborted') {
      subagentManager.settleRunningSubgraphs(outcome === 'success' ? 'complete' : 'error');
      publishSubagents();
    }
  }

  /**
   * The outcome for a stream that ended. A recorded terminal outcome always
   * wins. Otherwise either flag proves the turn completed, and they divide as:
   *
   * - `currentStepHasTerminalEvidence`: a root terminal marker arrived after
   *   this step had already produced a chunk. The marker need carry no
   *   payload — having spoken, the step is settled by the marker alone.
   * - `rootTerminalEvidence`: a payload-bearing root terminal event that no
   *   later chunk has invalidated. This is what a state-only turn produces —
   *   one that does its work in graph state and never speaks.
   *
   * A close with neither is an interruption.
   */
  function finishOutcome(attempt: DeliveryAttempt): CompleteOutcome {
    return attempt.terminalOutcome
      ?? (attempt.currentStepHasTerminalEvidence || attempt.rootTerminalEvidence ? 'success' : 'interrupted');
  }

  async function finalizeClosedAttempt(
    controller: AbortController,
    attempt: DeliveryAttempt,
  ): Promise<CompleteOutcome | null> {
    if (attempt.terminalOutcome) return attempt.terminalOutcome;

    const evidenceOutcome = finishOutcome(attempt);
    // The comparison that lets the refresh rescue an interruption: a run whose
    // stream died can still have committed its turn server-side, and the only
    // way to see that is that the refresh brought back more messages than were
    // here before it.
    const messageCountBeforeRefresh = subjects.messages$.value.length;
    attempt.awaitingFinalSync = true;
    let refreshed: ThreadState<T>[] | undefined;
    try {
      refreshed = await refreshHistory({
        force: true,
        isRelevant: () => isCurrentExecution(controller, attempt) && !attempt.terminalOutcome,
        // On an already-interrupted close the refresh is a diagnostic read, not
        // the operation the user asked for, so its own failure must not be
        // reported as the cause — the interruption is the story, and the
        // `interrupted` error published below says so with an honest recovery.
        // Any other close keeps the default, so a real sync failure still shows.
        onFailure: evidenceOutcome === 'interrupted' ? 'ignore' : 'publish',
      });
    } finally {
      attempt.awaitingFinalSync = false;
    }

    if (!isCurrentExecution(controller, attempt)) return null;

    // The two ways a refresh rescues an interruption. Read as one decision:
    // either the run is not over (it paused), or it finished without us.
    let outcome = evidenceOutcome;
    if (evidenceOutcome === 'interrupted' && refreshed) {
      // Paused, not dead. `refreshHistory` has already hydrated the interrupt
      // onto interrupt$ — the same mechanism a thread reloaded mid-pause uses —
      // so settling it like any other paused run is all that is left to do.
      const paused = collectHistoryInterrupts(refreshed).length > 0;
      // Committed server-side after the stream died. More messages than were
      // here before the refresh is the only available evidence of that, and it
      // is sound in both directions: an optimistically injected user message is
      // already counted BEFORE the refresh, so it cannot move the comparison,
      // and only a server-side addition can.
      const committed = subjects.messages$.value.length > messageCountBeforeRefresh;
      if (paused || committed) outcome = 'success';
    }

    if (!attempt.terminalOutcome) finalizeAttempt(attempt, outcome);
    // From here the attempt's OWN settled outcome wins over the local evidence.
    // A stop() landing while the refresh was in flight has already settled this
    // attempt as `aborted` and put the status back to Idle — it aborts
    // `historyAbortController` for exactly this window — and `outcome` is then
    // stale evidence from before the user made that decision. Publishing from it
    // would tell someone who deliberately stopped a run that their connection
    // dropped.
    //
    // This one condition is the whole guard, deliberately: every route that
    // aborts `controller` either settles the attempt first (stop() as
    // `aborted`; a newer submit, a thread switch or dispose as `interrupted`)
    // or detaches it, and a detached attempt has already returned null above.
    // So there is no abort this does not already cover, and a second
    // `!controller.signal.aborted` clause would be an untestable duplicate.
    const settledOutcome = attempt.terminalOutcome ?? outcome;
    if (settledOutcome === 'interrupted') publishInterruptionError();
    if (attempt.terminalOutcome === 'success' && attempt.rootTerminalEvidence
      && !controller.signal.aborted && !attempt.externalSignal?.aborted
      && !subjects.error$.value && !subjects.interrupt$.value && subjects.interrupts$.value.length === 0) {
      developmentRuntime.milestone('runtime.first_stream_completed', Date.now() - attempt.startedAt);
      if (attempt.resumedInterrupt) developmentRuntime.milestone('interrupt.handled');
    }
    return settledOutcome;
  }

  /**
   * Report an interruption the refresh could not rescue. Silent when an error
   * already describes the close (an explicit `error` event, say — the transport
   * saying what went wrong beats this generic account), and when the thread is
   * paused, where the interrupt panel is the honest surface and an error banner
   * beside it would be a contradiction.
   *
   * This owns only "is this error honest given what is on screen". Whether the
   * attempt asking is still the one entitled to speak — it settled as something
   * else, or was aborted — belongs to the caller, which is the only place those
   * facts are in scope.
   */
  function publishInterruptionError(): void {
    if (subjects.error$.value) return;
    if (subjects.interrupt$.value || subjects.interrupts$.value.length > 0) return;
    subjects.error$.next(interruptionError());
    subjects.status$.next(ResourceStatus.Error);
  }

  /**
   * The one shape every `interrupted` error in this adapter takes. Every route
   * here means the same thing — the request WAS dispatched and the server had
   * begun answering when the stream died — so none of them may be `retryable`.
   * A Retry button on a dispatched request invites the user to re-run work the
   * server may already have committed; `recovery` is what they get instead, and
   * it is honest about whether anything can actually check.
   */
  function interruptionError(cause?: unknown): AgentError {
    const recovery = canCheckStatus ? 'check' : 'none';
    return new AgentError({
      kind: 'interrupted',
      message: AGENT_RECOVERY_MESSAGES[recovery],
      retryable: false,
      recovery,
      detail: AGENT_RECOVERY_DETAILS[recovery],
      ...(cause !== undefined && !redactOperationErrors ? { cause } : {}),
    });
  }

  function trackAssistantMessages(messages: BaseMessage[]): void {
    const attempt = activeAttempt;
    if (!attempt || attempt.terminalOutcome) return;

    const assistantMessages = messages.filter(message => {
      const raw = message as unknown as Record<string, unknown>;
      const type = normalizeMessageType(
        typeof message._getType === 'function' ? message._getType() : raw['type'] as string | undefined,
      );
      const id = typeof raw['id'] === 'string' ? raw['id'] : undefined;
      return type === 'ai' && id && !attempt.finalizedMessageIds.has(id);
    });
    const newAssistantMessages = assistantMessages.filter(message => {
      const id = (message as unknown as Record<string, unknown>)['id'];
      return typeof id === 'string' && !attempt.baselineMessageIds.has(id);
    });
    const currentStepMessages = newAssistantMessages.length > 0
      ? newAssistantMessages
      : assistantMessages.filter(message =>
          (message as unknown as Record<string, unknown>)['id'] === attempt.eligibleBaselineAssistantId
        );

    for (const message of currentStepMessages) {
      const id = (message as unknown as Record<string, unknown>)['id'] as string;

      if (attempt.currentAssistantMessageId && attempt.currentAssistantMessageId !== id) {
        finalizeMessage(attempt, attempt.currentAssistantMessageId, 'success');
        attempt.currentStepHasTerminalEvidence = false;
      }
      attempt.currentAssistantMessageId = id;
      attempt.messageIds.add(id);
      attempt.sawAssistantChunk = true;
      attempt.rootTerminalEvidence = false;
      setDelivery(id, streamingDelivery(attempt.generation));
    }
  }

  function invalidateQueueDrain(): void {
    queueDrainEpoch += 1;
    activeQueueDrainEpoch = null;
  }

  function markNormalTerminal(event: StreamEvent): void {
    const attempt = activeAttempt;
    if (
      !attempt
      || attempt.terminalOutcome
      || (getEventNamespace(event)?.length ?? 0) > 0
    ) return;
    const baseType = getBaseEventType(event.type);
    // These are the canonical state/snapshot signals available in the current
    // transport contract. Iterator close alone is deliberately not terminal
    // evidence: after assistant chunks, a close without one of these markers
    // is classified as interrupted.
    if (baseType === 'values' || baseType === 'messages/complete' || baseType === 'checkpoints') {
      if (hasDevelopmentEventPayload(event)) attempt.rootTerminalEvidence = true;
      if (attempt.sawAssistantChunk) attempt.currentStepHasTerminalEvidence = true;
    }
  }

  function resetThreadState(): void {
    historyAbortController?.abort();
    subjects.values$.next({} as T);
    subjects.messages$.next([]);
    subjects.history$.next([]);
    subjects.interrupt$.next(undefined);
    subjects.interrupts$.next([]);
    subjects.toolProgress$.next([]);
    subjects.toolCalls$.next([]);
    subjects.messageMetadata$.next(new Map());
    subjects.subagents$.next(new Map());
    void cancelQueueEntries(takeQueuedRuns()).catch(err => subjects.error$.next(toSafeAgentError(err)));
    publishQueue();
    subjects.custom$.next([]);
    subjects.isThreadLoading$.next(false);
    toolProgressMap.clear();
    subagentManager.clear();
    reasoningTimingMap.clear();
    canonicalMessageIds.clear();
    if (activeAttempt && !activeAttempt.terminalOutcome) {
      finalizeAttempt(activeAttempt, 'interrupted');
    }
    messageDeliveries.clear();
    activeAttempt = null;
    notifyDeliveryChange();
  }

  function setThreadId(id: string | null, resetState: boolean): void {
    if (resetState) {
      invalidateQueueDrain();
      abortController?.abort();
      lastRequest = undefined;
    }
    currentThreadId = id;
    if (resetState) {
      resetThreadState();
    }
    void refreshHistory();
  }

  // Track threadId changes.
  //
  // A null currentThreadId means the bridge is not on a thread yet, so an
  // incoming id is an ADOPTION — typically the thread a transport just created
  // for the run that is streaming right now. Resetting there would abort the
  // bridge's own in-flight run. Only a KNOWN id changing to a different id (or
  // to null) is a genuine switch, and only that resets.
  threadId$.pipe(takeUntil(destroy$)).subscribe(id => {
    const shouldReset = currentThreadId !== null && currentThreadId !== id;
    setThreadId(id, shouldReset);
  });

  destroy$.subscribe(() => {
    disposed = true;
    lastRequest = undefined;
    developmentRuntime.dispose();
    invalidateQueueDrain();
    abortController?.abort();
    historyAbortController?.abort();
    reasoningTimingMap.clear();
    if (activeAttempt && !activeAttempt.terminalOutcome) {
      finalizeAttempt(activeAttempt, 'interrupted');
    }
    messageDeliveries.clear();
    activeAttempt = null;
    notifyDeliveryChange();
  });

  /**
   * Re-read the thread from the server and project it.
   *
   * Returns the history it actually applied, so a caller can settle on what the
   * refresh produced rather than re-reading subjects that a stale or failed
   * refresh would have left untouched. Returns `undefined` whenever nothing was
   * applied: no transport, no thread, a stale answer, or a failed read.
   *
   * Ignoring the return value is correct and expected. Only a caller that has
   * to DECIDE something from the refresh needs it; a caller that just wants the
   * projection to happen — thread adoption, a thread switch — should discard it,
   * and the several sites that do so are not overlooking a failure.
   */
  async function refreshHistory(
    { force = false, isRelevant = () => true, onFailure = 'publish' }: HistoryRefreshOptions = {},
  ): Promise<ThreadState<T>[] | undefined> {
    const getHistory = transport.getHistory?.bind(transport);
    if (!currentThreadId || !getHistory) return undefined;
    developmentRuntime.touch();

    historyAbortController?.abort();
    const controller = new AbortController();
    historyAbortController = controller;
    const threadId = currentThreadId;
    subjects.isThreadLoading$.next(true);

    let applied: ThreadState<T>[] | undefined;
    let failure: AgentError | undefined;
    try {
      const history = await waitForHistory(getHistory(threadId, controller.signal), controller.signal);
      if (!controller.signal.aborted && currentThreadId === threadId && isRelevant()) {
        applied = history as ThreadState<T>[];
        subjects.history$.next(history as ThreadState<T>[]);

        // Project the latest checkpoint into messages$ + values$:
        //  - On first connect (`force=false`): only when messages$ is
        //    empty, so optimistic local state isn't clobbered.
        //  - At run completion (`force=true`): always — server state is
        //    authoritative for node-level mutations (e.g. RemoveMessage
        //    or id-match content replacement performed by post-process
        //    nodes), and the streaming SDK doesn't always restream those.
        const latest = history[0] as
          | { values?: { messages?: BaseMessage[] } & T }
          | undefined;
        const shouldProject = latest?.values
          && (force || subjects.messages$.value.length === 0);
        if (shouldProject) {
          const restoredMessages = latest.values?.messages ?? [];
          const restoredValues = { ...(latest.values as T) };
          // Strip the `messages` field from values — messages$ is the
          // canonical surface for them; keeping a duplicate in values$
          // would confuse downstream consumers reading both subjects.
          delete (restoredValues as { messages?: unknown }).messages;
          subjects.messages$.next(preserveIds(subjects.messages$.value, restoredMessages));
          subjects.values$.next(restoredValues);
          if (!force && !activeAttempt && (restoredMessages.length > 0 || Object.keys(restoredValues as object).length > 0)) {
            developmentRuntime.milestone('thread.persisted');
          }
          // Rebuild derived subjects from the new authoritative messages$.
          // Tool-call results displayed by chat-tool-calls come from
          // toolCalls$, which is built from messages$; without this, the
          // panel keeps showing the streamed pre-mutation content.
          syncToolCallsFromMessages();
        }

        // Hydrate pending interrupts from the latest checkpoint. When a
        // thread is reloaded mid-pause (paused at an interrupt), the
        // streaming events won't replay — interrupts live on the
        // checkpoint's tasks[i].interrupts and must be projected manually
        // so the interrupt panel re-renders on page reload.
        hydrateInterruptsFromHistory(history as ThreadState<T>[], subjects);
      }
    } catch (err) {
      if (onFailure !== 'ignore' && !controller.signal.aborted && isRelevant() && !safeIsAbortError(err)) {
        if (onFailure === 'throw') failure = toSafeAgentError(err);
        else subjects.error$.next(toSafeAgentError(err));
      }
    } finally {
      if (historyAbortController === controller) {
        historyAbortController = null;
        subjects.isThreadLoading$.next(false);
      }
    }
    if (failure) throw failure;
    return applied;
  }

  function waitForHistory<R>(history: Promise<R>, signal: AbortSignal): Promise<R> {
    if (signal.aborted) return Promise.reject(createHistoryAbortError());

    return new Promise<R>((resolve, reject) => {
      const onAbort = () => {
        cleanup();
        reject(createHistoryAbortError());
      };
      const cleanup = () => signal.removeEventListener('abort', onAbort);
      signal.addEventListener('abort', onAbort, { once: true });
      history.then(
        value => {
          cleanup();
          resolve(value);
        },
        error => {
          cleanup();
          reject(error);
        },
      );
    });
  }

  function createHistoryAbortError(): Error {
    const error = new Error('History refresh aborted.');
    error.name = 'AbortError';
    return error;
  }

  function publishQueue(): void {
    subjects.queue$.next(createQueueSnapshot());
  }

  function createQueueSnapshot(): AgentQueue {
    return {
      entries: [...queuedRuns],
      size: queuedRuns.length,
      cancel: cancelQueuedRun,
      clear: clearQueue,
    };
  }

  async function enqueueRun(payload: unknown, opts?: LangGraphSubmitOptions): Promise<void> {
    if (!currentThreadId) {
      throw new Error('Cannot enqueue a run before a LangGraph thread exists.');
    }
    if (!transport.createQueuedRun) {
      throw new Error('The configured LangGraph transport does not support server-side queueing.');
    }

    captureRuntimeRequestTelemetry('enqueue');
    const controller = new AbortController();
    const entry = await transport.createQueuedRun(
      options.assistantId,
      currentThreadId,
      payload,
      opts?.signal ?? controller.signal,
      opts,
    );
    queuedRuns.push({
      ...entry,
      values: payload,
      options: { ...opts, multitaskStrategy: 'enqueue' },
      createdAt: entry.createdAt ?? new Date(),
    });
    publishQueue();
  }

  async function cancelQueuedRun(id: string): Promise<boolean> {
    const index = queuedRuns.findIndex(entry => entry.id === id);
    if (index === -1) return false;

    const [entry] = queuedRuns.splice(index, 1);
    publishQueue();
    if (!entry || !transport.cancelRun) return false;
    await cancelQueueEntries([entry]);
    return true;
  }

  async function clearQueue(): Promise<void> {
    const entries = takeQueuedRuns();
    publishQueue();
    await cancelQueueEntries(entries);
  }

  function takeQueuedRuns(): AgentQueueEntry[] {
    return queuedRuns.splice(0, queuedRuns.length);
  }

  async function cancelQueueEntries(entries: AgentQueueEntry[]): Promise<void> {
    const cancelRun = transport.cancelRun?.bind(transport);
    if (!cancelRun) return;
    await Promise.all(entries.map(entry =>
      cancelRun(entry.threadId, entry.id, new AbortController().signal)
    ));
  }

  async function drainQueue(): Promise<void> {
    if (activeQueueDrainEpoch !== null || queuedRuns.length === 0) return;
    queueDrainEpoch += 1;
    const drainEpoch = queueDrainEpoch;
    activeQueueDrainEpoch = drainEpoch;
    try {
      while (queuedRuns.length > 0) {
        if (activeQueueDrainEpoch !== drainEpoch) return;
        const entry = queuedRuns.shift();
        publishQueue();
        if (!entry || !transport.joinStream) continue;
        await joinQueuedRun(entry, drainEpoch);
      }
    } finally {
      if (activeQueueDrainEpoch === drainEpoch) activeQueueDrainEpoch = null;
    }
  }

  async function joinQueuedRun(entry: AgentQueueEntry, drainEpoch: number): Promise<void> {
    if (activeQueueDrainEpoch !== drainEpoch) return;
    const controller = new AbortController();
    abortController = controller;
    const attempt = beginAttempt(true);
    const startedAt = Date.now();
    captureRuntimeRequestTelemetry('join_queued');
    captureAgentRuntimeTelemetry(options.telemetry, 'tplane:stream_started', telemetryProperties);
    subjects.custom$.next([]);
    subjects.toolProgress$.next([]);
    toolProgressMap.clear();
    subjects.status$.next(ResourceStatus.Loading);

    try {
      const iter = transport.joinStream
        ? transport.joinStream(entry.threadId, entry.id, undefined, controller.signal)
        : [];
      for await (const event of iter) {
        if (controller.signal.aborted || !isCurrentExecution(controller, attempt)) break;
        processEvent(event);
      }
      if (!isCurrentExecution(controller, attempt)) return;
      const outcome = await finalizeClosedAttempt(controller, attempt);
      if (outcome === null) return;
      if (!controller.signal.aborted) {
        // An interruption has already published its own error and status;
        // resolving here would tell the user nothing went wrong.
        if (outcome !== 'error' && outcome !== 'interrupted') {
          subjects.status$.next(ResourceStatus.Resolved);
        }
        captureAgentRuntimeTelemetry(options.telemetry, 'tplane:stream_ended', {
          ...telemetryProperties,
          durationMs: Date.now() - startedAt,
        });
      }
    } catch (err) {
      if (!isCurrentExecution(controller, attempt)) return;
      if (attempt.terminalOutcome) return;
      if (safeIsAbortError(err) && userAbortedControllers.has(controller)) {
        finalizeAttempt(attempt, 'aborted');
        subjects.error$.next(undefined);
        subjects.status$.next(ResourceStatus.Idle);
      } else {
        finalizeAttempt(attempt, attempt.sawAssistantChunk ? 'interrupted' : 'error');
        subjects.error$.next(toSafeAgentError(err));
        subjects.status$.next(ResourceStatus.Error);
        captureAgentRuntimeTelemetry(options.telemetry, 'tplane:stream_errored', {
          ...telemetryProperties,
          durationMs: Date.now() - startedAt,
          errorClass: agentRuntimeTelemetryErrorClass(err),
        });
      }
    } finally {
      if (abortController === controller) abortController = null;
    }
  }

  async function runStream(
    payload: unknown,
    opts?: LangGraphSubmitOptions,
    requestType = 'submit',
  ): Promise<CompleteOutcome> {
    if (disposed) return 'aborted';
    invalidateQueueDrain();
    abortController?.abort();
    const controller = new AbortController();
    abortController = controller;
    const attempt = beginAttempt(
      requestType === 'resubmit' || (isRecord(opts?.command) && 'resume' in opts.command),
    );
    attempt.externalSignal = opts?.signal;
    attempt.resumedInterrupt = isRecord(opts?.command) && 'resume' in opts.command
      && (!!subjects.interrupt$.value || subjects.interrupts$.value.length > 0);
    const startedAt = Date.now();
    captureRuntimeRequestTelemetry(requestType);
    captureAgentRuntimeTelemetry(options.telemetry, 'tplane:stream_started', telemetryProperties);

    subjects.status$.next(ResourceStatus.Loading);
    subjects.error$.next(undefined);
    subjects.custom$.next([]);
    subjects.toolProgress$.next([]);
    toolProgressMap.clear();
    canonicalMessageIds.clear();
    const hasResume = isRecord(opts?.command) && 'resume' in opts.command;
    const { signal: _previousSignal, ...retryOptions } = opts ?? {};
    lastRequest = payload != null || hasResume
      ? {
          payload: hasResume ? structuredClone(payload ?? null) : payload,
          options: hasResume
            ? { ...retryOptions, command: structuredClone(opts!.command) }
            : retryOptions,
        }
      : undefined;

    // Tracks whether at least one stream event has been processed this run.
    // Used to distinguish a mid-stream network interruption (kind:'interrupted')
    // from a fresh connect failure (falls through to toAgentError classification).
    let streamingStarted = false;

    // Optimistically inject human messages so they appear immediately
    // without waiting for the server to echo them back. Assign a stable id
    // when missing — track-by-id in the chat-message-list relies on stable
    // ids across re-emissions, otherwise the optimistic message gets torn
    // down + recreated on every messages$.next() during streaming, which
    // restarts caret/typing animations and causes visible flicker.
    const inputMessages = (payload as Record<string, unknown>)?.['messages'];
    if (Array.isArray(inputMessages) && inputMessages.length > 0) {
      const stamped = (inputMessages as BaseMessage[]).map((m) => {
        const raw = m as unknown as Record<string, unknown>;
        if (typeof raw['id'] === 'string' && raw['id']) return m;
        const id = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        return { ...m, id } as BaseMessage;
      });
      const existing = subjects.messages$.value;
      subjects.messages$.next([...existing, ...stamped]);
    }

    try {
      const iter = transport.stream(
        options.assistantId,
        currentThreadId,
        payload,
        opts?.signal ?? controller.signal,
        opts,
      );

      for await (const event of iter) {
        if (controller.signal.aborted || !isCurrentExecution(controller, attempt)) break;
        streamingStarted = true;
        processEvent(event);
      }

      if (!isCurrentExecution(controller, attempt)) return finishOutcome(attempt);
      const outcome = await finalizeClosedAttempt(controller, attempt);
      if (outcome === null) return finishOutcome(attempt);

      if (!controller.signal.aborted) {
        // An interruption has already published its own error and status;
        // resolving here would tell the user nothing went wrong.
        if (outcome !== 'error' && outcome !== 'interrupted') {
          subjects.status$.next(ResourceStatus.Resolved);
        }
        await drainQueue();
        captureAgentRuntimeTelemetry(options.telemetry, 'tplane:stream_ended', {
          ...telemetryProperties,
          durationMs: Date.now() - startedAt,
        });
      }
      return outcome;
    } catch (err) {
      if (!isCurrentExecution(controller, attempt)) return finishOutcome(attempt);
      if (attempt.terminalOutcome) return attempt.terminalOutcome;
      if (safeIsAbortError(err) && userAbortedControllers.has(controller)) {
        finalizeAttempt(attempt, 'aborted');
        // User explicitly called stop() — treat as graceful idle, not an error.
        subjects.error$.next(undefined);
        subjects.status$.next(ResourceStatus.Idle);
      } else if (safeIsAbortError(err)) {
        finalizeAttempt(attempt, attempt.sawAssistantChunk ? 'interrupted' : 'error');
        // A non-user-requested abort: interrupted if a stream had started, else a
        // connect-phase failure. Never "aborted" (that's reserved for user stop).
        //
        // The two halves differ on exactly one question — was the request
        // dispatched? `streamingStarted` means the server had begun answering,
        // so that half gets the same non-retryable, recovery-carrying error a
        // closed stream gets. The connection half genuinely reached nobody, so
        // re-sending it cannot duplicate anything and stays retryable.
        const e = streamingStarted
          ? interruptionError(err)
          : new AgentError({
              kind: 'connection',
              message: AGENT_ERROR_MESSAGES.connection,
              retryable: true,
              ...(!redactOperationErrors ? { cause: err } : {}),
            });
        subjects.error$.next(e);
        subjects.status$.next(ResourceStatus.Error);
        captureAgentRuntimeTelemetry(options.telemetry, 'tplane:stream_errored', {
          ...telemetryProperties,
          durationMs: Date.now() - startedAt,
          errorClass: agentRuntimeTelemetryErrorClass(err),
        });
      } else {
        finalizeAttempt(attempt, attempt.sawAssistantChunk ? 'interrupted' : 'error');
        subjects.error$.next(toSafeAgentError(err));
        subjects.status$.next(ResourceStatus.Error);
        captureAgentRuntimeTelemetry(options.telemetry, 'tplane:stream_errored', {
          ...telemetryProperties,
          durationMs: Date.now() - startedAt,
          errorClass: agentRuntimeTelemetryErrorClass(err),
        });
      }
      return finishOutcome(attempt);
    } finally {
      if (abortController === controller) abortController = null;
    }
  }

  function processEvent(event: StreamEvent): void {
    const baseType = getBaseEventType(event.type);
    const namespace = getEventNamespace(event);
    if (hasDevelopmentEventPayload(event)) {
      developmentRuntime.milestone('transport.connected');
    }

    if (baseType === 'checkpoints' || baseType === 'messages/complete') {
      markNormalTerminal(event);
    }

    if (isMessagesEvent(event.type)) {
      const msgs = normalizeMessages(event);
      if (!msgs) return;

      const normalized = options.toMessage
        ? msgs.map(options.toMessage)
        : msgs as BaseMessage[];

      // Any namespaced message event is child content. It feeds the child's
      // stream and never merges into the parent transcript — the parent
      // transcript is what the parent graph says. Shared-state children still
      // surface at settle through the authoritative top-level `values` sync.
      if (isChildNamespace(namespace)) {
        const child = namespace ? childStreamRefFromNamespace(namespace) : undefined;
        if (child) {
          if (child.kind === 'subgraph') {
            subagentManager.ensureSubgraphStream(child.key, child.name);
          } else {
            // Claim the stream for its tool call before its tokens arrive.
            subagentManager.ensureToolStreamAttribution(child.key);
          }
          for (const msg of normalized) {
            subagentManager.addMessageToSubagent(child.key, msg);
          }
          publishSubagents();
        }
        storeMessageMetadata(normalized, event);
        return;
      }

      // Partial and message-tuple events are incremental. Merge them by id
      // so optimistic human messages and earlier tool messages are preserved.
      if (event.type === 'messages/partial' || event.messageMetadata) {
        if (!isTranscriptMessageEvent(event, options.transcriptNodeNames)) {
          storeMessageMetadata(normalized, event);
          syncSubagentsFromMessages(normalized);
          return;
        }
        const mode: MergeMode = event.messageMetadata ? 'delta' : 'snapshot';
        const affectedMessageIds = new Set<string>();
        const merged = mergeMessages(
          subjects.messages$.value,
          normalized,
          reasoningTimingMap,
          mode,
          canonicalMessageIds,
          affectedMessageIds,
          activeAttempt?.currentAssistantMessageId !== undefined
            && activeAttempt.currentStepHasTerminalEvidence !== true,
        );
        subjects.messages$.next(merged);
        {
          trackAssistantMessages(merged.filter(message => {
            const id = (message as unknown as Record<string, unknown>)['id'];
            return typeof id === 'string' && affectedMessageIds.has(id);
          }));
        }
        if (isLgTraceEnabled()) {
          const msgs = subjects.messages$.value;
          const last = msgs[msgs.length - 1];
          lgTrace('bridge.messages-tuple', { id: (last as unknown as Record<string, unknown> | undefined)?.['id'], count: msgs.length });
        }
      } else if (normalized.length === 0) {
        // Defensive: skip empty replacements during streaming. An empty
        // batch shouldn't tear down the entire UI (causes message DOM
        // teardown + streaming renderer reset = visible jank).
      } else {
        // Preserve existing ids by content so the final-id swap doesn't
        // tear down the chat-message DOM (and its streaming-md renderer).
        const affectedMessageIds = new Set<string>();
        const preserved = preserveIds(subjects.messages$.value, normalized, affectedMessageIds);
        subjects.messages$.next(preserved);
        {
          trackAssistantMessages(preserved.filter(message => {
            const id = (message as unknown as Record<string, unknown>)['id'];
            return typeof id === 'string' && affectedMessageIds.has(id);
          }));
        }
      }
      markNormalTerminal(event);
      storeMessageMetadata(normalized, event);
      syncSubagentsFromMessages(normalized);
      syncToolCallsFromMessages();
      return;
    }

    // normalizeSdkEvent spreads event data directly into the event object,
    // so the values/updates payload is at event['data'] (the original data object),
    // NOT at event['values'] or event['updates'].
    switch (baseType) {
      case 'values': {
        const vals = extractEventData(event);
        if (isChildNamespace(namespace)) {
          // A child's state must not clobber the parent's `values$` — route it
          // to the child stream and stop.
          if (isRecord(vals)) updateSubagentValues(namespace, vals);
          break;
        }
        if ((namespace?.length ?? 0) === 0) {
          if (hasInterrupts(vals)) {
            if (activeAttempt) finalizeAttempt(activeAttempt, 'paused');
          } else {
            markNormalTerminal(event);
          }
        }
        if (vals != null) {
          extractInterrupts(vals, subjects);
          subjects.values$.next(vals as T);
          // Also sync messages$ from the values state so the full message
          // history (including human messages) is available to consumers.
          const stateMessages = (vals as Record<string, unknown>)['messages'];
          if (Array.isArray(stateMessages) && stateMessages.length > 0) {
            // Defensive: only sync when state carries messages. An empty
            // values payload shouldn't wipe the UI mid-stream.
            const projected = options.toMessage
              ? stateMessages.map(options.toMessage)
              : (stateMessages as BaseMessage[]);
            // Drop empty-content AI placeholders before merging. LangGraph
            // emits intermediate `values` events whose `state.messages`
            // includes an unfilled assistant turn at the tail. Keeping it
            // would create a phantom slot that competes with the chunk-
            // streamed AIMessageChunk arriving via messages-tuple — they'd
            // never merge (different ids; non-overlapping content fragments)
            // and the user sees two assistant bubbles.
            const filtered = projected.filter((m, i) => {
              if (i !== projected.length - 1) return true;
              const t = normalizeMessageType(
                typeof m._getType === 'function' ? m._getType() : (m as unknown as Record<string, unknown>)['type'] as string | undefined,
              );
              if (t !== 'ai') return true;
              const text = extractText(m.content);
              return text.length > 0;
            });
            // Preserve existing ids by content match (server echo / final-id swap).
            const remapped = preserveIds(subjects.messages$.value, filtered);
            // ALWAYS merge values-derived messages into existing rather
            // than replacing. LangGraph emits intermediate values events
            // during streaming where state.messages can lag behind what
            // we've already seen via messages-tuple — replacing would
            // drop the partial AI (or even the optimistic human) and
            // tear down their DOM mid-stream. Merge by id keeps both,
            // updates content where ids match, preserves the rest.
            subjects.messages$.next(mergeMessages(subjects.messages$.value, remapped, reasoningTimingMap, 'snapshot', canonicalMessageIds));
            if (isLgTraceEnabled()) {
              lgTrace('bridge.values-sync', {
                incomingLength: stateMessages.length,
                mergedLength: subjects.messages$.value.length,
              });
            }
            syncSubagentsFromMessages(stateMessages as BaseMessage[]);
            subagentManager.reconstructFromMessages(
              stateMessages as BaseMessage[],
              { skipIfPopulated: true },
            );
            publishSubagents();
            syncToolCallsFromMessages();
          }
        }
        break;
      }
      case 'updates': {
        const upd = extractEventData(event);
        if (isChildNamespace(namespace)) {
          // A child's updates must not spread-merge into the parent's
          // `values$` — they only mark the child stream running.
          markSubagentRunning(namespace);
          break;
        }
        if (upd != null) {
          extractInterrupts(upd, subjects);
          subjects.values$.next({
            ...subjects.values$.value,
            ...(upd as object),
          } as T);
        }
        break;
      }
      case 'error':
        if (activeAttempt) finalizeAttempt(activeAttempt, 'error');
        subjects.error$.next(toSafeAgentError(safeReadEventError(event)));
        subjects.status$.next(ResourceStatus.Error);
        break;
      case 'interrupt':
        if (activeAttempt) finalizeAttempt(activeAttempt, 'paused');
        subjects.interrupt$.next(event['interrupt'] as Interrupt);
        break;
      case 'interrupts':
        if (activeAttempt) finalizeAttempt(activeAttempt, 'paused');
        subjects.interrupts$.next(event['interrupts'] as Interrupt[]);
        break;
      case 'custom': {
        const eventData = event['data'] as Record<string, unknown> | undefined;
        // Server-announced subagent identity (threadplane-middleware's
        // `announce_subagent`). Consumed here rather than forwarded: it is
        // protocol chatter, not application data.
        if (
          isRecord(eventData)
          && eventData['type'] === 'threadplane.subagent_binding'
          && typeof eventData['namespace'] === 'string'
          && typeof eventData['tool_call_id'] === 'string'
        ) {
          const bound = childStreamRefFromNamespace([eventData['namespace']]);
          if (bound?.kind === 'tool') {
            subagentManager.bindChildStream(bound.key, eventData['tool_call_id']);
            publishSubagents();
          }
          break;
        }
        const name = (event['name'] ?? eventData?.['name'] ?? '') as string;
        const data = eventData?.['data'] ?? eventData;
        const current = subjects.custom$.value;
        subjects.custom$.next([...current, { name, data }]);
        break;
      }
      case 'tools':
        updateToolProgress(event);
        break;
    }
  }

  function syncToolCallsFromMessages(): void {
    const toolCalls = getToolCallsWithResults(
      subjects.messages$.value as unknown as LangGraphMessage[],
    ) as ToolCallWithResult[];
    subjects.toolCalls$.next(toolCalls);
  }

  function syncSubagentsFromMessages(messages: BaseMessage[]): void {
    for (const message of messages) {
      const raw = message as unknown as Record<string, unknown>;
      if (isAiMessageWithToolCalls(raw)) {
        subagentManager.registerFromToolCalls(
          raw['tool_calls'] as Array<{ id?: string; name: string; args: Record<string, unknown> | string }>,
          typeof raw['id'] === 'string' ? raw['id'] : null,
        );
      }
      if (isToolMessage(raw)) {
        const content = typeof raw['content'] === 'string'
          ? raw['content']
          : JSON.stringify(raw['content']);
        const status = raw['status'] === 'error' ? 'error' : 'success';
        subagentManager.processToolMessage(raw['tool_call_id'], content, status);
      }
    }
    publishSubagents();
  }

  function updateSubagentValues(namespace: string[] | undefined, values: Record<string, unknown>): void {
    const child = namespace ? childStreamRefFromNamespace(namespace) : undefined;
    if (!child) return;

    if (child.kind === 'tool') {
      // Prefer the precise description match when the child's first message is
      // the human task; otherwise claim the stream positionally so a graph that
      // doesn't fit that shape still gets attributed.
      const messages = values['messages'];
      const first = Array.isArray(messages) && messages.length > 0 ? messages[0] : undefined;
      if (isRecord(first) && (first['type'] === 'human' || first['type'] === 'user') && typeof first['content'] === 'string') {
        subagentManager.matchSubgraphToSubagent(child.key, first['content']);
      } else {
        subagentManager.ensureToolStreamAttribution(child.key);
      }
    } else {
      subagentManager.ensureSubgraphStream(child.key, child.name);
    }
    subagentManager.updateSubagentValues(child.key, values);
    publishSubagents();
  }

  function markSubagentRunning(namespace: string[] | undefined): void {
    const child = namespace ? childStreamRefFromNamespace(namespace) : undefined;
    if (!child) return;
    if (child.kind === 'subgraph') {
      subagentManager.ensureSubgraphStream(child.key, child.name);
    }
    subagentManager.markRunningFromNamespace(child.key, namespace);
    publishSubagents();
  }

  function publishSubagents(): void {
    subjects.subagents$.next(toSubagentRefs(subagentManager.getSubagents()));
  }

  function storeMessageMetadata(messages: BaseMessage[], event: StreamEvent): void {
    if (!event.messageMetadata) return;
    const next = new Map(subjects.messageMetadata$.value);
    messages.forEach((message, index) => {
      const id = (message as unknown as Record<string, unknown>)['id'];
      const messageId = String(id ?? index);
      next.set(messageId, {
        messageId,
        firstSeenState: undefined,
        branch: undefined,
        branchOptions: undefined,
        streamMetadata: event.messageMetadata,
      });
    });
    subjects.messageMetadata$.next(next);
  }

  function updateToolProgress(event: StreamEvent): void {
    const data = extractEventData(event);
    if (!isRecord(data)) return;

    const toolEvent = data['event'];
    const name = data['name'];
    if (typeof toolEvent !== 'string' || typeof name !== 'string') return;

    const toolCallId = typeof data['toolCallId'] === 'string' ? data['toolCallId'] : undefined;
    const key = toolCallId ?? name;
    const existing = toolProgressMap.get(key);

    switch (toolEvent) {
      case 'on_tool_start':
        toolProgressMap.set(key, {
          toolCallId,
          name,
          state: 'starting',
          input: data['input'],
        });
        break;
      case 'on_tool_event':
        toolProgressMap.set(key, {
          toolCallId,
          name,
          ...existing,
          state: 'running',
          data: data['data'],
        });
        break;
      case 'on_tool_end':
        toolProgressMap.set(key, {
          toolCallId,
          name,
          ...existing,
          state: 'completed',
          result: data['output'],
        });
        break;
      case 'on_tool_error':
        toolProgressMap.set(key, {
          toolCallId,
          name,
          ...existing,
          state: 'error',
          error: redactOperationErrors ? 'The tool call failed.' : safeReadRecordValue(data, 'error'),
        });
        break;
      default:
        return;
    }

    subjects.toolProgress$.next([...toolProgressMap.values()]);
  }

  return {
    submit: async (payload, opts) => {
      if (opts?.multitaskStrategy === 'enqueue' && subjects.status$.value === ResourceStatus.Loading) {
        await enqueueRun(payload, opts);
        return 'success';
      }
      return runStream(payload, opts);
    },

    stop: async () => {
      invalidateQueueDrain();
      const shouldAbortAttempt = Boolean(
        abortController && activeAttempt && !activeAttempt.terminalOutcome
      );
      if (shouldAbortAttempt && abortController) userAbortedControllers.add(abortController);
      if (shouldAbortAttempt && activeAttempt) finalizeAttempt(activeAttempt, 'aborted');
      abortController?.abort();
      if (activeAttempt?.awaitingFinalSync) historyAbortController?.abort();
      await clearQueue();
      // Set Idle synchronously for an active user cancellation. Attempts that
      // already reached a terminal outcome retain their existing status.
      if (shouldAbortAttempt && subjects.status$.value !== ResourceStatus.Idle) {
        subjects.status$.next(ResourceStatus.Idle);
      }
    },

    switchThread: (id) => {
      setThreadId(id, true);
    },

    joinStream: async (runId, lastEventId) => {
      if (!currentThreadId) return;
      invalidateQueueDrain();
      abortController?.abort();
      const controller = new AbortController();
      abortController = controller;
      const attempt = beginAttempt(true);
      const threadId = currentThreadId;
      const startedAt = Date.now();
      captureRuntimeRequestTelemetry('join');
      captureAgentRuntimeTelemetry(options.telemetry, 'tplane:stream_started', telemetryProperties);
      subjects.custom$.next([]);
      subjects.toolProgress$.next([]);
      toolProgressMap.clear();
      subjects.status$.next(ResourceStatus.Loading);
      subjects.error$.next(undefined);
      try {
        const iter = transport.joinStream
          ? transport.joinStream(threadId, runId, lastEventId, controller.signal)
          : [];
        for await (const event of iter) {
          if (controller.signal.aborted || !isCurrentExecution(controller, attempt)) break;
          processEvent(event);
        }
        if (!isCurrentExecution(controller, attempt)) return;
        const outcome = await finalizeClosedAttempt(controller, attempt);
        if (outcome === null) return;
        if (!controller.signal.aborted) {
          // An interruption has already published its own error and status;
          // resolving here would tell the user nothing went wrong.
          if (outcome !== 'error' && outcome !== 'interrupted') {
            subjects.status$.next(ResourceStatus.Resolved);
          }
          captureAgentRuntimeTelemetry(options.telemetry, 'tplane:stream_ended', {
            ...telemetryProperties,
            durationMs: Date.now() - startedAt,
          });
        }
      } catch (err) {
        if (!isCurrentExecution(controller, attempt)) return;
        if (attempt.terminalOutcome) return;
        if (safeIsAbortError(err) && userAbortedControllers.has(controller)) {
          finalizeAttempt(attempt, 'aborted');
          subjects.error$.next(undefined);
          subjects.status$.next(ResourceStatus.Idle);
        } else {
          finalizeAttempt(attempt, attempt.sawAssistantChunk ? 'interrupted' : 'error');
          subjects.error$.next(toSafeAgentError(err));
          subjects.status$.next(ResourceStatus.Error);
          captureAgentRuntimeTelemetry(options.telemetry, 'tplane:stream_errored', {
            ...telemetryProperties,
            durationMs: Date.now() - startedAt,
            errorClass: agentRuntimeTelemetryErrorClass(err),
          });
        }
      } finally {
        if (abortController === controller) abortController = null;
      }
    },

    resubmitLast: async () => {
      if (!lastRequest || disposed) return 'not-started';
      return runStream(lastRequest.payload, lastRequest.options, 'resubmit');
    },

    // Present only when the transport can answer. `interrupted` errors report
    // `recovery: 'check'` on exactly this condition, so the control and the
    // recovery it is offered for can never disagree.
    ...(canCheckStatus
      ? {
          /**
           * The user-facing control for `error().recovery === 'check'`. Asks the
           * server what happened by re-reading the thread — never resubmits,
           * never appends a message — and settles the error only on a conclusive
           * answer, leaving it in place otherwise so the check can be offered
           * again.
           */
          checkStatus: async (): Promise<void> => {
            if (disposed) throw new Error('Agent has been disposed');
            if (abortController || (activeAttempt && !activeAttempt.terminalOutcome)) {
              throw new Error('Stop the active request before checking status');
            }
            // The only staleness guard available here: unlike a run, a check
            // holds no AbortController a newer request would clear, so the
            // attempt it was asked about is what identifies its answer.
            const attempt = activeAttempt;
            const isSameAttempt = () => activeAttempt === attempt;
            const messageCountBeforeRefresh = subjects.messages$.value.length;
            // `throw`, not `publish`: an unreachable server must not overwrite
            // the `interrupted` error that offered this check, or the user loses
            // both the explanation and the control. Rejecting hands the caller
            // something to say while leaving the offer standing.
            const refreshed = await refreshHistory({
              force: true,
              isRelevant: isSameAttempt,
              onFailure: 'throw',
            });
            // Asked again after the await, which is a different instant from
            // `isRelevant`: a consumer reacting to the projection can start a
            // newer request in between, and clearing a live run's error and
            // forcing its status to Idle is not this check's to do.
            if (!isSameAttempt() || !refreshed) return;
            const finished = collectHistoryInterrupts(refreshed).length > 0
              || subjects.messages$.value.length > messageCountBeforeRefresh;
            if (!finished) return;
            subjects.error$.next(undefined);
            subjects.status$.next(ResourceStatus.Idle);
          },
        }
      : {}),

    getReasoningDurationMs: (id: string): number | undefined => {
      const entry = reasoningTimingMap.get(id);
      if (!entry) return undefined;
      if (entry.endedAt === undefined) return undefined;
      return entry.endedAt - entry.startedAt;
    },

    getMessageDelivery: (id: string): MessageDelivery =>
      messageDeliveries.get(id) ?? staticDelivery(id),

    getSubagentMessageDelivery: (toolCallId: string, message: BaseMessage): MessageDelivery =>
      subagentManager.getMessageDelivery(toolCallId, message),

    deliveryRevision,

    updateState: async (
      values: Record<string, unknown>,
      opts?: { asNode?: string },
    ): Promise<void> => {
      // No-op when there is no thread yet or the transport doesn't support
      // updateState (e.g. MockAgentTransport in unit tests without a threadId).
      if (!currentThreadId || !transport.updateState) {
        return;
      }
      await transport.updateState(
        currentThreadId,
        values,
        new AbortController().signal,
        opts,
      );
    },

    get currentThreadId(): string | null {
      return currentThreadId;
    },
  };
}

function isTranscriptMessageEvent(
  event: StreamEvent,
  transcriptNodeNames: readonly string[] | undefined,
): boolean {
  if (!transcriptNodeNames || transcriptNodeNames.length === 0) return true;
  const node = event.messageMetadata?.['langgraph_node'];
  if (typeof node !== 'string') return true;
  return transcriptNodeNames.includes(node);
}

/**
 * Extracts the payload data from a normalized SDK event.
 *
 * Handles two formats:
 * 1. SDK events (via normalizeSdkEvent): data at event['data'] (record) + spread into event
 * 2. Mock/test events: data at event[event.type] (e.g., event['values'], event['updates'])
 */
/**
 * LangGraph emits interrupts as part of `updates`/`values` events under the
 * special `__interrupt__` key, not as standalone events. When such a payload
 * appears, mirror it onto `interrupt$` (latest) and `interrupts$` (full list)
 * so consumers can react via `agent.interrupt()` / `agent.interrupts()`.
 */
function extractInterrupts<T, B extends BagTemplate>(
  payload: unknown,
  subjects: StreamSubjects<T, B>,
): void {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
  const raw = (payload as Record<string, unknown>)['__interrupt__'];
  // Cast through unknown — Interrupt$ is parameterized over Bag's InterruptType,
  // and the SDK delivers raw Interrupt payloads here.
  if (Array.isArray(raw) && raw.length > 0) {
    const list = raw as Interrupt[];
    subjects.interrupts$.next(list as unknown as Parameters<typeof subjects.interrupts$.next>[0]);
    subjects.interrupt$.next(list[list.length - 1] as unknown as Parameters<typeof subjects.interrupt$.next>[0]);
    return;
  }
  // Payload has no `__interrupt__` key. Clear any stale interrupt so the UI
  // dismisses the panel after a resume completes (LangGraph does not emit a
  // separate "cleared" event — the absence of `__interrupt__` in subsequent
  // values/updates is the signal). No-op if interrupt$ was already empty.
  if (subjects.interrupt$.value !== undefined) {
    subjects.interrupt$.next(undefined);
    subjects.interrupts$.next([]);
  }
}

function hasInterrupts(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const raw = (payload as Record<string, unknown>)['__interrupt__'];
  return Array.isArray(raw) && raw.length > 0;
}

/**
 * The pending interrupts on the latest checkpoint. Shared by the hydration
 * below and by the close-time settle, which asks the same question of a
 * refresh it is holding: "did this run pause rather than die?".
 */
function collectHistoryInterrupts<T>(history: ThreadState<T>[]): Interrupt[] {
  const latest = history[0];
  if (!latest || !Array.isArray(latest.tasks)) return [];
  const collected: Interrupt[] = [];
  for (const task of latest.tasks) {
    if (task && Array.isArray(task.interrupts) && task.interrupts.length > 0) {
      for (const ix of task.interrupts as Interrupt[]) {
        collected.push(ix);
      }
    }
  }
  return collected;
}

/**
 * Projects pending interrupts from the latest history checkpoint onto the
 * interrupt$ / interrupts$ subjects. ThreadState exposes interrupts under
 * `tasks[i].interrupts` (per the LangGraph SDK schema). When the latest
 * checkpoint contains any pending interrupts, mirror them so consumers can
 * react via `agent.interrupt()` on thread reload without needing a fresh
 * stream event.
 *
 * If no interrupts are present, this is a no-op so existing streamed state
 * (mid-run) isn't clobbered by a stale history refresh.
 */
function hydrateInterruptsFromHistory<T, B extends BagTemplate>(
  history: ThreadState<T>[],
  subjects: StreamSubjects<T, B>,
): void {
  const collected = collectHistoryInterrupts(history);
  if (collected.length > 0) {
    subjects.interrupts$.next(
      collected as unknown as Parameters<typeof subjects.interrupts$.next>[0],
    );
    subjects.interrupt$.next(
      collected[collected.length - 1] as unknown as Parameters<
        typeof subjects.interrupt$.next
      >[0],
    );
  }
}

/** Growth evidence is stricter than the legacy stream projection fallbacks. */
function hasDevelopmentEventPayload(event: StreamEvent): boolean {
  const baseType = getBaseEventType(event.type);
  if (isMessagesEvent(event.type)) {
    const payload = Array.isArray(event.messages) ? event.messages : event['data'];
    if (Array.isArray(payload)) {
      return payload.length === 0 || (normalizeMessages(event)?.length ?? 0) > 0;
    }
    // Older custom transports flatten arrays into numeric event properties.
    return Object.keys(event).some(key => /^\d+$/.test(key))
      && (normalizeMessages(event)?.length ?? 0) > 0;
  }
  // An explicitly malformed SDK payload cannot borrow namespace/metadata keys
  // from extractEventData's compatibility fallback as proof of decoded state.
  const payload = 'data' in event ? event['data']
    : baseType in event ? event[baseType]
    : Object.fromEntries(Object.entries(event).filter(([key]) =>
        !['type', 'namespace', 'messageMetadata'].includes(key)));
  switch (baseType) {
    case 'values':
    case 'updates':
    case 'checkpoints':
    case 'metadata':
      return isRecord(payload) && ('data' in event || baseType in event || Object.keys(payload).length > 0);
    case 'error':
      return safeReadEventError(event) !== undefined;
    case 'interrupt':
      return isRecord(event['interrupt']);
    case 'interrupts':
      return Array.isArray(event['interrupts']) && event['interrupts'].every(isRecord);
    case 'custom':
      return 'data' in event;
    case 'tools':
      return isRecord(payload) && typeof payload['event'] === 'string' && typeof payload['name'] === 'string';
    default:
      return false;
  }
}

function extractEventData(event: StreamEvent): unknown {
  // Try event['data'] first (SDK format from normalizeSdkEvent)
  const d = event['data'];
  if (d != null && typeof d === 'object' && !Array.isArray(d)) {
    return d;
  }
  // Try event[event.type] (mock/test format: { type: 'values', values: {...} })
  const named = event[event.type];
  if (named != null && typeof named === 'object' && !Array.isArray(named)) {
    return named;
  }
  // Fallback: reconstruct from remaining keys
  const rest = Object.fromEntries(
    Object.entries(event).filter(([key]) => key !== 'type' && key !== 'data'),
  );
  return Object.keys(rest).length > 0 ? rest : d;
}

function isMessagesEvent(type: StreamEvent['type']): boolean {
  const baseType = getBaseEventType(type);
  return baseType === 'messages' || baseType.startsWith('messages/');
}

function getBaseEventType(type: StreamEvent['type']): string {
  return String(type).split('|')[0];
}

function getEventNamespace(event: StreamEvent): string[] | undefined {
  if (Array.isArray(event.namespace)) return event.namespace;
  const parts = String(event.type).split('|');
  return parts.length > 1 ? parts.slice(1) : undefined;
}

function normalizeMessages(event: StreamEvent): unknown[] | null {
  const directMessages = event['messages'];
  if (Array.isArray(directMessages)) {
    // Filter out non-message metadata objects (e.g. { langgraph_node, langgraph_triggers })
    // that the LangGraph SDK includes alongside real messages in messages/* events.
    const filtered = directMessages.filter(isMessageLike);
    return filtered.length > 0 ? filtered : null;
  }

  const data = event['data'];
  if (Array.isArray(data)) {
    if (data.every(isMessageLike)) {
      return data;
    }
    if (isMessageLike(data[0])) {
      return [data[0]];
    }
  }

  const indexedValues = Object.keys(event)
    .filter(key => /^\d+$/.test(key))
    .sort((left, right) => Number(left) - Number(right))
    .map(key => event[key]);

  if (indexedValues.every(isMessageLike)) {
    return indexedValues;
  }
  if (isMessageLike(indexedValues[0])) {
    return [indexedValues[0]];
  }

  return null;
}

/**
 * Collapse adjacent AI messages where one's text is a prefix of the other.
 *
 * When complex-content streaming is in play, the same conceptual assistant
 * message can land in two slots: the canonical AI from values-sync (id
 * `resp_…` or run id) and the chunk-streamed AIMessageChunk from
 * messages-tuple (id `lc_run--…`). Both slots fill in parallel; once both
 * carry the full text we collapse them, keeping the older slot's id so
 * track-by-id stays stable in the chat list.
 */
function collapseAdjacentAi(
  messages: BaseMessage[],
  affectedMessageIds?: Set<string>,
  allowCrossIdAiMerge = true,
): BaseMessage[] {
  if (messages.length < 2) return messages;
  const out: BaseMessage[] = [];
  for (const msg of messages) {
    const last = out[out.length - 1];
    if (!last) { out.push(msg); continue; }
    const lastType = normalizeMessageType(
      typeof last._getType === 'function' ? last._getType() : (last as unknown as Record<string, unknown>)['type'] as string | undefined,
    );
    const msgType = normalizeMessageType(
      typeof msg._getType === 'function' ? msg._getType() : (msg as unknown as Record<string, unknown>)['type'] as string | undefined,
    );
    if (lastType === 'ai' && msgType === 'ai') {
      const lastText = extractText(last.content);
      const msgText = extractText(msg.content);
      const lastRaw = last as unknown as Record<string, unknown>;
      const msgRaw = msg as unknown as Record<string, unknown>;
      const differentIds = lastRaw['id'] !== msgRaw['id'];
      if (!(differentIds && !allowCrossIdAiMerge) && (lastText.length === 0
          || msgText.length === 0
          || lastText === msgText
          || lastText.startsWith(msgText)
          || msgText.startsWith(lastText))) {
        // Keep the longer content; preserve last (older) id and metadata.
        const longerText = msgText.length >= lastText.length ? msgText : lastText;
        const lastId = (last as unknown as Record<string, unknown>)['id'];
        const msgId = (msg as unknown as Record<string, unknown>)['id'];
        if (typeof msgId === 'string' && affectedMessageIds?.delete(msgId) && typeof lastId === 'string') {
          affectedMessageIds.add(lastId);
        }
        out[out.length - 1] = { ...(last as object), content: longerText } as BaseMessage;
        continue;
      }
    }
    out.push(msg);
  }
  return out;
}

type MergeMode = 'delta' | 'snapshot';

function mergeMessages(
  existing: BaseMessage[],
  incoming: BaseMessage[],
  reasoningTimingMap?: Map<string, { startedAt: number; endedAt?: number }>,
  mode: MergeMode = 'snapshot',
  canonicalMessageIds?: Set<string>,
  affectedMessageIds?: Set<string>,
  allowCrossIdAiMerge = true,
): BaseMessage[] {
  const merged = [...existing];
  for (const msg of incoming) {
    const rawIn = msg as unknown as Record<string, unknown>;
    const id = rawIn['id'];
    let idx = id ? merged.findIndex(m => (m as unknown as Record<string, unknown>)['id'] === id) : -1;
    // Fallback: match by (role, content) when ids differ. This is the path
    // that fires when the server echoes back our optimistic human message
    // with a server-assigned id, or when partial AI tokens carry a chunk
    // id but the final canonical message has a run id. Preserving the
    // existing id here keeps track-by-id stable in the chat list and
    // prevents DOM teardown + animation restarts mid-stream.
    if (idx < 0) {
      idx = findContentMatch(merged, msg);
      if (idx >= 0 && !canMergeCrossIdAi(merged[idx], msg, allowCrossIdAiMerge)) {
        idx = -1;
      }
    }
    // When an AIMessageChunk arrives without an id-match or content-prefix
    // match, treat the trailing AI message as its accumulator. The
    // OpenAI Responses API emits per-chunk events whose ids identify the
    // *event*, not the message, so consecutive chunks land here. Without
    // this we'd append every chunk as a separate bubble.
    if (idx < 0) {
      const inType = normalizeMessageType(rawIn['type'] as string | undefined);
      if (inType === 'ai') {
        for (let i = merged.length - 1; i >= 0; i--) {
          const t = normalizeMessageType(
            typeof (merged[i] as BaseMessage)._getType === 'function'
              ? (merged[i] as BaseMessage)._getType()
              : (merged[i] as unknown as Record<string, unknown>)['type'] as string | undefined,
          );
          if (t === 'ai') {
            if (!canMergeCrossIdAi(merged[i], msg, allowCrossIdAiMerge)) break;
            idx = i;
            break;
          }
          if (t === 'human' || t === 'tool' || t === 'system') break;
        }
      }
    }
    if (idx >= 0) {
      const existing = merged[idx];
      const existingId = (existing as unknown as Record<string, unknown>)['id'];
      const incomingRaw = msg as unknown as Record<string, unknown>;
      const targetId = (existingId ?? incomingRaw['id']) as string | undefined;
      // Identity backstop: once a message's content is known-final, late
      // streamed deltas for it are stale stragglers — ignore them outright.
      if (mode === 'delta' && targetId && canonicalMessageIds?.has(targetId)
          && !isFinalCanonicalReasoningContent(incomingRaw['content'])) {
        continue;
      }
      // Keep the *existing* id so downstream track-by-id sees stable identity.
      // For complex-content streaming (OpenAI gpt-5/o-series, Anthropic) the
      // SDK emits per-chunk *delta* arrays — not accumulated arrays — so a
      // straight replacement collapses the rendered bubble to just the
      // latest token. Accumulate text-bearing content across chunks here
      // and hand a string to consumers; downstream code already handles
      // string content uniformly.
      const accumulatedContent = accumulateContent(
        existing.content as unknown,
        incomingRaw['content'],
        mode,
      );
      if (targetId && isFinalCanonicalReasoningContent(incomingRaw['content'])) {
        canonicalMessageIds?.add(targetId);
      }
      // Only accumulate reasoning when the incoming message explicitly carries
      // a `reasoning` field or complex-content array blocks with
      // type='reasoning'/'thinking'. Never use a plain string content value
      // as reasoning source — that would wrongly treat every assistant
      // message text as reasoning content.
      const incomingReasoningSource = 'reasoning' in incomingRaw
        ? incomingRaw['reasoning']
        : (Array.isArray(incomingRaw['content']) ? incomingRaw['content'] : undefined);
      const accumulatedReasoning = accumulateReasoning(
        (existing as unknown as Record<string, unknown>)['reasoning'],
        incomingReasoningSource,
      );
      const idForTiming = (existingId as string | undefined) ?? (incomingRaw['id'] as string | undefined);
      if (idForTiming && reasoningTimingMap) {
        const hasReasoning = accumulatedReasoning.length > 0;
        const hasText = (typeof accumulatedContent === 'string' ? accumulatedContent : '').length > 0;
        if (hasReasoning) {
          const entry = reasoningTimingMap.get(idForTiming) ?? { startedAt: Date.now() };
          if (hasText && entry.endedAt === undefined) entry.endedAt = Date.now();
          reasoningTimingMap.set(idForTiming, entry);
        }
      }
      const next = { ...(msg as object), content: accumulatedContent } as BaseMessage;
      (next as unknown as Record<string, unknown>)['reasoning'] = accumulatedReasoning;
      if (existingId) {
        (next as unknown as Record<string, unknown>)['id'] = existingId;
      }
      const changed = mode === 'delta' || messageChangedForDelivery(existing, next);
      merged[idx] = next;
      if (targetId && changed) affectedMessageIds?.add(targetId);
    } else {
      const incomingRaw = msg as unknown as Record<string, unknown>;
      const initialReasoningSource = 'reasoning' in incomingRaw
        ? incomingRaw['reasoning']
        : (Array.isArray(incomingRaw['content']) ? incomingRaw['content'] : undefined);
      const initialReasoning = accumulateReasoning(undefined, initialReasoningSource);
      if (initialReasoning.length > 0 && reasoningTimingMap) {
        const msgId = incomingRaw['id'] as string | undefined;
        if (msgId && !reasoningTimingMap.has(msgId)) {
          reasoningTimingMap.set(msgId, { startedAt: Date.now() });
        }
      }
      const next = { ...(msg as object) } as BaseMessage;
      (next as unknown as Record<string, unknown>)['reasoning'] = initialReasoning;
      merged.push(next);
      const nextId = (next as unknown as Record<string, unknown>)['id'];
      if (typeof nextId === 'string') affectedMessageIds?.add(nextId);
    }
  }
  return collapseAdjacentAi(merged, affectedMessageIds, allowCrossIdAiMerge);
}

function canMergeCrossIdAi(
  candidate: BaseMessage,
  incoming: BaseMessage,
  allowCrossIdAiMerge: boolean,
): boolean {
  const candidateRaw = candidate as unknown as Record<string, unknown>;
  const incomingRaw = incoming as unknown as Record<string, unknown>;
  if (candidateRaw['id'] === incomingRaw['id']) return true;
  return allowCrossIdAiMerge;
}

/**
 * Merge an incoming chunk's content into prior accumulated content for the
 * same message id. Behavior is governed by `mode`, which reflects the
 * DECLARED kind of the source event rather than a guess from comparing text:
 *
 * - mode 'delta' (messages-tuple / `event.messageMetadata` truthy): the
 *   payload is a genuine per-chunk delta. Append unconditionally — a
 *   prefix-comparison "dedupe" here would silently drop legitimate tokens
 *   that coincide with the message-so-far (e.g. every bare "|" while
 *   streaming a markdown table). Staleness after the message goes canonical
 *   is instead handled by identity in `mergeMessages` (canonicalMessageIds).
 * - mode 'snapshot' (messages/partial, values-sync): the payload carries the
 *   message-so-far, not a delta, so mutual prefix comparison picks the
 *   longer state and ignores stale shorter snapshots.
 *
 * In both modes, a "final canonical" reasoning+text array (see
 * `isFinalCanonicalReasoningContent`) always replaces whatever was
 * accumulated — it's the authoritative final message, not another chunk.
 *
 * We deliberately collapse complex content arrays to a string at this layer.
 * The langgraph-sdk client does not accumulate complex-content arrays the
 * way it accumulates strings, and per-chunk arrays carry only the latest
 * delta. Concatenating extracted text gives consumers the same uniform
 * string they get for non-reasoning models.
 */
/**
 * Heuristic: does this content look like a "final canonical" array
 * carrying both reasoning and visible text blocks? OpenAI's Responses
 * API ships the final assistant message in this shape after the
 * streaming token chunks complete. Detection is narrow (requires BOTH
 * a reasoning-shape block AND a text-shape block in the same array)
 * so it doesn't trip on routine streaming chunks.
 */
function isFinalCanonicalReasoningContent(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  let hasReasoning = false;
  let hasText = false;
  for (const block of content) {
    if (block == null || typeof block !== 'object') continue;
    const t = (block as Record<string, unknown>)['type'];
    if (t === 'reasoning' || t === 'thinking') hasReasoning = true;
    else if (t === 'text' || t === 'output_text') hasText = true;
  }
  return hasReasoning && hasText;
}

function accumulateContent(existing: unknown, incoming: unknown, mode: MergeMode = 'snapshot'): string {
  const existingText = extractText(existing);
  const incomingText = extractText(incoming);

  // Always return a string. We never want array content escaping the bridge:
  // (a) downstream consumers expect string content, and (b) findContentMatch
  // stringifies arrays, which would prevent the canonical-message id-swap
  // dedupe from matching the streamed-chunk message after a partial chunk.
  if (existingText.length === 0) return incomingText;
  if (incomingText.length === 0) return existingText;
  // Final-canonical detection applies in both modes: the authoritative
  // "reasoning + text" array replaces whatever was accumulated.
  if (isFinalCanonicalReasoningContent(incoming)) return incomingText;
  if (mode === 'delta') {
    // Tuple chunks are declared deltas. Append unconditionally — any
    // text-comparison "dedupe" here can silently drop legitimate tokens
    // that coincide with the message prefix (e.g. every bare "|" in a
    // markdown table). Staleness is handled by identity in mergeMessages.
    return existingText + incomingText;
  }
  // Snapshot mode (messages/partial, values-sync): payloads carry the
  // message-so-far, so mutual prefix comparison picks the longer state and
  // ignores stale shorter snapshots.
  if (incomingText.startsWith(existingText)) return incomingText;
  if (existingText.startsWith(incomingText)) return existingText;
  return existingText + incomingText;
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  let out = '';
  for (const block of content) {
    if (typeof block === 'string') { out += block; continue; }
    if (block == null || typeof block !== 'object') continue;
    const rec = block as Record<string, unknown>;
    const t = rec['type'];
    if (t === 'text' || t === 'output_text' || t === undefined) {
      const text = rec['text'];
      if (typeof text === 'string') out += text;
    }
  }
  return out;
}

function extractReasoning(content: unknown): string {
  if (typeof content === 'string') return '';
  if (!Array.isArray(content)) return '';
  let out = '';
  for (const block of content) {
    if (block == null || typeof block !== 'object') continue;
    const rec = block as Record<string, unknown>;
    const t = rec['type'];
    if (t === 'reasoning' || t === 'thinking') {
      // Direct text field — Anthropic-style "thinking" blocks and
      // some LangChain-shaped reasoning blocks land here.
      const text = rec['text'];
      if (typeof text === 'string') out += text;
      // OpenAI Responses API: when `reasoning.summary='auto'` was
      // requested, reasoning blocks carry a `summary` array of
      // `{type: 'summary_text', text: '...'}` items. Concatenate
      // their texts in order.
      const summary = rec['summary'];
      if (Array.isArray(summary)) {
        for (const item of summary) {
          if (item == null || typeof item !== 'object') continue;
          const itemText = (item as Record<string, unknown>)['text'];
          if (typeof itemText === 'string') out += itemText;
        }
      }
    }
  }
  return out;
}

function accumulateReasoning(existing: unknown, incoming: unknown): string {
  const existingText = typeof existing === 'string' ? existing : extractReasoning(existing);
  const incomingText = typeof incoming === 'string' ? incoming : extractReasoning(incoming);
  if (existingText.length === 0) return incomingText;
  if (incomingText.length === 0) return existingText;
  if (incomingText.startsWith(existingText)) return incomingText;
  if (existingText.startsWith(incomingText)) return existingText;
  return existingText + incomingText;
}

/**
 * Replace the incoming messages' ids with the existing array's ids whenever
 * (role, content) matches positionally and the existing id differs. Keeps
 * track-by-id stable across server echoes and final-id swaps.
 */
function preserveIds(
  existing: BaseMessage[],
  incoming: BaseMessage[],
  affectedMessageIds?: Set<string>,
): BaseMessage[] {
  if (existing.length === 0) {
    for (const message of incoming) {
      const id = (message as unknown as Record<string, unknown>)['id'];
      if (typeof id === 'string') affectedMessageIds?.add(id);
    }
    return collapseAdjacentAi(incoming, affectedMessageIds);
  }
  const usedExisting = new Set<number>();
  const remapped = incoming.map((msg, i) => {
    const inRaw = msg as unknown as Record<string, unknown>;
    const inId = inRaw['id'];
    // First try same-position match (the dominant case).
    let matchIdx = -1;
    if (i < existing.length && !usedExisting.has(i) && sameRoleAndContent(existing[i], msg)) {
      matchIdx = i;
    } else {
      // Fallback: any unused existing message with matching role+content.
      matchIdx = existing.findIndex((m, j) => !usedExisting.has(j) && sameRoleAndContent(m, msg));
    }
    if (matchIdx < 0) {
      if (typeof inId === 'string') affectedMessageIds?.add(inId);
      return msg;
    }
    usedExisting.add(matchIdx);
    const existingId = (existing[matchIdx] as unknown as Record<string, unknown>)['id'];
    const remappedMessage = !existingId || existingId === inId
      ? msg
      : { ...(msg as object), id: existingId } as BaseMessage;
    if (typeof existingId === 'string' && messageChangedForDelivery(existing[matchIdx], remappedMessage)) {
      affectedMessageIds?.add(existingId);
    }
    return remappedMessage;
  });
  return collapseAdjacentAi(remapped, affectedMessageIds);
}

function messageChangedForDelivery(existing: BaseMessage, incoming: BaseMessage): boolean {
  const existingRaw = existing as unknown as Record<string, unknown>;
  const incomingRaw = incoming as unknown as Record<string, unknown>;
  const existingType = normalizeMessageType(
    typeof existing._getType === 'function' ? existing._getType() : existingRaw['type'] as string | undefined,
  );
  const incomingType = normalizeMessageType(
    typeof incoming._getType === 'function' ? incoming._getType() : incomingRaw['type'] as string | undefined,
  );
  if (existingType !== incomingType || extractText(existing.content) !== extractText(incoming.content)) {
    return true;
  }
  const existingReasoning = typeof existingRaw['reasoning'] === 'string'
    ? existingRaw['reasoning']
    : extractReasoning(existingRaw['reasoning']);
  const incomingReasoning = typeof incomingRaw['reasoning'] === 'string'
    ? incomingRaw['reasoning']
    : extractReasoning(incomingRaw['reasoning']);
  if (existingReasoning !== incomingReasoning) return true;
  return JSON.stringify(existingRaw['tool_calls'] ?? null) !== JSON.stringify(incomingRaw['tool_calls'] ?? null);
}

function sameRoleAndContent(a: BaseMessage, b: BaseMessage): boolean {
  const aType = normalizeMessageType(
    typeof a._getType === 'function' ? a._getType() : (a as unknown as Record<string, unknown>)['type'] as string | undefined,
  );
  const bType = normalizeMessageType(
    typeof b._getType === 'function' ? b._getType() : (b as unknown as Record<string, unknown>)['type'] as string | undefined,
  );
  if (aType !== bType) return false;
  const aContent = typeof a.content === 'string' ? a.content : JSON.stringify(a.content);
  const bContent = typeof b.content === 'string' ? b.content : JSON.stringify(b.content);
  if (aContent === bContent) return true;
  // For AI messages we accept prefix relationships (streaming → final).
  if (aType === 'ai' && typeof aContent === 'string' && typeof bContent === 'string') {
    return aContent.length > 0 && (bContent.startsWith(aContent) || aContent.startsWith(bContent));
  }
  return false;
}

function findContentMatch(merged: BaseMessage[], incoming: BaseMessage): number {
  const inRaw = incoming as unknown as Record<string, unknown>;
  const inType = normalizeMessageType(
    typeof incoming._getType === 'function' ? incoming._getType() : (inRaw['type'] as string | undefined),
  );
  const inContent = typeof incoming.content === 'string' ? incoming.content : JSON.stringify(incoming.content);
  // Only worth matching for human messages (where the optimistic→echo
  // mismatch happens) and for AI messages where content is a strict prefix
  // of the existing (token-streaming + final-id swap pattern).
  for (let i = merged.length - 1; i >= 0; i--) {
    const m = merged[i] as unknown as Record<string, unknown>;
    const mType = normalizeMessageType(
      typeof (merged[i] as BaseMessage)._getType === 'function'
        ? (merged[i] as BaseMessage)._getType()
        : (m['type'] as string | undefined),
    );
    if (mType !== inType) continue;
    const mContent = typeof (merged[i] as BaseMessage).content === 'string'
      ? (merged[i] as BaseMessage).content as string
      : JSON.stringify((merged[i] as BaseMessage).content);
    if (inType === 'human' && mContent === inContent) return i;
    if (inType === 'ai') {
      // Skip empty placeholders. We don't want a pre-existing empty AI
      // (created by an early values-sync emission with `state.messages`
      // including an unfilled assistant turn) to absorb the first chunk
      // arriving via messages-tuple — that strands subsequent chunks in a
      // separate slot whose content no longer prefix-matches the canonical.
      const aSafe = typeof mContent === 'string' ? mContent : '';
      const bSafe = typeof inContent === 'string' ? inContent : '';
      if (aSafe.length === 0 || bSafe.length === 0) continue;
      if (mContent === inContent || aSafe.startsWith(bSafe) || bSafe.startsWith(aSafe)) return i;
    }
  }
  return -1;
}

/**
 * Normalize message type so AIMessage and AIMessageChunk compare equal.
 * The LangGraph SDK emits type='AIMessageChunk' on the messages-tuple
 * streaming path and type='ai' on the values-sync path for the same
 * canonical assistant message — distinguishing them prevents the
 * content-prefix dedupe from collapsing the duplicate bubbles.
 */
function normalizeMessageType(t: string | undefined): string | undefined {
  if (!t) return t;
  if (t === 'AIMessageChunk' || t === 'AIMessage' || t === 'assistant') return 'ai';
  if (t === 'HumanMessage' || t === 'HumanMessageChunk' || t === 'user') return 'human';
  if (t === 'ToolMessage') return 'tool';
  if (t === 'SystemMessage') return 'system';
  return t;
}

function getTailAssistantMessageId(messages: BaseMessage[]): string | undefined {
  const tail = messages[messages.length - 1];
  if (!tail) return undefined;
  const raw = tail as unknown as Record<string, unknown>;
  const type = normalizeMessageType(
    typeof tail._getType === 'function' ? tail._getType() : raw['type'] as string | undefined,
  );
  return type === 'ai' && typeof raw['id'] === 'string' ? raw['id'] : undefined;
}

function toSubagentRefs(
  subagents: Map<string, TrackedSubagent>,
): Map<string, SubagentStreamRef> {
  const refs = new Map<string, SubagentStreamRef>();
  subagents.forEach((subagent, key) => {
    refs.set(key, {
      toolCallId: subagent.id,
      // Tool children are named by their `subagent_type` arg; subgraph
      // children by their node name (stored as the synthetic toolCall name).
      name: typeof subagent.toolCall.args['subagent_type'] === 'string'
        ? subagent.toolCall.args['subagent_type']
        : subagent.kind === 'subgraph'
          ? subagent.toolCall.name
          : undefined,
      status: signal(subagent.status),
      values: signal(subagent.values),
      messages: signal(subagent.messages as unknown as BaseMessage[]),
    });
  });
  return refs;
}

function isAiMessageWithToolCalls(value: Record<string, unknown>): boolean {
  return (value['type'] === 'ai' || value['type'] === 'assistant')
    && Array.isArray(value['tool_calls']);
}

function isToolMessage(value: Record<string, unknown>): value is Record<string, unknown> & { tool_call_id: string } {
  return value['type'] === 'tool' && typeof value['tool_call_id'] === 'string';
}

function isMessageLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object'
    && value !== null
    && (
      'content' in value
      || 'type' in value
      || 'id' in value
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const _internalsForTesting = {
  extractText,
  extractReasoning,
  accumulateContent,
  accumulateReasoning,
  collapseAdjacentAi,
  mergeMessages,
  preserveIds,
  normalizeMessageType,
  isFinalCanonicalReasoningContent,
};
