import type { BaseMessage } from '@langchain/core/messages';
import {
  completeDelivery,
  staticDelivery,
  streamingDelivery,
  type MessageDelivery,
} from '@threadplane/chat';

export interface TrackedToolCall {
  id?: string;
  name: string;
  args: Record<string, unknown> | string;
}

export interface TrackedSubagent {
  id: string;
  generation: string;
  /**
   * How this child stream came to exist. 'tool' children are delegation tool
   * calls (registered from the parent's AI message, keyed by tool-call id);
   * 'subgraph' children are plain compiled-graph nodes (registered from their
   * first namespaced stream event, keyed by the namespace segment itself).
   */
  kind: 'tool' | 'subgraph';
  status: 'pending' | 'running' | 'complete' | 'error';
  toolCall: {
    id: string;
    name: string;
    args: Record<string, unknown>;
  };
  values: Record<string, unknown>;
  messages: BaseMessage[];
}

export interface SubagentTrackerOptions {
  subagentToolNames?: string[];
  onSubagentChange?: () => void;
}

const DEFAULT_SUBAGENT_TOOL_NAMES = ['task'];
let subagentGenerationSequence = 0;

function createSubagentGeneration(): string {
  subagentGenerationSequence += 1;
  return `subagent-${subagentGenerationSequence}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Lightweight Angular adapter for LangGraph subagent stream state.
 *
 * This intentionally mirrors only the SDK behavior this package exposes. Using
 * the SDK UI barrel at runtime pulls StreamManager/client utilities into every
 * Angular bundle, which breaks cockpit production budgets.
 */
export class SubagentTracker {
  private readonly subagentToolNames: Set<string>;
  private readonly onSubagentChange?: () => void;
  private readonly subagents = new Map<string, TrackedSubagent>();
  private readonly namespaceToToolCallId = new Map<string, string>();
  /**
   * Child messages received under a namespace that is not yet attributed to a
   * registered subagent. LangGraph's `tools:<id>` namespace carries an internal
   * run UUID, not the parent's tool-call id, and the two are only reconciled
   * once a `values` event arrives carrying the child's first human message. Any
   * chunk streamed before that point would otherwise be dropped — which is what
   * made subagent cards render "0 message(s)" despite a full child transcript.
   *
   * Merged by id like a real transcript, so this stays bounded by the child's
   * distinct message count rather than by chunk volume.
   */
  private readonly unattributedMessages = new Map<string, BaseMessage[]>();
  private readonly pendingMatches = new Map<string, string>();

  constructor(options: SubagentTrackerOptions = {}) {
    this.subagentToolNames = new Set(options.subagentToolNames ?? DEFAULT_SUBAGENT_TOOL_NAMES);
    this.onSubagentChange = options.onSubagentChange;
  }

  clear(): void {
    this.subagents.clear();
    this.namespaceToToolCallId.clear();
    this.pendingMatches.clear();
    this.unattributedMessages.clear();
    this.onSubagentChange?.();
  }

  getSubagents(): Map<string, TrackedSubagent> {
    const visible = new Map<string, TrackedSubagent>();
    for (const [id, subagent] of this.subagents) {
      if (subagent.status !== 'pending') {
        visible.set(id, subagent);
      }
    }
    return visible;
  }

  registerFromToolCalls(toolCalls: TrackedToolCall[], aiMessageId?: string | null): void {
    let changed = false;
    for (const toolCall of toolCalls) {
      if (!this.subagentToolNames.has(toolCall.name)) continue;

      const id = toolCall.id;
      if (!id) continue;

      const args = parseToolCallArgs(toolCall.args);
      if (!isValidSubagentType(args['subagent_type'])) continue;

      const existing = this.subagents.get(id);
      this.subagents.set(id, {
        id,
        generation: existing?.generation ?? createSubagentGeneration(),
        kind: 'tool',
        status: existing?.status ?? 'pending',
        toolCall: {
          id,
          name: toolCall.name,
          args: {
            ...args,
            ...(aiMessageId ? { _aiMessageId: aiMessageId } : {}),
          },
        },
        values: existing?.values ?? {},
        messages: existing?.messages ?? [],
      });
      changed = true;
    }

    if (changed) {
      this.retryPendingMatches();
      this.onSubagentChange?.();
    }
  }

  reconstructFromMessages(messages: BaseMessage[], options: { skipIfPopulated?: boolean } = {}): void {
    if (options.skipIfPopulated && this.subagents.size > 0) return;

    for (const message of messages) {
      const raw = message as unknown as Record<string, unknown>;
      if (isAiMessageWithToolCalls(raw)) {
        this.registerFromToolCalls(
          raw['tool_calls'] as TrackedToolCall[],
          typeof raw['id'] === 'string' ? raw['id'] : null,
        );
      } else if (isToolMessage(raw)) {
        this.processToolMessage(raw['tool_call_id'], raw['content'], raw['status'] === 'error' ? 'error' : 'success');
      }
    }
  }

  matchSubgraphToSubagent(namespaceId: string, description: string): string | undefined {
    if (this.namespaceToToolCallId.has(namespaceId)) {
      return this.namespaceToToolCallId.get(namespaceId);
    }

    const mapped = new Set(this.namespaceToToolCallId.values());
    const establish = (toolCallId: string): string => {
      this.namespaceToToolCallId.set(namespaceId, toolCallId);
      const subagent = this.subagents.get(toolCallId);
      if (subagent) {
        const buffered = this.unattributedMessages.get(namespaceId);
        this.subagents.set(toolCallId, {
          ...subagent,
          status: subagent.status === 'complete' || subagent.status === 'error' ? subagent.status : 'running',
          messages: buffered ? mergeMessages(subagent.messages, buffered) : subagent.messages,
        });
        this.unattributedMessages.delete(namespaceId);
      }
      this.onSubagentChange?.();
      return toolCallId;
    };

    // The description rungs are only meaningful with a real description.
    // ensureToolStreamAttribution calls this with '' precisely to skip them:
    // without this guard, a subagent whose `description` arg is literally ''
    // exact-matches every empty-description probe, bypassing the positional
    // rung's one-candidate safety check.
    if (description) {
      for (const [toolCallId, subagent] of this.subagents) {
        if (subagent.kind !== 'tool' || mapped.has(toolCallId)) continue;
        if (subagent.toolCall.args['description'] === description) {
          return establish(toolCallId);
        }
      }

      for (const [toolCallId, subagent] of this.subagents) {
        if (subagent.kind !== 'tool' || mapped.has(toolCallId)) continue;
        const subagentDescription = subagent.toolCall.args['description'];
        if (typeof subagentDescription !== 'string' || !subagentDescription) continue;
        if (description.includes(subagentDescription) || subagentDescription.includes(description)) {
          return establish(toolCallId);
        }
      }
    }

    // Last-resort fallback — tool children only, and only when there is
    // nothing to guess between.
    //
    // LangGraph's `tools:<uuid>` namespace is a checkpoint id assigned
    // independently of the parent's `call_*` tool-call id; the two are not
    // linked anywhere on the wire (verified against a live run). So when a
    // delegation tool carries no matchable description, position is the only
    // signal left.
    //
    // That is sound with exactly one outstanding child — the shape every graph
    // in this repo produces, since each dispatches one tool call per assistant
    // turn. With several outstanding at once (parallel fan-out) arrival order
    // is NOT dispatch order, and claiming the first unmapped call cross-wires
    // the children: one card renders another's output. Leaving the stream
    // unattributed keeps its messages buffered instead, so an empty card is
    // the worst case rather than a confidently wrong one. It can still resolve
    // later: as siblings complete, the candidate set shrinks back to one.
    const candidates = [...this.subagents].filter(
      ([toolCallId, subagent]) =>
        subagent.kind === 'tool' &&
        !mapped.has(toolCallId) &&
        (subagent.status === 'pending' || subagent.status === 'running'),
    );
    if (candidates.length === 1) {
      return establish(candidates[0][0]);
    }

    if (description) {
      this.pendingMatches.set(namespaceId, description);
    }
    return undefined;
  }

  markRunningFromNamespace(namespaceId: string, namespace?: string[]): void {
    const toolCallId = this.resolveToolCallId(namespaceId);
    const subagent = this.subagents.get(toolCallId);
    if (!subagent) return;

    if (!this.namespaceToToolCallId.has(namespaceId)) {
      this.namespaceToToolCallId.set(namespaceId, toolCallId);
    }
    this.subagents.set(toolCallId, {
      ...subagent,
      status: subagent.status === 'complete' || subagent.status === 'error' ? subagent.status : 'running',
      values: {
        ...subagent.values,
        ...(namespace ? { namespace } : {}),
      },
    });
    this.onSubagentChange?.();
  }

  /**
   * Authoritative namespace→tool-call binding, from the server.
   *
   * `threadplane.middleware.langgraph.announce_subagent` emits a custom event
   * pairing the child's checkpoint namespace with its tool-call id — the two
   * halves that are never linked on the wire otherwise. Unlike the matching
   * ladder this is not a heuristic: it overrides nothing that is already
   * mapped, works with any number of children outstanding, and replays any
   * chunks that streamed before the binding arrived.
   */
  bindChildStream(namespaceId: string, toolCallId: string): void {
    if (this.namespaceToToolCallId.get(namespaceId) === toolCallId) return;
    this.namespaceToToolCallId.set(namespaceId, toolCallId);
    const subagent = this.subagents.get(toolCallId);
    if (subagent) {
      const buffered = this.unattributedMessages.get(namespaceId);
      this.subagents.set(toolCallId, {
        ...subagent,
        status: subagent.status === 'complete' || subagent.status === 'error' ? subagent.status : 'running',
        messages: buffered ? mergeMessages(subagent.messages, buffered) : subagent.messages,
      });
      this.unattributedMessages.delete(namespaceId);
    }
    this.onSubagentChange?.();
  }

  /** Ids of every registered delegation tool call, including hidden pending ones. */
  getToolChildIds(): Set<string> {
    const ids = new Set<string>();
    for (const [id, subagent] of this.subagents) {
      if (subagent.kind === 'tool') ids.add(id);
    }
    return ids;
  }

  /**
   * Seed a delegation child's execution from persisted thread history.
   *
   * `namespaceId` is the child's stream key (the id after `tools:`), bound the
   * same way a server announcement binds it, so a run that resumes after a
   * reload streams into this card instead of opening a second one. A child
   * whose task is still outstanding is `running`; one whose outstanding task
   * failed is `error`. A child already settled by its tool result keeps that
   * status.
   */
  restoreExecution(
    toolCallId: string,
    execution: { namespaceId?: string; outstanding: boolean; failed: boolean },
  ): void {
    const subagent = this.subagents.get(toolCallId);
    if (!subagent || subagent.kind !== 'tool') return;
    if (execution.namespaceId && !this.namespaceToToolCallId.has(execution.namespaceId)) {
      this.namespaceToToolCallId.set(execution.namespaceId, toolCallId);
      this.pendingMatches.delete(execution.namespaceId);
    }
    if (subagent.status === 'complete' || subagent.status === 'error' || !execution.outstanding) return;
    this.subagents.set(toolCallId, { ...subagent, status: execution.failed ? 'error' : 'running' });
    this.onSubagentChange?.();
  }

  /** True when a registered child has no transcript yet. */
  needsTranscript(toolCallId: string): boolean {
    const subagent = this.subagents.get(toolCallId);
    return subagent !== undefined && subagent.messages.length === 0;
  }

  /**
   * Fill an empty child card with the transcript read from the child's own
   * checkpoint namespace. Never overwrites messages that are already present —
   * a live stream that reached the card first is the fresher account. Returns
   * whether the transcript was applied.
   */
  restoreTranscript(
    toolCallId: string,
    messages: BaseMessage[],
    values: Record<string, unknown>,
  ): boolean {
    const subagent = this.subagents.get(toolCallId);
    if (!subagent || subagent.messages.length > 0 || messages.length === 0) return false;
    this.subagents.set(toolCallId, {
      ...subagent,
      values: { ...values, ...subagent.values },
      messages,
    });
    this.onSubagentChange?.();
    return true;
  }

  /**
   * Attribute a `tools:` child stream to its parent tool call as soon as the
   * child is seen, without requiring a description to match on.
   *
   * The description ladder needs two things this repo's own graphs don't
   * reliably provide: a delegation tool that names its argument `description`,
   * and a child whose first message is the human task. `cockpit/chat/subagents`
   * has neither — it uses `task_description`, and its child's messages begin
   * with the AI reply. Attribution therefore never ran, so the child's
   * transcript was never claimed and every card rendered "0 message(s)".
   *
   * Calling the ladder with no description skips both description rungs and
   * lands on the positional fallback (first unmapped pending/running tool
   * child), which is correct for sequential dispatch and is the same heuristic
   * the ladder already relied on in practice.
   */
  ensureToolStreamAttribution(namespaceId: string): void {
    if (this.namespaceToToolCallId.has(namespaceId)) return;
    this.matchSubgraphToSubagent(namespaceId, '');
  }

  /**
   * Register a plain-subgraph child stream on its first namespaced event.
   *
   * Unlike tool children — announced ahead of time by the parent's tool call —
   * a compiled child added as a plain node has no announcement: its existence
   * is learned from the first event carrying its namespace. It starts
   * 'running' because by the time we see an event, it is.
   */
  ensureSubgraphStream(key: string, name: string): void {
    if (this.subagents.has(key)) return;
    this.subagents.set(key, {
      id: key,
      generation: createSubagentGeneration(),
      kind: 'subgraph',
      status: 'running',
      toolCall: { id: key, name, args: {} },
      values: {},
      messages: [],
    });
    this.onSubagentChange?.();
  }

  /**
   * Settle still-running subgraph children when the run reaches a terminal
   * outcome. Tool children settle through their tool result
   * (`processToolMessage`); subgraph children have no result message, so the
   * run's own settle is their completion signal. Paused/interrupted runs must
   * NOT call this — a child can resume with the thread.
   */
  settleRunningSubgraphs(outcome: 'complete' | 'error'): void {
    let changed = false;
    for (const [key, subagent] of this.subagents) {
      if (subagent.kind !== 'subgraph' || subagent.status !== 'running') continue;
      this.subagents.set(key, { ...subagent, status: outcome });
      changed = true;
    }
    if (changed) this.onSubagentChange?.();
  }

  updateSubagentValues(namespaceId: string, values: Record<string, unknown>): void {
    const toolCallId = this.resolveToolCallId(namespaceId);
    const subagent = this.subagents.get(toolCallId);
    if (!subagent) return;

    this.subagents.set(toolCallId, {
      ...subagent,
      status: subagent.status === 'complete' || subagent.status === 'error' ? subagent.status : 'running',
      values,
    });
    this.onSubagentChange?.();
  }

  addMessageToSubagent(namespaceId: string, message: BaseMessage): void {
    const toolCallId = this.resolveToolCallId(namespaceId);
    const subagent = this.subagents.get(toolCallId);
    if (!subagent) {
      // Not attributed yet — hold it rather than drop it. `establish()` will
      // replay the buffer the moment this namespace is matched to a tool call.
      this.unattributedMessages.set(
        namespaceId,
        mergeMessages(this.unattributedMessages.get(namespaceId) ?? [], [message]),
      );
      return;
    }

    this.subagents.set(toolCallId, {
      ...subagent,
      status: subagent.status === 'complete' || subagent.status === 'error' ? subagent.status : 'running',
      messages: mergeMessages(subagent.messages, [message]),
    });
    this.onSubagentChange?.();
  }

  processToolMessage(toolCallId: string, content: unknown, status: 'success' | 'error'): void {
    const subagent = this.subagents.get(toolCallId);
    if (!subagent) return;

    this.subagents.set(toolCallId, {
      ...subagent,
      status: status === 'error' ? 'error' : 'complete',
      values: {
        ...subagent.values,
        result: content,
      },
    });
    this.onSubagentChange?.();
  }

  getMessageDelivery(toolCallId: string, message: BaseMessage): MessageDelivery {
    const id = getMessageId(message) ?? toolCallId;
    const raw = message as unknown as Record<string, unknown>;
    const type = typeof message._getType === 'function' ? message._getType() : raw['type'];
    if (type !== 'ai' && type !== 'assistant' && type !== 'AIMessage' && type !== 'AIMessageChunk') {
      return staticDelivery(id);
    }

    const subagent = this.subagents.get(toolCallId);
    if (!subagent) return staticDelivery(id);
    if (subagent.status === 'error') return completeDelivery(subagent.generation, 'error');
    if (subagent.status === 'complete') return completeDelivery(subagent.generation, 'success');
    return streamingDelivery(subagent.generation);
  }

  private retryPendingMatches(): void {
    for (const [namespaceId, description] of this.pendingMatches) {
      if (this.matchSubgraphToSubagent(namespaceId, description)) {
        this.pendingMatches.delete(namespaceId);
      }
    }
  }

  private resolveToolCallId(namespaceId: string): string {
    return this.namespaceToToolCallId.get(namespaceId) ?? namespaceId;
  }
}

/**
 * True when a stream event belongs to a child graph rather than the parent —
 * i.e. it carries any namespace at all. This is the single classification
 * question; which child owns the event is a separate (attribution) question.
 *
 * Kept consistent with the terminal-evidence guard, which has always refused
 * ANY namespaced event as proof the parent run finished.
 */
export function isChildNamespace(namespace: string[] | string | undefined): boolean {
  if (!namespace) return false;
  if (typeof namespace === 'string') return namespace.length > 0;
  return namespace.length > 0;
}

/** Resolved identity of a child stream, derived from its event namespace. */
export interface ChildStreamRef {
  /**
   * Map key: the tool-call id for a single `tools:` namespace; for a nested
   * delegation, the namespace path truncated at (and including) the
   * innermost `tools:` segment, so trailing internal-node segments don't
   * fragment one grandchild into several entries; else the namespace segment
   * itself.
   */
  key: string;
  /** Display name; for subgraph nodes, the node name. Unused on the tool path. */
  name: string;
  kind: 'tool' | 'subgraph';
}

/**
 * Derive a child stream's identity from an event namespace.
 *
 * `tools:<id>` segments identify a tool-dispatched child by its tool-call id.
 * Any other segment (e.g. `research:<uuid>` from a compiled graph added with
 * `add_node`) identifies a plain subgraph child: the full segment is the key
 * (unique per invocation) and the part before the first ':' is the node name.
 *
 * A namespace with MORE than one `tools:` segment is a nested delegation — a
 * subagent that itself dispatched a delegation tool. That stream registers as
 * its own subgraph-kind entry keyed by the namespace path truncated at the
 * innermost `tools:` segment (inclusive), so trailing internal-node segments
 * after it (the grandchild's own `model:`/`agent:` steps) don't fragment one
 * grandchild into several map entries. Subgraph entries are skipped by every
 * attribution-ladder rung, so a grandchild can neither merge into the outer
 * child's card nor mis-attach to a sibling. Linking it to its parent card (a
 * delegation tree) is deliberately not modeled; the flat map is the contract.
 */
export function childStreamRefFromNamespace(namespace: string[]): ChildStreamRef | undefined {
  const toolSegments = namespace.filter((segment) => segment.startsWith('tools:'));
  if (toolSegments.length > 1) {
    let lastToolsIndex = -1;
    for (let i = namespace.length - 1; i >= 0; i -= 1) {
      if (namespace[i].startsWith('tools:')) {
        lastToolsIndex = i;
        break;
      }
    }
    const innermost = namespace[lastToolsIndex];
    const colon = innermost.indexOf(':');
    return {
      // The innermost segment's node name is 'tools' for a delegation-tool
      // child — an intentionally generic card label; there's no
      // subagent_type to name it from.
      key: namespace.slice(0, lastToolsIndex + 1).join('|'),
      name: colon > 0 ? innermost.slice(0, colon) : innermost,
      kind: 'subgraph',
    };
  }
  if (toolSegments.length === 1) {
    return { key: toolSegments[0].slice(6), name: '', kind: 'tool' };
  }
  const first = namespace[0];
  if (!first) return undefined;
  const colon = first.indexOf(':');
  return { key: first, name: colon > 0 ? first.slice(0, colon) : first, kind: 'subgraph' };
}

function parseToolCallArgs(args: Record<string, unknown> | string): Record<string, unknown> {
  if (typeof args !== 'string') return args;
  try {
    const parsed = JSON.parse(args) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function isValidSubagentType(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 3
    && value.length <= 50
    && /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(value);
}

function isAiMessageWithToolCalls(value: Record<string, unknown>): boolean {
  return (value['type'] === 'ai' || value['type'] === 'assistant')
    && Array.isArray(value['tool_calls']);
}

function isToolMessage(value: Record<string, unknown>): value is Record<string, unknown> & { tool_call_id: string } {
  return value['type'] === 'tool' && typeof value['tool_call_id'] === 'string';
}

function mergeMessages(existing: BaseMessage[], incoming: BaseMessage[]): BaseMessage[] {
  const merged = [...existing];
  for (const msg of incoming) {
    const id = getMessageId(msg);
    const idx = id ? merged.findIndex(m => getMessageId(m) === id) : -1;
    if (idx >= 0) {
      merged[idx] = accumulateChunk(merged[idx], msg);
    } else {
      merged.push(msg);
    }
  }
  return merged;
}

/**
 * Fold a streamed chunk into the message it belongs to.
 *
 * A child graph streams `AIMessageChunk`s that are *deltas* — a handful of
 * characters each, hundreds per message. Replacing by id (the previous
 * behavior) therefore kept only the final delta, so a fully attributed
 * subagent still rendered a near-empty message. Snapshots, which carry the
 * message-so-far, still replace.
 *
 * This mirrors the parent transcript's delta handling: append unconditionally
 * rather than comparing text, because a prefix-style "dedupe" silently eats
 * legitimate tokens that happen to repeat the accumulated prefix.
 */
function accumulateChunk(existing: BaseMessage, incoming: BaseMessage): BaseMessage {
  if (!isChunkMessage(incoming)) return incoming;
  const previousText = extractText((existing as unknown as Record<string, unknown>)['content']);
  const incomingText = extractText((incoming as unknown as Record<string, unknown>)['content']);
  if (!incomingText) return existing;
  if (!previousText) return incoming;
  return { ...(incoming as object), content: previousText + incomingText } as BaseMessage;
}

function isChunkMessage(message: BaseMessage): boolean {
  const type = (message as unknown as Record<string, unknown>)['type'];
  return typeof type === 'string' && type.endsWith('Chunk');
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  let out = '';
  for (const block of content) {
    if (typeof block === 'string') { out += block; continue; }
    if (block == null || typeof block !== 'object') continue;
    const record = block as Record<string, unknown>;
    const blockType = record['type'];
    if (blockType === 'text' || blockType === 'output_text' || blockType === undefined) {
      const text = record['text'];
      if (typeof text === 'string') out += text;
    }
  }
  return out;
}

function getMessageId(message: BaseMessage): string | undefined {
  return (message as unknown as { id?: string }).id;
}
