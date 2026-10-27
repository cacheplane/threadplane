import { describe, expect, it, vi } from 'vitest';
import { captureSubmitInput, createSubmitPayload } from './submit-input';

describe('submit input capture and payload', () => {
  it('normalizes shorthand and captures readonly nested data independently', () => {
    expect(captureSubmitInput('')).toEqual({ message: '' });
    const state = { itinerary: [{ city: 'Paris' }] };
    const captured = captureSubmitInput({ message: 'Plan', state });
    state.itinerary[0].city = 'London';
    expect(captured).toEqual({
      message: 'Plan',
      state: { itinerary: [{ city: 'Paris' }] },
    });
    expect(Object.isFrozen(captured.state?.['itinerary'])).toBe(true);
  });

  it('omits reserved getters and preserves own prototype-sensitive application keys', () => {
    const forbidden = vi.fn(() => {
      throw new Error('reserved getter');
    });
    const state = Object.create(null);
    Object.defineProperties(state, {
      messages: { enumerable: true, get: forbidden },
      client_tools: { enumerable: true, get: forbidden },
      constructor: { enumerable: true, value: 'application' },
      hidden: { enumerable: false, value: 'omit' },
    });
    // Define __proto__ as an own key; an object-literal descriptor would alter
    // the descriptor map's prototype instead.
    Object.defineProperty(state, '__proto__', {
      enumerable: true,
      value: { safe: true },
    });
    const captured = captureSubmitInput({ message: 'Plan', state });
    const messages = [{ type: 'human', content: 'Plan' }];
    const catalog = [{ name: 'weather' }];
    const payload = createSubmitPayload(messages, catalog, captured.state);
    expect(forbidden).not.toHaveBeenCalled();
    expect(Object.getPrototypeOf(payload)).toBe(Object.prototype);
    expect(Object.hasOwn(payload, '__proto__')).toBe(true);
    expect(payload['__proto__']).toEqual({ safe: true });
    expect(payload['constructor']).toBe('application');
    expect(payload).toMatchObject({ messages, client_tools: catalog });
    expect(payload).not.toHaveProperty('hidden');
    expect(createSubmitPayload(messages, [])).toEqual({ messages });
  });

  it.each([
    [],
    new Date(0),
    Object.assign(new (class State {})(), { model: 'x' }),
  ])('rejects non-record roots before copying keys: %j', (state) => {
    expect(() =>
      captureSubmitInput({ message: 'Plan', state: state as never })
    ).toThrow(TypeError);
  });

  it('uses the existing ownership boundary for nested instances and cycles', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    for (const state of [{ nested: new Date(0) }, cyclic]) {
      expect(() =>
        captureSubmitInput({ message: 'Plan', state: state as never })
      ).toThrow(TypeError);
    }
  });
});
