import type {
  AgentSnapshot,
  Message,
  ToolCall,
  ToolContract,
} from '@threadplane/core';
import { createMarkdown } from '../markdown/create-markdown.js';
import type { Markdown, MarkdownSnapshot } from '../markdown/types.js';

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
      for (const [id, owner] of owners) {
        if (present.has(id)) continue;
        owner.dispose();
        owners.delete(id);
      }
      const previous = new Map(rows.map((row) => [row.id, row]));
      const projected = next.messages.map((message): MessageRow<TTools> => {
        const document = {
          generation: message.delivery.generation,
          phase: message.delivery.phase,
          content: message.content,
        };
        let owner = owners.get(message.id);
        if (!owner) {
          owner = factory(document, { violationPolicy: 'rebuild' });
          owners.set(message.id, owner);
        } else {
          const accepted = owner.getSnapshot().document;
          if (
            accepted.generation !== document.generation ||
            accepted.phase !== document.phase ||
            accepted.content !== document.content
          )
            owner.update(document);
        }
        const markdown = owner.getSnapshot();
        const calls = projectedCalls.filter(
          (call) =>
            message.toolCallIds?.includes(call.id) ||
            message.toolCallId === call.id
        );
        const old = previous.get(message.id);
        if (
          old?.message === message &&
          old.markdown === markdown &&
          old.toolCalls.length === calls.length &&
          calls.every((call, index) => call === old.toolCalls[index])
        )
          return old;
        return Object.freeze({
          id: message.id,
          role: message.role,
          message,
          markdown,
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
      for (const owner of owners.values()) owner.dispose();
      owners.clear();
    },
  };
}
