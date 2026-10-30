import type { Channel } from './types.ts';

const TIME_ZONE = 'America/Los_Angeles';

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  weekday: 'short',
});

function pacificParts(instant: Date): Record<string, string> {
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) parts[part.type] = part.value;
  return parts;
}

/** Offset (ms) of Pacific wall-clock time from UTC at the given instant. */
function pacificOffsetMs(instant: Date): number {
  const p = pacificParts(instant);
  const asUtc = Date.UTC(
    Number(p['year']),
    Number(p['month']) - 1,
    Number(p['day']),
    Number(p['hour']),
    Number(p['minute']),
    Number(p['second']),
  );
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Convert a Pacific wall-clock `YYYY-MM-DD` + `HH:mm` to the matching instant. */
export function pacificDateTime(date: string, time: string): Date {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const wallAsUtc = Date.UTC(y, mo - 1, d, h, mi);
  // Resolve the offset at the target wall time itself, so DST days are right.
  let instant = wallAsUtc - pacificOffsetMs(new Date(wallAsUtc));
  instant = wallAsUtc - pacificOffsetMs(new Date(instant));
  return new Date(instant);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The next Monday strictly after `date`, as a Pacific `YYYY-MM-DD`. */
export function weekStartFor(date: Date): string {
  const p = pacificParts(date);
  const today = `${p['year']}-${p['month']}-${p['day']}`;
  const dow = WEEKDAYS.indexOf(p['weekday']);
  const ahead = (8 - dow) % 7 || 7;
  return addDays(today, ahead);
}

export interface DefaultSlot {
  channel: Channel;
  slot: string;
  publishAt: Date;
}

const DAY_NAMES = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** Default weekly layout, anchored on a Monday `weekStart` (Pacific). */
export function defaultSlots(weekStart: string): DefaultSlot[] {
  const day = (offset: number) => addDays(weekStart, offset);
  const slots: DefaultSlot[] = [];
  DAY_NAMES.forEach((name, i) => {
    slots.push({ channel: 'x', slot: `x-${name}`, publishAt: pacificDateTime(day(i), '08:30') });
  });
  for (const i of [1, 2, 3]) {
    slots.push({
      channel: 'linkedin',
      slot: `linkedin-${DAY_NAMES[i]}`,
      publishAt: pacificDateTime(day(i), '08:00'),
    });
  }
  slots.push({ channel: 'blog', slot: 'blog', publishAt: pacificDateTime(day(1), '09:00') });
  slots.push({ channel: 'devto', slot: 'devto', publishAt: pacificDateTime(day(3), '09:00') });
  return slots;
}

/** The Monday on or before `date`, as a Pacific `YYYY-MM-DD`. */
export function pacificWeekContaining(date: Date): string {
  const [y, m, d] = weekStartFor(date).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 7)).toISOString().slice(0, 10);
}
