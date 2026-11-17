import type { FunctionTool } from '@threadplane/core/tools';

export interface LocationArguments { location: string }
export interface WeatherArguments extends LocationArguments {
  temperatureF: number;
  conditions: string;
  humidity: number;
  windMph: number;
}
export interface StatusArguments { label?: string }
export interface BookingArguments { summary: string }
export interface BookingInvocation {
  readonly ownerGeneration: number;
  readonly callId: string;
  readonly assistantMessageId: string;
  readonly sourceRunId: string;
  readonly summary: string;
}
export interface BookingDecision { confirmed: boolean }
/** The booking question as a function tool whose handler waits for the person's answer. */
export type BookingAsk = FunctionTool<BookingArguments, BookingDecision>;

function argumentsRecord(input: unknown, keys: readonly string[]): object {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid tool arguments');
  const prototype = Object.getPrototypeOf(input);
  if ((prototype !== Object.prototype && prototype !== null) ||
    Reflect.ownKeys(input).some((key) => typeof key !== 'string' || !keys.includes(key))) {
    throw new Error('Invalid tool arguments');
  }
  return input;
}
function field(input: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new Error('Invalid tool arguments');
  return descriptor.value;
}
function text(input: object, key: string): string {
  const value = field(input, key);
  if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid tool arguments');
  return value;
}
function number(input: object, key: string): number {
  const value = field(input, key);
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid tool arguments');
  return value;
}
const weatherKeys = ['location', 'temperatureF', 'conditions', 'humidity', 'windMph'];
/** Business validation also lets native projection admit only complete local readings. */
export function validateWeatherArguments(input: unknown): WeatherArguments {
  const record = argumentsRecord(input, weatherKeys);
  const value = {
    location: text(record, 'location'), temperatureF: number(record, 'temperatureF'),
    conditions: text(record, 'conditions'), humidity: number(record, 'humidity'), windMph: number(record, 'windMph'),
  };
  if (value.humidity < 0 || value.humidity > 100 || value.windMph < 0) throw new Error('Invalid tool arguments');
  return value;
}
export function validateBookingArguments(input: unknown): BookingArguments {
  return { summary: text(argumentsRecord(input, ['summary']), 'summary') };
}
const weatherParameters = Object.freeze({
  type: 'object', additionalProperties: false, required: Object.freeze(weatherKeys),
  properties: Object.freeze({
    location: Object.freeze({ type: 'string', minLength: 1 }),
    temperatureF: Object.freeze({ type: 'number' }),
    conditions: Object.freeze({ type: 'string', minLength: 1 }),
    humidity: Object.freeze({ type: 'number', minimum: 0, maximum: 100 }),
    windMph: Object.freeze({ type: 'number', minimum: 0 }),
  }),
});
const aborted = () => new DOMException('Client tool cancelled', 'AbortError');
function sameInvocation(left: BookingInvocation, right: BookingInvocation): boolean {
  return left.ownerGeneration === right.ownerGeneration && left.callId === right.callId &&
    left.assistantMessageId === right.assistantMessageId && left.sourceRunId === right.sourceRunId && left.summary === right.summary;
}
/**
 * Owns business promises only. The native session supplies every protocol identity, and `ask`
 * (the booking declared in booking.tsx) waits for the person's answer.
 */
