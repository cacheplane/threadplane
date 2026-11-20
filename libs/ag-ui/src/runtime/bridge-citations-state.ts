import type { Message } from '@threadplane/core';
import { copyData } from './copy-data.js';
import { citation } from './message-projection.js';

/**
 * Attaches the citations an AG-UI thread carries in its `state`
 * (`state.citations`, keyed by message id) to the matching messages. A session
 * already does this for the messages it publishes; this helper is for messages
 * held outside a session.
 *
 * @param thread - The container holding `state.citations`.
 * @param messages - The messages to enrich.
 * @returns A new array where matching messages gain their `citations`; a
 *   message without citations is returned unchanged.
 * @example
 * ```ts
 * const enriched = bridgeCitationsState({ state }, messages);
 * ```
 */
export function bridgeCitationsState(
  thread: { readonly state?: unknown },
  messages: readonly Message[]
): readonly Message[] {
  const byMessage = (thread.state as { citations?: unknown } | undefined)
    ?.citations;
  if (!byMessage || typeof byMessage !== 'object') return messages;
  const map = byMessage as Record<string, unknown>;
  return messages.map((message) => {
    const raw = map[message.id];
    if (!Array.isArray(raw) || raw.length === 0) return message;
    return {
      ...message,
      citations: copyData(raw.map(citation), true) as Message['citations'],
    };
  });
}
