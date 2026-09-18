import {
  businessMorningAfter,
  isCampaignSendWindow,
  pacificCalendarDate,
} from './campaign-schedule.ts';

describe('Pacific campaign calendar', () => {
  it.each([
    ['2026-09-07T12:00:00Z', 1, '2026-09-08T14:00:00.000Z'],
    ['2026-09-11T18:00:00Z', 1, '2026-09-14T14:00:00.000Z'],
    ['2026-09-12T18:00:00Z', 1, '2026-09-14T14:00:00.000Z'],
    ['2026-09-13T18:00:00Z', 1, '2026-09-14T14:00:00.000Z'],
    ['2026-09-08T14:01:00Z', 3, '2026-09-11T14:00:00.000Z'],
    ['2026-09-11T14:01:00Z', 5, '2026-09-18T14:00:00.000Z'],
    ['2026-03-06T15:01:00Z', 1, '2026-03-09T14:00:00.000Z'],
    ['2026-10-30T14:01:00Z', 1, '2026-11-02T15:00:00.000Z'],
    ['2026-12-31T15:01:00Z', 1, '2027-01-01T15:00:00.000Z'],
    ['2026-09-08T01:00:00Z', 1, '2026-09-08T14:00:00.000Z'],
  ])('schedules %s plus %s weekdays', (input, days, expected) => {
    expect(businessMorningAfter(new Date(input), days).toISOString()).toBe(
      expected
    );
  });
  it.each([
    ['2026-09-08T13:59:59Z', false],
    ['2026-09-08T14:00:00Z', true],
    ['2026-09-08T14:59:59Z', true],
    ['2026-09-08T15:00:00Z', false],
    ['2026-09-12T14:00:00Z', false],
    ['2026-11-02T15:00:00Z', true],
  ])('checks the weekday morning send window %s', (input, expected) => {
    expect(isCampaignSendWindow(new Date(input))).toBe(expected);
  });
  it('rejects invalid dates and business-day offsets', () => {
    expect(() => businessMorningAfter(new Date('invalid'), 1)).toThrow();
    for (const offset of [0, -1, 1.5, Infinity])
      expect(() => businessMorningAfter(new Date(), offset)).toThrow();
    expect(() => isCampaignSendWindow(new Date('invalid'))).toThrow();
  });
});

describe('pacificCalendarDate', () => {
  it('returns the Pacific calendar date and whether it is a weekday', () => {
    // 2026-09-16T23:30Z is Wednesday 16:30 Pacific (PDT).
    expect(pacificCalendarDate(new Date('2026-09-16T23:30:00.000Z'))).toEqual({
      date: '2026-09-16',
      weekday: true,
    });
    // 2026-09-19T06:59Z is Friday 23:59 Pacific.
    expect(pacificCalendarDate(new Date('2026-09-19T06:59:00.000Z'))).toEqual({
      date: '2026-09-18',
      weekday: true,
    });
    // 2026-09-19T07:00Z is Saturday 00:00 Pacific.
    expect(pacificCalendarDate(new Date('2026-09-19T07:00:00.000Z'))).toEqual({
      date: '2026-09-19',
      weekday: false,
    });
  });

  it('rejects an invalid date', () => {
    expect(() => pacificCalendarDate(new Date('nope'))).toThrow('Invalid campaign date');
  });
});
