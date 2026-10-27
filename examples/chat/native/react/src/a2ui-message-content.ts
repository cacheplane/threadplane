import { createMarkdown } from '@threadplane/content/markdown';
import {
  createA2uiSurfaces,
  type A2uiSurfaces,
} from '@threadplane/content/a2ui';
import type { A2uiMessage } from '@threadplane/a2ui';
import type { Message } from '@threadplane/core';
import {
  createMessageContent,
  type MessageContent,
  type TripSummaryCard,
} from '../../shared/message-content.js';
import type { ApplicationToolCall } from '../../shared/trip-summary.js';
import {
  buildTripSurface,
  projectTripSurface,
  type A2uiTripSummaryRender,
} from './a2ui-trip-catalog.js';

export interface A2uiMessageContent extends MessageContent {
  readonly a2uiTripSummaryRenders: readonly A2uiTripSummaryRender[];
}
type RawOwner = Pick<A2uiSurfaces, 'apply' | 'getSnapshot' | 'dispose'>;
interface Options {
  readonly ownerFactory?: () => RawOwner;
  readonly markdownFactory?: typeof createMarkdown;
  readonly contentFactory?: () => ReturnType<typeof createMessageContent>;
  readonly projectSurface?: typeof projectTripSurface;
}
interface Entry {
  readonly card: TripSummaryCard;
  readonly prepared: A2uiTripSummaryRender;
}
interface MessageOwner {
  readonly generation: string;
  readonly raw: RawOwner;
  readonly entries: ReadonlyMap<string, Entry>;
}

// Private application composition: raw mutation capabilities never enter a row.
export function createA2uiMessageContent(options: Options = {}) {
  const base =
    options.contentFactory?.() ?? createMessageContent(options.markdownFactory);
  const createOwner = options.ownerFactory ?? createA2uiSurfaces;
  const project = options.projectSurface ?? projectTripSurface;
  let owners = new Map<string, MessageOwner>();
  const active = new Set<RawOwner>();
  let decorated = new WeakMap<MessageContent, A2uiMessageContent>();
  let snapshot: readonly A2uiMessageContent[] = Object.freeze([]);
  let disposed = false;

  function retire(raw: RawOwner): void {
    if (!active.delete(raw)) return;
    raw.dispose();
  }
  const remove = (surfaceId: string): A2uiMessage => ({
    version: 'v0.9',
    deleteSurface: { surfaceId },
  });

  return {
    getSnapshot: () => snapshot,
    update(
      messages: readonly Message[],
      calls: readonly ApplicationToolCall[]
    ): void {
      if (disposed) return;
      try {
        // Shared content can throw too. Preflight every authored description before
        // retiring owners or replacing a live surface.
        base.update(messages, calls);
        const plans = base.getSnapshot().map((row) => ({
          row,
          cards: row.tripSummaries.map((card) => ({
            card,
            description: buildTripSurface(card),
          })),
        }));
        const eligible = new Map(
          plans
            .filter(
              (plan) =>
                plan.row.message.role === 'assistant' && plan.cards.length > 0
            )
            .map((plan) => [plan.row.message.id, plan])
        );
        for (const [id, owner] of owners) {
          const plan = eligible.get(id);
          if (
            !plan ||
            owner.generation !== plan.row.message.delivery.generation
          ) {
            retire(owner.raw);
            owners.delete(id);
          }
        }
        const nextOwners = new Map<string, MessageOwner>();
        const pendingRows: [MessageContent, A2uiMessageContent][] = [];
        const rows = plans.map(({ row, cards }): A2uiMessageContent => {
          const prepared: A2uiTripSummaryRender[] = [];
          if (eligible.has(row.message.id)) {
            const previous = owners.get(row.message.id);
            const raw = previous?.raw ?? createOwner();
            active.add(raw); // Track a provisional owner before its first write.
            const entries = new Map<string, Entry>();
            const current = new Set(cards.map(({ card }) => card.callId));
            for (const callId of previous?.entries.keys() ?? []) {
              if (!current.has(callId)) raw.apply(remove(callId));
            }
            for (const { card, description } of cards) {
              let entry = previous?.entries.get(card.callId);
              if (entry?.card !== card) {
                if (entry) raw.apply(remove(card.callId));
                raw.apply({
                  version: 'v0.9',
                  createSurface: {
                    surfaceId: description.surfaceId,
                    catalogId: description.catalogId,
                  },
                });
                raw.apply({
                  version: 'v0.9',
                  updateComponents: {
                    surfaceId: description.surfaceId,
                    components: [...description.components],
                  },
                });
                const surface = raw
                  .getSnapshot()
                  .surfaces.find((value) => value.surfaceId === card.callId);
                if (!surface)
                  throw new TypeError(
                    'Authored trip surface was not published'
                  );
                entry = { card, prepared: project(surface, card.callId) };
              }
              entries.set(card.callId, entry);
              // Raw Map insertion order does not determine current card order.
              prepared.push(entry.prepared);
            }
            nextOwners.set(row.message.id, {
              generation: row.message.delivery.generation,
              raw,
              entries,
            });
          }
          const cached = decorated.get(row);
          if (
            cached &&
            cached.a2uiTripSummaryRenders.length === prepared.length &&
            prepared.every(
              (value, index) => value === cached.a2uiTripSummaryRenders[index]
            )
          )
            return cached;
          const next = Object.freeze({
            ...row,
            a2uiTripSummaryRenders: Object.freeze(prepared),
          });
          pendingRows.push([row, next]);
          return next;
        });
        // Publish the combined immutable result only after every owner and
        // projection succeeded. Until here the last accepted rows remain visible.
        owners = nextOwners;
        for (const [row, next] of pendingRows) decorated.set(row, next);
        if (
          rows.length !== snapshot.length ||
          rows.some((row, index) => row !== snapshot[index])
        )
          snapshot = Object.freeze(rows);
      } catch (error) {
        for (const raw of active) retire(raw);
        owners.clear();
        decorated = new WeakMap();
        // Keep shared Markdown alive; identical complete input can rebuild a new
        // raw-owner epoch even when the base reuses its own accepted row objects.
        throw error;
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const raw of active) retire(raw);
      owners.clear();
      decorated = new WeakMap();
      base.dispose();
    },
  };
}
