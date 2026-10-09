import type {
  RenderElementData,
  RenderSpecData,
} from '@threadplane/react/render';
import type { PlainValue } from '@threadplane/core';
import {
  arrayData,
  copyData,
  dashboardState,
  dashboardText,
  plainRecord,
} from './dashboard-data';

const metricKeys = ['on_time', 'flights_today', 'avg_delay', 'load_factor'];
const disruptionKeys = ['flight_number', 'type', 'minutes', 'route', 'date'];
const safeKey = (value: unknown): value is string =>
  dashboardText(value) &&
  value.length <= 80 &&
  !['__proto__', 'prototype', 'constructor'].includes(value);
const finite = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value);

function binding(value: unknown, paths: readonly string[]) {
  return (
    plainRecord(value) &&
    Object.keys(value).length === 1 &&
    typeof value.$state === 'string' &&
    paths.includes(value.$state)
  );
}
function scalar(value: unknown, suffix: 'value' | 'delta') {
  return (
    value === null ||
    dashboardText(value) ||
    (suffix === 'value' && finite(value)) ||
    binding(
      value,
      metricKeys.map((key) => `/${key}/${suffix}`)
    )
  );
}
function data(
  value: unknown,
  key: 'on_time_trend' | 'flights_by_airline' | 'recent_disruptions'
) {
  return (
    value === null ||
    binding(value, [`/${key}`]) ||
    (Array.isArray(value) && dashboardState({ [key]: value }) !== undefined)
  );
}
function columns(value: unknown) {
  const items = arrayData(value);
  return (
    !!items &&
    items.length > 0 &&
    items.length <= disruptionKeys.length &&
    items.every(
      (key) => typeof key === 'string' && disruptionKeys.includes(key)
    ) &&
    new Set(items).size === items.length
  );
}

type PropRule = (value: unknown) => boolean;
interface ViewSchema {
  readonly required: readonly string[];
  readonly props: Readonly<Record<string, PropRule>>;
  readonly children: boolean;
}
const catalog: Readonly<Record<string, ViewSchema>> = Object.freeze({
  dashboard_grid: { required: [], props: {}, children: true },
  container: {
    required: [],
    props: { direction: (value) => value === 'row' || value === 'column' },
    children: true,
  },
  stat_card: {
    required: ['label'],
    props: {
      label: dashboardText,
      value: (value) => scalar(value, 'value'),
      delta: (value) => scalar(value, 'delta'),
    },
    children: false,
  },
  line_chart: {
    required: ['data', 'xKey', 'yKey'],
    props: {
      title: dashboardText,
      data: (value) => data(value, 'on_time_trend'),
      xKey: (value) => value === 'month',
      yKey: (value) => value === 'on_time_pct',
    },
    children: false,
  },
  bar_chart: {
    required: ['data', 'labelKey', 'valueKey'],
    props: {
      title: dashboardText,
      data: (value) => data(value, 'flights_by_airline'),
      labelKey: (value) => value === 'airline',
      valueKey: (value) => value === 'count',
    },
    children: false,
  },
  data_grid: {
    required: ['rows', 'columns'],
    props: {
      title: dashboardText,
      rows: (value) => data(value, 'recent_disruptions'),
      columns,
    },
    children: false,
  },
});

function own(value: unknown): PlainValue {
  if (Array.isArray(value)) {
    const items = arrayData(value);
    if (!items) throw new Error('Unsupported dashboard array');
    return Object.freeze(items.map(own));
  }
  if (plainRecord(value))
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, own(item)])
      )
    );
  return value as PlainValue;
}

function children(value: unknown): readonly string[] | undefined {
  const items = arrayData(value);
  if (!items || !items.every(safeKey) || new Set(items).size !== items.length)
    return;
  return Object.freeze([...items]);
}

/** Validate and own the existing authored catalog before presenting it. */
export function dashboardSpec(value: unknown): RenderSpecData | undefined {
  try {
    value = copyData(value);
    if (
      !plainRecord(value) ||
      Object.keys(value).length !== 2 ||
      !safeKey(value.root) ||
      !plainRecord(value.elements) ||
      !Object.hasOwn(value.elements, value.root)
    )
      return;
    const entries = Object.entries(value.elements);
    if (entries.length === 0 || entries.length > 100) return;
    const elements: Record<string, RenderElementData> = {};
    for (const [key, element] of entries) {
      if (
        !safeKey(key) ||
        !plainRecord(element) ||
        Object.keys(element).some(
          (name) => !['type', 'props', 'children'].includes(name)
        ) ||
        typeof element.type !== 'string' ||
        !Object.hasOwn(catalog, element.type)
      )
        return;
      const schema = catalog[element.type],
        props = element.props === undefined ? {} : element.props;
      if (
        !plainRecord(props) ||
        !schema.required.every((name) => Object.hasOwn(props, name)) ||
        Object.keys(props).some(
          (name) =>
            !Object.hasOwn(schema.props, name) ||
            !schema.props[name](props[name])
        )
      )
        return;
      const childKeys =
        element.children === undefined ? undefined : children(element.children);
      if (
        element.children !== undefined &&
        (!childKeys || (!schema.children && childKeys.length))
      )
        return;
      elements[key] = Object.freeze({
        type: element.type,
        props: own(props) as Readonly<Record<string, PlainValue>>,
        ...(childKeys ? { children: childKeys } : {}),
      });
    }
    const visited = new Set<string>(),
      visiting = new Set<string>();
    function visit(key: string): boolean {
      if (!Object.hasOwn(elements, key) || visiting.has(key)) return false;
      if (visited.has(key)) return false;
      visiting.add(key);
      for (const child of elements[key].children ?? [])
        if (!visit(child)) return false;
      visiting.delete(key);
      visited.add(key);
      return true;
    }
    if (!visit(value.root) || visited.size !== entries.length) return;
    return Object.freeze({
      root: value.root,
      elements: Object.freeze(elements),
    });
  } catch {
    return undefined;
  }
}
