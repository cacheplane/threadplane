import type {
  MeetingApproval,
  OwnedTurn,
  NativeSnapshot,
} from './approval-policy';
import type { StrandsSnapshot } from './application';
import type { ScheduleSnapshot } from './schedule-projection';
function readonlyContract(
  view: StrandsSnapshot,
  approval: MeetingApproval,
  turn: OwnedTurn,
  native: NativeSnapshot,
  schedule: ScheduleSnapshot
) {
  // @ts-expect-error View generation is owned.
  view.generation = 42;
  // @ts-expect-error Root rows cannot be appended by the view.
  view.rows.push(turn.human);
  // @ts-expect-error Canonical meeting arguments are immutable.
  approval.meeting.topic = 'spoof';
  // @ts-expect-error Opaque native occurrence cannot be replaced.
  approval.pause = 'reconstructed';
  // @ts-expect-error Prefix is owned.
  turn.prefix.push(turn.human);
  // @ts-expect-error Native transcript is deeply readonly.
  native.transcript[0].id = 'spoof';
  // @ts-expect-error Observed schedule cannot confer mutable authority.
  if (schedule.booking) schedule.booking.status = 'booked';
  // @ts-expect-error Observed availability is readonly.
  if (schedule.availability) schedule.availability.slots.push('spoof');
}
void readonlyContract;
