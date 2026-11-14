import type { Message } from '@threadplane/core';

interface Timing {
  /** Where the message sat when last seen, to follow a replaced identifier. */
  index: number;
  /** Absent when the reasoning was never seen arriving, so it has no time. */
  startedAt?: number;
  durationMs?: number;
}

/** Reasoning is over once the step writes text, calls a tool or completes. */
const settled = (message: Message) =>
  message.content.length > 0 ||
  (message.toolCallIds?.length ?? 0) > 0 ||
  message.delivery.phase === 'complete';

/**
 * Times assistant reasoning as it arrives, one observation per publication.
 *
 * The backend sends reasoning text without a duration, so the time shown is
 * arrival time on this clock: from the first publication in which a step has
 * reasoning and nothing else, to the first in which it has text, a tool call
 * or a completed delivery. Reasoning that is first seen already settled (saved
 * history, or a step delivered whole) was never observed arriving and stays
 * unmeasured. Nothing here is stored or sent; a session created later knows no
 * durations.
 */
export function createReasoningTimer(
  now: () => number = () => Date.now()
) {
  const timings = new Map<string, Timing>();

  return {
    /** Returns the messages, stamping `reasoningDurationMs` where measured. */
    observe(messages: readonly Message[]): readonly Message[] {
      let at: number | undefined;
      const clock = () => (at ??= now());
      const present = new Set(messages.map((message) => message.id));
      // A provisional stream identifier can be replaced in place by the saved
      // one. The step is the same, so its timing follows the position.
      const replaced = new Map<number, Timing>();
      for (const [id, timing] of timings) {
        if (present.has(id)) continue;
        timings.delete(id);
        replaced.set(timing.index, timing);
      }
      let changed = false;
      const stamped = messages.map((message, index) => {
        if (message.role !== 'assistant') return message;
        let timing = timings.get(message.id);
        if (!timing) {
          const moved = replaced.get(index);
          if (moved) timings.set(message.id, (timing = moved));
        }
        if (!timing) {
          if (!message.reasoning) return message;
          timing = settled(message) ? { index } : { index, startedAt: clock() };
          timings.set(message.id, timing);
        }
        timing.index = index;
        if (
          timing.startedAt !== undefined &&
          timing.durationMs === undefined &&
          settled(message)
        )
          timing.durationMs = Math.max(0, clock() - timing.startedAt);
        // A correction that removes the reasoning removes its time with it.
        if (!message.reasoning || timing.durationMs === undefined)
          return message;
        changed = true;
        return { ...message, reasoningDurationMs: timing.durationMs };
      });
      return changed ? stamped : messages;
    },
  };
}
