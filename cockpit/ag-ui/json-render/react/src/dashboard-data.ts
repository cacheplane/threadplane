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

/** Captures supported native state fields; the session keeps the complete state. */
export function dashboardState(state: unknown): DashboardState | undefined {
  try {
    if (!plainRecord(state)) return;
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
