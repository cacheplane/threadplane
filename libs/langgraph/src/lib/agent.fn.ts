import {
  inject, DestroyRef, computed, effect,
  isSignal, signal, Signal,
} from '@angular/core';
import { AGENT_CONFIG } from './agent.provider';
import { registerDevelopmentRuntimePolicy } from '@threadplane/telemetry/browser';
import type { AgentLifecycle } from './lifecycle';
import { AgentLifecycleRegistry } from './agent-lifecycle-registry';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import {
  BehaviorSubject, Subject, of,
  throttleTime, asyncScheduler,
} from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import type { Observable } from 'rxjs';
import type { BaseMessage, AIMessage as CoreAIMessage } from '@langchain/core/messages';

/**
 * Wire-shape of a `RemoveMessage` instruction. LangGraph's `add_messages`
 * reducer (Python side) coerces incoming dicts via a strict check that
 * expects `role` + `content` keys; without them, the dict-to-Message
 * conversion throws and the whole `updateState` request 400s. Construct
 * the shape directly with the required keys so we get correct semantics
 * without importing the `RemoveMessage` class from `@langchain/core/messages`
 * (the class import pulls in the full BaseMessage hierarchy, ~30-50 kB,
 * which Cockpit's example-app bundle budget rejects).
 */
type RemoveMessageInstruction = {
  type: 'remove';
  role: 'remove';
  id: string;
  content: '';
};
import type { Command, Interrupt, ToolCallWithResult } from '@langchain/langgraph-sdk';
import type { BagTemplate, InferBag } from '@langchain/langgraph-sdk';
import type {
  AgentEvent,
  AgentCheckpoint,
  AgentErrorKind,
  AgentInterrupt,
  AgentStatus,
  Message,
  Role,
  Subagent,
  ToolCall,
  ToolCallStatus,
  ContentBlock,
  AgentSubmitInput,
  AgentSubmitOptions,
  MessageDelivery,
} from '@threadplane/chat';
import { AgentError, staticDelivery } from '@threadplane/chat';

import {
  AgentOptions,
  LangGraphAgent,
  CustomStreamEvent,
  StreamSubjects,
  SubagentStreamRef,
  ResourceStatus,
  AgentQueue,
  LangGraphSubmitOptions,
} from './agent.types';
import type { ThreadState, ToolProgress } from '@langchain/langgraph-sdk';
import type { MessageMetadata } from '@langchain/langgraph-sdk/ui';
import { createStreamManagerBridge } from './internals/stream-manager.bridge';
import { LANGGRAPH_CLIENT_OPTIONS, resolveClientOptions } from './client/client-options';
import { buildBranchTree } from './internals/branch-tree';
import { extractCitations } from './internals/extract-citations';
import {
  createClientToolsCapability,
  mergeA2uiClientCapabilities,
  mergeClientTools,
  mergeStagedToolMessages,
} from './client-tools';
import type { ClientToolResultPatch, StagedToolMessageBatch } from './client-tools';
import { ɵLANGGRAPH_RUNTIME_OPERATION_REPORTER } from './runtime-operation-reporter';

/**
 * Walk LangGraph history (newest-first) and pair each AIMessage id with
 * the most recent checkpoint that contains it as the tail message in
 * `values.messages`.
 *
 * Implementation: iterate oldest → newest (i.e. reverse the input array)
 * so later writes overwrite earlier ones; the final map has each
 * AIMessage paired with the newest containing checkpoint where it is
 * still the tail. Checkpoints with no AIMessage in scope are skipped.
 * Checkpoints with no checkpoint_id are skipped.
 */
export function computeMessageCheckpoints(
  history: ReadonlyArray<ThreadState<unknown>>,
): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (let i = history.length - 1; i >= 0; i--) {
    const state = history[i];
    const cpId = state.checkpoint?.checkpoint_id;
    if (typeof cpId !== 'string' || cpId.length === 0) continue;
    const values = state.values as { messages?: unknown[] } | undefined;
    const msgs = Array.isArray(values?.messages) ? values.messages : [];
    for (let j = msgs.length - 1; j >= 0; j--) {
      const m = msgs[j] as { id?: string; _getType?: () => string; type?: string };
      const type = typeof m._getType === 'function' ? m._getType() : m.type;
      if (type === 'ai' && typeof m.id === 'string') {
        out.set(m.id, cpId);
        break;
      }
    }
  }
  return out;
}

