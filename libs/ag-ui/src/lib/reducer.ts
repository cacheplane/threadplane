// @ag-ui/client@0.0.52 — EventType is a string enum with uppercase values.
// Discriminator strings (e.g. 'RUN_STARTED') match EventType enum members
// verbatim; the switch cases below use the string literals directly so this
// file has no runtime dependency on the EventType enum import.
import { signal, type WritableSignal } from '@angular/core';
import type { Subject } from 'rxjs';
import {
  completeDelivery,
  staticDelivery,
  streamingDelivery,
  toAgentError,
  type AgentError,
  type CompleteOutcome,
} from '@threadplane/chat';
import type {
  Message, AgentStatus, ToolCall, AgentEvent, AgentInterrupt,
} from '@threadplane/chat';
import type { BaseEvent } from '@ag-ui/client';
import { applyPatch, type JsonPatchOp } from './internal/apply-patch';
import { bridgeCitationsState } from './bridge-citations-state';

/**
 * AG-UI AssistantMessage shape as it arrives on the wire in a MESSAGES_SNAPSHOT.
 * The `toolCalls` field carries full ToolCall objects (id + function { name, arguments }).
 * This is distinct from the chat lib's `Message.toolCallIds` which is a plain string[].
 */
interface AgUiSnapshotToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface AgUiSnapshotMessage {
  id: string;
  role: string;
  content?: string;
  toolCalls?: AgUiSnapshotToolCall[];
  [key: string]: unknown;
}

/**
 * A custom event surfaced to consumers via the agent's `customEvents` signal.
 * Mirrors the LangGraph adapter's CustomStreamEvent shape so the chat
 * a2ui partial-args bridge consumes both transports identically.
 */
export interface CustomStreamEvent {
  /** Event name set by the backend (e.g. 'a2ui-partial', 'state_update'). */
  name: string;
  /** Arbitrary payload from the backend (JSON-string values are parsed). */
  data: unknown;
}

/** A native AG-UI ACTIVITY (typed, identified, incrementally-streamed sub-process).
 *  Generic — keyed by messageId, grouped by activityType. toAgent projects
 *  activityType==='subagent' to the neutral Subagent contract. */
export interface ActivityEntry {
  messageId: string;
  activityType: string;
  generation: string;
  content: WritableSignal<Record<string, unknown>>;
}

export interface ReducerDeliveryRun {
  generation: string;
  baselineMessageIds: Set<string>;
  ownedMessageIds: Set<string>;
  snapshotReplacementIds: Set<string>;
  eligibleBaselineAssistantId?: string;
  currentAssistantMessageId?: string;
  pendingReasoning?: { messageId: string; startedAt: number };
  protocolRunId?: string;
  outcome?: CompleteOutcome;
}

export interface ReducerStore {
  messages:     WritableSignal<Message[]>;
  status:       WritableSignal<AgentStatus>;
  isLoading:    WritableSignal<boolean>;
  error:        WritableSignal<AgentError | undefined>;
  toolCalls:    WritableSignal<ToolCall[]>;
  state:        WritableSignal<Record<string, unknown>>;
  interrupt:    WritableSignal<AgentInterrupt | undefined>;
  events$:      Subject<AgentEvent>;
  customEvents: WritableSignal<CustomStreamEvent[]>;
  activities: WritableSignal<Map<string, ActivityEntry>>;
  deliveryRun: ReducerDeliveryRun | null;
  allocateDeliveryGeneration(scope: string): string;
  /** Accumulated raw TOOL_CALL_ARGS text per toolCallId. A live model streams
   *  args as many partial-JSON fragments, so each delta must be appended here
   *  and the ACCUMULATED buffer parsed — parsing a lone delta only succeeds
   *  when the whole payload happens to arrive in one chunk (e.g. test
   *  fixtures). Lazily created by the reducer; entries dropped on
   *  TOOL_CALL_END. */
  argsBuffers?: Map<string, string>;
}

/** Finalize one run without touching messages owned by another generation. */
export function finalizeDeliveryRun(
  store: ReducerStore,
  run: ReducerDeliveryRun,
  outcome: CompleteOutcome,
): boolean {
  if (run.outcome !== undefined) return false;
  run.outcome = outcome;
  delete run.pendingReasoning;
  store.messages.update(messages => messages.map(message =>
    message.delivery.generation === run.generation
      ? { ...message, delivery: completeDelivery(run.generation, outcome) }
      : message,
  ));
  return true;
}

/**
 * Applies a single AG-UI BaseEvent to the supplied signal store. The adapter
 * forwards source subscriber events here; reasoning timing reads Date.now()
 * at this imperative boundary and retains its pending start on the delivery run.
 */
