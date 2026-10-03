import { describe, expect, it } from 'vitest';
import { dashboardSpec } from './dashboard-spec';

export function authoredSpec() {
  return {
    root: 'dashboard',
    elements: {
      dashboard: {
        type: 'dashboard_grid',
        props: {},
        children: ['row', 'table'],
      },
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
  };
}

describe('authored read-only dashboard specs', () => {
  it('owns all six supported view types and safe bindings without changing literal text', () => {
    const input = authoredSpec();
    const spec = dashboardSpec(input);
    expect(spec).toEqual(input);
    expect(
      new Set(
        Object.values(spec?.elements ?? {}).map((element) => element.type)
      ).size
    ).toBe(6);
    input.elements.card.props.label = 'changed';
    input.elements.row.children.push('table');
    expect(spec?.elements.card.props?.label).toBe('<script>literal</script>');
    expect(spec?.elements.row.children).toEqual(['card', 'trend', 'airlines']);
    expect(Object.isFrozen(spec?.elements.card.props?.value)).toBe(true);
    expect(Object.isFrozen(spec?.elements)).toBe(true);
  });

  it('accepts a small structural replacement and literal card values', () => {
    const spec = {
      root: 'new-card',
      elements: {
        'new-card': {
          type: 'stat_card',
          props: { label: 'Flights', value: 312, delta: null },
        },
      },
    };
    expect(dashboardSpec(spec)).toEqual(spec);
  });

  it.each(
    [
      null,
      [],
      'serialized JSON',
      { root: 'missing', elements: {} },
      { root: 'row', elements: { row: { type: 'container', props: null } } },
      {
        root: 'card',
        elements: {
          card: { type: 'custom_html', props: { html: '<script>' } },
        },
      },
      {
        root: 'card',
        elements: {
          card: {
            type: 'stat_card',
            props: { label: 'x', value: { $state: '/messages/0/content' } },
          },
        },
      },
      {
        root: 'card',
        elements: {
          card: {
            type: 'stat_card',
            props: {
              label: 'x',
              value: { $state: '/on_time/value', extra: true },
            },
          },
        },
      },
      {
        root: 'card',
        elements: {
          card: { type: 'stat_card', props: { label: 'x', value: Infinity } },
        },
      },
      {
        root: 'row',
        elements: { row: { type: 'container', children: ['row'] } },
      },
      {
        root: 'row',
        elements: { row: { type: 'container', children: ['missing'] } },
      },
      {
        root: 'row',
        elements: {
          row: { type: 'container', children: ['card', 'card'] },
          card: { type: 'stat_card', props: { label: 'x', value: 1 } },
        },
      },
      {
        root: 'card',
        elements: {
          card: {
            type: 'stat_card',
            props: { label: 'x', value: 1 },
            on: { click: { action: 'send' } },
          },
        },
      },
      {
        root: 'card',
        elements: {
          card: {
            type: 'stat_card',
            props: { label: 'x', value: 1 },
            repeat: { statePath: '/messages' },
          },
        },
      },
      {
        root: 'card',
        elements: {
          card: {
            type: 'stat_card',
            props: { label: 'x', value: 1, href: 'javascript:x' },
          },
        },
      },
      JSON.parse(
        '{"root":"__proto__","elements":{"__proto__":{"type":"stat_card","props":{"label":"x","value":1}}}}'
      ),
      {
        root: 'table',
        elements: {
          table: {
            type: 'data_grid',
            props: {
              rows: { $state: '/recent_disruptions' },
              columns: ['constructor'],
            },
          },
        },
      },
    ].map((value) => [value])
  )('rejects unsupported or malformed specs %j', (value) => {
    expect(dashboardSpec(value)).toBeUndefined();
  });

  it('bounds the catalog and prevents getter evaluation', () => {
    const input = authoredSpec();
    let reads = 0;
    Object.defineProperty(input.elements.card.props, 'label', {
      get() {
        reads++;
        return 'x';
      },
    });
    expect(dashboardSpec(input)).toBeUndefined();
    expect(reads).toBe(0);
    const elements = Object.fromEntries(
      Array.from({ length: 101 }, (_, i) => [
        'card' + i,
        { type: 'stat_card', props: { label: 'x', value: 1 } },
      ])
    );
    expect(dashboardSpec({ root: 'card0', elements })).toBeUndefined();
  });
  it('rejects custom column mapping without invoking it during ownership', () => {
    const input = authoredSpec();
    let calls = 0;
    Object.defineProperty(input.elements.table.props.columns, 'map', {
      value: () => {
        calls++;
        return ['injected'];
      },
    });
    expect(dashboardSpec(input)).toBeUndefined();
    expect(calls).toBe(0);
  });
});