/**
 * Internal factory that constructs a LangGraph-backed Angular agent.
 *
 * @internal Consumers do not call this directly. Configure the adapter with
 * `provideAgent({...})` in `app.config.ts` (or a component's `providers`), then
 * retrieve the agent with `injectAgent()`. This factory is the construction
 * logic invoked by `provideAgent`'s DI factory.
 *
 * Must run within an Angular injection context. Returns a unified
 * {@link LangGraphAgent} whose properties are Angular Signals that update
 * in real time as LangGraph streams messages, values, tool calls, interrupts,
 * subagent state, and checkpoint history.
 *
 * @typeParam T - The state shape returned by the agent
 * @typeParam Bag - Optional bag template for typed interrupts and submit payloads
 * @param options - Configuration for the LangGraph agent
 * @returns A {@link LangGraphAgent} with reactive signals and action methods
 *
 * @example
 * ```typescript
 * // app.config.ts — configure once
 * providers: [
 *   provideAgent({
 *     assistantId: 'chat',
 *     apiUrl: 'http://localhost:2024',
 *     threadId: signal(savedThreadId),
 *     onThreadId: (id) => localStorage.setItem('threadId', id),
 *   }),
 * ];
 *
 * // component — retrieve from DI
 * const chat = injectAgent();
 *
 * // Access signals in template
 * // chat.messages(), chat.status(), chat.error()
 * ```
 */
export function agent<
  T = Record<string, unknown>,
  Bag extends BagTemplate = BagTemplate,
