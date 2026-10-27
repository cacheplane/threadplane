export type MetricData = {
  readonly value: string | number;
  readonly delta: string | null;
};
export interface DashboardState {
  readonly on_time?: MetricData | null;
  readonly flights_today?: MetricData | null;
  readonly avg_delay?: MetricData | null;
  readonly load_factor?: MetricData | null;
  readonly on_time_trend?:
    | readonly Readonly<{ month: string; on_time_pct: number }>[]
    | null;
  readonly flights_by_airline?:
    | readonly Readonly<{ airline: string; count: number }>[]
    | null;
  readonly recent_disruptions?:
    | readonly Readonly<{
        flight_number: string;
        type: string;
        minutes: number;
        route: string;
        date: string;
      }>[]
    | null;
}

export function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Object.getOwnPropertySymbols(value).length === 0 &&
    Object.values(Object.getOwnPropertyDescriptors(value)).every((descriptor) =>
      Object.hasOwn(descriptor, 'value')
    )
  );
}

export function dashboardText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512;
}

/** Capture dense ordinary arrays without invoking caller-owned iteration. */
export function arrayData(value: unknown): readonly unknown[] | undefined {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    return;
  const descriptors = Object.getOwnPropertyDescriptors(
    value
  ) as unknown as Record<string, PropertyDescriptor>;
  const length = descriptors.length.value;
  if (
    !Number.isInteger(length) ||
    length < 0 ||
    length > 100 ||
    Reflect.ownKeys(descriptors).length !== length + 1
  )
    return;
  const items: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return;
    items.push(descriptor.value);
  }
  return Object.freeze(items);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function exact(value: Record<string, unknown>, keys: readonly string[]) {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function metric(value: unknown): MetricData | undefined {
  if (
    !plainRecord(value) ||
    !exact(value, ['value', 'delta']) ||
    (!dashboardText(value.value) && !finite(value.value)) ||
    (value.delta !== null && !dashboardText(value.delta))
  )
    return;
  return Object.freeze({ value: value.value, delta: value.delta });
}

type FieldSchema = Readonly<Record<string, (value: unknown) => boolean>>;
function rows(
  value: unknown,
  schema: FieldSchema
): readonly Readonly<Record<string, unknown>>[] | undefined {
  const items = arrayData(value);
  if (!items) return;
  const keys = Object.keys(schema),
    result: Readonly<Record<string, unknown>>[] = [];
  for (const item of items) {
    if (
      !plainRecord(item) ||
      !exact(item, keys) ||
      !keys.every((key) => schema[key](item[key]))
    )
      return;
    result.push(
      Object.freeze(Object.fromEntries(keys.map((key) => [key, item[key]])))
    );
  }
  return Object.freeze(result);
}

const nonnegative = (value: unknown) => finite(value) && value >= 0;
const percentage = (value: unknown) =>
  finite(value) && value >= 0 && value <= 100;
const fields = Object.freeze({
  on_time: metric,
  flights_today: metric,
  avg_delay: metric,
  load_factor: metric,
  on_time_trend: (value: unknown) =>
    rows(value, { month: dashboardText, on_time_pct: percentage }),
  flights_by_airline: (value: unknown) =>
    rows(value, { airline: dashboardText, count: nonnegative }),
  recent_disruptions: (value: unknown) =>
    rows(value, {
      flight_number: dashboardText,
      type: dashboardText,
      minutes: nonnegative,
      route: dashboardText,
      date: dashboardText,
    }),
});

/** Captures exactly the seven owned dashboard slots. */
export function dashboardState(state: unknown): DashboardState | undefined {
  try {
    state = copyData(state);
    if (
      !plainRecord(state) ||
      Object.keys(state).some((key) => !Object.hasOwn(fields, key))
    )
      return;
    const selected: Record<string, unknown> = {};
    for (const [key, capture] of Object.entries(fields)) {
      if (!Object.hasOwn(state, key)) continue;
      const value = state[key] === null ? null : capture(state[key]);
      if (value === undefined) return;
      selected[key] = value;
    }
    return Object.freeze(selected) as DashboardState;
  } catch {
    return undefined;
  }
}

/** Bounded descriptor-only capture: never retain mutable input or invoke getters. */
export function copyData(value: unknown): unknown {
  const parents = new Set<object>();
  let nodes = 0,
    characters = 0;
  function capture(item: unknown, depth: number): unknown {
    if (++nodes > 20000 || depth > 32) throw new Error('Data exceeds budget');
    if (typeof item === 'string') {
      characters += item.length;
      if (item.length > 100000 || characters > 1000000)
        throw new Error('Text exceeds budget');
      return item;
    }
    if (item === null || item === undefined || typeof item === 'boolean')
      return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (
      typeof item !== 'object' ||
      parents.has(item) ||
      Object.getOwnPropertySymbols(item).length
    )
      throw new Error('Unsupported data');
    const array = Array.isArray(item),
      prototype = Object.getPrototypeOf(item);
    if (
      array
        ? prototype !== Array.prototype
        : prototype !== Object.prototype && prototype !== null
    )
      throw new Error('Unsupported prototype');
    const descriptors = Object.getOwnPropertyDescriptors(item);
    const length = array ? descriptors['length'].value : 0;
    if (
      array &&
      (!Number.isInteger(length) ||
        length > 10000 ||
        Object.keys(descriptors).length !== length + 1)
    )
      throw new Error('Unsupported array');
    const keys = array
      ? Array.from({ length }, (_, i) => String(i))
      : Object.keys(descriptors).sort();
    if (keys.length > 10000) throw new Error('Object exceeds budget');
    const result = array ? [] : Object.create(null);
    parents.add(item);
    for (const key of keys) {
      characters += key.length;
      if (key.length > 100000 || characters > 1000000)
        throw new Error('Keys exceed budget');
      const descriptor = descriptors[key];
      if (!descriptor || !Object.hasOwn(descriptor, 'value'))
        throw new Error('Unsupported descriptor');
      Object.defineProperty(result, key, {
        value: capture(descriptor.value, depth + 1),
        enumerable: true,
      });
    }
    parents.delete(item);
    return Object.freeze(result);
  }
  return capture(value, 0);
}
export const dataKey = (value: unknown): string =>
  JSON.stringify(copyData(value));
export function parseData(text: unknown): unknown {
  if (typeof text !== 'string' || text.length > 100000) return undefined;
  try {
    return copyData(JSON.parse(text));
  } catch {
    return undefined;
  }
}
