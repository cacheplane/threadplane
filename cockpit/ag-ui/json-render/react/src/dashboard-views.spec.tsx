import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { RenderSpec } from '@threadplane/react/render';
import { dashboardSpec } from './dashboard-spec';
import { dashboardState } from './dashboard-data';
import { dashboardRegistry } from './dashboard-views';

afterEach(cleanup);
it('keeps twelve month labels within a readable four-label axis budget', () => {
  const view = render(
    <RenderSpec
      spec={spec}
      registry={dashboardRegistry}
      state={{
        ...state,
        on_time_trend: Array.from({ length: 12 }, (_, index) => ({
          month: `2025-${String(index + 1).padStart(2, '0')}`,
          on_time_pct: 80 + index,
        })),
      }}
    />
  );
  const labels = [
    ...view.container.querySelectorAll(
      '[data-dashboard-view="line_chart"] svg > text'
    ),
  ].map((element) => element.textContent);
  expect(labels.length).toBeLessThanOrEqual(4);
  expect(labels[0]).toBe('2025-01');
  expect(labels.at(-1)).toBe('2025-12');
});

it('shows chart categories on the plot as well as in the data alternative', () => {
  const view = render(
    <RenderSpec spec={spec} registry={dashboardRegistry} state={{ ...state }} />
  );
  const labels = [...view.container.querySelectorAll('svg text')].map(
    (element) => element.textContent
  );
  expect(labels).toContain('April');
  expect(labels).toContain('United');
  expect(labels).toContain('92');
});

it('spaces short-series month labels far enough apart to read', () => {
  const view = render(
    <RenderSpec
      spec={spec}
      registry={dashboardRegistry}
      state={{
        ...state,
        on_time_trend: Array.from({ length: 6 }, (_, index) => ({
          month: `2026-0${index + 1}`,
          on_time_pct: 80 + index,
        })),
      }}
    />
  );
  const positions = [
    ...view.container.querySelectorAll(
      '[data-dashboard-view="line_chart"] svg > text'
    ),
  ].map((element) => Number(element.getAttribute('x')));
  expect(
    positions.slice(1).every((x, index) => x - positions[index] >= 64)
  ).toBe(true);
});

it.each([1, 3])(
  'uses distinct ticks and a centered line for %i equal-valued points',
  (count) => {
    const view = render(
      <RenderSpec
        spec={spec}
        registry={dashboardRegistry}
        state={{
          ...state,
          on_time_trend: Array.from({ length: count }, (_, index) => ({
            month: `Month ${index + 1}`,
            on_time_pct: 84.2,
          })),
        }}
      />
    );
    const chart = view.container.querySelector(
      '[data-dashboard-view="line_chart"] svg'
    );
    const ticks = [...(chart?.querySelectorAll('g text') ?? [])].map(
      (element) => element.textContent
    );
    expect(new Set(ticks).size).toBe(3);
    expect(
      [...(chart?.querySelectorAll('circle') ?? [])].every(
        (circle) => Math.abs(Number(circle.getAttribute('cy')) - 104) < 0.01
      )
    ).toBe(true);
  }
);

it('keeps close-valued tick labels distinct', () => {
  const view = render(
    <RenderSpec
      spec={spec}
      registry={dashboardRegistry}
      state={{
        ...state,
        on_time_trend: [
          { month: 'March', on_time_pct: 84.21 },
          { month: 'April', on_time_pct: 84.22 },
        ],
      }}
    />
  );
  const ticks = [
    ...view.container.querySelectorAll(
      '[data-dashboard-view="line_chart"] svg g text'
    ),
  ].map((element) => element.textContent);
  expect(new Set(ticks).size).toBe(3);
});

it('keeps a hundred bars in bounds and their complete data available', () => {
  const view = render(
    <RenderSpec
      spec={spec}
      registry={dashboardRegistry}
      state={{
        ...state,
        flights_by_airline: Array.from({ length: 100 }, (_, index) => ({
          airline: `Airline ${index}`,
          count: index + 1,
        })),
      }}
    />
  );
  const chart = view.container.querySelector(
    '[data-dashboard-view="bar_chart"]'
  );
  const bars = [...(chart?.querySelectorAll('rect') ?? [])];
  expect(bars).toHaveLength(100);
  expect(
    bars.every(
      (bar) =>
        Number(bar.getAttribute('width')) > 0 &&
        Number(bar.getAttribute('x')) >= 16 &&
        Number(bar.getAttribute('x')) + Number(bar.getAttribute('width')) <=
          384.01
    )
  ).toBe(true);
  expect(chart?.querySelectorAll('svg text').length).toBeLessThanOrEqual(12);
  expect(chart?.querySelectorAll('tbody tr').length).toBe(100);
});

const spec = dashboardSpec({
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
})!;
const state = dashboardState({
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
})!;
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
