import { createMarkdown } from '@threadplane/content/markdown';
import {
  createMessageContent as createSharedMessageContent,
  type MessageRow,
} from '@threadplane/content/messages';
import type { Message } from '@threadplane/core';
import {
  formatTripSummary,
  type ApplicationToolCall,
  type ApplicationToolContracts,
} from './trip-summary.js';

export type TripSummaryCard = ReturnType<typeof formatTripSummary> & {
  readonly callId: string;
};

export interface MessageContent extends MessageRow<ApplicationToolContracts> {
  readonly tripSummaries: readonly TripSummaryCard[];
}

// Private application composition, not a package API or a view capability.
export function createMessageContent(
  factory: typeof createMarkdown = createMarkdown,
  projectionFactory: typeof createSharedMessageContent<ApplicationToolContracts> = createSharedMessageContent
) {
  const content = projectionFactory({ markdownFactory: factory });
  const decorated = new WeakMap<
    MessageRow<ApplicationToolContracts>,
    MessageContent
  >();
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
      // Only transcript fields drive the projection; status is not interpreted.
      const base = content.project({ status: 'idle', messages, toolCalls });
      const rows = base.map((row): MessageContent => {
        const old = decorated.get(row);
        if (old) return old;
        const { message, toolCalls: calls } = row;
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
        const next = Object.freeze({
          ...row,
          tripSummaries: Object.freeze(tripSummaries),
        });
        decorated.set(row, next);
        return next;
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
      content.dispose();
      // Retained rows remain readable, including their frozen Markdown trees.
    },
  };
}
