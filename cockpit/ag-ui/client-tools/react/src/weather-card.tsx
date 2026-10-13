import type { WeatherArguments } from './tools';
export function WeatherCard({
  reading,
}: {
  readonly reading: Readonly<WeatherArguments>;
}) {
  return (
    <section
      className="weather-card"
      aria-label={`Simulated weather for ${reading.location}`}
    >
      <h3>Simulated weather</h3>
      <p>{reading.location}</p>
      <dl>
        <dt>Temperature</dt>
        <dd>{reading.temperatureF}°F</dd>
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