>(
  options: AgentOptions<T, InferBag<T, Bag>>,
): LangGraphAgent<T, InferBag<T, Bag>> {
  // Injection context required
  const destroyRef   = inject(DestroyRef);
  const globalConfig = inject(AGENT_CONFIG, { optional: true });
  const sharedClientOptions = inject(LANGGRAPH_CLIENT_OPTIONS, { optional: true });
  const reportOperationFailure = inject(ɵLANGGRAPH_RUNTIME_OPERATION_REPORTER, { optional: true });
  const destroy$     = new Subject<void>();
  destroyRef.onDestroy(() => { destroy$.next(); destroy$.complete(); });

  // Merge: call-site options take precedence over global provider config
  const apiUrl    = options.apiUrl    ?? globalConfig?.apiUrl    ?? '';
  const transport = options.transport ?? globalConfig?.transport;
  // clientOptions precedence: agent({...}) call-site → provideAgent config →
  // app-wide LANGGRAPH_CLIENT_OPTIONS token → SDK default.
  const clientOptions = resolveClientOptions(
    options.clientOptions,
    globalConfig?.clientOptions,
    sharedClientOptions,
  );

  const init = (options.initialValues ?? {}) as T;

  // All subjects created before the bridge
  const status$          = new BehaviorSubject<ResourceStatus>(ResourceStatus.Idle);
  const values$          = new BehaviorSubject<T>(init);
  const messages$        = new BehaviorSubject<BaseMessage[]>([]);
  const error$           = new BehaviorSubject<unknown>(undefined);
  const interrupt$       = new BehaviorSubject<Interrupt<InferBag<T, Bag>['InterruptType']> | undefined>(undefined);
  const interrupts$      = new BehaviorSubject<Interrupt<InferBag<T, Bag>['InterruptType']>[]>([]);
  const branch$          = new BehaviorSubject<string>('');
  const history$         = new BehaviorSubject<ThreadState<T>[]>([]);
  const isThreadLoading$ = new BehaviorSubject<boolean>(false);
  const toolProgress$    = new BehaviorSubject<ToolProgress[]>([]);
  const toolCalls$       = new BehaviorSubject<ToolCallWithResult[]>([]);
  const messageMetadata$ = new BehaviorSubject<Map<string, MessageMetadata<Record<string, unknown>>>>(new Map());
  const subagents$       = new BehaviorSubject<Map<string, SubagentStreamRef>>(new Map());
  const queue$           = new BehaviorSubject<AgentQueue>({
    entries: [],
    size: 0,
    cancel: async () => false,
    clear: async () => undefined,
  });
  const custom$          = new BehaviorSubject<CustomStreamEvent[]>([]);
  const hasValue$        = new BehaviorSubject<boolean>(false);

  // Forward reference. The client-tools capability is built much further down
  // (it needs `manager`, which needs these subjects), but the thread-change
  // seam lives here. A holder keeps the binding itself a `const` while its
  // member is filled in later.
  const clientToolStaging: { clear?: () => void } = {};
  let retryableToolMessageBatch: StagedToolMessageBatch | undefined;

  function resetDerivedThreadState(): void {
    status$.next(ResourceStatus.Idle);
    error$.next(undefined);
    hasValue$.next(false);
    // Staged client-tool results belong to the thread whose AIMessage produced
    // their tool_call_ids. Carrying them into a different thread would prepend
    // a ToolMessage that matches no tool call there — a 400 on that turn.
    // Runs BEFORE manager.switchThread resets the store, so the capability can
    // still read the outgoing thread's tool calls.
    clientToolStaging.clear?.();
  }

  // Track hasValue — becomes true once values or messages arrive
  values$.pipe(takeUntil(destroy$)).subscribe(v => {
    if (v != null && Object.keys(v as object).length > 0) hasValue$.next(true);
  });
  messages$.pipe(takeUntil(destroy$)).subscribe(m => { if (m.length > 0) hasValue$.next(true); });

  const subjects: StreamSubjects<T, InferBag<T, Bag>> = {
    status$, values$, messages$, error$,
    interrupt$, interrupts$, branch$, history$,
    isThreadLoading$, toolProgress$, toolCalls$, messageMetadata$, subagents$, queue$, custom$,
  };

  // threadId$ — resolved before bridge creation (injection context required for toObservable)
  const threadId$ = isSignal(options.threadId)
    ? toObservable(options.threadId as Signal<string | null>)
    : of((options.threadId as string | null | undefined) ?? null);

  let hasSeenThreadId = false;
  let lastThreadId: string | null = null;
  threadId$.pipe(takeUntil(destroy$)).subscribe((id) => {
    if (hasSeenThreadId && lastThreadId !== id) {
      resetDerivedThreadState();
    }
    hasSeenThreadId = true;
    lastThreadId = id;
  });

  // ── Lifecycle instrumentation ─────────────────────────────────────────────
  // Eight signals tracking key transitions for telemetry/observability.
  // All reset together via resetLifecycle(); see switchThread() below.
  const lcStreamStartedAt      = signal<number | null>(null);
  const lcStreamErrorAt        = signal<{ at: number; kind: AgentErrorKind | string } | null>(null);
  const lcInterruptReceivedAt  = signal<number | null>(null);
  const lcInterruptResolvedAt  = signal<number | null>(null);
  const lcThreadCreatedAt      = signal<number | null>(null);
  const lcThreadPersistedAt    = signal<number | null>(null);
  const lcToolCallStartedAt    = signal<number | null>(null);
  const lcToolCallCompletedAt  = signal<number | null>(null);

  const lifecycle: AgentLifecycle = {
    streamStartedAt:     lcStreamStartedAt,
    streamErrorAt:       lcStreamErrorAt,
    interruptReceivedAt: lcInterruptReceivedAt,
    interruptResolvedAt: lcInterruptResolvedAt,
    threadCreatedAt:     lcThreadCreatedAt,
    threadPersistedAt:   lcThreadPersistedAt,
    toolCallStartedAt:   lcToolCallStartedAt,
    toolCallCompletedAt: lcToolCallCompletedAt,
  };

  // Register with the root lifecycle registry. It is `providedIn: 'root'`, so
  // every agent registers regardless of which injector built it, and external
  // instrumentation (e.g. cockpit-telemetry) sees them all. Registration is
  // scoped to this agent's injector lifetime.
  const lifecycleRegistry = inject(AgentLifecycleRegistry);
  lifecycleRegistry.register(lifecycle);
  destroyRef.onDestroy(() => lifecycleRegistry.unregister(lifecycle));

  function resetLifecycle(): void {
    lcStreamStartedAt.set(null);
    lcStreamErrorAt.set(null);
    lcInterruptReceivedAt.set(null);
    lcInterruptResolvedAt.set(null);
    lcThreadCreatedAt.set(null);
    lcThreadPersistedAt.set(null);
    lcToolCallStartedAt.set(null);
    lcToolCallCompletedAt.set(null);
  }

  // First chunk: first values$ or messages$ emission with content.
  values$.pipe(takeUntil(destroy$)).subscribe(v => {
    if (lcStreamStartedAt() === null && v != null && Object.keys(v as object).length > 0) {
      lcStreamStartedAt.set(Date.now());
    }
  });
  messages$.pipe(takeUntil(destroy$)).subscribe(m => {
    if (lcStreamStartedAt() === null && m.length > 0) lcStreamStartedAt.set(Date.now());
  });
  // Stream error: capture timestamp + failure class. The bridge normalizes every
  // failure through toAgentError(), so `kind` is the actionable AgentErrorKind;
  // anything that slipped past normalization falls back to a constructor name.
  error$.pipe(takeUntil(destroy$)).subscribe(e => {
    if (e == null) return;
    const kind = e instanceof AgentError
      ? e.kind
      : e instanceof Error
        ? e.name
        : typeof e === 'string' ? 'string' : 'unknown';
    lcStreamErrorAt.set({ at: Date.now(), kind });
  });
  // First non-null interrupt within this thread.
  interrupt$.pipe(takeUntil(destroy$)).subscribe(ix => {
    if (ix != null && lcInterruptReceivedAt() === null) lcInterruptReceivedAt.set(Date.now());
  });
  // First tool call append; first completed/error result transition.
  const seenToolCallStates = new Map<string, string>();
  toolCalls$.pipe(takeUntil(destroy$)).subscribe(tcs => {
    if (tcs.length > 0 && lcToolCallStartedAt() === null) lcToolCallStartedAt.set(Date.now());
    if (lcToolCallCompletedAt() !== null) return;
    for (const tc of tcs) {
      const prev = seenToolCallStates.get(tc.id);
      if (prev !== tc.state && (tc.state === 'completed' || tc.state === 'error')) {
        lcToolCallCompletedAt.set(Date.now());
        seenToolCallStates.set(tc.id, tc.state);
        break;
      }
      seenToolCallStates.set(tc.id, tc.state);
    }
  });
  // Thread restored from server: history$ populates with content for a
  // pre-existing threadId.
  history$.pipe(takeUntil(destroy$)).subscribe(h => {
    if (h.length > 0 && lcThreadPersistedAt() === null) lcThreadPersistedAt.set(Date.now());
  });

  const manager = createStreamManagerBridge({
    options: { ...options, apiUrl, transport, clientOptions },
    subjects,
    threadId$,
    destroy$: destroy$.asObservable(),
    ...(transport === undefined && reportOperationFailure !== null
      ? { reportOperationFailure }
      : {}),
  });

  // Throttle helper — default 16ms (~60fps) to batch SSE token updates into
  // at most one signal update per frame, preventing change detection storms.
  const ms = typeof options.throttle === 'number' ? options.throttle : 16;
  const maybeThrottle = <V>(obs: BehaviorSubject<V>) =>
    ms > 0
      ? obs.pipe(throttleTime(ms, asyncScheduler, { leading: true, trailing: true }))
      : obs.asObservable();

  // Convert to Angular Signals (must happen in injection context)
  const value        = toSignal(maybeThrottle(values$),   { initialValue: init });
  // No throttle on messages$: we need every token emission to propagate to
  // Angular so streaming markdown actually streams. The bridge already
  // batches per-tuple at the SDK level; further throttling at the signal
  // boundary collapses tokens together and breaks visible token-by-token
  // rendering. Same-frame multiple emissions are coalesced by Angular's
  // CD anyway.
  const rawMessages  = toSignal(messages$, { initialValue: [] as BaseMessage[] });
  const statusSig    = toSignal(status$,          { initialValue: ResourceStatus.Idle });
  // Cast justified: error$ accepts only AgentError | undefined (bridge catch normalizes all errors via
  // toAgentError before calling next(); resetDerivedThreadState passes undefined). The BehaviorSubject
  // is typed unknown to satisfy StreamSubjects<unknown> invariance at the subjects-bag assignment.
  const errorSig     = toSignal(error$,           { initialValue: undefined }) as Signal<AgentError | undefined>;
  const hasValueSig  = toSignal(hasValue$,        { initialValue: false });
  const interruptSig = toSignal(interrupt$,       { initialValue: undefined });
  const interruptsSig= toSignal(interrupts$,      { initialValue: [] });
  const branchSig    = toSignal(branch$,          { initialValue: '' });
  const historySig   = toSignal(history$,         { initialValue: [] });
  const threadLoadSig= toSignal(isThreadLoading$, { initialValue: false });
  const toolProgSig  = toSignal(toolProgress$,    { initialValue: [] });
  const rawToolCalls = toSignal(toolCalls$,       { initialValue: [] });
  const subagentsSig = toSignal(subagents$,       { initialValue: new Map<string, SubagentStreamRef>() });
  const queueSig     = toSignal(queue$,           { initialValue: queue$.value });
  const customSig    = toSignal(custom$,           { initialValue: [] as CustomStreamEvent[] });

  const isLoading    = computed(() => statusSig() === ResourceStatus.Loading);
  const activeSubagents = computed(() =>
    [...subagentsSig().values()].filter(s => s.status() === 'running')
  );

  // ── Runtime-neutral projections ───────────────────────────────────────────

  // Project BaseMessage → Message on every recompute. We deliberately do
  // NOT cache: the LangGraph SDK mutates the same AIMessage instance in
  // place during token streaming (appends content to the same object), so
  // any identity-based cache returns stale projections and Angular's
  // `@let content = messageContent(message)` short-circuits — DOM never
  // updates per token. DOM stability is provided by `track message.id`
  // in chat-message-list, not by Message identity.
  const messagesNeutral = computed<Message[]>(() => {
    manager.deliveryRevision();
    return rawMessages().map((m) =>
      toMessage(m, manager.getReasoningDurationMs, manager.getMessageDelivery)
    );
  });

  // Client-tool resolutions written client-side. The raw `toolCalls$` stream
  // (and thus `rawToolCalls`) only ever carries backend results — a resolved
  // client tool (`ask`/`view`) never receives a backend ToolMessage on its
  // LOCAL call. These overrides layer the client-side outcome over the raw
  // projection so the transcript card can freeze (see chat-tool-views
  // toToolViewSpec, which spreads `result` into the mounted component's props).
  const clientResultOverrides = signal<ReadonlyMap<string, ClientToolResultPatch>>(new Map());

  const toolCallsNeutral = computed<ToolCall[]>(() => {
    const overrides = clientResultOverrides();
    return rawToolCalls().map((tc) => {
      const neutral = toToolCall(tc);
      const patch = overrides.get(neutral.id);
      return patch ? { ...neutral, ...patch } : neutral;
    });
  });

  const statusNeutral = computed<AgentStatus>(() => mapStatus(statusSig()));

  const stateNeutral = computed<Record<string, unknown>>(() => {
    const v = value();
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  });

  const interruptNeutral = computed<AgentInterrupt | undefined>(() => {
    const ix = interruptSig();
    return ix ? toInterrupt(ix) : undefined;
  });

  const subagentsNeutral = computed<Map<string, Subagent>>(() => {
    const out = new Map<string, Subagent>();
    subagentsSig().forEach((sa, key) => out.set(key, toSubagent(sa, manager)));
    return out;
  });

  const historyNeutral = computed<AgentCheckpoint[]>(() =>
    historySig().map(toCheckpoint),
  );
  const messageCheckpointsSig = computed<ReadonlyMap<string, string>>(() =>
    computeMessageCheckpoints(historySig() as ThreadState<unknown>[]),
  );
  const experimentalBranchTree = computed(() =>
    buildBranchTree(historySig() as ThreadState<T>[]),
  );

  const events$ = buildEvents$(customSig);

  // ── Client tools capability ──────────────────────────────────────────────
  // The capability takes a direct reference to manager.submit so it can issue
  // follow-up runs (resolve) without going through the full submit() wrapper.
  // The catalog is injected into every outbound payload via mergeClientTools()
  // in the submit wrapper below and in the resolve path inside the capability.
  //
  // flush() needs a durable write that does NOT start a run. The bridge's
  // updateState() silently no-ops when the transport has no updateState, so
  // only supply a persist function when the effective transport supports it —
  // an omitted transport means the bridge builds a FetchStreamTransport, which
  // does. When persistFn is undefined, a non-empty flush() rejects while the
  // results stay staged; an ordinary non-null submit remains their in-memory
  // fallback path.
  const canPersistToolMessages = !transport || typeof transport.updateState === 'function';
  const clientToolsCap = createClientToolsCapability(
    (payload, opts, batch) => {
      retryableToolMessageBatch = batch;
      return manager.submit(payload, opts);
    },
    {
      toolCalls: toolCallsNeutral,
      isLoading,
      applyClientResult: (id, patch) =>
        clientResultOverrides.update((m) => new Map(m).set(id, patch)),
    },
    canPersistToolMessages
      ? async (messages) => {
          // Throw rather than let the bridge no-op: without a thread there is
          // nothing to write to, and flush() must keep the buffer staged.
          if (!manager.currentThreadId) {
            throw new Error('no threadId for client tool flush');
          }
          // No asNode: add_messages appends the ToolMessages and the graph's
          // resume point is left untouched, so no run is started.
          await manager.updateState({ messages: [...messages] });
        }
      : undefined,
    // Stamps each staged result with the thread it was settled on, so a write
    // can never land on a thread the user has since moved to.
    () => manager.currentThreadId,
  );
  clientToolStaging.clear = () => {
    retryableToolMessageBatch = undefined;
    clientToolsCap.clearStagedToolMessages();
  };

  async function resubmitWithToolRecovery(): Promise<void> {
    const batch = retryableToolMessageBatch;
    const outcome = await manager.resubmitLast();
    if (outcome === 'success') batch?.acknowledge();
  }

  return registerDevelopmentRuntimePolicy<LangGraphAgent<T, InferBag<T, Bag>>>({
    // ── Runtime-neutral surface (AgentWithHistory) ────────────────────────
    messages:  messagesNeutral,
    status:    statusNeutral,
    isLoading,
    error:     errorSig,
    toolCalls: toolCallsNeutral,
    state:     stateNeutral as Signal<T>,
    interrupt: interruptNeutral,
    subagents: subagentsNeutral,
    events$,
    history:            historyNeutral,
    messageCheckpoints: messageCheckpointsSig,
    submit: async (input: AgentSubmitInput | null | undefined, opts?: AgentSubmitOptions & LangGraphSubmitOptions) => {
      // Lifecycle: first submit with no existing threadId → thread create.
      if (lcThreadCreatedAt() === null && lastThreadId == null) {
        lcThreadCreatedAt.set(Date.now());
      }
      // Lifecycle: any resume submit marks an interrupt resolution.
      if (input?.resume !== undefined || opts?.resume !== undefined) {
        lcInterruptResolvedAt.set(Date.now());
      }
      const request = buildSubmitRequest(input, opts);
      // Thread the client-tools catalog into every outbound payload so the
      // backend middleware can merge them into the model's tool list. Null
      // payloads (regenerate re-runs, command resumes) are left unchanged.
      //
      // Snapshot results settled but not yet durable (flush unavailable or a
      // prior flush failed) so they ride along without being forgotten. The
      // exact snapshot is acknowledged only when this operation succeeds;
      // overlaps may safely carry the same deterministic message IDs. A null
      // payload cannot carry results, so it leaves staging unchanged.
      const batch = request.payload === null || request.payload === undefined
        ? undefined
        : clientToolsCap.snapshotToolMessages();
      const staged = batch?.messages ?? [];
      const withStaged = staged.length > 0
        ? mergeStagedToolMessages(request.payload, staged)
        : request.payload;
      const payload = mergeA2uiClientCapabilities(
        mergeClientTools(withStaged, clientToolsCap.catalog()),
        options.a2uiClientCapabilities,
      );
      const createsQueuedRun =
        request.options?.multitaskStrategy === 'enqueue' && isLoading();
      if (!createsQueuedRun) {
        retryableToolMessageBatch = batch;
      }
      const outcome = await manager.submit(payload, request.options);
      if (outcome === 'success') batch?.acknowledge();
    },
    stop: () => manager.stop(),

    // Mirrors the bridge exactly, including its absence: a transport that
    // cannot read history reports `recovery: 'none'`, and offering a control
    // for it would promise an answer the adapter cannot get.
    ...(manager.checkStatus ? { checkStatus: manager.checkStatus } : {}),

    retry: async () => {
      if (isLoading()) return;          // no-op while a run is in flight
      error$.next(undefined);           // clear the error before re-running
      await resubmitWithToolRecovery();
    },

    clientTools: clientToolsCap,

    regenerate: async (assistantMessageIndex: number): Promise<void> => {
      if (isLoading()) {
        throw new Error('Cannot regenerate while agent is loading another response');
      }
      const msgs = messagesNeutral();
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

      // Snapshot the raw BaseMessages that will be REMOVED (everything after userIdx).
      const rawToRemove = messages$.value.slice(userIdx + 1);

      // Truncate local buffer INCLUSIVE of the user message. The computed
      // messagesNeutral signal immediately reflects this — user message is
      // preserved in the UI while the new response streams in.
      messages$.next(messages$.value.slice(0, userIdx + 1));

      // Build RemoveMessage wire-shape instructions for server-side rollback.
      // LangGraph's add_messages reducer recognises `{ type: 'remove', id }`
      // and removes those entries from the thread state — ensuring the
      // runtime re-runs against the same trimmed state rather than appending
      // new messages on top.
      const removeList: RemoveMessageInstruction[] = rawToRemove
        .map(m => {
          const raw = m as unknown as Record<string, unknown>;
          const id = typeof raw['id'] === 'string' ? raw['id'] : undefined;
          return id
            ? { type: 'remove' as const, role: 'remove' as const, id, content: '' as const }
            : null;
        })
        .filter((rm): rm is RemoveMessageInstruction => rm !== null);

      // RemoveMessage rollback + reposition the graph to the entry node
      // via `as_node: '__start__'`. After the original run, the thread is
      // at `__end__` with `next: []` — submitting `null` would be a no-op
      // because there is nothing pending to execute. Setting `asNode` to
      // the start node tells LangGraph to treat the update as if `__start__`
      // had just produced the values, so the next pull resumes at the entry
      // node and runs `generate` against the rolled-back state.
      //
      // We always pass `asNode` even when removeList is empty (rare, but
      // possible if the assistant message had no id) so the regenerate
      // submit below still runs the graph.
      await manager.updateState(
        { messages: removeList },
        { asNode: '__start__' },
      );

      // Re-run the graph with no new input. With the thread now repositioned
      // at `__start__`, this resumes at the entry node and produces a fresh
      // assistant message — the trailing user message becomes the active
      // prompt without being re-appended.
      retryableToolMessageBatch = undefined;
      await manager.submit(null, undefined);
    },

    // ── Raw LangGraph signals ─────────────────────────────────────────────
    langGraphMessages:   rawMessages as Signal<BaseMessage[]>,
    langGraphInterrupts: interruptsSig,
    langGraphToolCalls:  rawToolCalls,
    langGraphHistory:    historySig,
    experimentalBranchTree,

    // ── Other LangGraph-specific fields ──────────────────────────────────
    value:           value as Signal<T>,
    hasValue:        hasValueSig,
    reload:          () => {
      void resubmitWithToolRecovery();
    },
    toolProgress:    toolProgSig,
    queue:           queueSig,
    activeSubagents,
    getSubagent:     (toolCallId) => subagentsSig().get(toolCallId),
    getSubagentsByType: (type) =>
      [...subagentsSig().values()].filter(sa => sa.name === type),
    getSubagentsByMessage: (msg) => resolveSubagentsByMessage(msg, subagentsSig()),
    customEvents:    customSig,
    branch:          branchSig,
    setBranch:       (b) => branch$.next(b),
    isThreadLoading: threadLoadSig,
    switchThread:    (id) => {
      resetDerivedThreadState();
      resetLifecycle();
      seenToolCallStates.clear();
      manager.switchThread(id);
    },
    lifecycle,
    joinStream:          (id, last) => manager.joinStream(id, last),
    getMessagesMetadata: (msg, idx) => {
      const id = (msg as unknown as Record<string, unknown>)['id'];
      const key = id != null ? String(id) : idx != null ? String(idx) : undefined;
      return key ? messageMetadata$.value.get(key) : undefined;
    },
    getToolCalls: (msg) => {
      const id = (msg as unknown as Record<string, unknown>)['id'];
      return id == null
        ? []
        : toolCalls$.value.filter(tc => (tc.aiMessage as unknown as Record<string, unknown>)['id'] === id);
    },
  }, () => options.telemetry === undefined);
}

