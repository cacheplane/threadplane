import { describe, expect, it, vi } from 'vitest';
import { initialObservation } from './session-observation';
import { createPublication } from './session-publication';
describe('private session publication', () => {
  it('publishes owned references and independent registrations without notifying on reads or same reference', () => {
    const initial = initialObservation();
    const store = createPublication(initial);
    const listener = vi.fn();
    const off = store.subscribe(listener);
    store.subscribe(listener);
    expect(store.getSnapshot()).toBe(initial);
    store.publish(initial);
    expect(listener).not.toHaveBeenCalled();
    const next = initialObservation([], 1);
    store.publish(next);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot()).toBe(next);
    off();
    off();
    store.publish(initial);
    expect(listener).toHaveBeenCalledTimes(3);
    store.clear();
    store.publish(next);
    expect(listener).toHaveBeenCalledTimes(3);
  });
  it('holds one snapshot per pass, skips removals, defers additions, contains errors and drains reentrant commands', () => {
    const initial = initialObservation();
    const next = initialObservation([], 1);
    const last = initialObservation([], 2);
    const store = createPublication(initial);
    const seen: unknown[] = [];
    let remove = () => undefined as void;
    store.subscribe(() => {
      seen.push(['a', store.getSnapshot()]);
      if (store.getSnapshot() === next) {
        store.command(() => store.publish(last));
        remove();
        store.subscribe(() => seen.push(['new', store.getSnapshot()]));
      }
      throw new Error('view failure');
    });
    remove = store.subscribe(() => seen.push(['removed', store.getSnapshot()]));
    store.subscribe(() => seen.push(['b', store.getSnapshot()]));
    store.publish(next);
    expect(seen).toEqual([
      ['a', next],
      ['b', next],
      ['a', last],
      ['b', last],
      ['new', last],
    ]);
    expect(store.getSnapshot()).toBe(last);
  });
});
