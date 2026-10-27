import { describe, expect, it } from 'vitest';
import { copyData, dashboardState } from './dashboard-data';

describe('owned dashboard data', () => {
  it('captures supported slots without retaining caller references', () => {
    const source = {
      on_time: { value: '84%', delta: '+1%' },
      recent_disruptions: [],
    };
    const captured = dashboardState(source);
    expect(captured).toEqual(source);
    source.on_time.value = 'changed';
    expect(captured).toEqual({
      on_time: { value: '84%', delta: '+1%' },
      recent_disruptions: [],
    });
    expect(Object.isFrozen(captured)).toBe(true);
  });
  it('rejects foreign slots and invalid rows', () => {
    for (const data of [
      { foreign: [] },
      { on_time: { value: Infinity, delta: null } },
      { on_time_trend: [{ month: 'May', on_time_pct: 101 }] },
      { flights_by_airline: [{ airline: 'A', count: -1 }] },
      { recent_disruptions: [{ type: 'cancelled' }] },
    ])
      expect(dashboardState(data)).toBeUndefined();
  });
  it('never evaluates accessors and rejects symbols, sparse arrays and exotic objects', () => {
    let reads = 0;
    const getter = Object.defineProperty({}, 'on_time', {
      get() {
        reads++;
        throw new Error('executed');
      },
    });
    for (const value of [
      getter,
      { [Symbol('x')]: 1 },
      { recent_disruptions: new Array(3) },
      new Date(),
      { on_time: { value: () => 1, delta: null } },
    ])
      expect(dashboardState(value)).toBeUndefined();
    expect(reads).toBe(0);
  });
  it('bounds strings, arrays, depth, graph size and cycles before traversal', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    let deep: unknown = null;
    for (let i = 0; i < 40; i++) deep = { child: deep };
    for (const value of [
      cyclic,
      deep,
      Array(10001).fill(null),
      'x'.repeat(100001),
      { n: NaN },
    ])
      expect(() => copyData(value)).toThrow();
    expect(
      dashboardState({
        flights_by_airline: Array(101).fill({ airline: 'A', count: 1 }),
      })
    ).toBeUndefined();
    expect(
      dashboardState({ on_time: { value: 'x'.repeat(513), delta: null } })
    ).toBeUndefined();
  });
});
