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
  readonly toolCalls: readonly ToolCall<TTools>[];
}

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

export interface MessageContentOptions {
  /** @internal Test seam. */
  readonly markdownFactory?: typeof createMarkdown;
}

export function createMessageContent<
  TTools extends { [K in keyof TTools]: ToolContract } = Record<
    string,
    ToolContract
  >
>(options: MessageContentOptions = {}): MessageContent<TTools> {
  const factory = options.markdownFactory ?? createMarkdown;
  const owners = new Map<string, Markdown>();
  const reasoningOwners = new Map<string, Markdown>();
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
      for (const collection of [owners, reasoningOwners]) {
        for (const [id, owner] of collection) {
          if (present.has(id)) continue;
          owner.dispose();
          collection.delete(id);
        }
      }
      const previous = new Map(rows.map((row) => [row.id, row]));
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
      for (const collection of [owners, reasoningOwners]) {
        for (const owner of collection.values()) owner.dispose();
        collection.clear();
      }
    },
  };
}