// ── Private translation helpers (moved from to-agent.ts) ─────────────────────

/**
 * Build an Observable<AgentEvent> that bridges LangGraph's
 * `Signal<CustomStreamEvent[]>` (append-only array) into a stream of newly
 * emitted events. Each effect firing compares against a cursor tracking the
 * previously-seen length and emits only the tail slice.
 */
function buildEvents$(customSig: Signal<CustomStreamEvent[]>): Observable<AgentEvent> {
  const subject = new Subject<AgentEvent>();
  let seen = 0;
  effect(() => {
    const all = customSig();
    if (all.length < seen) {
      // Stream reset (new session, thread switch, etc.). Rewind cursor.
      seen = 0;
    }
    for (let i = seen; i < all.length; i++) {
      subject.next(toAgentEvent(all[i]));
    }
    seen = all.length;
  });
  return subject.asObservable();
}

function toAgentEvent(e: CustomStreamEvent): AgentEvent {
  if (e.name === 'state_update' && isRecord(e.data)) {
    return { type: 'state_update', data: e.data };
  }
  return { type: 'custom', name: e.name, data: e.data };
}

function mapStatus(s: ResourceStatus): AgentStatus {
  switch (s) {
    case ResourceStatus.Error: return 'error';
    case ResourceStatus.Loading:
    case ResourceStatus.Reloading:
      return 'running';
    default:
      return 'idle';
  }
}

