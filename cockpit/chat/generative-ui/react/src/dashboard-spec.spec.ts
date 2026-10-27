import { describe, expect, it } from 'vitest';
import { dashboardSpec } from './dashboard-spec';
const spec = () => ({
  root: 'root',
  elements: {
    root: { type: 'dashboard_grid', children: ['card'] },
    card: {
      type: 'stat_card',
      props: { label: 'On-time', value: { $state: '/on_time/value' } },
    },
  },
});
describe('authored six-view policy', () => {
  it('owns the authored tree and its approved bindings', () => {
    const input = spec(),
      captured = dashboardSpec(input);
    expect(captured).toBeDefined();
    input.elements.card.props.label = 'changed';
    expect(captured?.elements['card'].props?.['label']).toBe('On-time');
  });
  it('rejects foreign types, properties, paths and action/function values', () => {
    for (const element of [
      { type: 'iframe' },
      { type: 'stat_card', props: { label: 'X', onClick: 'run' } },
      {
        type: 'stat_card',
        props: { label: 'X', value: { $state: '/secrets' } },
      },
      { type: 'stat_card', props: { label: () => 'X' } },
      { type: 'container', actions: {} },
    ])
      expect(
        dashboardSpec({ root: 'root', elements: { root: element } })
      ).toBeUndefined();
    expect(dashboardSpec({ ...spec(), foreign: true })).toBeUndefined();
  });
  it('rejects missing, unreachable, cyclic and multiply-parented nodes', () => {
    for (const elements of [
      { root: { type: 'container', children: ['missing'] } },
      { root: { type: 'container' }, orphan: { type: 'container' } },
      { root: { type: 'container', children: ['root'] } },
      {
        root: { type: 'container', children: ['a', 'b'] },
        a: { type: 'container', children: ['c'] },
        b: { type: 'container', children: ['c'] },
        c: { type: 'container' },
      },
    ])
      expect(dashboardSpec({ root: 'root', elements })).toBeUndefined();
  });
  it('rejects descriptor attacks and invalid JSON strings without executing anything', () => {
    let reads = 0;
    const input = spec();
    Object.defineProperty(input.elements.card.props, 'label', {
      get() {
        reads++;
        return 'X';
      },
    });
    expect(dashboardSpec(input)).toBeUndefined();
    expect(
      dashboardSpec({ ...spec(), [Symbol('hidden')]: true })
    ).toBeUndefined();
    expect(dashboardSpec('{')).toBeUndefined();
    expect(reads).toBe(0);
  });
});
