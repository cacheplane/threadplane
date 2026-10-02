import type { WeatherReading } from './tool-view-policy';

/** Displays observed server data; completion and commands belong to the session. */
export function WeatherCard({
  reading,
}: {
  readonly reading: WeatherReading | undefined;
}) {
  if (!reading) return <p>Waiting for weather data…</p>;
  return (
    <section
      className="weather-card"
      aria-label={`Weather result for ${reading.location}`}
    >
      <h3>Weather for {reading.location}</h3>
      <dl>
        <dt>Temperature</dt>
        <dd>{reading.temperatureF} °F</dd>
        <dt>Conditions</dt>
        <dd>{reading.conditions}</dd>
        <dt>Humidity</dt>
        <dd>{reading.humidity}%</dd>
        <dt>Wind</dt>
        <dd>{reading.windMph} mph</dd>
      </dl>
    </section>
  );
}
