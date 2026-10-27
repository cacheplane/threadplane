import { boundedText, ownData, record, type Meeting } from './approval-policy';
export interface ScheduleSnapshot {
  readonly availability?: {
    readonly day: string;
    readonly slots: readonly string[];
  };
  readonly booking?: Readonly<Partial<Meeting>> & {
    readonly status?: 'pending' | 'booked' | 'declined';
  };
}
/** Observed shared state is display only; never infer a booking outcome from it. */
export function projectSchedule(state: unknown): ScheduleSnapshot | undefined {
  try {
    const s = record(ownData(state));
    if (!s) return;
    const availability = record(s['availability']),
      booking = record(s['booking']);
    const output: {
      availability?: ScheduleSnapshot['availability'];
      booking?: ScheduleSnapshot['booking'];
    } = {};
    if (
      availability &&
      boundedText(availability['day']) &&
      Array.isArray(availability['slots']) &&
      availability['slots'].length <= 100 &&
      availability['slots'].every((slot) => boundedText(slot))
    )
      output.availability = Object.freeze({
        day: availability['day'],
        slots: Object.freeze([...availability['slots']]),
      });
    if (booking) {
      const b: {
        topic?: string;
        slot?: string;
        status?: 'pending' | 'booked' | 'declined';
      } = {};
      if (boundedText(booking['topic'])) b.topic = booking['topic'];
      if (boundedText(booking['slot'])) b.slot = booking['slot'];
      if (
        ['pending', 'booked', 'declined'].includes(booking['status'] as string)
      )
        b.status = booking['status'] as 'pending' | 'booked' | 'declined';
      if (Object.keys(b).length) output.booking = Object.freeze(b);
    }
    return Object.keys(output).length ? Object.freeze(output) : undefined;
  } catch {
    return;
  }
}
