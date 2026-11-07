import { describe, expect, it } from 'vitest';
import {
  frameAt,
  seek,
  step,
  startPlayback,
  advancePlayback,
} from './playback';

describe('observation playback', () => {
  const frames = Object.freeze([
    Object.freeze({ id: 'start', state: null, messages: [] }),
    Object.freeze({
      id: 'partial',
      state: { busy: true },
      messages: ['Paris'],
    }),
    Object.freeze({
      id: 'end',
      state: { busy: false },
      messages: ['Paris itinerary'],
    }),
  ]);

  it('restores the whole captured observation on backward seek without modifying it', () => {
    const bytes = JSON.stringify(frames);
    expect(frameAt(frames, 2)).toBe(frames[2]);
    expect(frameAt(frames, step(2, -1, frames.length))).toBe(frames[1]);
    expect(frameAt(frames, 0)?.state).toBeNull();
    expect(JSON.stringify(frames)).toBe(bytes);
  });

  it('handles empty recordings and malformed or out-of-range input', () => {
    expect(frameAt([], 0)).toBeNull();
    expect(seek(100, 3)).toBe(2);
    expect(seek(-2, 3)).toBe(0);
    expect(seek(Number.NaN, 3)).toBe(0);
    expect(seek(Infinity, 3)).toBe(0);
    expect(seek(1.7, 3)).toBe(1);
    expect(step(0, -1, 3)).toBe(0);
  });

  it('stops at completion and restarts from the beginning only on an explicit play action', () => {
    expect(advancePlayback({ cursor: 1, playing: true }, 3)).toEqual({
      cursor: 2,
      playing: false,
    });
    expect(advancePlayback({ cursor: 1, playing: false }, 3)).toEqual({
      cursor: 1,
      playing: false,
    });
    expect(startPlayback(2, 3)).toEqual({ cursor: 0, playing: true });
    expect(startPlayback(1, 3)).toEqual({ cursor: 1, playing: true });
    expect(startPlayback(0, 0)).toEqual({ cursor: 0, playing: false });
    expect(startPlayback(0, 1)).toEqual({ cursor: 0, playing: false });
  });
});
