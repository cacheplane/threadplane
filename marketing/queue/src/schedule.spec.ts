import { describe, expect, it } from 'vitest';
import { defaultSlots, pacificDateTime, weekStartFor } from './schedule.ts';

describe('weekStartFor', () => {
  it('returns the next Monday after a Thursday', () => {
    expect(weekStartFor(new Date('2026-10-29T17:00:00Z'))).toBe('2026-11-02');
  });
  it('returns the following Monday when given a Monday', () => {
    expect(weekStartFor(new Date('2026-10-26T17:00:00Z'))).toBe('2026-11-02');
  });
  it('returns the next day when given a Sunday', () => {
    expect(weekStartFor(new Date('2026-11-01T20:00:00Z'))).toBe('2026-11-02');
  });
  it('uses the Pacific calendar date', () => {
    // 2026-10-26 02:00Z is still Sunday 10-25 in Pacific
    expect(weekStartFor(new Date('2026-10-26T02:00:00Z'))).toBe('2026-10-26');
  });
});

describe('pacificDateTime', () => {
  it('resolves PDT and PST offsets', () => {
    expect(pacificDateTime('2026-10-30', '08:30').toISOString()).toBe('2026-10-30T15:30:00.000Z');
    expect(pacificDateTime('2026-11-02', '08:30').toISOString()).toBe('2026-11-02T16:30:00.000Z');
  });
});

describe('defaultSlots', () => {
  const slots = defaultSlots('2026-10-26');
  it('yields 7 x, 3 linkedin, 1 blog, 1 devto', () => {
    const count = (c: string) => slots.filter((s) => s.channel === c).length;
    expect(count('x')).toBe(7);
    expect(count('linkedin')).toBe(3);
    expect(count('blog')).toBe(1);
    expect(count('devto')).toBe(1);
  });
  it('keeps 08:30 Pacific across the Nov 1 DST change', () => {
    const at = (slot: string) => slots.find((s) => s.slot === slot)?.publishAt.toISOString();
    expect(at('x-sat')).toBe('2026-10-31T15:30:00.000Z');
    expect(at('x-sun')).toBe('2026-11-01T16:30:00.000Z');
  });
  it('places linkedin, blog and devto slots', () => {
    const at = (slot: string) => slots.find((s) => s.slot === slot)?.publishAt.toISOString();
    expect(at('linkedin-tue')).toBe('2026-10-27T15:00:00.000Z');
    expect(at('blog')).toBe('2026-10-27T16:00:00.000Z');
    expect(at('devto')).toBe('2026-10-29T16:00:00.000Z');
  });
});
