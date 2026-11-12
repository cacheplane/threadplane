import type { BookingPanel } from './tools';
export function ConfirmBooking({
  booking,
  respond,
}: {
  readonly booking: BookingPanel;
  readonly respond: (token: string, confirmed: boolean) => void;
}) {
  return (
    <section aria-label="Fictional booking" className="booking-panel">
      <h3>Fictional booking</h3>
      <p>{booking.summary}</p>
      <p>No real reservation will be made.</p>
      {booking.status === 'pending' ? (
        <div>
          <button type="button" onClick={() => respond(booking.token, true)}>
            Confirm
          </button>{' '}
          <button type="button" onClick={() => respond(booking.token, false)}>
            Cancel booking
          </button>
        </div>
      ) : (
        <p>
          {booking.status === 'aborted'
            ? 'Booking decision cancelled.'
            : booking.confirmed
            ? 'You confirmed this fictional booking.'
            : 'You cancelled this fictional booking.'}
        </p>
      )}
    </section>
  );
}
