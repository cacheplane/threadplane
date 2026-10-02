import type { PlainValue } from '@threadplane/core';
import type { FunctionTool } from '@threadplane/core/tools';

export interface LocationArguments { location: string }
export interface WeatherArguments extends LocationArguments {
  temperatureF: number;
  conditions: string;
  humidity: number;
  windMph: number;
}
export interface BookingArguments { summary: string }
export interface StatusArguments { label?: string }
export interface WeatherPanel extends Readonly<WeatherArguments> {
  readonly id: string;
}
export interface BookingPanel {
  readonly id: string;
  readonly summary: string;
  readonly status: 'pending' | 'confirmed' | 'cancelled' | 'aborted';
}
export interface ClientToolsSnapshot {
  readonly weather: readonly WeatherPanel[];
  readonly bookings: readonly BookingPanel[];
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

/** App-owned presentation and decision authority; no runtime call IDs are inferred. */
export function createClientToolsController() {
  let snapshot: ClientToolsSnapshot = Object.freeze({
    weather: Object.freeze([]), bookings: Object.freeze([]),
  });
  const listeners = new Set<() => void>();
  const cancellations = new Set<() => void>();
  const pending = new Map<string, {
    readonly row: BookingPanel;
    readonly signal: AbortSignal;
    readonly finish: (confirmed: boolean) => void;
  }>();
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
  function replaceBooking(row: BookingPanel, status: BookingPanel['status']) {
    publish({ bookings: Object.freeze(snapshot.bookings.map((entry) =>
      entry === row ? Object.freeze({ ...row, status }) : entry
    )) });
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
      description: 'Ask the user to confirm a fictional booking. No real reservation is made.',
      parameters: parameters({ summary: { type: 'string', minLength: 1 } }, ['summary']),
      async handler(input: BookingArguments, { signal }) {
        active(signal);
        const summary = text(argumentsRecord(input, ['summary']), 'summary');
        active(signal);
        return new Promise<{ confirmed: boolean }>((resolve, reject) => {
          const row: BookingPanel = Object.freeze({ id: `booking-${++sequence}`, summary, status: 'pending' });
          let finished = false;
          const cleanup = () => {
            pending.delete(row.id);
            cancellations.delete(cancel);
            signal.removeEventListener('abort', cancel);
          };
          const cancel = () => {
            if (finished) return;
            finished = true;
            cleanup();
            replaceBooking(row, 'aborted');
            reject(aborted());
          };
          pending.set(row.id, {
            row, signal,
            finish(confirmed) {
              if (finished) return;
              finished = true;
              cleanup();
              replaceBooking(row, confirmed ? 'confirmed' : 'cancelled');
              resolve({ confirmed });
            },
          });
          cancellations.add(cancel);
          signal.addEventListener('abort', cancel, { once: true });
          publish({ bookings: Object.freeze([...snapshot.bookings, row]) });
          if (signal.aborted || disposed) cancel();
        });
      },
    } satisfies FunctionTool<BookingArguments, { confirmed: boolean }>,
  });
  return Object.freeze({
    tools,
    getSnapshot: () => snapshot,
    subscribe(notify: () => void) {
      if (disposed) return () => undefined;
      listeners.add(notify);
      return () => { listeners.delete(notify); };
    },
    decide(row: BookingPanel, confirmed: boolean): boolean {
      const request = pending.get(row.id);
      if (disposed || typeof confirmed !== 'boolean' || !request ||
        request.row !== row || request.signal.aborted) return false;
      request.finish(confirmed);
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      for (const cancel of [...cancellations]) cancel();
      pending.clear();
    },
  });
}
