import { describe, it, expect } from 'vitest';
import type { RenderHost } from '@threadplane/angular/render';
import { emitBinding } from './emit-binding';

function makeHost(): { host: RenderHost; writes: Array<[string, unknown]> } {
  const writes: Array<[string, unknown]> = [];
  const host: RenderHost = {
    set: (p, v) => writes.push([p, v]),
    emit: () => { /* noop */ },
    result: () => { /* noop */ },
  };
  return { host, writes };
}

describe('A2uiSliderComponent — v0.9 protocol', () => {
  // NOTE: Angular signal-based inputs can't be tested via TestBed without the
  // angular() vite plugin (NG0303). v0.9: `min` (default 0) / `max` bound the
  // range; `step` was removed; value writes back via the `value` binding.

  it('writes binding with numeric value from range input', () => {
    const { host, writes } = makeHost();
    const bindings = { value: '/rating' };
    const event = { target: { value: '75' } } as unknown as Event;
    const val = Number((event.target as HTMLInputElement).value);
    emitBinding(host, bindings, 'value', val);
    expect(writes).toEqual([['/rating', 75]]);
  });

  it('coerces string range value to number', () => {
    const event = { target: { value: '42.5' } } as unknown as Event;
    const val = Number((event.target as HTMLInputElement).value);
    expect(val).toBe(42.5);
    expect(typeof val).toBe('number');
  });

  it('does not write when no binding exists for value', () => {
    const { host, writes } = makeHost();
    emitBinding(host, {}, 'value', 50);
    expect(writes).toHaveLength(0);
  });
});