export function reduceEvent(event: BaseEvent, store: ReducerStore): void {
  // A subagentRunId on a content event means the child produced it: route it
  // into that subagent's activity entry and never into the parent transcript —
  // the same structural rule @threadplane/langgraph applies to namespaced
  // events. Scope: text, tool and reasoning message events. Step attribution
  // is not routed yet.
  const subagentRunId = (event as { subagentRunId?: string }).subagentRunId;
  if (subagentRunId && SUBAGENT_ROUTED_TYPES.has(event.type as string)) {
    routeSubagentContentEvent(subagentRunId, event, store);
    return;
  }
  switch (event.type) {
    case 'RUN_STARTED': {
      const run = store.deliveryRun;
      if (!run || run.outcome !== undefined || !bindRunId(event, run)) return;
      store.status.set('running');
      store.isLoading.set(true);
      store.error.set(undefined);
      store.interrupt.set(undefined);
      store.customEvents.set([]);
      store.activities.set(new Map());
      // A run boundary is the reset point for in-flight args accumulation:
      // a TOOL_CALL_ARGS fragment whose TOOL_CALL_END never arrived (aborted
      // or errored run) must not prefix a same-id call in the next run.
      store.argsBuffers?.clear();
      return;
    }
    case 'RUN_FINISHED': {
      const run = currentRunForEvent(event, store);
      if (store.deliveryRun && !run) return;
      const outcome = runFinishedOutcome(event);
      if (outcome?.type === 'interrupt') {
        // Protocol-standard interrupt signal: RUN_FINISHED carrying
        // outcome = { type: 'interrupt', interrupts: [...] }. AWS Strands and
        // Microsoft Agent Framework emit ONLY this; Mastra emits it in
        // addition to the CUSTOM on_interrupt bridge convention below.
        // First signal wins within a run — a CUSTOM on_interrupt that already
        // paused this run must not have its interrupt clobbered here.
        if (!run || run.outcome === undefined) {
          store.interrupt.set(toOutcomeInterrupt(outcome, eventRunId(event)));
        }
        if (run && finalizeDeliveryRun(store, run, 'paused')) {
          store.status.set('idle');
          store.isLoading.set(false);
        }
        return;
      }
      if (!run || !finalizeDeliveryRun(store, run, 'success')) return;
      store.status.set('idle');
      store.isLoading.set(false);
      return;
    }
    case 'RUN_ERROR': {
      const run = currentRunForEvent(event, store);
      if (!run || !finalizeDeliveryRun(store, run, 'error')) return;
      store.status.set('error');
      store.isLoading.set(false);
      const runErrorMsg = (event as { message?: unknown }).message;
      store.error.set(toAgentError(
        typeof runErrorMsg === 'string' ? new Error(runErrorMsg) : (runErrorMsg ?? event),
      ));
      return;
    }
    case 'TEXT_MESSAGE_START': {
      const id = messageIdFrom(event);
      const delivery = ownAssistantMessage(store, id);
      if (!delivery) return;
      store.messages.update((prev) =>
        prev.some((m) => m.id === id)
          ? prev.map((m) => m.id === id ? { ...m, content: m.content ?? '', delivery } : m)
          : [...prev, { id, role: 'assistant', content: '', delivery }],
      );
      return;
    }
    case 'REASONING_MESSAGE_START': {
      const run = currentRunForEvent(event, store);
      if (!run || run.outcome !== undefined) return;
      const id = messageIdFrom(event);
      const delivery = ownAssistantMessage(store, id);
      if (!delivery) return;
      run.pendingReasoning = { messageId: id, startedAt: Date.now() };
      // Initialize an assistant slot with empty reasoning if it doesn't already exist.
      store.messages.update((prev) =>
        prev.some((m) => m.id === id)
          ? prev.map((m) => m.id === id
              ? { ...m, reasoning: m.reasoning ?? '', reasoningDurationMs: undefined, delivery }
              : m)
          : [...prev, { id, role: 'assistant', content: '', reasoning: '', delivery }],
      );
      return;
    }
    case 'REASONING_MESSAGE_CONTENT':
    case 'REASONING_MESSAGE_CHUNK': {
      const run = currentRunForEvent(event, store);
      if (!run || run.outcome !== undefined) return;
      const id = messageIdFrom(event);
      const delivery = ownAssistantMessage(store, id);
      if (!delivery) return;
      const delta = (event as { delta?: string }).delta ?? '';
      store.messages.update((prev) =>
        prev.map((m) => m.id === id
          ? { ...m, reasoning: (m.reasoning ?? '') + delta, delivery }
          : m),
      );
      return;
    }
    case 'REASONING_MESSAGE_END': {
      const run = currentRunForEvent(event, store);
      if (!run || run.outcome !== undefined) return;
      const id = messageIdFrom(event);
      const pending = run.pendingReasoning;
      if (!pending || pending.messageId !== id
        || run.currentAssistantMessageId !== id || !run.ownedMessageIds.has(id)) return;
      const message = store.messages().find(m => m.id === id && m.role === 'assistant'
        && m.delivery.generation === run.generation && m.delivery.phase === 'streaming');
      if (!message) return;
      const duration = Date.now() - pending.startedAt;
      delete run.pendingReasoning;
      store.messages.update(messages => messages.map(m =>
        m === message ? { ...m, reasoningDurationMs: duration } : m,
      ));
      return;
    }
    case 'TEXT_MESSAGE_CONTENT': {
      const id = messageIdFrom(event);
      const delivery = ownAssistantMessage(store, id);
      if (!delivery) return;
      const delta = (event as { delta?: string }).delta ?? '';
      store.messages.update((prev) =>
        prev.map((m) => m.id === id ? { ...m, content: m.content + delta, delivery } : m),
      );
      return;
    }
    case 'TEXT_MESSAGE_END': {
      // No-op — message is finalized by virtue of TEXT_MESSAGE_CONTENT
      // having been applied. Reserved for future hooks.
      return;
    }
    case 'TOOL_CALL_START': {
      const e = event as unknown as { toolCallId: string; toolCallName: string; parentMessageId?: string };
      store.toolCalls.update((prev) => [
        ...prev,
        { id: e.toolCallId, name: e.toolCallName, args: {}, status: 'running' },
      ]);
      // Link the tool call to its parent assistant message so the chat lib's
      // per-message tool-call resolution (chat-tool-calls / chat-tool-views)
      // can scope it. ag-ui-langgraph emits parentMessageId for every tool
      // call. If the parent assistant message hasn't been created yet (a
      // tool-call-only turn emits no TEXT_MESSAGE_START), create a slot.
      const parentId = e.parentMessageId;
      if (parentId) {
        const delivery = ownAssistantMessage(store, parentId);
        if (!delivery) return;
        store.messages.update((prev) => {
          const existing = prev.find((m) => m.id === parentId);
          if (existing) {
            return prev.map((m) =>
              m.id === parentId
                ? { ...m, toolCallIds: [...(m.toolCallIds ?? []), e.toolCallId], delivery }
                : m,
            );
          }
          return [...prev, { id: parentId, role: 'assistant', content: '', toolCallIds: [e.toolCallId], delivery }];
        });
      }
      return;
    }
    case 'TOOL_CALL_ARGS': {
      const e = event as unknown as { toolCallId: string; delta: string };
      // Deltas are FRAGMENTS of a JSON document, not standalone JSON: a live
      // model streams args token-by-token (`{"loca`, `tion":"Pa`, …), so we
      // accumulate the raw text and parse the accumulated buffer. Until the
      // buffer parses, keep the last-good args (initially {}).
      const buffers = (store.argsBuffers ??= new Map<string, string>());
      const buffer = (buffers.get(e.toolCallId) ?? '') + e.delta;
      buffers.set(e.toolCallId, buffer);
      const args = tryParseArgs(buffer);
      if (args !== undefined) {
        store.toolCalls.update((prev) =>
          prev.map((t) => t.id === e.toolCallId ? { ...t, args } : t),
        );
      }
      return;
    }
    case 'TOOL_CALL_END': {
      const e = event as unknown as { toolCallId: string };
      // Belt and braces: apply the final accumulated args (in case the last
      // ARGS delta arrived but an intermediate state was left unparsed), then
      // drop the buffer.
      const finalBuffer = store.argsBuffers?.get(e.toolCallId);
      store.argsBuffers?.delete(e.toolCallId);
      const finalArgs = finalBuffer !== undefined ? tryParseArgs(finalBuffer) : undefined;
      store.toolCalls.update((prev) =>
        prev.map((t) =>
          t.id === e.toolCallId
            ? { ...t, status: 'complete', ...(finalArgs !== undefined ? { args: finalArgs } : {}) }
            : t,
        ),
      );
      return;
    }
    case 'TOOL_CALL_RESULT': {
      const e = event as unknown as { toolCallId: string; content: unknown };
      // ag_ui_langgraph serialises tool results via normalize_tool_content()
      // which always returns a string. Parse it so downstream consumers
      // (chat-tool-views / toToolViewSpec) can spread the object into props.
      const result = typeof e.content === 'string' ? safeParseJson(e.content) : e.content;
      store.toolCalls.update((prev) =>
        prev.map((t) => t.id === e.toolCallId ? { ...t, result } : t),
      );
      return;
    }
    case 'STATE_SNAPSHOT': {
      const e = event as unknown as { snapshot: Record<string, unknown> };
      const snapshot = e.snapshot ?? {};
      store.state.set(snapshot);
      store.messages.update(msgs => bridgeCitationsState({ state: snapshot }, msgs));
      return;
    }
    case 'STATE_DELTA': {
      const e = event as unknown as { delta: JsonPatchOp[] };
      const next = applyPatch(deepClone(store.state()), e.delta);
      store.state.set(next);
      store.messages.update(msgs => bridgeCitationsState({ state: next }, msgs));
      return;
    }
    case 'MESSAGES_SNAPSHOT': {
      const e = event as unknown as { messages: AgUiSnapshotMessage[] };
      const raw = e.messages ?? [];
      const run = store.deliveryRun?.outcome === undefined ? store.deliveryRun : null;
      const canonicalAssistantId = resolveCanonicalAssistantId(raw, run);
      const activeCanonicalAssistantId = canonicalAssistantId
        && ownAssistantMessage(store, canonicalAssistantId)
        ? canonicalAssistantId
        : undefined;
      const previousById = new Map(store.messages().map(message => [message.id, message]));
      // AG-UI AssistantMessage carries `toolCalls` (ToolCall objects) on the
      // snapshot wire. Bridge them to `toolCallIds` so that the chat lib's
      // per-message tool-call resolution (resolveMessageToolCalls) can scope
      // correctly. Also merge any snapshot-only tool calls into store.toolCalls
      // so the data is visible to <chat-tool-views>.
      const snapshotToolCalls: ToolCall[] = [];
      const messages: Message[] = raw.map((m) => {
        const previous = previousById.get(m.id);
        const completedMessage = m.id !== activeCanonicalAssistantId
          && previous?.delivery.phase === 'complete'
          && (
            !run
            || run.ownedMessageIds.has(m.id)
            || run.snapshotReplacementIds.has(m.id)
          )
          ? previous
          : undefined;
        let delivery = previous?.delivery ?? staticDelivery(m.id);
        let snapshotMessage: Omit<Message, 'delivery'>;
        if (m.role !== 'assistant' || !m.toolCalls || m.toolCalls.length === 0) {
          snapshotMessage = m as unknown as Omit<Message, 'delivery'>;
        } else {
          const ids: string[] = [];
          for (const tc of m.toolCalls) {
            ids.push(tc.id);
            snapshotToolCalls.push({
              id: tc.id,
              name: tc.function.name,
              args: safeParseArgs(tc.function.arguments),
              status: 'complete',
            });
          }
          const { toolCalls: _dropped, ...rest } = m;
          snapshotMessage = { ...rest, toolCallIds: ids } as unknown as Omit<Message, 'delivery'>;
        }
        if (completedMessage) {
          const snapshotChanged = completedMessage.content !== snapshotMessage.content
            || !sameStringArray(completedMessage.toolCallIds, snapshotMessage.toolCallIds);
          if (!snapshotChanged) return completedMessage;

          run?.snapshotReplacementIds.add(m.id);
          return {
            ...completedMessage,
            ...snapshotMessage,
            delivery: completeDelivery(
              store.allocateDeliveryGeneration(`snapshot:${m.id}`),
              'success',
            ),
          } as Message;
        }
        if (run && (run.ownedMessageIds.has(m.id) || m.id === canonicalAssistantId)) {
          delivery = delivery.generation === run.generation && delivery.phase === 'complete'
            ? delivery
            : streamingDelivery(run.generation);
          run.ownedMessageIds.add(m.id);
          if (m.id === activeCanonicalAssistantId) run.currentAssistantMessageId = m.id;
        }
        return { ...snapshotMessage, delivery } as Message;
      });
      const currentAssistant = run?.currentAssistantMessageId
        ? previousById.get(run.currentAssistantMessageId)
        : undefined;
      if (
        run
        && currentAssistant?.delivery.generation === run.generation
        && currentAssistant.delivery.phase === 'streaming'
        && !messages.some(message => message.id === currentAssistant.id)
      ) {
        messages.push(currentAssistant);
      }
      // Re-apply per-message citations from the already-received STATE. A
      // MESSAGES_SNAPSHOT replaces the streamed messages wholesale — and the
      // final snapshot message id (str(AIMessage.id), e.g. "resp-…") differs
      // from the streaming chunk id the earlier STATE_SNAPSHOT bridged against,
      // so without re-bridging here the citations (keyed by the final id) would
      // be dropped on the message swap.
      store.messages.set(bridgeCitationsState({ state: store.state() }, messages));
      if (snapshotToolCalls.length > 0) {
        store.toolCalls.update((prev) => {
          // Merge: keep existing entries (they may carry richer state from
          // streaming) and only insert entries not already present by id.
          const existingIds = new Set(prev.map((tc) => tc.id));
          const toAdd = snapshotToolCalls.filter((tc) => !existingIds.has(tc.id));
          return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
        });
      }
      return;
    }
    case 'CUSTOM': {
      const e = event as unknown as { name: string; value: unknown };
      // ag_ui_langgraph serializes interrupt payloads as JSON strings.
      // Parse the value if it arrives as a string so downstream consumers
      // (e.g. ChatApprovalCardComponent) receive a plain object, not a string.
      const parsedValue = typeof e.value === 'string' ? safeParseJson(e.value) : e.value;
      if (e.name === 'on_interrupt') {
        const run = currentRunForEvent(event, store);
        if (store.deliveryRun && !run) return;
        // First signal wins within a run: when a RUN_FINISHED interrupt
        // outcome already paused this run (a backend may emit both, in either
        // order), keep the interrupt it stored rather than clobbering it.
        if (!(run?.outcome === 'paused' && store.interrupt() !== undefined)) {
          store.interrupt.set({ id: randomId(), value: parsedValue, resumable: true });
        }
        if (run && finalizeDeliveryRun(store, run, 'paused')) {
          store.status.set('idle');
          store.isLoading.set(false);
        }
        return;
      }
      // Surface every other custom event on the customEvents signal so the
      // chat a2ui partial-args bridge (which reads agent.customEvents()) lights
      // up live/progressive a2ui rendering — parity with the LangGraph adapter.
      store.customEvents.update((prev) => [...prev, { name: e.name, data: parsedValue }]);
      if (e.name === 'state_update' && isRecord(parsedValue)) {
        store.events$.next({ type: 'state_update', data: parsedValue });
      } else {
        store.events$.next({ type: 'custom', name: e.name, data: parsedValue });
      }
      return;
    }
    case 'SUBAGENT_STARTED': {
      const e = event as unknown as {
        subagentRunId: string; name: string; description?: string; parentToolCallId?: string;
      };
      const existing = store.activities().get(e.subagentRunId);
      const existingContent = existing?.content();
      const nextToolCallId = e.parentToolCallId
        ?? (existingContent?.['toolCallId'] as string | undefined)
        ?? e.subagentRunId;
      // Identity is "placeholder" when this is the first sighting, or when a
      // buffer-not-drop entry (created by an attributed content event that
      // arrived before STARTED) still carries its placeholder name/toolCallId.
      // to-agent.ts's wrapper cache keys on (id, generation) and snapshots
      // name/toolCallId at creation — a content-only update on the SAME
      // generation would leave an already-cached wrapper permanently stale,
      // so identity changes must land on a freshly allocated generation.
      const identityChanged = !existing
        || existingContent?.['name'] !== e.name
        || existingContent?.['toolCallId'] !== nextToolCallId;
      const mergedContent: Record<string, unknown> = {
        ...(existingContent ?? { messages: [], toolCalls: [] }),
        name: e.name,
        ...(e.description !== undefined ? { description: e.description } : {}),
        toolCallId: nextToolCallId,
        status: 'running',
      };
      if (identityChanged) {
        const entry: ActivityEntry = {
          messageId: e.subagentRunId,
          activityType: 'subagent',
          generation: store.allocateDeliveryGeneration(`activity:${e.subagentRunId}`),
          content: signal<Record<string, unknown>>(mergedContent),
        };
        const map = new Map(store.activities());
        map.set(e.subagentRunId, entry);
        store.activities.set(map);   // membership/identity change → new ref
      } else {
        // Re-announce (e.g. after a suspend) with unchanged identity: content-
        // only update, no map churn — mirrors ACTIVITY_DELTA's idiom.
        existing.content.update((c) => ({ ...c, ...mergedContent }));
      }
      return;
    }
    case 'SUBAGENT_FINISHED': {
      const e = event as unknown as {
        subagentRunId: string; result?: unknown; outcome?: { type: 'success' | 'suspended' };
      };
      const entry = store.activities().get(e.subagentRunId);
      if (!entry) return;
      // Suspended keeps the card running: the run resumes with the same id,
      // and the interrupt itself surfaces through the interrupt signal.
      const status = e.outcome?.type === 'suspended' ? 'running' : 'complete';
      entry.content.update((c) => ({
        ...c,
        status,
        ...(e.result !== undefined
          ? { state: { ...((c['state'] as Record<string, unknown>) ?? {}), result: e.result } }
          : {}),
      }));  // content-only change → inner signal, no map churn
      return;
    }
    case 'SUBAGENT_ERROR': {
      const e = event as unknown as { subagentRunId: string; message: string };
      const entry = store.activities().get(e.subagentRunId);
      if (!entry) return;
      entry.content.update((c) => ({
        ...c,
        status: 'error',
        state: { ...((c['state'] as Record<string, unknown>) ?? {}), error: e.message },
      }));  // content-only change → inner signal, no map churn
      return;
    }
    case 'ACTIVITY_SNAPSHOT': {
      const e = event as unknown as {
        messageId: string; activityType: string;
        content: Record<string, unknown>; replace?: boolean;
      };
      const map = new Map(store.activities());
      const existing = map.get(e.messageId);
      if (existing && existing.activityType === e.activityType) {
        if (e.replace) existing.content.set(e.content ?? {});
        else existing.content.update((c) => ({ ...c, ...e.content }));
      } else {
        map.set(e.messageId, {
          messageId: e.messageId,
          activityType: e.activityType,
          generation: store.allocateDeliveryGeneration(`activity:${e.messageId}`),
          content: signal<Record<string, unknown>>(e.content ?? {}),
        });
      }
      store.activities.set(map);   // new ref → projection picks up membership change
      return;
    }
    case 'ACTIVITY_DELTA': {
      const e = event as unknown as {
        messageId: string; patch: readonly JsonPatchOp[];
      };
      const entry = store.activities().get(e.messageId);
      if (!entry) return;          // unknown activity — ignore
      entry.content.update((c) => {
        try {
          return applyPatch(c, e.patch);
        } catch (err) {
          // A malformed/out-of-order ACTIVITY_DELTA must not break the stream — drop it.
          if (typeof console !== 'undefined') console.warn('[ag-ui] dropping malformed ACTIVITY_DELTA patch', err);
          return c;
        }
      });  // inner signal → live, no map churn
      return;
    }
    default: {
      // Unknown event types are ignored; AG-UI may add new ones in
      // future protocol versions. We surface them as no-ops rather
      // than throwing, so a partial-version mismatch doesn't crash.
      return;
    }
  }
}

