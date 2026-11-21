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

describe('emitBinding', () => {
  it('writes typed value to host at bound path', () => {
    const { host, writes } = makeHost();
    emitBinding(host, { value: '/name' }, 'value', 'Alice');
    expect(writes).toEqual([['/name', 'Alice']]);
  });

  it('does nothing when binding prop is not in bindings map', () => {
    const { host, writes } = makeHost();
    emitBinding(host, {}, 'value', 'Alice');
    expect(writes).toHaveLength(0);
  });

  it('does nothing when bindings is undefined', () => {
    const { host, writes } = makeHost();
    emitBinding(host, undefined, 'value', 'Alice');
    expect(writes).toHaveLength(0);
  });

  it('writes numeric values without string coercion', () => {
    const { host, writes } = makeHost();
    emitBinding(host, { value: '/count' }, 'value', 42);
    expect(writes).toEqual([['/count', 42]]);
    expect(typeof writes[0][1]).toBe('number');
  });

  it('writes boolean values without string coercion', () => {
    const { host, writes } = makeHost();
    emitBinding(host, { checked: '/agreed' }, 'checked', true);
    expect(writes).toEqual([['/agreed', true]]);
    expect(typeof writes[0][1]).toBe('boolean');
  });
});
