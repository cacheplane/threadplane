import type { TripSummaryCard } from '../../shared/message-content';

export function TripSummary({ card }: { card: TripSummaryCard }) {
  return (
    <section className="trip-summary" aria-label="Trip summary">
      <h4>{card.title}</h4>
      <p className="trip-summary-counts">
        {card.dayCount} {card.dayCount === 1 ? 'day' : 'days'} ·{' '}
        {card.stopCount} {card.stopCount === 1 ? 'stop' : 'stops'}
      </p>
      {card.days.length === 0 ? (
        <p>No days supplied.</p>
      ) : (
        <ol className="trip-summary-days">
          {card.days.map((day, dayIndex) => (
            <li className="trip-summary-day" key={dayIndex}>
              <h5>{day.label}</h5>
              {day.places.length === 0 ? (
                <p>No stops</p>
              ) : (
                <ul>
                  {day.places.map((place, placeIndex) => (
                    <li className="trip-summary-place" key={placeIndex}>
                      {place}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
      {card.note !== undefined && (
        <p className="trip-summary-note">{card.note}</p>
      )}
    </section>
  );
}
