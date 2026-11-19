import type { AGUIEvent } from '@ag-ui/client';
import type { Observation } from './session-observation.js';
import type { Transcript } from './transcript.js';

type Durations = Readonly<Record<string, number>>;

/** Runs of consecutive root reasoning records, as their IDs, in order. */
function reasoningRuns(transcript: Transcript): string[][] {
  const runs: string[][] = [];
  let open: string[] | undefined;
  for (const record of transcript) {
    if (typeof record.subagentRunId === 'string' || record.role === 'activity')
      continue;
    if (record.role !== 'reasoning') open = undefined;
    else if (open) open.push(record.id);
    else runs.push((open = [record.id]));
  }
  return runs;
}

/**
 * Keeps measured times when a messages snapshot replaces the transcript.
 *
 * A backend can stream a step's reasoning as several messages and then send
 * the saved history with fewer records under other IDs. When the transcript
 * has as many runs of reasoning after the snapshot as before, each run keeps
 * its measured total, on its first record when its IDs changed. Otherwise only
 * the times of records that are still present are kept.
 */
export function carryReasoningDurations(
  previous: Transcript,
  next: Transcript,
  durations: Durations | undefined
): Durations | undefined {
  if (!durations || previous === next) return durations;
  const before = reasoningRuns(previous);
  const after = reasoningRuns(next);
  const carried: Record<string, number> = Object.create(null);
  const measured = (id: string) =>
    Object.hasOwn(durations, id) ? durations[id] : undefined;
  if (before.length === after.length)
    after.forEach((ids, index) => {
      const old = before[index];
      if (old.length === ids.length && old.every((id, at) => id === ids[at])) {
        for (const id of ids) {
          const time = measured(id);
          if (time !== undefined) carried[id] = time;
        }
        return;
      }
      let total: number | undefined;
      for (const id of old) {
        const time = measured(id);
        if (time !== undefined) total = (total ?? 0) + time;
      }
      if (total !== undefined) carried[ids[0]] = total;
    });
  else
    for (const ids of after)
      for (const id of ids) {
        const time = measured(id);
        if (time !== undefined) carried[id] = time;
      }
  const keys = Object.keys(carried);
  if (keys.length === 0) return undefined;
  return keys.length === Object.keys(durations).length &&
    keys.every((id) => measured(id) === carried[id])
    ? durations
    : Object.freeze(carried);
}

/**
 * Times root reasoning messages between their start and end events.
 *
 * The protocol sends no duration, so this is arrival time on the local clock.
 * A reasoning message whose end event never arrives stays unmeasured, as does
 * any reasoning supplied at restore. A messages snapshot keeps the measured
 * times of the reasoning it still carries (see `carryReasoningDurations`).
 */
export function createReasoningClock(now: () => number = () => Date.now()) {
  const started = new Map<string, number>();
  return {
    /**
     * Returns `next`, with the measured time added when a reasoning message
     * ends. `previous` is the snapshot the event was applied to; with it, a
     * messages snapshot carries the measured times over to the new records.
     */
    observe<T extends Observation>(
      event: AGUIEvent,
      next: T,
      previous?: Observation
    ): T {
      if (event.type === 'MESSAGES_SNAPSHOT' && previous) {
        const carried = carryReasoningDurations(
          previous.transcript,
          next.transcript,
          next.reasoningDurations
        );
        if (carried === next.reasoningDurations) return next;
        const { reasoningDurations: _dropped, ...rest } = next;
        return Object.freeze(
          carried ? { ...rest, reasoningDurations: carried } : rest
        ) as T;
      }
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
