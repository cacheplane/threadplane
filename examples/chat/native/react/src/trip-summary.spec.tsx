import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TripSummary } from './trip-summary';
import { formatTripSummary } from '../../shared/trip-summary';
import { prepareTripSummaryRender } from '../../shared/trip-summary-render';

afterEach(cleanup);
describe('prepared trip RenderSpec', () => {
  it('preserves semantic markup, literal text, counts and day/place structure', () => {
    const prepared = prepareTripSummaryRender({
      callId: 'call',
      ...formatTripSummary({
        title: '<b>City</b>',
        days: [
          { day: 2, places: ['Museum', '<script>literal</script>'] },
          { day: 3, places: [] },
        ],
        note: 'Walk',
      }),
    });
    const before = JSON.stringify(prepared);
    const view = render(<TripSummary prepared={prepared} />);
    expect(view.getByRole('region', { name: 'Trip summary' })).toBeTruthy();
    expect(
      view.getByRole('heading', { level: 4, name: '<b>City</b>' })
    ).toBeTruthy();
    expect(view.getByText('2 days · 2 stops')).toBeTruthy();
    expect(
      view.getAllByRole('heading', { level: 5 }).map((node) => node.textContent)
    ).toEqual(['Day 2', 'Day 3']);
    expect(view.getByText('No stops')).toBeTruthy();
    expect(view.getByText('<script>literal</script>')).toBeTruthy();
    expect(view.getByText('Walk').className).toBe('trip-summary-note');
    expect(view.container.querySelector('b,script')).toBeNull();
    expect(
      view.container.querySelectorAll('.trip-summary-days > li')
    ).toHaveLength(2);
    expect(view.container.querySelectorAll('.trip-summary-place')).toHaveLength(
      2
    );
    expect(JSON.stringify(prepared)).toBe(before);
  });
  it('preserves empty days and explicitly empty notes', () => {
    const prepare = (note?: string) =>
      prepareTripSummaryRender({
        callId: 'call',
        ...formatTripSummary({
          title: 'Empty',
          days: [],
          ...(note === undefined ? {} : { note }),
        }),
      });
    const view = render(<TripSummary prepared={prepare()} />);
    expect(view.getByText('No days supplied.')).toBeTruthy();
    expect(view.getByText('0 days · 0 stops')).toBeTruthy();
    expect(view.container.querySelector('.trip-summary-note')).toBeNull();
    view.rerender(<TripSummary prepared={prepare('')} />);
    expect(
      view.container.querySelector('.trip-summary-note')?.textContent
    ).toBe('');
    expect(view.container.querySelector('ol')).toBeNull();
  });
  it('preserves the mounted named section through prepared data updates', () => {
    const prepare = (title: string) =>
      prepareTripSummaryRender({
        callId: 'call',
        ...formatTripSummary({ title, days: [{ day: 1, places: ['Museum'] }] }),
      });
    const view = render(<TripSummary prepared={prepare('First')} />);
    const section = view.getByRole('region', { name: 'Trip summary' });
    view.rerender(<TripSummary prepared={prepare('Changed')} />);
    expect(view.getByRole('region', { name: 'Trip summary' })).toBe(section);
    expect(view.getByRole('heading', { level: 4 }).textContent).toBe('Changed');
    expect(view.getByText('1 day · 1 stop')).toBeTruthy();
  });
});
