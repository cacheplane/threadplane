import { describe, expect, it, vi } from 'vitest';
import { ownState } from './state';
import {
  captureSubmit,
  mergeSubmitState,
  type SubmitInput,
  type ApplicationState,
} from './submit-input';

describe('narrow submit input capture', () => {
  it.each(['Hello', '', ' \n '])(
    'preserves literal text %j in either form',
    (message) => {
      expect(captureSubmit(message)).toEqual({ message });
      expect(captureSubmit({ message })).toEqual({ message });
      expect(captureSubmit({ message, state: undefined })).toEqual({ message });
    }
  );
  it('captures selected fields and nested data once, without freezing or retaining the caller graph', () => {
    const nested = { steps: [1] };
    const getMessage = vi.fn(() => 'Hello');
    const getNested = vi.fn(() => nested);
    const patch = {
      get nested() {
        return getNested();
      },
    };
    const getState = vi.fn(() => patch);
    const unused = vi.fn(() => {
      throw new Error('ignored getter');
    });
    const input = {
      get message() {
        return getMessage();
      },
      get state() {
        return getState();
      },
      get threadId() {
        return unused();
      },
      get forwardedProps() {
        return unused();
      },
    };
    const result = captureSubmit(input);
    nested.steps.push(2);
    expect(result).toEqual({
      message: 'Hello',
      state: { nested: { steps: [1] } },
    });
    expect([
      getMessage.mock.calls.length,
      getState.mock.calls.length,
      getNested.mock.calls.length,
    ]).toEqual([1, 1, 1]);
    expect(unused).not.toHaveBeenCalled();
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(patch)).toBe(false);
    expect(Object.isFrozen(nested.steps)).toBe(false);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.state)).toBe(true);
    expect(Object.isFrozen(result.state?.['nested'])).toBe(true);
  });
  it.each([null, [], 1, 'state', new Date(), { nested: () => true }])(
    'rejects unsupported patch %j',
    (state) => {
      expect(() =>
        captureSubmit({ message: 'x', state } as unknown as SubmitInput)
      ).toThrow();
    }
  );
  it('rejects cycles, invalid message, and throwing selected getters', () => {
    const cycle: Record<string, unknown> = {};
    cycle['self'] = cycle;
    for (const input of [
      { state: {} },
      { message: 1 },
      { message: 'x', state: cycle },
      {
        get message() {
          throw new Error('message');
        },
      },
    ]) {
      expect(() => captureSubmit(input as unknown as SubmitInput)).toThrow();
    }
  });
});

describe('admission state merge', () => {
  it('shallowly replaces captured keys and shares unaffected already owned branches', () => {
    const previous = ownState({
      keep: { stable: [1] },
      settings: { old: true },
      count: 1,
    }) as ApplicationState;
    const patch = captureSubmit({
      message: 'x',
      state: { settings: { next: true }, count: 2 },
    }).state;
    const merged = mergeSubmitState(previous, patch) as ApplicationState;
    expect(merged).toEqual({
      keep: { stable: [1] },
      settings: { next: true },
      count: 2,
    });
    expect(merged['keep']).toBe(previous['keep']);
    expect(merged['settings']).toBe(patch?.['settings']);
    expect(previous).toEqual({
      keep: { stable: [1] },
      settings: { old: true },
      count: 1,
    });
    expect(Object.isFrozen(merged)).toBe(true);
  });
  it('reuses no-op state while distinguishing absent from own undefined', () => {
    const previous = ownState({ n: 1, absent: undefined, nil: null });
    expect(mergeSubmitState(previous, {})).toBe(previous);
    expect(
      mergeSubmitState(previous, { n: 1, absent: undefined, nil: null })
    ).toBe(previous);
    const next = mergeSubmitState(previous, {
      added: undefined,
    }) as ApplicationState;
    expect(next).not.toBe(previous);
    expect(Object.hasOwn(next, 'added')).toBe(true);
    expect(Object.hasOwn(previous as object, 'added')).toBe(false);
  });
  it('preserves prototype-looking keys as payload and accepts null-prototype records', () => {
    const patch = Object.create(null);
    Object.defineProperty(patch, '__proto__', {
      value: { safe: true },
      enumerable: true,
    });
    patch.constructor = 'payload';
    patch.messages = ['settings'];
    const captured = captureSubmit({ message: 'x', state: patch });
    const merged = mergeSubmitState(
      ownState(Object.assign(Object.create(null), { keep: 1 })),
      captured.state
    ) as ApplicationState;
    expect(Object.hasOwn(merged, '__proto__')).toBe(true);
    expect(merged['__proto__']).toEqual({ safe: true });
    expect(merged['constructor']).toBe('payload');
    expect(merged['messages']).toEqual(['settings']);
    expect(merged['keep']).toBe(1);
    expect(Object.getPrototypeOf(merged)).not.toEqual({ safe: true });
  });
  it.each([null, false, 0, '', 'literal', [1], { record: true }])(
    'omission preserves literal state %j',
    (value) => {
      const previous = ownState(value);
      expect(mergeSubmitState(previous)).toBe(previous);
    }
  );
  it.each([null, false, 0, '', [1]])(
    'patches cannot merge into literal state %j even when empty',
    (value) => {
      expect(() => mergeSubmitState(ownState(value), {})).toThrow();
      expect(() =>
        mergeSubmitState(ownState(value), { selected: true })
      ).toThrow();
    }
  );
});
