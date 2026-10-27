import type { ToolCall } from '@threadplane/core';
import {
  copyData,
  dashboardState,
  dashboardText,
  plainRecord,
  parseData,
  dataKey,
  type DashboardState,
} from './dashboard-data';
function argumentsFor(
  call: Pick<ToolCall, 'name' | 'args'>
): Record<string, unknown> | undefined {
  const args = copyData(call.args),
    name = call.name;
  if (!plainRecord(args)) return;
  if (name === 'render_spec') return args;
  if (
    ![
      'query_airline_kpis',
      'query_on_time_trend',
      'query_flights_by_airline',
      'query_recent_disruptions',
    ].includes(name)
  )
    return;
  const allowed =
    name === 'query_airline_kpis'
      ? []
      : name === 'query_on_time_trend'
      ? ['months']
      : name === 'query_flights_by_airline'
      ? ['airlines']
      : ['limit', 'type'];
  if (Object.keys(args).some((key) => !allowed.includes(key))) return;
  for (const key of ['months', 'limit'])
    if (
      Object.hasOwn(args, key) &&
      (typeof args[key] !== 'number' ||
        !Number.isInteger(args[key]) ||
        args[key] < 1 ||
        args[key] > 100)
    )
      return;
  if (
    Object.hasOwn(args, 'airlines') &&
    args.airlines !== null &&
    (!Array.isArray(args.airlines) ||
      args.airlines.length > 100 ||
      !args.airlines.every(dashboardText))
  )
    return;
  if (
    Object.hasOwn(args, 'type') &&
    args.type !== null &&
    !dashboardText(args.type)
  )
    return;
  return args;
}

export function validToolArgs(tool: Pick<ToolCall, 'name' | 'args'>): boolean {
  try {
    return argumentsFor(tool) !== undefined;
  } catch {
    return false;
  }
}
/** Match the graph's narrowly defined fenced result transfer. */
export function renderResult(tool: ToolCall): string | undefined {
  if (
    tool.name !== 'render_spec' ||
    tool.status !== 'complete' ||
    typeof tool.result !== 'string'
  )
    return;
  let text = tool.result.trim();
  if (text.startsWith('```'))
    text = text
      .split('\n')
      .filter((line) => !line.startsWith('```'))
      .join('\n')
      .trim();
  const parsed = parseData(text);
  return parsed !== undefined && dataKey(parsed) === dataKey(tool.args)
    ? text
    : undefined;
}
export function toolData(tool: ToolCall): DashboardState | undefined {
  try {
    return captureToolData(tool);
  } catch {
    return undefined;
  }
}
function captureToolData(tool: ToolCall): DashboardState | undefined {
  const args = argumentsFor(tool),
    name = tool.name;
  if (!args || name === 'render_spec' || tool.status !== 'complete') return;
  const value = parseData(tool.result);
  if (name === 'query_airline_kpis') {
    const keys = ['on_time', 'flights_today', 'avg_delay', 'load_factor'];
    return plainRecord(value) &&
      Object.keys(value).length === keys.length &&
      keys.every((key) => Object.hasOwn(value, key) && value[key] !== null) &&
      dashboardState(value) !== undefined
      ? dashboardState(value)
      : undefined;
  }
  const key =
    name === 'query_on_time_trend'
      ? 'on_time_trend'
      : name === 'query_flights_by_airline'
      ? 'flights_by_airline'
      : 'recent_disruptions';
  if (!Array.isArray(value) || dashboardState({ [key]: value }) === undefined)
    return undefined;
  if (
    key === 'on_time_trend' &&
    typeof args.months === 'number' &&
    value.length > args.months
  )
    return undefined;
  const airlines = args.airlines;
  if (
    key === 'flights_by_airline' &&
    Array.isArray(airlines) &&
    airlines.length > 0 &&
    value.some((row) => !airlines.includes(row.airline))
  )
    return undefined;
  if (
    key === 'recent_disruptions' &&
    ((typeof args.limit === 'number' && value.length > args.limit) ||
      (typeof args.type === 'string' &&
        value.some((row) => row.type !== args.type)))
  )
    return undefined;
  return dashboardState({ [key]: value });
}