function toMessage(
  m: BaseMessage,
  getReasoningDurationMs?: (id: string) => number | undefined,
  getDelivery?: (id: string) => MessageDelivery,
): Message {
  const raw = m as unknown as Record<string, unknown>;
  const typeVal = typeof m._getType === 'function'
    ? m._getType()
    : (raw['type'] as string | undefined) ?? 'ai';
  const role: Role =
    typeVal === 'human' ? 'user' :
    typeVal === 'tool'  ? 'tool' :
    typeVal === 'system' ? 'system' :
    'assistant';
  const id = (m.id as string | undefined) ?? (raw['id'] as string | undefined) ?? randomId();
  const reasoning = typeof raw['reasoning'] === 'string' && (raw['reasoning'] as string).length > 0
    ? (raw['reasoning'] as string)
    : undefined;
  const reasoningDurationMs = reasoning && getReasoningDurationMs
    ? getReasoningDurationMs(id)
    : undefined;
  const result: Message = {
    id,
    role,
    delivery: getDelivery?.(id) ?? staticDelivery(id),
    content: extractTextContent(m.content),
    toolCallId: raw['tool_call_id'] as string | undefined,
    name: raw['name'] as string | undefined,
    reasoning,
    reasoningDurationMs,
    extra: raw,
  };
  const citations = extractCitations(raw as { additional_kwargs?: Record<string, unknown> });
  if (citations) result.citations = citations;
  if (role === 'assistant') {
    const tcIds = getToolCallIds(m as CoreAIMessage);
    if (tcIds.length > 0) result.toolCallIds = tcIds;
  }
  return result;
}