function randomId(): string {
  return Math.random().toString(36).slice(2);
}

/** Content events a subagentRunId can route away from the parent transcript. */
const SUBAGENT_ROUTED_TYPES = new Set([
  'TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END',
  'TOOL_CALL_START', 'TOOL_CALL_ARGS', 'TOOL_CALL_END', 'TOOL_CALL_RESULT',
  'REASONING_MESSAGE_START', 'REASONING_MESSAGE_CONTENT',
  'REASONING_MESSAGE_CHUNK', 'REASONING_MESSAGE_END',
]);

function subagentArgsBufferKey(subagentRunId: string, toolCallId: string): string {
  return `subagent:${subagentRunId}:${toolCallId}`;
}

/** Get-or-create the ActivityEntry for a subagent run, keyed by
 *  subagentRunId — mirrors ACTIVITY_SNAPSHOT's creation branch exactly
 *  (same generation allocation, same activities-map replace idiom) so
 *  the projection in to-agent.ts needs no special-casing. Buffer-not-drop:
 *  an attributed content event that arrives before SUBAGENT_STARTED still
 *  gets a card, which SUBAGENT_STARTED then fills in with identity. */
function ensureSubagentEntry(subagentRunId: string, store: ReducerStore): ActivityEntry {
  const existing = store.activities().get(subagentRunId);
  if (existing && existing.activityType === 'subagent') return existing;
  const entry: ActivityEntry = {
    messageId: subagentRunId,
    activityType: 'subagent',
    generation: store.allocateDeliveryGeneration(`activity:${subagentRunId}`),
    content: signal<Record<string, unknown>>({
      toolCallId: subagentRunId,
      name: '',
      status: 'running',
      messages: [],
      toolCalls: [],
    }),
  };
  const map = new Map(store.activities());
  map.set(subagentRunId, entry);
  store.activities.set(map);
  return entry;
}

