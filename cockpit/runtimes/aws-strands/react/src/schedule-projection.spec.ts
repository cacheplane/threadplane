import { expect, it } from 'vitest';
import { projectSchedule } from './schedule-projection';
it('retains only bounded observed availability and booking, without synthesizing final status', () => {
  expect(
    projectSchedule({
      availability: null,
      booking: { topic: 'Q3', slot: 'Tuesday 10:00', status: 'pending' },
    })
  ).toEqual({
    booking: { topic: 'Q3', slot: 'Tuesday 10:00', status: 'pending' },
  });
  for (const status of ['pending', 'booked', 'declined'])
    expect(
      projectSchedule({
        availability: { day: 'Tuesday', slots: ['10:00', '15:00'] },
        booking: { topic: 'Q3', slot: 'Tuesday 10:00', status },
      })?.booking?.status
    ).toBe(status);
  expect(projectSchedule({ booking: { status: 'approved' } })).toBeUndefined();
  expect(
    projectSchedule({ availability: { day: 'Tuesday', slots: [5] } })
  ).toBeUndefined();
  expect(
    projectSchedule({ availability: { day: 'x'.repeat(501), slots: [] } })
  ).toBeUndefined();
  expect(projectSchedule({})).toBeUndefined();
});
it('does not invoke snapshot accessors', () => {
  let called = false;
  expect(
    projectSchedule({
      get booking() {
        called = true;
        return {};
      },
    })
  ).toBeUndefined();
  expect(called).toBe(false);
});