/**
 * Extract user-visible text from a `BaseMessage.content` value.
 *
 * LangChain's `BaseMessage.content` is `string | MessageContentComplex[]`.
 * Reasoning-capable models (OpenAI gpt-5/o-series, Anthropic) emit complex
 * arrays of typed blocks: `{type: 'text', text}`, `{type: 'reasoning', ...}`,
 * tool-use blocks, etc. We render only the visible text portions and skip
 * anything else. JSON-stringifying the whole array (the previous behaviour)
 * would dump raw `[{"type":"text",...}]` into the chat bubble.
 */
function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  let out = '';
  for (const block of content) {
    if (typeof block === 'string') {
      out += block;
      continue;
    }
    if (!isRecord(block)) continue;
    const t = block['type'];
    // Common text-bearing block shapes across providers.
    if (t === 'text' || t === 'output_text' || t === undefined) {
      const text = block['text'];
      if (typeof text === 'string') out += text;
    }
    // Skip reasoning, tool_use, image, etc. — not chat-bubble content.
  }
  return out;
}

function toToolCall(tc: ToolCallWithResult): ToolCall {
  const stateMap: Record<string, ToolCallStatus> = {
    pending: 'pending',
    completed: 'complete',
    error: 'error',
  };
  const status: ToolCallStatus = stateMap[tc.state] ?? 'running';
  const result = tc.result as (Record<string, unknown> | undefined);
  return {
    id: tc.id,
    name: tc.call.name,
    args: tc.call.args,
    status,
    result: result?.['content'],
    error: tc.state === 'error' ? result?.['content'] : undefined,
  };
}

