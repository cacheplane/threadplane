export const CAMPAIGN_TIME_ZONE = 'America/Los_Angeles';

const calendar = new Intl.DateTimeFormat('en-US', {
  timeZone: CAMPAIGN_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
});

function parts(date: Date) {
  if (!Number.isFinite(date.getTime()))
    throw new Error('Invalid campaign date');
  const values = Object.fromEntries(
    calendar.formatToParts(date).map((p) => [p.type, p.value])
  );
  return {
    year: Number(values['year']),
    month: Number(values['month']),
    day: Number(values['day']),
    hour: Number(values['hour']),
  };
}

/** Count local calendar weekdays, always excluding the anchor date. */
export function businessMorningAfter(anchor: Date, businessDays: number): Date {
  if (
    !Number.isSafeInteger(businessDays) ||
    businessDays < 1 ||
    businessDays > 366
  )
    throw new Error('Invalid business-day offset');
  const local = parts(anchor);
  const day = new Date(Date.UTC(local.year, local.month - 1, local.day));
  let remaining = businessDays;
  while (remaining > 0) {
    day.setUTCDate(day.getUTCDate() + 1);
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) remaining--;
  }
  // 15:00 UTC is 07:00 or 08:00 Pacific. Resolve the target date's own
  // offset, not the anchor's, so crossing DST preserves the local hour.
  day.setUTCHours(15);
  day.setUTCHours(day.getUTCHours() + 7 - parts(day).hour);
  return day;
}

export function isCampaignSendWindow(now: Date): boolean {
  const local = parts(now);
  const weekday = new Date(
    Date.UTC(local.year, local.month - 1, local.day)
  ).getUTCDay();
  return weekday !== 0 && weekday !== 6 && local.hour === 7;
}

/** The Pacific calendar date for `now`, and whether it is Monday to Friday. */
export function pacificCalendarDate(now: Date): {
  date: string;
  weekday: boolean;
} {
  const local = parts(now);
  const day = new Date(Date.UTC(local.year, local.month - 1, local.day));
  const weekday = day.getUTCDay() !== 0 && day.getUTCDay() !== 6;
  const pad = (value: number) => String(value).padStart(2, '0');
  return {
    date: `${local.year}-${pad(local.month)}-${pad(local.day)}`,
    weekday,
  };
}