/** Route a subagentRunId-attributed content event into that subagent's
 *  ActivityEntry rather than the parent transcript/toolCalls signal.
 *  Text and tool-call handling mirrors the parent TEXT_MESSAGE and
 *  TOOL_CALL cases above, but written against the entry's content record
 *  instead of store.messages/store.toolCalls. */
function routeSubagentContentEvent(subagentRunId: string, event: BaseEvent, store: ReducerStore): void {
  if (event.type === 'REASONING_MESSAGE_START' || event.type === 'REASONING_MESSAGE_CONTENT'
    || event.type === 'REASONING_MESSAGE_CHUNK' || event.type === 'REASONING_MESSAGE_END') {
    if (!store.deliveryRun || store.deliveryRun.outcome !== undefined) return;
    // END carries no child timing or lifecycle effect, even before STARTED.
    // Reject inert/terminal events before currentRunForEvent can bind a run ID.
    if (event.type === 'REASONING_MESSAGE_END') return;
    const existing = store.activities().get(subagentRunId);
    const status = existing?.content()['status'];
    if (existing?.activityType === 'subagent' && (status === 'complete' || status === 'error')) return;
    if (!currentRunForEvent(event, store)) return;
  }
  const entry = ensureSubagentEntry(subagentRunId, store); // buffer-not-drop: creates on first sight
  const e = event as unknown as Record<string, unknown>;

  // TOOL_CALL_ARGS/END mutate the shared argsBuffers map — a side effect.
  // Compute that up front so the content.update callback below stays a pure
  // function of its input, same as every other content.update in this file.
  let parsedArgs: Record<string, unknown> | undefined;
  if (event.type === 'TOOL_CALL_ARGS') {
    // Same accumulated-buffer rule as the parent handler: deltas are JSON
    // fragments; parse the accumulation, keep last-good args.
    // Keyed by subagent run AND tool-call id: two children reusing the same
    // toolCallId (real for providers that mint per-child ids) must never
    // interleave fragments into one buffer.
    const buffers = (store.argsBuffers ??= new Map<string, string>());
    const key = subagentArgsBufferKey(subagentRunId, e['toolCallId'] as string);
    const buffer = (buffers.get(key) ?? '') + ((e['delta'] as string) ?? '');
    buffers.set(key, buffer);
    parsedArgs = tryParseArgs(buffer);
  } else if (event.type === 'TOOL_CALL_END') {
    store.argsBuffers?.delete(subagentArgsBufferKey(subagentRunId, e['toolCallId'] as string));
  }

  entry.content.update((c) => {
    const messages = [...((c['messages'] as Array<Record<string, unknown>>) ?? [])];
    const toolCalls = [...((c['toolCalls'] as Array<Record<string, unknown>>) ?? [])];
    switch (event.type as string) {
      case 'REASONING_MESSAGE_START':
      case 'REASONING_MESSAGE_CONTENT':
      case 'REASONING_MESSAGE_CHUNK': {
        const id = e['messageId'] as string;
        const idx = messages.findIndex((m) => m['id'] === id);
        const delta = event.type === 'REASONING_MESSAGE_START' ? '' : (e['delta'] as string) ?? '';
        if (idx < 0) messages.push({ id, role: 'assistant', content: '', reasoning: delta });
        else messages[idx] = { ...messages[idx], reasoning: `${messages[idx]['reasoning'] ?? ''}${delta}` };
        return { ...c, messages };
      }
      case 'TEXT_MESSAGE_START': {
        const id = e['messageId'] as string;
        if (!messages.some((m) => m['id'] === id)) messages.push({ id, role: 'assistant', content: '' });
        return { ...c, messages };
      }
      case 'TEXT_MESSAGE_CONTENT': {
        const id = e['messageId'] as string;
        const idx = messages.findIndex((m) => m['id'] === id);
        if (idx < 0) messages.push({ id, role: 'assistant', content: (e['delta'] as string) ?? '' });
        else messages[idx] = { ...messages[idx], content: `${messages[idx]['content'] ?? ''}${(e['delta'] as string) ?? ''}` };
        return { ...c, messages };
      }
      case 'TEXT_MESSAGE_END':
        return c;
      case 'TOOL_CALL_START': {
        toolCalls.push({ id: e['toolCallId'], name: e['toolCallName'], args: {}, status: 'running' });
        // Mirror the parent TOOL_CALL_START handler: link the call to its
        // parent child message so chat-subagent-card can draw it from
        // message.toolCallIds, same as the top-level transcript does.
        const parentId = e['parentMessageId'] as string | undefined;
        if (parentId) {
          const idx = messages.findIndex((m) => m['id'] === parentId);
          if (idx < 0) {
            messages.push({ id: parentId, role: 'assistant', content: '', toolCallIds: [e['toolCallId']] });
          } else {
            messages[idx] = {
              ...messages[idx],
              toolCallIds: [...((messages[idx]['toolCallIds'] as unknown[]) ?? []), e['toolCallId']],
            };
          }
        } else if (messages.length > 0) {
          // No parentMessageId on the wire: attach to the most recently
          // opened child message, mirroring TEXT_MESSAGE_START's append order.
          const lastIdx = messages.length - 1;
          messages[lastIdx] = {
            ...messages[lastIdx],
            toolCallIds: [...((messages[lastIdx]['toolCallIds'] as unknown[]) ?? []), e['toolCallId']],
          };
        }
        return { ...c, messages, toolCalls };
      }
      case 'TOOL_CALL_ARGS':
        return parsedArgs === undefined
          ? c
          : { ...c, toolCalls: toolCalls.map((t) => (t['id'] === e['toolCallId'] ? { ...t, args: parsedArgs } : t)) };
      case 'TOOL_CALL_END':
        return { ...c, toolCalls: toolCalls.map((t) => (t['id'] === e['toolCallId'] ? { ...t, status: 'complete' } : t)) };
      case 'TOOL_CALL_RESULT': {
        // ag_ui_langgraph serialises tool results via normalize_tool_content()
        // which always returns a string — parse it the same way the parent
        // TOOL_CALL_RESULT handler does so downstream consumers get an object.
        const raw = e['content'];
        const result = typeof raw === 'string' ? safeParseJson(raw) : raw;
        return { ...c, toolCalls: toolCalls.map((t) => (t['id'] === e['toolCallId'] ? { ...t, result } : t)) };
      }
      default:
        return c;
    }
  });  // content-only change → inner signal, no map churn
}

