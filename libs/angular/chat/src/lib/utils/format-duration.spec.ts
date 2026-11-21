import { describe, it, expect } from 'vitest';
import { formatDuration } from './format-duration';

describe('formatDuration', () => {
  it('renders sub-second durations as "<1s"', () => {
    expect(formatDuration(0)).toBe('<1s');
    expect(formatDuration(500)).toBe('<1s');
    expect(formatDuration(999)).toBe('<1s');
  });

  it('renders sub-minute durations in seconds', () => {
    expect(formatDuration(1000)).toBe('1s');
    expect(formatDuration(4000)).toBe('4s');
    expect(formatDuration(59_000)).toBe('59s');
    expect(formatDuration(59_999)).toBe('59s');
  });

  it('renders minute-or-greater durations as "Nm Ms"', () => {
    expect(formatDuration(60_000)).toBe('1m 0s');
    expect(formatDuration(72_000)).toBe('1m 12s');
    expect(formatDuration(125_000)).toBe('2m 5s');
    expect(formatDuration(3_600_000)).toBe('60m 0s');
  });

  it('clamps negative inputs to "<1s"', () => {
    expect(formatDuration(-1)).toBe('<1s');
    expect(formatDuration(-1000)).toBe('<1s');
  });

  it('handles non-finite inputs by returning "<1s"', () => {
    expect(formatDuration(Number.NaN)).toBe('<1s');
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('<1s');
  });
});
