import type { PlainValue } from '@threadplane/core';
import type { FunctionTool } from '@threadplane/core/tools';
import { createBookingTools, type BookingArguments, type BookingDecision } from './booking';

export interface LocationArguments { location: string }
export interface WeatherArguments extends LocationArguments {
  temperatureF: number;
  conditions: string;
  humidity: number;
  windMph: number;
}
export interface StatusArguments { label?: string }
export interface WeatherPanel extends Readonly<WeatherArguments> {
  readonly id: string;
}
export interface ClientToolsSnapshot {
  readonly weather: readonly WeatherPanel[];
}

function argumentsRecord(value: unknown, keys: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid tool arguments.');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new Error('Invalid tool arguments.');
  if (Object.keys(value).some((key) => !keys.includes(key)))
    throw new Error('Invalid tool arguments.');
  return value;
}
function field(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value'))
    throw new Error('Invalid tool arguments.');
  return descriptor.value;
}
function text(value: object, key: string): string {
  const entry = field(value, key);
  if (typeof entry !== 'string' || !entry.trim())
    throw new Error('Invalid tool arguments.');
  return entry;
}
function number(value: object, key: string): number {
  const entry = field(value, key);
  if (typeof entry !== 'number' || !Number.isFinite(entry))
    throw new Error('Invalid tool arguments.');
  return entry;
}
const weatherKeys = ['location', 'temperatureF', 'conditions', 'humidity', 'windMph'];
function weatherArguments(input: unknown): WeatherArguments {
  const record = argumentsRecord(input, weatherKeys);
  const value = {
    location: text(record, 'location'), temperatureF: number(record, 'temperatureF'),
    conditions: text(record, 'conditions'), humidity: number(record, 'humidity'),
    windMph: number(record, 'windMph'),
  };
  if (value.humidity < 0 || value.humidity > 100 || value.windMph < 0)
    throw new Error('Invalid tool arguments.');
  return value;
}
function parameters(properties: Record<string, PlainValue>, required: readonly string[]): PlainValue {
  return { type: 'object', properties, required, additionalProperties: false };
}
const weatherParameters = parameters({
  location: { type: 'string', minLength: 1 },
  temperatureF: { type: 'number' },
  conditions: { type: 'string', minLength: 1 },
  humidity: { type: 'number', minimum: 0, maximum: 100 },
  windMph: { type: 'number', minimum: 0 },
}, weatherKeys);
const aborted = () => new DOMException('Client tool cancelled.', 'AbortError');

/** App-owned function tools and weather panels, plus the booking ask tool `Chat` draws. */
export function createClientToolsController() {
  let snapshot: ClientToolsSnapshot = Object.freeze({ weather: Object.freeze([]) });
  const listeners = new Set<() => void>();
  const cancellations = new Set<() => void>();
  const bookings = createBookingTools();
  // Disposal revokes a waiting booking, like Stop.
  const disposal = new AbortController();
  let sequence = 0;
  let disposed = false;
  function active(signal: AbortSignal) {
    if (disposed || signal.aborted) throw aborted();
  }
  function publish(update: Partial<ClientToolsSnapshot>) {
    if (disposed) return;
    snapshot = Object.freeze({ ...snapshot, ...update });
    for (const notify of listeners) notify();
  }
  function delay(signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      active(signal);
      let finished = false;
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        cancellations.delete(cancel);
      };
      const cancel = () => {
        if (finished) return;
        finished = true;
        cleanup();
        reject(aborted());
      };
      const timer = setTimeout(() => {
        if (finished) return;
        finished = true;
        cleanup();
        resolve();
      }, 3000);
      cancellations.add(cancel);
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted || disposed) cancel();
    });
  }
  async function showWeather(input: WeatherArguments, signal: AbortSignal) {
    active(signal);
    const fields = weatherArguments(input);
    active(signal);
    const row = Object.freeze({ id: `weather-${++sequence}`, ...fields });
    publish({ weather: Object.freeze([...snapshot.weather, row]) });
    active(signal);
    return { shown: true };
  }
  const tools = Object.freeze({
    get_weather: {
      description: 'Look up simulated weather for a location.',
      parameters: parameters({ location: { type: 'string', minLength: 1 } }, ['location']),
      async handler(input: LocationArguments, { signal }) {
        active(signal);
        const location = text(argumentsRecord(input, ['location']), 'location');
        active(signal);
        return { location, temperatureF: 68, conditions: 'Sunny', humidity: 55, windMph: 8 };
      },
    } satisfies FunctionTool<LocationArguments, WeatherArguments>,
    slow_status_check: {
      description: 'Run a cancellable local status check. Use to test stopping a slow browser tool.',
      parameters: parameters({ label: { type: 'string', minLength: 1, default: 'status check' } }, []),
      async handler(input: StatusArguments, { signal }) {
        active(signal);
        const record = argumentsRecord(input, ['label']);
        const label = Object.hasOwn(record, 'label') ? text(record, 'label') : 'status check';
        await delay(signal);
        active(signal);
        return { label, status: 'complete' };
      },
    } satisfies FunctionTool<StatusArguments, { label: string; status: string }>,
    weather_card: {
      description: 'Display a simulated weather card with these finalized readings, then briefly confirm.',
      parameters: weatherParameters,
      handler: (input: WeatherArguments, { signal }) => showWeather(input, signal),
    } satisfies FunctionTool<WeatherArguments, { shown: boolean }>,
    weather_snapshot: {
      description: 'Display a simulated weather card as a terminal snapshot without an assistant summary.',
      parameters: weatherParameters,
      followUp: false,
      handler: (input: WeatherArguments, { signal }) => showWeather(input, signal),
    } satisfies FunctionTool<WeatherArguments, { shown: boolean }>,
    confirm_booking: {
      ...bookings.tools.confirm_booking,
      // Check the arguments first, so the card only ever shows a valid summary.
      async handler(input: BookingArguments, { signal }) {
        active(signal);
        text(argumentsRecord(input, ['summary']), 'summary');
        return bookings.tools.confirm_booking.handler(input, {
          signal: AbortSignal.any([signal, disposal.signal]),
        });
      },
    } satisfies FunctionTool<BookingArguments, BookingDecision>,
  });
  return Object.freeze({
    tools,
    /** Pass to `Chat` as `clientTools`; a waiting booking is drawn from here. */
    clientTools: bookings,
    getSnapshot: () => snapshot,
    subscribe(notify: () => void) {
      if (disposed) return () => undefined;
      listeners.add(notify);
      return () => { listeners.delete(notify); };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      for (const cancel of [...cancellations]) cancel();
      disposal.abort();
    },
  });
}
