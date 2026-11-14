import type {
  AgentSnapshot,
  Message,
  ToolCall,
  ToolContract,
} from '@threadplane/core';
import { createMarkdown } from '../markdown/create-markdown.js';
import type {
  Markdown,
  MarkdownDocument,
  MarkdownSnapshot,
} from '../markdown/types.js';

/**
 * The reasoning of one agent turn. A turn that reasons, calls a tool and
 * reasons again produces several assistant messages; this joins their
 * reasoning so a transcript can show it once.
 */
export interface ReasoningRun {
  /** The steps' reasoning in order, separated by blank lines. */
  readonly snapshot: MarkdownSnapshot;
  /** How many assistant messages contributed reasoning. */
  readonly steps: number;
  /** The measured durations added up; absent when no step reported one. */
  readonly durationMs?: number;
}

/** One transcript row. Unchanged rows keep their identity across projections. */
export interface MessageRow<
  TTools extends { [K in keyof TTools]: ToolContract } = Record<
    string,
    ToolContract
  >
> {
  readonly id: string;
  readonly role: Message['role'];
  readonly message: Message;
  readonly markdown: MarkdownSnapshot;
  /** Independently owned backend reasoning; absent for omitted or empty text. */
  readonly reasoning?: MarkdownSnapshot;
  /**
   * Present on the first reasoning row of a turn only. Later reasoning rows of
   * the same turn, separated from it by nothing but tool messages, are counted
   * here and carry no run of their own.
   */
  readonly reasoningRun?: ReasoningRun;
  readonly toolCalls: readonly ToolCall<TTools>[];
}

/** Owns per-message Markdown parsers and projects agent snapshots into reusable transcript rows. */
export interface MessageContent<
  TTools extends { [K in keyof TTools]: ToolContract } = Record<
    string,
    ToolContract
  >
> {
  /** Pure and idempotent: identical messages and tool calls return the same array. */
  project(snapshot: AgentSnapshot<TTools>): readonly MessageRow<TTools>[];
  /** Releases every Markdown owner. Returned rows stay readable. */
  dispose(): void;
}

/** Optional Markdown owner factory override used when constructing transcript projections. */
export interface MessageContentOptions {
  /** @internal Test seam. */
  readonly markdownFactory?: typeof createMarkdown;
}

/** Creates a transcript projector that preserves unchanged row identities and releases parsers for removed messages. */
export function createMessageContent<
  TTools extends { [K in keyof TTools]: ToolContract } = Record<
    string,
    ToolContract
  >
