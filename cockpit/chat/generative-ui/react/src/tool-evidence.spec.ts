import { expect, it } from 'vitest';
import type { PlainValue } from '@threadplane/core';
import { validToolArgs, toolData, renderResult } from './tool-evidence';
const call = (name: string, args: PlainValue, result: string) => ({
  id: 'call',
  name,
  args,
  result,
  status: 'complete' as const,
});
it('accepts supported arguments and correlates filtered tool data', () => {
  const args = { limit: 2, type: 'cancelled' };
  const rows = [
    {
      flight_number: 'AA1',
      type: 'cancelled',
      minutes: 0,
      route: 'A→B',
      date: '2026-05-14',
    },
  ];
  expect(validToolArgs(call('query_recent_disruptions', args, ''))).toBe(true);
  expect(
    toolData(call('query_recent_disruptions', args, JSON.stringify(rows)))
  ).toEqual({ recent_disruptions: rows });
  expect(
    toolData(
      call(
        'query_recent_disruptions',
        { type: 'delayed' },
        JSON.stringify(rows)
      )
    )
  ).toBeUndefined();
});
it('requires exact supported arguments and data result shapes', () => {
  for (const args of [
    { months: 0 },
    { months: 101 },
    { months: 2.5 },
    { foreign: 1 },
  ])
    expect(validToolArgs(call('query_on_time_trend', args, '[]'))).toBe(false);
  expect(validToolArgs(call('execute', {}, '{}'))).toBe(false);
  expect(toolData(call('query_airline_kpis', {}, '{}'))).toBeUndefined();
  expect(
    toolData(
      call(
        'query_on_time_trend',
        { months: 1 },
        JSON.stringify([
          { month: 'May', on_time_pct: 80 },
          { month: 'June', on_time_pct: 90 },
        ])
      )
    )
  ).toBeUndefined();
});
it('correlates raw render JSON semantically and strips the defined code fence', () => {
  const args = { root: 'root', elements: { root: { type: 'container' } } };
  expect(
    renderResult(
      call('render_spec', args, '```json\n' + JSON.stringify(args) + '\n```')
    )
  ).toBe(JSON.stringify(args));
  expect(renderResult(call('render_spec', args, '{'))).toBeUndefined();
  expect(
    renderResult(
      call('render_spec', args, JSON.stringify({ ...args, root: 'else' }))
    )
  ).toBeUndefined();
});
