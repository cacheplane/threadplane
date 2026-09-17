import { computed, isDevMode, signal, type Signal } from '@angular/core';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Keep the postinstall module external through ng-packagr.
import { installationToken } from '#development-install';
declare const ngDevMode: boolean;
import { createDevelopmentRuntime, registerDevelopmentRuntimePolicy } from '@threadplane/telemetry/browser';
import { THREADPLANE_PACKAGE_VERSION as packageVersion } from './package-version';
import { Subject } from 'rxjs';
import type { AbstractAgent } from '@ag-ui/client';
import {
  completeDelivery,
  staticDelivery,
  streamingDelivery,
  toAgentError,
  isAbortError,
  AgentError,
  AGENT_ERROR_MESSAGES,
  AGENT_RECOVERY_MESSAGES,
} from '@threadplane/chat';
import type {
  Agent, Message, AgentStatus, ToolCall, AgentEvent,
  AgentInterrupt,
  AgentRuntimeTelemetryEvent,
  AgentRuntimeTelemetryProperties,
  AgentRuntimeTelemetrySink,
  AgentSubmitInput, AgentSubmitOptions,
  ClientToolsCapability,
  Subagent, SubagentStatus,
} from '@threadplane/chat';
import {
  finalizeDeliveryRun,
  reduceEvent,
  type ReducerDeliveryRun,
  type ReducerStore,
  type CustomStreamEvent,
  type ActivityEntry,
} from './reducer';
import { createClientToolsCapability } from './client-tools';
import { InterruptSession } from './interrupt-session';
import type { InterruptSessionSnapshot, InterruptTransport, ResumeAttempt } from './interrupt-session.types';
import { RunStateTransaction } from './run-state-transaction';
import { InterruptPersistence, type AgUiInterruptPersistence, type AgUiThreadRecord } from './interrupt-persistence';

export interface ToAgentOptions {
  /** Application-owned durable storage. Requires a stable source threadId and scoped namespace. */
  persistence?: AgUiInterruptPersistence;
  /** Native outcomes take precedence in auto mode; select a legacy profile explicitly when required. */
  interruptTransport?: InterruptTransport;
  /**
   * Omit to enable automatic development-only collection. Set `false` to disable.
   * An app-owned sink replaces the automatic destination and receives the
   * existing runtime lifecycle callbacks.
   */
  telemetry?: AgentRuntimeTelemetrySink | false;
  /**
   * A2UI client capabilities (catalog negotiation) to advertise to the agent.
   * When set, they are seeded once into the AG-UI shared state under the
   * `a2ui_client_capabilities` key, so every RunAgentInput.state carries them.
   * Use `@threadplane/chat`'s `a2uiClientCapabilities()` for the renderer's
   * standard value.
   */
  a2uiClientCapabilities?: { supportedCatalogIds: string[]; inlineCatalogs?: unknown[] };
}

type InternalToAgentOptions = ToAgentOptions & {
  protectOperationErrors?: boolean;
};

