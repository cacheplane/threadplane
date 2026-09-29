import {
  createMarkdown,
  type Markdown,
  type MarkdownSnapshot,
} from '@threadplane/content/markdown';
import type { Message } from '@threadplane/core';
import { formatTripSummary, type ApplicationToolCall } from './trip-summary.js';

export type TripSummaryCard = ReturnType<typeof formatTripSummary> & {
  readonly callId: string;
};

export interface MessageContent {
  readonly id: string;
  readonly role: Message['role'];
  readonly message: Message;
  readonly markdown: MarkdownSnapshot;
  readonly toolCalls: readonly ApplicationToolCall[];
  readonly tripSummaries: readonly TripSummaryCard[];
}

// Private application composition, not a package API or a view capability.
export function createMessageContent(
  factory: typeof createMarkdown = createMarkdown
) {
  const owners = new Map<string, Markdown>();
  const cards = new WeakMap<ApplicationToolCall, TripSummaryCard>();
  let snapshot: readonly MessageContent[] = Object.freeze([]);
  let disposed = false;
  return {
    getSnapshot: () => snapshot,
    update(
      messages: readonly Message[],
      toolCalls: readonly ApplicationToolCall[]
    ) {
      if (disposed) return;
      const present = new Set(messages.map((message) => message.id));
      for (const [id, owner] of owners) {
        if (present.has(id)) continue;
        owner.dispose();
        owners.delete(id);
      }
      const previous = new Map(snapshot.map((row) => [row.id, row]));
      const rows = messages.map((message): MessageContent => {
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
        const calls = toolCalls.filter(
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
        const tripSummaries =
          message.role === 'assistant'
            ? calls.flatMap((call) => {
                if (
                  call.status !== 'complete' ||
                  !message.toolCallIds?.includes(call.id)
                )
                  return [];
                let card = cards.get(call);
                if (!card) {
                  card = Object.freeze({
                    callId: call.id,
                    ...formatTripSummary(call.args),
                  });
                  cards.set(call, card);
                }
                return [card];
              })
            : [];
        return Object.freeze({
          id: message.id,
          role: message.role,
          message,
          markdown,
          toolCalls: Object.freeze(calls),
          tripSummaries: Object.freeze(tripSummaries),
        });
      });
      if (
        rows.length !== snapshot.length ||
        rows.some((row, index) => row !== snapshot[index])
      )
        snapshot = Object.freeze(rows);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const owner of owners.values()) owner.dispose();
      owners.clear();
      // Retained rows remain readable, including their frozen Markdown trees.
    },
  };
}
