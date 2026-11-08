/** App-authored labels for the tools these examples actually implement. Unknown tools stay generic. */
export function exampleToolLabel(name: string): string | undefined {
  const labels: Readonly<Record<string, string>> = {
    query_airline_kpis: 'Checking airline performance',
    query_on_time_trend: 'Checking on-time trends',
    query_flights_by_airline: 'Comparing airlines',
    query_recent_disruptions: 'Checking recent disruptions',
    render_spec: 'Preparing dashboard layout',
    generate_json_render_spec: 'Preparing dashboard layout',
    generate_a2ui_schema: 'Preparing flight preview',
    lookup_flight: 'Looking up flight information',
    get_airport_info: 'Checking airport information',
    find_routes: 'Finding flight routes',
    weather_card: 'Checking the weather',
  };
  return Object.hasOwn(labels, name) ? labels[name] : undefined;
}
