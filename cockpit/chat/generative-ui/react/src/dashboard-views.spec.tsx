// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { RenderSpec } from '@threadplane/react/render';
import { dashboardSpec } from './dashboard-spec';
import { dashboardState } from './dashboard-data';
import { dashboardRegistry } from './dashboard-views';

afterEach(cleanup);
const spec = required(
  dashboardSpec({
    root: 'dashboard',
    elements: {
      dashboard: { type: 'dashboard_grid', children: ['row', 'table'] },
      row: {
        type: 'container',
        props: { direction: 'row' },
        children: ['card', 'trend', 'airlines'],
      },
      card: {
        type: 'stat_card',
        props: {
          label: '<script>literal</script>',
          value: { $state: '/on_time/value' },
          delta: { $state: '/on_time/delta' },
        },
      },
      trend: {
        type: 'line_chart',
        props: {
          title: 'Trend',
          data: { $state: '/on_time_trend' },
          xKey: 'month',
          yKey: 'on_time_pct',
        },
      },
      airlines: {
        type: 'bar_chart',
        props: {
          title: 'Airlines',
          data: { $state: '/flights_by_airline' },
          labelKey: 'airline',
          valueKey: 'count',
        },
      },
      table: {
        type: 'data_grid',
        props: {
          title: 'Disruptions',
          rows: { $state: '/recent_disruptions' },
          columns: ['flight_number', 'type', 'minutes', 'route', 'date'],
        },
      },
    },
  })
);
const state = required(
  dashboardState({
    on_time: { value: '84.2%', delta: '+1.5%' },
    on_time_trend: [{ month: 'April', on_time_pct: 84.2 }],
    flights_by_airline: [{ airline: 'United', count: 92 }],
    recent_disruptions: [
      {
        flight_number: 'UA204',
        type: 'cancelled',
        minutes: 0,
        route: 'SFO-LAX',
        date: '2026-03-12',
      },
    ],
  })
);
it('renders all six views through native RenderSpec and exposes chart and table data', () => {
  const view = render(
    <RenderSpec spec={spec} registry={dashboardRegistry} state={{ ...state }} />
  );
  expect(view.container.querySelectorAll('[data-dashboard-view]')).toHaveLength(
    6
  );
  expect(screen.getByText('<script>literal</script>')).toBeTruthy();
  expect(view.container.querySelector('script')).toBeNull();
  expect(screen.getByText('84.2%')).toBeTruthy();
  expect(screen.getByRole('img', { name: 'Trend' })).toBeTruthy();
  expect(screen.getByRole('img', { name: 'Airlines' })).toBeTruthy();
  expect(
    screen.getByRole('table', { name: 'Trend data' }).textContent
  ).toContain('April');
  expect(
    screen.getByRole('table', { name: 'Airlines data' }).textContent
  ).toContain('92');
  expect(
    screen.getByRole('table', { name: 'Disruptions' }).textContent
  ).toContain('UA204');
});
it('updates the same retained layout from latest shared state without mutating the spec', () => {
  const view = render(
    <RenderSpec spec={spec} registry={dashboardRegistry} state={{ ...state }} />
  );
  view.rerender(
    <RenderSpec
      spec={spec}
      registry={dashboardRegistry}
      state={{
        ...state,
        on_time: { value: '90%', delta: null },
        recent_disruptions: [],
      }}
    />
  );
  expect(screen.getByText('90%')).toBeTruthy();
  expect(screen.queryByText('84.2%')).toBeNull();
  expect(screen.queryByText('UA204')).toBeNull();
  expect(screen.getByText('No disruptions.')).toBeTruthy();
  expect(spec.elements.card.props.value).toEqual({ $state: '/on_time/value' });
});
it('distinguishes unavailable data from valid empty lists and zero values', () => {
  const view = render(<RenderSpec spec={spec} registry={dashboardRegistry} />);
  expect(screen.getAllByText('Waiting for dashboard data…')).toHaveLength(4);
  view.rerender(
    <RenderSpec
      spec={spec}
      registry={dashboardRegistry}
      state={{
        on_time: { value: 0, delta: null },
        on_time_trend: [],
        flights_by_airline: [],
        recent_disruptions: [],
      }}
    />
  );
  expect(screen.getByText('0')).toBeTruthy();
  expect(screen.getAllByText('No chart data.')).toHaveLength(2);
  expect(view.container.querySelectorAll('svg')).toHaveLength(0);
});

function required<T>(value: T | null | undefined): T {
  if (value == null) throw Error('Required fixture');
  return value;
}