function captureAgentRuntimeTelemetry(
  sink: AgentRuntimeTelemetrySink | false | undefined,
  event: AgentRuntimeTelemetryEvent,
  properties: AgentRuntimeTelemetryProperties,
): void {
  if (!sink) return;
  try {
    void Promise.resolve(sink({ event, properties })).catch(() => undefined);
  } catch {
    // Keep telemetry side effects isolated from adapter control flow.
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

/** Adapter-specific submit guards in addition to cancellation. */
export interface AgUiSubmitOptions extends AgentSubmitOptions {
  /** Generation captured when rendering the interrupt decision; rejects stale controls. */
  interruptGeneration?: number;
}

/**
 * The neutral Agent contract, widened with the AG-UI adapter's
 * `customEvents` signal (the chat composition feature-detects it to enable
 * live a2ui streaming), the browser client-tools capability, and concrete
 * ACTIVITY-backed `subagents`.
 * Mirrors langgraph's LangGraphAgent extension where the protocol surfaces
 * overlap.
 */
export interface AgUiAgent<TState = Record<string, unknown>> extends Agent<TState> {
  submit(input: AgentSubmitInput, opts?: AgUiSubmitOptions): Promise<void>;
  /** Resolves after persisted thread state is hydrated; actions wait for it. */
  ready: Promise<void>;
  /** Recover an uncertain attempt using the configured authoritative reconciler. */
  reconcileInterrupt(): Promise<void>;
  /** Full interrupt batch and its request ownership phase. */
  interruptSession: Signal<InterruptSessionSnapshot>;
  /** Unsubscribe and stop local work. Does not cancel backend checkpoints. */
  dispose(): void;
  customEvents: Signal<CustomStreamEvent[]>;
  clientTools: ClientToolsCapability;
  /** Subagent activities (activityType==='subagent') projected to the neutral
   *  Subagent contract, keyed by messageId. Narrows the base Agent's optional
   *  `subagents?` to a concrete signal for AG-UI consumers. */
  subagents: Signal<Map<string, Subagent>>;
}

/**
 * Wraps an AG-UI AbstractAgent into the runtime-neutral Agent contract.
 *
 * The adapter subscribes to source.subscribe({ onEvent }) and reduces every
 * event into the produced Agent's signals. submit() optimistically appends the
 * user message to both our signals and the source agent's internal message
 * list, then calls source.runAgent(). stop() calls source.abortRun().
 *
 * Subscription cleanup: providers dispose the adapter with their injector.
 * Direct callers must call dispose() when they no longer need the adapter.
 *
 * @example
 * ```ts
 * import { HttpAgent } from '@ag-ui/client';
 * import { toAgent } from '@threadplane/ag-ui';
 *
 * const agent = toAgent(new HttpAgent({ url: '/api/agent' }));
 * ```
 */
export function toAgent(source: AbstractAgent, options: ToAgentOptions = {}): AgUiAgent {
  return createAgentAdapter(source, options);
}

/** @internal Adapter integration seam used only by provideAgent. */
export function ɵtoAgentWithProtectedErrors(
  source: AbstractAgent,
  options: ToAgentOptions,
): AgUiAgent {
  return createAgentAdapter(source, { ...options, protectOperationErrors: true });
}

function createAgentAdapter(
  source: AbstractAgent,
  options: InternalToAgentOptions,
): AgUiAgent {
  // Advertise A2UI capabilities via the AG-UI shared state so every
  // RunAgentInput.state carries them (transport metadata, A2UI v0.9).
  if (options.a2uiClientCapabilities) {
    source.state = {
      ...((source.state as Record<string, unknown>) ?? {}),
      a2ui_client_capabilities: options.a2uiClientCapabilities,
    };
  }

  let generationSequence = 0;
  const allocateDeliveryGeneration = (scope: string): string =>
    `${scope}-${++generationSequence}-${Math.random().toString(36).slice(2, 10)}`;
  const store: ReducerStore = {
    messages:     signal<Message[]>([]),
    status:       signal<AgentStatus>('idle'),
    isLoading:    signal<boolean>(false),
    error:        signal<AgentError | undefined>(undefined),
    toolCalls:    signal<ToolCall[]>([]),
    state:        signal<Record<string, unknown>>({}),
    interrupt:    signal<AgentInterrupt | undefined>(undefined),
    events$:      new Subject<AgentEvent>(),
    customEvents: signal<CustomStreamEvent[]>([]),
    activities:   signal<Map<string, ActivityEntry>>(new Map()),
    deliveryRun: null,
    allocateDeliveryGeneration,
  };
  const interrupts = new InterruptSession(options.interruptTransport);
  const interruptSession = signal(interrupts.snapshot);
  const transaction = new RunStateTransaction({ state: source.state ?? {}, messages: source.messages ?? [] });
  let disposed = false;
  let resumeInput: { state: Record<string, unknown>; messages: typeof source.messages; localMessages?: Message[] } | undefined;
  const persistence = options.persistence ? new InterruptPersistence(options.persistence, source.threadId) : undefined;
  const hydrated = signal(!persistence);
  const reconciling = signal(false);
  let persistenceFault: unknown;
  let persistenceWrites: Promise<void> = Promise.resolve();
  function storageError(error: unknown): void {
    persistenceFault = error;
    if (!disposed) {
      store.error.set(options.protectOperationErrors ? protectedAgentError() : projectAgentError(error));
      store.status.set('error'); store.isLoading.set(false);
    }
  }
  function persistCurrent(): Promise<void> {
    if (!persistence) return Promise.resolve();
    const data = {
      committed: transaction.committed, session: interrupts.snapshot,
      ...(resumeInput && interrupts.snapshot.attempt ? { resumeInput: { state: resumeInput.state, messages: resumeInput.messages } } : {}),
    };
    const write = persistenceWrites.then(() => persistence.save(data));
    persistenceWrites = write;
    void write.catch(storageError);
    return write;
  }
  function hydrate(record: AgUiThreadRecord): void {
    if (disposed) return;
    transaction.commit(record.committed);
    source.state = structuredClone(record.committed.state);
    source.messages = structuredClone(record.committed.messages);
    store.deliveryRun = null;
    reduceEvent({ type: 'MESSAGES_SNAPSHOT', messages: record.committed.messages } as never, store);
    store.state.set(structuredClone(record.committed.state));
    interrupts.restore(record.session);
    source.pendingInterrupts = structuredClone(record.session.interrupts);
    resumeInput = record.resumeInput ? structuredClone(record.resumeInput) : undefined;
    publishInterrupt();
  }
  const ready = persistence
    ? persistence.load().then(record => { if (record) hydrate(record); hydrated.set(true); }).catch(error => { storageError(error); throw error; })
    : Promise.resolve();
  void ready.catch(() => undefined);
  function publishInterrupt(): void {
    const snapshot = interrupts.snapshot;
    interruptSession.set(snapshot);
    if (snapshot.phase === 'none' || snapshot.phase === 'acknowledged') {
      store.interrupt.set(undefined);
    } else if (snapshot.interrupts.length && options.interruptTransport !== 'legacy-command' && options.interruptTransport !== 'mastra-command') {
      store.interrupt.set({
        id: snapshot.interrupts[0].id, resumable: true,
        value: { interrupts: snapshot.interrupts, ...(snapshot.runId ? { runId: snapshot.runId } : {}) },
      });
    } else {
      store.interrupt.set(snapshot.legacy);
    }
  }
  function assertAvailable(): void {
    if (disposed) throw new Error('Agent has been disposed');
    if (reconciling()) throw new Error('Interrupt reconciliation is in progress');
    if (!hydrated()) throw new Error('Wait for agent.ready before starting a request');
    if (persistenceFault) throw new Error('Interrupt storage recovery requires reconciliation');
  }
  function assertNoInterrupt(): void {
    assertAvailable();
    if (interrupts.snapshot.phase !== 'none') throw new Error('Resolve the pending interrupt before starting another request');
  }
  function rollbackState(): void {
    const committed = transaction.rollback();
    source.state = committed.state;
    source.messages = committed.messages;
    store.state.set(committed.state);
  }
  function commitState(): void {
    transaction.commit({ state: store.state(), messages: source.messages ?? [] });
  }
  const telemetryProperties = { transport: 'ag-ui' as const, surface: 'to_agent' };
  const developmentRuntime = createDevelopmentRuntime({
    integration: 'ag-ui', packageName: '@threadplane/ag-ui', packageVersion,
    installationToken: (typeof ngDevMode === 'undefined' || ngDevMode) && isDevMode() ? installationToken : null,
    enabled: () => options.telemetry === undefined,
  });
  interface AdapterRun extends ReducerDeliveryRun {
    startedAt: number;
    telemetrySettled: boolean;
    resumedInterrupt: boolean;
    resumeAttempt?: ResumeAttempt;
    terminalReceived?: boolean;
    /** Narrower than `terminalReceived`, which a RUN_ERROR also sets. */
    finishedReceived?: boolean;
  }
  let activeRun: AdapterRun | null = null;
  const runsByProtocolId = new Map<string, AdapterRun>();

  // Tracks the last AgentSubmitInput so retry() can re-run it without
  // duplicating the user message. Set at the top of submit()'s message path.
  let lastInput: AgentSubmitInput | undefined;
  let lastRunInput: typeof resumeInput;

  function resolveCallbackRun(protocolRunId: string | undefined): AdapterRun | null {
    if (!protocolRunId) return activeRun;
    const known = runsByProtocolId.get(protocolRunId);
    if (known) return known;
    if (!activeRun || activeRun.protocolRunId) return null;
    activeRun.protocolRunId = protocolRunId;
    runsByProtocolId.set(protocolRunId, activeRun);
    while (runsByProtocolId.size > 16) {
      const oldestId = runsByProtocolId.keys().next().value as string | undefined;
      if (!oldestId) break;
      if (runsByProtocolId.get(oldestId) === activeRun) {
        const current = runsByProtocolId.get(oldestId)!;
        runsByProtocolId.delete(oldestId);
        runsByProtocolId.set(oldestId, current);
        continue;
      }
      runsByProtocolId.delete(oldestId);
    }
    return activeRun;
  }

  /** Forward a neutral-contract state patch onto the AG-UI run input.
   *  Mirrors the canonical demo's `input.state` mechanism: the patch is
   *  merged into the source agent's client state (carried on
   *  RunAgentInput.state) and reflected optimistically in the local
   *  state signal — the server's next STATE_SNAPSHOT stays authoritative. */
  const applyStatePatch = (patch: Record<string, unknown> | undefined): void => {
    if (!patch || Object.keys(patch).length === 0) return;
    source.state = { ...((source.state as Record<string, unknown>) ?? {}), ...patch };
    store.state.update((prev) => ({ ...prev, ...patch }));
  };

  captureAgentRuntimeTelemetry(
    options.telemetry,
    'tplane:runtime_instance_created',
    telemetryProperties,
  );

  function beginRun(requestType: string, allowBaselineTail = false, resumedInterrupt = false): AdapterRun {
    developmentRuntime.touch();
    if (activeRun && activeRun.outcome === undefined) {
      const supersededRun = activeRun;
      finalizeDeliveryRun(store, supersededRun, 'interrupted');
      const interruption = new Error('Run superseded by a newer request');
      interruption.name = 'InterruptedError';
      failRunTelemetry(interruption, supersededRun);
    }
    const run: AdapterRun = {
      generation: allocateDeliveryGeneration('run'),
      baselineMessageIds: new Set(store.messages().map(message => message.id)),
      ownedMessageIds: new Set(),
      snapshotReplacementIds: new Set(),
      eligibleBaselineAssistantId: allowBaselineTail
        ? getTailAssistantMessageId(store.messages())
        : undefined,
      startedAt: Date.now(),
      telemetrySettled: false,
      resumedInterrupt,
    };
    activeRun = run;
    store.deliveryRun = run;
    captureAgentRuntimeTelemetry(options.telemetry, 'tplane:runtime_request_created', {
      ...telemetryProperties,
      requestType,
    });
    captureAgentRuntimeTelemetry(options.telemetry, 'tplane:stream_started', telemetryProperties);
    return run;
  }

  function finishRunTelemetry(run: AdapterRun): void {
    if (run.telemetrySettled) return;
    run.telemetrySettled = true;
    captureAgentRuntimeTelemetry(options.telemetry, 'tplane:stream_ended', {
      ...telemetryProperties,
      durationMs: Date.now() - run.startedAt,
    });
  }

  function failRunTelemetry(error: unknown, run: AdapterRun | null = activeRun): void {
    if (!run || run.telemetrySettled) return;
    run.telemetrySettled = true;
    captureAgentRuntimeTelemetry(options.telemetry, 'tplane:stream_errored', {
      ...telemetryProperties,
      durationMs: Date.now() - run.startedAt,
      errorClass: agentRuntimeTelemetryErrorClass(error),
    });
  }

  function failRun(run: AdapterRun, error: unknown): void {
    if (disposed || (run.outcome !== undefined && !(run.outcome === 'paused' && !run.terminalReceived && interrupts.snapshot.phase === 'collecting'))) return;
    run.terminalReceived = true;
    finalizeDeliveryRun(store, run, 'error');
    if (activeRun === run) {
      rollbackState();
      if (run.resumeAttempt) {
        interrupts.fail(run.resumeAttempt.id, isRecord(error) && error['requestNotDispatched'] === true);
        publishInterrupt();
      }
      store.status.set('error');
      store.isLoading.set(false);
      store.error.set(options.protectOperationErrors ? protectedAgentError() : projectAgentError(error));
      void persistCurrent().catch(() => undefined);
    }
    failRunTelemetry(options.protectOperationErrors ? undefined : error, run);
  }

  // Placeholder recovery classification for an unexpectedly closed stream.
  // Task 5 replaces this body with the real classifier; until then every
  // interruption reports the most conservative option.
  function interruptionError(_run: AdapterRun): AgentError {
    return new AgentError({
      kind: 'interrupted',
      message: AGENT_RECOVERY_MESSAGES.none,
      retryable: false,
      recovery: 'none',
    });
  }

  function settleTransportClose(run: AdapterRun): void {
    if (run.outcome === undefined) {
      if (run.finishedReceived) {
        // The server sent RUN_FINISHED and `onEvent` attributed it to this run,
        // but the reducer declined it — the two disagree when the event body
        // carries a different runId than the SDK callback envelope. The run did
        // finish, so settle it as a success rather than reporting a close the
        // server never made. Deliberately narrower than `terminalReceived`,
        // which a RUN_ERROR also sets: a declined RUN_ERROR must NOT land here
        // and be reported as a clean success.
        finalizeDeliveryRun(store, run, 'success');
        if (activeRun === run) {
          store.status.set('idle');
          store.isLoading.set(false);
          store.error.set(undefined);
        }
      } else {
        // No attributed terminal evidence and no user stop: the stream closed
        // unexpectedly, so report an honest uncertain outcome.
        if (run.resumeAttempt) {
          rollbackState();
          interrupts.fail(run.resumeAttempt.id, false);
          publishInterrupt();
        }
        finalizeDeliveryRun(store, run, 'interrupted');
        if (activeRun === run) {
          store.status.set('error');
          store.isLoading.set(false);
          store.error.set(interruptionError(run));
        }
        // The partial message and its `interrupted` delivery are the evidence
        // the error points at, so they have to survive a reload.
        void persistCurrent().catch(() => undefined);
        // An unexpected close is an errored stream, not a clean end. This marks
        // the run settled, so the tail call below is a no-op for this path.
        const interruption = new Error('Stream closed without a terminal event');
        interruption.name = 'InterruptedError';
        failRunTelemetry(interruption, run);
      }
    }
    finishRunTelemetry(run);
  }

  function abortRun(run: AdapterRun): void {
    if (run.outcome !== undefined) return;
    rollbackState();
    if (run.resumeAttempt) {
      interrupts.fail(run.resumeAttempt.id, false);
      publishInterrupt();
      void persistCurrent().catch(() => undefined);
    }
    finalizeDeliveryRun(store, run, 'aborted');
    store.status.set('idle');
    store.isLoading.set(false);
    store.error.set(undefined);
    finishRunTelemetry(run);
  }

  type RunParameters = Parameters<AbstractAgent['runAgent']>[0];

  async function executeRun(
    requestType: string,
    parameters?: RunParameters,
    allowBaselineTail = false,
    resumedInterrupt = false,
    resumeAttempt?: ResumeAttempt,
    signal?: AbortSignal,
  ): Promise<void> {
    assertAvailable();
    if (!resumeAttempt) assertNoInterrupt();
    const run = beginRun(requestType, allowBaselineTail, resumedInterrupt);
    if (!resumeAttempt) lastRunInput = structuredClone({ state: source.state ?? {}, messages: source.messages ?? [], localMessages: store.messages() });
    run.resumeAttempt = resumeAttempt;
    if (resumeAttempt) {
      run.protocolRunId = resumeAttempt.runId;
      runsByProtocolId.set(resumeAttempt.runId, run);
    }
    const tools = clientToolsCap.catalogAsAgUiTools();
    const runParameters = parameters === undefined && tools.length === 0
      ? undefined
      : { ...parameters, ...(tools.length > 0 ? { tools } : {}) };
    // Compatibility profiles address the same canonical claim through their
    // native command. Ordinary input never clears a pending client ledger.
    if (resumeAttempt && runParameters?.resume === undefined) {
      const pending = (source as { pendingInterrupts?: unknown }).pendingInterrupts;
      if (Array.isArray(pending) && pending.length > 0) {
        (source as { pendingInterrupts: unknown[] }).pendingInterrupts = [];
      }
    }
    const abort = () => {
      if (activeRun !== run || run.outcome !== undefined) return;
      abortRun(run);
      source.abortRun();
    };
    try {
      if (resumeAttempt && persistence) await persistCurrent();
      if (signal?.aborted) {
        if (resumeAttempt) { interrupts.fail(resumeAttempt.id, true); publishInterrupt(); }
        throw Object.assign(new Error('Request aborted before dispatch'), { requestNotDispatched: true });
      }
      signal?.addEventListener('abort', abort, { once: true });
      if (resumeAttempt) {
        interrupts.dispatched(resumeAttempt.id); publishInterrupt();
        if (persistence) await persistCurrent();
      }
      if (disposed || activeRun !== run || run.outcome !== undefined) return;
      await source.runAgent(runParameters);
      if (disposed || activeRun !== run) return;
      if (interrupts.snapshot.phase === 'collecting' && !run.terminalReceived) { interrupts.ready(); publishInterrupt(); commitState(); void persistCurrent().catch(() => undefined); }
      settleTransportClose(run);
      await persistenceWrites;
    } catch (err) {
      if (run.outcome === 'aborted' && safeIsAbortError(err)) return;
      failRun(run, err);
    } finally {
      signal?.removeEventListener('abort', abort);
      await persistenceWrites.catch(() => undefined);
    }
  }

  const clientToolsCap = createClientToolsCapability(
    source,
    store,
    () => executeRun('client-tool-continuation', undefined, true),
    assertNoInterrupt,
  );

  // Tap all events from the source agent via the AgentSubscriber API.
  // This subscription lives for the lifetime of `source`.
  const subscription = source.subscribe({
    onRunInitialized({ input }) {
      if (disposed) return;
      resolveCallbackRun(input.runId);
    },
    onEvent({ event, input }): void | { stopPropagation: boolean } {
      if (disposed) return { stopPropagation: true };
      const callbackRunId = input?.runId ?? (event as { runId?: string }).runId;
      const run = resolveCallbackRun(callbackRunId);
      if (!run) {
        if (!callbackRunId) {
          reduceEvent(event, store);
          if (event.type === 'CUSTOM' && (event as { name?: string }).name === 'on_interrupt') {
            interrupts.observeLegacy(store.interrupt()?.value);
            interrupts.ready(); publishInterrupt();
          }
        }
        return;
      }
      if (run !== activeRun) {
        if (event.type === 'RUN_FINISHED') finalizeDeliveryRun(store, run, 'success');
        else if (event.type === 'RUN_ERROR') finalizeDeliveryRun(store, run, 'error');
        return { stopPropagation: true };
      }
      if (run.outcome === 'aborted' || run.outcome === 'error' || run.outcome === 'interrupted') return { stopPropagation: true };
      if (run.terminalReceived && (run.outcome !== 'paused' || (event.type !== 'CUSTOM' && event.type !== 'RUN_FINISHED'))) return { stopPropagation: true };
      const hasDevelopmentEvidence = event.type !== 'RUN_FINISHED' || hasValidFinishedOutcome(event);
      if (run.outcome === undefined && hasDevelopmentEvidence && supportedDevelopmentEventTypes.has(event.type)) {
        developmentRuntime.milestone('transport.connected');
      }
      if (event.type === 'RUN_ERROR' && options.protectOperationErrors) {
        failRun(run, undefined);
        return;
      }
      if (event.type === 'RUN_FINISHED') {
        const outcome = (event as unknown as { outcome?: { type: string; interrupts?: unknown[] } }).outcome;
        try {
          if (!hasValidFinishedOutcome(event)) throw new Error('Invalid run outcome');
          if (outcome?.type === 'interrupt') interrupts.observeNative(outcome.interrupts ?? [], run.protocolRunId);
        } catch (error) {
          failRun(run, error);
          return { stopPropagation: true };
        }
      }
      const wasPending = run.outcome === undefined;
      reduceEvent(event, store);
      if (event.type === 'RUN_STARTED' && run.resumeAttempt && run.outcome === undefined
        && (!(event as { runId?: string }).runId || (event as { runId?: string }).runId === run.protocolRunId)) {
        interrupts.acknowledge(run.resumeAttempt.id); publishInterrupt();
        void persistCurrent().catch(() => undefined);
      }
      if (event.type === 'CUSTOM' && (event as { name?: string }).name === 'on_interrupt') {
        const value = (event as unknown as { value: unknown }).value;
        let parsed = value;
        if (typeof value === 'string') { try { parsed = JSON.parse(value); } catch { /* Keep opaque compatibility values. */ } }
        interrupts.observeLegacy(parsed, run.protocolRunId);
        publishInterrupt();
      }
      if (event.type === 'RUN_FINISHED') {
        run.terminalReceived = true;
        run.finishedReceived = true;
        if (interrupts.snapshot.phase === 'collecting') interrupts.ready();
        else if (run.resumeAttempt && run.outcome === 'success') interrupts.complete(run.resumeAttempt.id);
        publishInterrupt();
        commitState();
        void persistCurrent().catch(() => undefined);
      }
      if (event.type === 'RUN_ERROR') {
        run.terminalReceived = true;
        if (run.resumeAttempt) { interrupts.fail(run.resumeAttempt.id, false); publishInterrupt(); }
        rollbackState();
        void persistCurrent().catch(() => undefined);
      }
      if (run && event.type === 'RUN_FINISHED' && run.outcome === 'success') {
        if (wasPending && hasDevelopmentEvidence && !store.interrupt() && !store.error()) {
          developmentRuntime.milestone('runtime.first_stream_completed', Date.now() - run.startedAt);
          if (run.resumedInterrupt) developmentRuntime.milestone('interrupt.handled');
        }
        finishRunTelemetry(run);
      } else if (event.type === 'RUN_ERROR') {
        failRunTelemetry((event as { message?: unknown }).message ?? event, run);
      }
    },
    onRunFailed({ error, input }) {
      if (disposed) return;
      const run = resolveCallbackRun(input?.runId);
      if (run) {
        if (run.outcome === 'aborted' && safeIsAbortError(error)) {
          return options.protectOperationErrors ? ({ stopPropagation: true } as never) : undefined;
        }
        failRun(run, error);
        return options.protectOperationErrors ? ({ stopPropagation: true } as never) : undefined;
      }
      if (input?.runId) {
        return options.protectOperationErrors ? ({ stopPropagation: true } as never) : undefined;
      }
      store.status.set('error');
      store.isLoading.set(false);
      store.error.set(options.protectOperationErrors ? protectedAgentError() : projectAgentError(error));
      return options.protectOperationErrors ? ({ stopPropagation: true } as never) : undefined;
    },
  });

  // Stable Subagent wrappers per messageId so chat-subagents (tracks by
  // toolCallId) doesn't churn as activity content streams.
  const subagentWrappers = new Map<string, { generation: string; wrapper: Subagent }>();
  function subagentFor(id: string, entry: ActivityEntry): Subagent {
    const cached = subagentWrappers.get(id);
    let w = cached?.generation === entry.generation ? cached.wrapper : undefined;
    if (!w) {
      w = {
        toolCallId: (entry.content()['toolCallId'] as string) ?? id,
        name: entry.content()['name'] as string | undefined,
        status: computed(() => (entry.content()['status'] as SubagentStatus) ?? 'running'),
        messages: computed<Message[]>(() => {
          const c = entry.content();
          const status = (c['status'] as SubagentStatus) ?? 'running';
          const assistantDelivery = status === 'error'
            ? completeDelivery(entry.generation, 'error')
            : status === 'complete'
              ? completeDelivery(entry.generation, 'success')
              : streamingDelivery(entry.generation);
          const raw = c['messages'];
          if (Array.isArray(raw)) {
            return (raw as Array<Record<string, unknown>>).map((m, i) => {
              const messageId = (m['id'] as string) ?? `${id}-${i}`;
              return {
                id: messageId,
                role: 'assistant' as Message['role'],
                content: typeof m['content'] === 'string' ? (m['content'] as string) : (m['content'] as Message['content']) ?? '',
                delivery: m['role'] === 'assistant' ? assistantDelivery : staticDelivery(messageId),
                ...(Array.isArray(m['toolCallIds']) ? { toolCallIds: m['toolCallIds'] as string[] } : {}),
                ...(typeof m['reasoning'] === 'string' ? { reasoning: m['reasoning'] as string } : {}),
              };
            });
          }
          return [{ id, role: 'assistant', content: String(c['text'] ?? ''), delivery: assistantDelivery }];
        }),
        toolCalls: computed<ToolCall[]>(() => {
          const raw = entry.content()['toolCalls'];
          return Array.isArray(raw) ? (raw as ToolCall[]) : [];
        }),
        state: computed(() => (entry.content()['state'] as Record<string, unknown>) ?? {}),
      };
      subagentWrappers.set(id, { generation: entry.generation, wrapper: w });
    }
    return w;
  }

  return registerDevelopmentRuntimePolicy<AgUiAgent>({
    ready,
    reconcileInterrupt: async () => {
      if (disposed) throw new Error('Agent has been disposed');
      if (reconciling()) throw new Error('Interrupt reconciliation is in progress');
      if (activeRun && activeRun.outcome === undefined) throw new Error('Stop the active request before reconciliation');
      if (!persistence) throw new Error('Interrupt recovery requires a persistence reconciler');
      reconciling.set(true);
      try {
        await persistenceWrites.catch(() => undefined);
        const record = await persistence.reconcile();
        if (disposed) return;
        if (record) hydrate(record);
        persistenceFault = undefined; persistenceWrites = Promise.resolve();
        hydrated.set(true); store.error.set(undefined); store.status.set('idle');
      } finally {
        reconciling.set(false);
      }
    },
    interruptSession: interruptSession.asReadonly(),
    isInputBlocked: computed(() => !hydrated() || reconciling() || interruptSession().phase !== 'none'),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (activeRun) abortRun(activeRun);
      subscription.unsubscribe();
      source.abortRun();
      developmentRuntime.dispose();
      store.events$.complete();
    },
    messages:  store.messages,
    status:    store.status,
    isLoading: store.isLoading,
    error:     store.error,
    toolCalls: store.toolCalls,
    state:     store.state,
    interrupt: store.interrupt,
    events$:      store.events$.asObservable(),
    customEvents: store.customEvents,
    subagents: computed<Map<string, Subagent>>(() => {
      const out = new Map<string, Subagent>();
      for (const [id, entry] of store.activities()) {
        if (entry.activityType !== 'subagent') continue;
        out.set(id, subagentFor(id, entry));
      }
      // Prune stale wrappers: keeps the cache bounded and prevents a reused
      // tool-call-id from binding to an orphaned (pre-RUN_STARTED) content signal.
      for (const id of subagentWrappers.keys()) {
        if (!out.has(id)) subagentWrappers.delete(id);
      }
      return out;
    }),
    clientTools:  clientToolsCap,

    submit: async (input: AgentSubmitInput, opts?: AgUiSubmitOptions) => {
      if (!hydrated()) await ready;
      assertAvailable();
      if (input.resume !== undefined) {
        if (opts?.interruptGeneration !== undefined && opts.interruptGeneration !== interrupts.snapshot.generation) {
          throw new Error('Stale interrupt generation: refresh the decision before submitting');
        }
        const attempt = interrupts.claim(input, randomId(), randomId());
        publishInterrupt();
        applyStatePatch(input.state);
        const userMsg = buildUserMessage(input);
        if (userMsg) {
          store.messages.update(prev => [...prev, userMsg]);
          source.addMessage(userMsg as Parameters<typeof source.addMessage>[0]);
        }
        resumeInput = structuredClone({ state: source.state ?? {}, messages: source.messages ?? [], localMessages: store.messages() });
        await executeRun(
          'resume',
          { ...attempt.parameters, runId: attempt.runId },
          true,
          true, attempt, opts?.signal,
        );
        return;
      }

      assertNoInterrupt();
      applyStatePatch(input.state);

      // Optimistic append of user message to our signals and to the source
      // agent's own message list so runAgent() sees the new message.
      const userMsg = buildUserMessage(input);
      if (userMsg) {
        store.messages.update((prev) => [...prev, userMsg]);
        // Sync to AG-UI source so it's included in the next run's input.
        source.addMessage(userMsg as Parameters<typeof source.addMessage>[0]);
      }

      // Record the input so retry() can re-run it without re-appending the
      // user message (the message is already in the list by this point).
      lastInput = input;

      await executeRun('submit', undefined, false, false, undefined, opts?.signal);
    },

    retry: async () => {
      if (!hydrated()) await ready;
      assertAvailable();
      if (interrupts.snapshot.attempt) {
        const attempt = interrupts.retry();
        publishInterrupt();
        if (resumeInput) {
          const restored = structuredClone(resumeInput);
          source.state = restored.state; source.messages = restored.messages;
          store.state.set(restored.state);
          if (restored.localMessages) store.messages.set(restored.localMessages);
          else {
            store.deliveryRun = null;
            reduceEvent({ type: 'MESSAGES_SNAPSHOT', messages: restored.messages } as never, store);
          }
        }
        store.error.set(undefined);
        await executeRun('resume', { ...attempt.parameters, runId: attempt.runId }, true, true, attempt);
        return;
      }
      if (store.isLoading()) return;   // no-op while a run is in flight
      if (lastInput === undefined) return; // nothing to retry
      assertNoInterrupt();
      store.error.set(undefined);
      if (lastRunInput) {
        const restored = structuredClone(lastRunInput);
        source.state = restored.state; source.messages = restored.messages;
        store.state.set(restored.state); store.messages.set(restored.localMessages ?? []);
      }
      // Re-run the same message list against the source without appending a
      // duplicate user message — the message is already in store.messages and
      // source's internal list from the original submit().
      await executeRun('retry', undefined, true);
    },

    stop: async () => {
      const run = activeRun;
      if (run) abortRun(run);
      source.abortRun();
      await persistenceWrites.catch(() => undefined);
    },

    regenerate: async (assistantMessageIndex: number): Promise<void> => {
      if (!hydrated()) await ready;
      assertNoInterrupt();
      if (store.isLoading()) {
        throw new Error('Cannot regenerate while agent is loading another response');
      }
      const msgs = store.messages();
      const target = msgs[assistantMessageIndex];
      if (!target || target.role !== 'assistant') {
        throw new Error(`Message at index ${assistantMessageIndex} is not an assistant message`);
      }

      // Find the user message immediately preceding the target assistant message.
      const userIdx = msgs
        .slice(0, assistantMessageIndex)
        .map((m, i) => ({ m, i }))
        .reverse()
        .find(({ m }) => m.role === 'user')?.i;
      if (userIdx === undefined) {
        throw new Error('No user message found before the target assistant message');
      }

      // Truncate local message buffer INCLUSIVE of the user message. This
      // preserves the user message in the UI (replace-semantics) while the
      // new assistant response streams in. The trailing user message becomes
      // the active prompt for the next run — we must NOT re-add it.
      const trimmed = msgs.slice(0, userIdx + 1);
      store.messages.set(trimmed);

      // Sync the trimmed list back to the source agent so its internal state
      // matches what we're about to re-run. source.setMessages() replaces the
      // agent's internal message list without appending — the trailing user
      // message in `trimmed` becomes the active prompt for the next run.
      source.setMessages(trimmed as Parameters<typeof source.setMessages>[0]);

      await executeRun('regenerate');
    },
  }, () => options.telemetry === undefined);
}

const supportedDevelopmentEventTypes = new Set([
  'RUN_STARTED', 'RUN_FINISHED', 'RUN_ERROR', 'TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT',
  'TEXT_MESSAGE_END', 'REASONING_MESSAGE_START', 'REASONING_MESSAGE_CONTENT', 'REASONING_MESSAGE_CHUNK',
  'REASONING_MESSAGE_END', 'TOOL_CALL_START', 'TOOL_CALL_ARGS', 'TOOL_CALL_END', 'TOOL_CALL_RESULT',
  'STATE_SNAPSHOT', 'STATE_DELTA', 'MESSAGES_SNAPSHOT', 'CUSTOM', 'SUBAGENT_STARTED',
  'SUBAGENT_FINISHED', 'SUBAGENT_ERROR', 'ACTIVITY_SNAPSHOT', 'ACTIVITY_DELTA',
]);

/** A malformed outcome must not turn the reducer's legacy fallback into evidence. */
function hasValidFinishedOutcome(event: object): boolean {
  const outcome = (event as { outcome?: unknown }).outcome;
  // The AG-UI schema explicitly accepts absent/null outcomes for older servers.
  if (outcome == null) return true;
  if (typeof outcome !== 'object' || Array.isArray(outcome)) return false;
  const value = outcome as Record<string, unknown>;
  if (value['type'] === 'success') return true;
  return value['type'] === 'interrupt' && Array.isArray(value['interrupts']);
}

function protectedAgentError(): AgentError {
  return new AgentError({
    kind: 'server',
    message: AGENT_ERROR_MESSAGES.server,
    retryable: true,
  });
}

function projectAgentError(error: unknown): AgentError {
  try {
    return toAgentError(error);
  } catch {
    return protectedAgentError();
  }
}

function safeIsAbortError(error: unknown): boolean {
  try {
    return isAbortError(error);
  } catch {
    return false;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function buildUserMessage(input: AgentSubmitInput): Message | undefined {
  if (input.message === undefined) return undefined;
  const content = typeof input.message === 'string'
    ? input.message
    : input.message.map((b) => b.type === 'text' ? b.text : JSON.stringify(b)).join('');
  const id = randomId();
  return { id, role: 'user', content, delivery: staticDelivery(id) };
}

function randomId(): string {
  return Math.random().toString(36).slice(2);
}

function getTailAssistantMessageId(messages: readonly Message[]): string | undefined {
  const tail = messages[messages.length - 1];
  return tail?.role === 'assistant' ? tail.id : undefined;
}