/** Loosely-typed RUN_FINISHED outcome. @ag-ui/core@0.0.59 ships the strict
 *  RunFinishedInterruptOutcomeSchema / InterruptSchema for this shape, but
 *  the reducer deliberately keeps this tolerant hand-rolled view: a strict
 *  parse would silently DROP an interrupt whose entries deviate from the
 *  schema (extra keys on the strict outcome object, a missing `reason`),
 *  while the contract here is to preserve every entry verbatim under
 *  `value.interrupts` for resume to address. Validation strictness would be
 *  a behavior change, not a simplification. */
interface RunFinishedOutcome {
  type?: string;
  interrupts?: unknown;
}

function runFinishedOutcome(event: BaseEvent): RunFinishedOutcome | undefined {
  const outcome = (event as { outcome?: unknown }).outcome;
  return isRecord(outcome) ? (outcome as RunFinishedOutcome) : undefined;
}

/**
 * Build the neutral AgentInterrupt from a RUN_FINISHED interrupt outcome.
 * Every identifying field of the outcome's interrupt entries (id, reason,
 * toolCallId, responseSchema, metadata, …) is preserved verbatim under
 * `value.interrupts` — resume needs them to address the pending interrupts.
 * The event's protocol runId rides along as `value.runId` (Mastra's resume
 * contract wants the interrupting run's id back).
 */