function toInterrupt(ix: Interrupt<unknown>): AgentInterrupt {
  const raw = ix as unknown as Record<string, unknown>;
  return {
    id: (raw['id'] as string | undefined) ?? randomId(),
    value: raw['value'] ?? ix,
    resumable: true,
  };
}

function toSubagent(
  sa: SubagentStreamRef,
  manager: ReturnType<typeof createStreamManagerBridge>,
): Subagent {
  return {
    toolCallId: sa.toolCallId,
    name: sa.name,
    status: sa.status,
    messages: computed(() => {
      manager.deliveryRevision();
      return sa.messages().map((m) =>
        toMessage(
          m,
          undefined,
          () => manager.getSubagentMessageDelivery(sa.toolCallId, m),
        )
      );
    }) as Signal<Message[]>,
    state: sa.values as Signal<Record<string, unknown>>,
  };
}

/**
 * Resolve the subagents spawned by an AI message's tool calls.
 *
 * Anchors on the contract field `SubagentStreamRef.toolCallId`, not the map
 * KEY: the key is an adapter detail (LangGraph keys by the tool-call id,
 * AG-UI keys activities by `<toolCallId>-sub`) and only the field is
 * guaranteed to equal the id on the message's `tool_calls` — the same rule
 * `<chat-tool-calls>` applies when it re-indexes `agent.subagents()`.
 *
 * @internal Exported for unit tests only — not part of the public API.
 */
