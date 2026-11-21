import { describe, it, expect } from 'vitest';
import { makeGuardedEmit } from './guarded-emit';

describe('makeGuardedEmit', () => {
  it('forwards events while not destroyed', () => {
    const seen: number[] = [];
    const destroyed = false;
    const emit = makeGuardedEmit<number>((n) => seen.push(n), () => destroyed);
    emit(1);
    emit(2);
    expect(seen).toEqual([1, 2]);
  });

  it('no-ops once destroyed (never calls the underlying emit)', () => {
    const seen: number[] = [];
    let destroyed = false;
    const emit = makeGuardedEmit<number>((n) => seen.push(n), () => destroyed);
    emit(1);
    destroyed = true;
    emit(2);
    emit(3);
    expect(seen).toEqual([1]);
  });
});
