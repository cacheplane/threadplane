import type { AGUIEvent } from '@ag-ui/client';
import type { SessionSnapshot } from './session-observation.js';

/**
 * Times root reasoning messages between their start and end events.
 *
 * The protocol sends no duration, so this is arrival time on the local clock.
 * A reasoning message whose end event never arrives stays unmeasured, as does
 * any reasoning supplied at restore or replaced by a messages snapshot.
 */
export function createReasoningClock(now: () => number = () => Date.now()) {
  const started = new Map<string, number>();
  return {
    /** Returns `next`, with the measured time added when a reasoning message ends. */
    observe<T extends SessionSnapshot>(event: AGUIEvent, next: T): T {
      if (
        event.type !== 'REASONING_MESSAGE_START' &&
        event.type !== 'REASONING_MESSAGE_END'
      )
        return next;
      if (typeof event.subagentRunId === 'string') return next;
      const id = event.messageId;
      if (event.type === 'REASONING_MESSAGE_START') {
        started.set(id, now());
        return next;
      }
      const at = started.get(id);
      if (at === undefined) return next;
      started.delete(id);
      const durations: Record<string, number> = Object.create(null);
      Object.assign(durations, next.reasoningDurations);
      durations[id] = Math.max(0, now() - at);
      return Object.freeze({
        ...next,
        reasoningDurations: Object.freeze(durations),
      });
    },
  };
}
