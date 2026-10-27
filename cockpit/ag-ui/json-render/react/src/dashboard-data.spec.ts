import { describe, expect, it } from 'vitest';
import { dashboardState } from './dashboard-data';

describe('owned dashboard state', () => {
  it('selects and deeply owns the seven supported fields without duplicating native history', () => {
    const input = {
      messages: [{ content: 'native history' }],
      unrelated: { secret: 'not a dashboard field' },
      on_time: { value: '84.2%', delta: '+1.4%' },
      flights_today: { value: 312, delta: '+8' },
      avg_delay: { value: '12 min', delta: '-2 min' },
      load_factor: { value: '78.5%', delta: '+0.6%' },
      on_time_trend: [{ month: '2026-04', on_time_pct: 84.2 }],
      flights_by_airline: [{ airline: 'United', count: 92 }],
      recent_disruptions: [
        {
          flight_number: 'UA123',
          type: 'delayed',
          minutes: 45,
          route: 'LAX→JFK',
          date: '2026-05-14',
        },
      ],
    };
    const captured = dashboardState(input);
    expect(captured).toBeDefined();
    expect(Object.keys(captured ?? {})).toHaveLength(7);
    expect(captured).not.toHaveProperty('messages');
    input.on_time.value = 'changed';
    input.on_time_trend[0].on_time_pct = 0;
    expect(captured?.on_time).toEqual({ value: '84.2%', delta: '+1.4%' });
    expect(captured?.on_time_trend).toEqual([
      { month: '2026-04', on_time_pct: 84.2 },
    ]);
    expect(Object.isFrozen(captured)).toBe(true);
    expect(Object.isFrozen(captured?.on_time_trend?.[0])).toBe(true);
  });

  it('supports missing/null fields and empty arrays as genuine skeleton and filtered states', () => {
    expect(dashboardState({})).toEqual({});
    expect(dashboardState({ on_time: null, recent_disruptions: [] })).toEqual({
      on_time: null,
      recent_disruptions: [],
    });
    const old = dashboardState({ flights_today: { value: 312, delta: '+8' } });
    const replacement = dashboardState({ on_time: null });
    expect(old).toHaveProperty('flights_today');
    expect(replacement).not.toHaveProperty('flights_today');
  });

  it.each(
    [
      null,
      [],
      'state',
      4,
      { on_time: { value: Infinity, delta: '+1' } },
      { flights_today: { value: {}, delta: '+1' } },
      { avg_delay: { value: '12 min', delta: false } },
      { load_factor: { value: '78%', delta: '+1', injected: true } },
      { on_time_trend: [{ month: 'April', on_time_pct: NaN }] },
      { flights_by_airline: [{ airline: 'United', count: -1 }] },
      {
        recent_disruptions: [
          {
            flight_number: 'UA123',
            type: 'cancelled',
            minutes: -1,
            route: 'A→B',
            date: '2026-05-14',
          },
        ],
      },
      {
        on_time_trend: Array.from({ length: 101 }, () => ({
          month: 'April',
          on_time_pct: 84,
        })),
      },
    ].map((input) => [input])
  )('rejects malformed present dashboard state %j', (input) => {
    expect(dashboardState(input)).toBeUndefined();
  });

  it('rejects accessors without reading them', () => {
    let reads = 0;
    const input = Object.defineProperty({}, 'on_time', {
      enumerable: true,
      get() {
        reads++;
        return {};
      },
    });
    expect(dashboardState(input)).toBeUndefined();
    expect(reads).toBe(0);
  });
  it('rejects custom array iteration and prototypes without invoking them', () => {
    let calls = 0;
    const rows: unknown[] = [];
    Object.defineProperty(rows, Symbol.iterator, {
      value: function* () {
        calls++;
        yield { month: 'April', on_time_pct: 84 };
      },
    });
    expect(dashboardState({ on_time_trend: rows })).toBeUndefined();
    expect(calls).toBe(0);
    const inherited = Object.setPrototypeOf([], Object.create(Array.prototype));
    expect(dashboardState({ on_time_trend: inherited })).toBeUndefined();
  });
});
