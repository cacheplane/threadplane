// libs/chat/src/lib/primitives/chat-tool-calls/group-summary.ts

/**
 * Truthful generic summary for tool activity. A technical prefix does not
 * establish what kind of resource a tool actually used.
 *
 * Consumers can override the registry per-instance via the
 * `[groupSummary]` input on <chat-tool-calls>.
 */
export function summarizeGroup(_name: string, count: number): string {
  return `${count} tool ${count === 1 ? 'activity' : 'activities'}`;
}
