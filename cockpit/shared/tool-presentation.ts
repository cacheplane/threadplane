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

/**
 * Summaries of confirmed demo aviation data, plus the lookup tools' declared
 * `{ "error": string }` result shown as a failed call. Execution stays with the
 * session, and a not-found lookup is not retried because the answer is fixed.
 */
export function exampleToolOutcome(activity: {
  readonly phase?: string;
  readonly name: string;
  readonly resultText?: string;
}):
  | { readonly status?: 'succeeded'; readonly text: string }
  | { readonly status: 'failed'; readonly text: string }
  | undefined {
  if (activity.phase !== 'complete' || typeof activity.resultText !== 'string')
    return undefined;
  let result: unknown;
  try {
    result = JSON.parse(activity.resultText);
  } catch {
    return undefined;
  }
  if (!record(result)) return undefined;
  if ('error' in result) {
    const error = result['error'];
    // Only the two lookup tools declare this shape, and only as the whole result.
    return ['lookup_flight', 'get_airport_info'].includes(activity.name) &&
      Object.keys(result).length === 1 &&
      typeof error === 'string' &&
      error.trim().length > 0 &&
      error.length <= 300
      ? { status: 'failed', text: error.split('. Available:')[0] }
      : undefined;
  }
  if (activity.name === 'lookup_flight' && flightResult(result)) {
    const status =
      result['status'] === 'on_time' ? 'on time' : result['status'];
    return {
      text: `${result['flight_number']}: ${status} · Gate ${result['gate']}`,
    };
  }
  if (
    activity.name === 'get_airport_info' &&
    airportCode(result['code']) &&
    typeof result['name'] === 'string' &&
    result['name'].trim().length > 0 &&
    result['name'].length <= 140
  ) {
    return { text: `${result['code']}: ${result['name']}` };
  }
  if (
    activity.name === 'find_routes' &&
    airportCode(result['from']) &&
    airportCode(result['to']) &&
    Array.isArray(result['flights']) &&
    result['flights'].every(
      (item) =>
        flightResult(item) &&
        item['from'] === result['from'] &&
        item['to'] === result['to']
    )
  ) {
    const count = result['flights'].length;
    return {
      text: `${count} ${count === 1 ? 'flight' : 'flights'} from ${
        result['from']
      } to ${result['to']}`,
    };
  }
  return undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function airportCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value);
}
function flightResult(value: unknown): value is Record<string, unknown> {
  return (
    record(value) &&
    !('error' in value) &&
    typeof value['flight_number'] === 'string' &&
    /^[A-Z0-9]{2,3}\d{1,4}$/.test(value['flight_number']) &&
    ['on_time', 'delayed', 'cancelled'].includes(value['status'] as string) &&
    typeof value['gate'] === 'string' &&
    /^[A-Z0-9-]{1,15}$/.test(value['gate']) &&
    airportCode(value['from']) &&
    airportCode(value['to'])
  );
}