function toOutcomeInterrupt(
  outcome: RunFinishedOutcome,
  runId: string | undefined,
): AgentInterrupt {
  const interrupts = Array.isArray(outcome.interrupts) ? outcome.interrupts : [];
  const first = interrupts.find(isRecord);
  const firstId = first?.['id'];
  return {
    id: typeof firstId === 'string' && firstId.length > 0 ? firstId : randomId(),
    value: { interrupts, ...(runId !== undefined ? { runId } : {}) },
    resumable: true,
  };
}

function eventRunId(event: BaseEvent): string | undefined {
  const runId = (event as { runId?: unknown }).runId;
  return typeof runId === 'string' ? runId : undefined;
}

function bindRunId(event: BaseEvent, run: ReducerDeliveryRun): boolean {
  const runId = eventRunId(event);
  if (!runId) return true;
  if (run.protocolRunId && run.protocolRunId !== runId) return false;
  run.protocolRunId = runId;
  return true;
}

function currentRunForEvent(event: BaseEvent, store: ReducerStore): ReducerDeliveryRun | null {
  const run = store.deliveryRun;
  if (!run || !bindRunId(event, run)) return null;
  return run;
}

function ownAssistantMessage(store: ReducerStore, id: string) {
  const run = store.deliveryRun;
  if (!run || run.outcome !== undefined) return undefined;
  const currentId = run.currentAssistantMessageId;
  if (currentId && currentId !== id) {
    if (run.ownedMessageIds.has(id)) return undefined;
    delete run.pendingReasoning;
    store.messages.update(messages => messages.map(message =>
      message.id === currentId
        && message.delivery.generation === run.generation
        && message.delivery.phase === 'streaming'
        ? { ...message, delivery: completeDelivery(run.generation, 'success') }
        : message,
    ));
  }
  run.ownedMessageIds.add(id);
  run.currentAssistantMessageId = id;
  return streamingDelivery(run.generation);
}

function sameStringArray(left?: string[], right?: string[]): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function resolveCanonicalAssistantId(
  messages: readonly AgUiSnapshotMessage[],
  run: ReducerDeliveryRun | null,
): string | undefined {
  if (!run) return undefined;
  if (
    run.currentAssistantMessageId
    && messages.some(message => message.id === run.currentAssistantMessageId)
  ) {
    return run.currentAssistantMessageId;
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'assistant' && !run.baselineMessageIds.has(message.id)) {
      return message.id;
    }
  }
  return run.eligibleBaselineAssistantId
    && messages.some(message =>
      message.role === 'assistant' && message.id === run.eligibleBaselineAssistantId
    )
      ? run.eligibleBaselineAssistantId
      : undefined;
}

function messageIdFrom(event: BaseEvent): string {
  return (event as { messageId?: string }).messageId ?? 'unknown';
}

function safeParseArgs(delta: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(delta);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Parse an (accumulated) args buffer; `undefined` when it isn't valid JSON
 *  yet — callers keep the previous args rather than clobbering them with {}. */
function tryParseArgs(buffer: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(buffer);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Parse a JSON string to its value; return the original string on failure. */
function safeParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}