export function resolveSubagentsByMessage(
  msg: CoreAIMessage,
  subagents: ReadonlyMap<string, SubagentStreamRef>,
): SubagentStreamRef[] {
  const byToolCallId = new Map<string, SubagentStreamRef>();
  subagents.forEach(sa => byToolCallId.set(sa.toolCallId, sa));
  return getToolCallIds(msg)
    .map(id => byToolCallId.get(id))
    .filter((subagent): subagent is SubagentStreamRef => subagent != null);
}

function getToolCallIds(msg: CoreAIMessage): string[] {
  const raw = msg as unknown as Record<string, unknown>;
  const toolCalls = raw['tool_calls'];
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls
    .map(toolCall => isRecord(toolCall) && typeof toolCall['id'] === 'string' ? toolCall['id'] : undefined)
    .filter((id): id is string => id != null);
}

function buildSubmitRequest(
  input: AgentSubmitInput | null | undefined,
  opts?: AgentSubmitOptions & LangGraphSubmitOptions,
): { payload: unknown; options?: AgentSubmitOptions & LangGraphSubmitOptions } {
  return {
    payload: buildSubmitPayload(input),
    options: normalizeSubmitOptions(input, opts),
  };
}

function buildSubmitPayload(input: AgentSubmitInput | null | undefined): unknown {
  if (input == null) return null;
  if (input.resume !== undefined) return null;
  return buildSubmitUpdate(input) ?? {};
}

function normalizeSubmitOptions(
  input: AgentSubmitInput | null | undefined,
  opts?: AgentSubmitOptions & LangGraphSubmitOptions,
): (AgentSubmitOptions & LangGraphSubmitOptions) | undefined {
  const inputResume = input?.resume;
  const optionResume = opts?.resume;
  const resume = inputResume !== undefined ? inputResume : optionResume;
  if (resume === undefined) return opts;

  const next = { ...(opts ?? {}) };
  delete next.resume;
  const command = next.command;
  const update = buildSubmitUpdate(input);
  const commandUpdate = mergeCommandUpdate(command?.update, update);
  return {
    ...next,
    command: {
      ...command,
      resume,
      ...(commandUpdate === undefined ? {} : { update: commandUpdate }),
    },
  };
}

function buildSubmitUpdate(input: AgentSubmitInput | null | undefined): Record<string, unknown> | undefined {
  if (input == null) return undefined;
  if (input.message !== undefined) {
    const content = typeof input.message === 'string'
      ? input.message
      : input.message.map((b: ContentBlock) => (b.type === 'text' ? b.text : JSON.stringify(b))).join('');
    // `type: 'human'` is what `toMessage()` reads via `_getType` || raw['type'];
    // `role: 'human'` is what the LangGraph server expects in submit payloads.
    // Include both so the optimistic local copy projects as a 'user' bubble
    // (otherwise toMessage falls through to the 'ai' default and renders the
    // user's question as an assistant message).
    return { messages: [{ type: 'human', role: 'human', content }], ...(input.state ?? {}) };
  }
  return input.state;
}

function mergeCommandUpdate(
  existing: Command['update'] | undefined,
  update: Record<string, unknown> | undefined,
): Command['update'] | undefined {
  if (update === undefined) return existing;
  if (existing == null) return update;
  if (isRecord(existing)) return { ...existing, ...update };
  if (Array.isArray(existing)) return [...existing, ...Object.entries(update)];
  return update;
}

function randomId(): string {
  return Math.random().toString(36).slice(2);
}

function toCheckpoint(state: ThreadState<unknown>): AgentCheckpoint {
  return {
    id:    state.checkpoint?.checkpoint_id ?? undefined,
    label: state.next?.[0] ?? undefined,
    values: isRecord(state.values) ? state.values : {},
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