export function createClientToolsController(readCurrentBooking: () => BookingInvocation | undefined, ask: BookingAsk) {
  let disposed = false;
  const cancellations = new Set<() => void>();
  // One native call is asked once, even after it was cancelled.
  const asked: BookingInvocation[] = [];
  // Disposal revokes a waiting booking, like Stop.
  const disposal = new AbortController();
  function active(signal: AbortSignal) {
    if (disposed || signal.aborted) throw aborted();
  }
  function current(signal: AbortSignal): BookingInvocation | undefined {
    active(signal);
    const value = readCurrentBooking();
    active(signal);
    if (!value) return undefined;
    const record = argumentsRecord(value, ['ownerGeneration', 'callId', 'assistantMessageId', 'sourceRunId', 'summary']);
    const ownerGeneration = number(record, 'ownerGeneration');
    if (!Number.isSafeInteger(ownerGeneration) || ownerGeneration < 0) return undefined;
    const identity = Object.freeze({ ownerGeneration, callId: text(record, 'callId'),
      assistantMessageId: text(record, 'assistantMessageId'), sourceRunId: text(record, 'sourceRunId'), summary: text(record, 'summary') });
    active(signal);
    return identity;
  }
  function delay(signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      active(signal);
      let finished = false;
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); cancellations.delete(cancel); };
      const cancel = () => { if (finished) return; finished = true; cleanup(); reject(aborted()); };
      const timer = setTimeout(() => {
        if (finished) return;
        if (disposed || signal.aborted) { cancel(); return; }
        finished = true; cleanup(); resolve();
      }, 3000);
      cancellations.add(cancel);
      signal.addEventListener('abort', cancel, { once: true });
      if (disposed || signal.aborted) cancel();
    });
  }
  async function showWeather(input: WeatherArguments, signal: AbortSignal): Promise<{ displayed: true }> {
    active(signal); validateWeatherArguments(input); active(signal);
    return { displayed: true };
  }
  const tools = Object.freeze({
    get_weather: Object.freeze({
      description: 'Return simulated local weather readings for a location.', followUp: true,
      parameters: Object.freeze({ type: 'object', additionalProperties: false,
        required: Object.freeze(['location']), properties: Object.freeze({ location: Object.freeze({ type: 'string', minLength: 1 }) }) }),
      async handler(input: LocationArguments, { signal }) {
        active(signal); const location = text(argumentsRecord(input, ['location']), 'location');
        await Promise.resolve(); active(signal);
        return { location, temperatureF: 68, conditions: 'Sunny', humidity: 55, windMph: 8 };
      },
    } satisfies FunctionTool<LocationArguments, WeatherArguments>),
    slow_status_check: Object.freeze({
      description: 'Run a cancellable local status check lasting three seconds.', followUp: true,
      parameters: Object.freeze({ type: 'object', additionalProperties: false, required: Object.freeze([]),
        properties: Object.freeze({ label: Object.freeze({ type: 'string', minLength: 1, default: 'status check' }) }) }),
      async handler(input: StatusArguments, { signal }): Promise<{ label: string; status: 'complete' }> {
        active(signal); const record = argumentsRecord(input, ['label']);
        const label = Object.hasOwn(record, 'label') ? text(record, 'label') : 'status check';
        active(signal); await delay(signal); active(signal);
        return { label, status: 'complete' };
      },
    } satisfies FunctionTool<StatusArguments, { label: string; status: 'complete' }>),
    weather_card: Object.freeze({
      description: 'Display complete simulated weather readings and allow an assistant follow-up.',
      parameters: weatherParameters, followUp: true,
      handler: (input: WeatherArguments, { signal }) => showWeather(input, signal),
    } satisfies FunctionTool<WeatherArguments, { displayed: true }>),
    weather_snapshot: Object.freeze({
      description: 'Display a terminal simulated weather snapshot without an assistant follow-up.',
      parameters: weatherParameters, followUp: false,
      handler: (input: WeatherArguments, { signal }) => showWeather(input, signal),
    } satisfies FunctionTool<WeatherArguments, { displayed: true }>),
    confirm_booking: Object.freeze({
      description: 'Ask for an explicit fictional booking decision. No real reservation is made.', followUp: true,
      parameters: Object.freeze({ type: 'object', additionalProperties: false, required: Object.freeze(['summary']),
        properties: Object.freeze({ summary: Object.freeze({ type: 'string', minLength: 1 }) }) }),
      // Check the arguments and the native call first, so the card only ever shows an admitted booking.
      async handler(input: BookingArguments, { signal }) {
        active(signal); const { summary } = validateBookingArguments(input); active(signal);
        let identity: BookingInvocation | undefined;
        try { identity = current(signal); } catch (error) { if (signal.aborted || disposed) throw aborted(); throw new Error('Booking invocation unavailable', { cause: error }); }
        if (!identity || identity.summary !== summary || asked.some((entry) => sameInvocation(entry, identity))) {
          throw new Error('Booking invocation unavailable');
        }
        asked.push(identity);
        return ask.handler({ summary }, { signal: AbortSignal.any([signal, disposal.signal]) });
      },
    } satisfies BookingAsk),
  });
  return Object.freeze({
    tools,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const cancel of [...cancellations]) cancel();
      disposal.abort();
    },
  });
}