>(options: MessageContentOptions = {}): MessageContent<TTools> {
  const factory = options.markdownFactory ?? createMarkdown;
  const owners = new Map<string, Markdown>();
  const reasoningOwners = new Map<string, Markdown>();
  const runOwners = new Map<string, Markdown>();
  const all = [owners, reasoningOwners, runOwners];
  const projectMarkdown = (
    collection: Map<string, Markdown>,
    id: string,
    document: MarkdownDocument
  ): MarkdownSnapshot => {
    let owner = collection.get(id);
    if (!owner) {
      owner = factory(document, { violationPolicy: 'rebuild' });
      collection.set(id, owner);
    } else {
      const accepted = owner.getSnapshot().document;
      if (
        accepted.generation !== document.generation ||
        accepted.phase !== document.phase ||
        accepted.content !== document.content
      )
        owner.update(document);
    }
    return owner.getSnapshot();
  };
  let rows: readonly MessageRow<TTools>[] = Object.freeze([]);
  let messages: readonly Message[] | undefined;
  let toolCalls: readonly ToolCall<TTools>[] | undefined;
  let disposed = false;
  return {
    project(snapshot) {
      const next = snapshot as {
        readonly messages: readonly Message[];
        readonly toolCalls: readonly ToolCall<TTools>[];
      };
      const projectedCalls = next.toolCalls;
      if (
        disposed ||
        (next.messages === messages && next.toolCalls === toolCalls)
      )
        return rows;
      const present = new Set(next.messages.map((message) => message.id));
      for (const collection of all) {
        for (const [id, owner] of collection) {
          if (present.has(id)) continue;
          owner.dispose();
          collection.delete(id);
        }
      }
      const previous = new Map(rows.map((row) => [row.id, row]));
      // A run starts at a reasoning step that does not continue an earlier one
      // and takes every later reasoning step reached through tool messages only.
      const runs = new Map<string, Message[]>();
      let open: Message[] | undefined;
      for (const message of next.messages) {
        if (message.role === 'tool') continue;
        if (message.role === 'assistant' && message.reasoning) {
          if (open) open.push(message);
          else runs.set(message.id, (open = [message]));
        } else open = undefined;
      }
      for (const [id, owner] of runOwners) {
        if ((runs.get(id)?.length ?? 0) > 1) continue;
        owner.dispose();
        runOwners.delete(id);
      }
      const projected = next.messages.map((message): MessageRow<TTools> => {
        const document = {
          generation: message.delivery.generation,
          phase: message.delivery.phase,
          content: message.content,
        };
        const markdown = projectMarkdown(owners, message.id, document);
        let reasoning: MarkdownSnapshot | undefined;
        if (message.reasoning !== undefined && message.reasoning.length > 0) {
          reasoning = projectMarkdown(reasoningOwners, message.id, {
            generation: `${message.delivery.generation}:reasoning`,
            phase: message.delivery.phase,
            content: message.reasoning,
          });
        } else {
          reasoningOwners.get(message.id)?.dispose();
          reasoningOwners.delete(message.id);
        }
        const steps = runs.get(message.id);
        let reasoningRun: ReasoningRun | undefined;
        if (steps && reasoning) {
          const last = steps[steps.length - 1];
          const measured = steps
            .map((step) => step.reasoningDurationMs)
            .filter(
              (duration): duration is number =>
                typeof duration === 'number' && Number.isFinite(duration)
            );
          const durationMs = measured.length
            ? measured.reduce((total, duration) => total + duration, 0)
            : undefined;
          const snapshot =
            steps.length === 1
              ? reasoning
              : projectMarkdown(runOwners, message.id, {
                  // The first step names the document, so steps joining later
                  // extend it instead of replacing it.
                  generation: `${message.delivery.generation}:reasoning-run`,
                  phase: last.delivery.phase,
                  content: steps.map((step) => step.reasoning).join('\n\n'),
                });
          const before = previous.get(message.id)?.reasoningRun;
          reasoningRun =
            before?.snapshot === snapshot &&
            before.steps === steps.length &&
            before.durationMs === durationMs
              ? before
              : Object.freeze({
                  snapshot,
                  steps: steps.length,
                  ...(durationMs === undefined ? {} : { durationMs }),
                });
        }
        const calls = projectedCalls.filter(
          (call) =>
            message.toolCallIds?.includes(call.id) ||
            message.toolCallId === call.id
        );
        const old = previous.get(message.id);
        if (
          old?.message === message &&
          old.markdown === markdown &&
          old.reasoning === reasoning &&
          old.reasoningRun === reasoningRun &&
          old.toolCalls.length === calls.length &&
          calls.every((call, index) => call === old.toolCalls[index])
        )
          return old;
        return Object.freeze({
          id: message.id,
          role: message.role,
          message,
          markdown,
          ...(reasoning === undefined ? {} : { reasoning }),
          ...(reasoningRun === undefined ? {} : { reasoningRun }),
          toolCalls: Object.freeze(calls),
        });
      });
      if (
        projected.length !== rows.length ||
        projected.some((row, index) => row !== rows[index])
      )
        rows = Object.freeze(projected);
      messages = next.messages;
      toolCalls = next.toolCalls;
      return rows;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const collection of all) {
        for (const owner of collection.values()) owner.dispose();
        collection.clear();
      }
    },
  };
}
