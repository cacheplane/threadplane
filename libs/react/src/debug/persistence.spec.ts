import { describe, expect, it } from 'vitest';
import {
  createDebugPreferences,
  type DebugPreferences,
  type DebugStorage,
} from './persistence';
const defaults = { open: false, dock: 'right', tab: 'state' } as const;
function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const writes: string[] = [];
  return {
    values,
    writes,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      writes.push(key);
      values.set(key, value);
    },
  };
}
describe('debug UI preferences', () => {
  it('uses deterministic defaults with missing storage and defaultOpen', () => {
    expect(createDebugPreferences('one').restore()).toEqual(defaults);
    expect(createDebugPreferences('one', undefined, true).restore().open).toBe(
      true
    );
  });
  it('restores once before writes and isolates keys', () => {
    const saved = { open: true, dock: 'bottom', tab: 'timeline' } as const;
    const store = storage({ one: JSON.stringify(saved) });
    const prefs = createDebugPreferences('one', store);
    prefs.write(defaults);
    expect(store.writes).toEqual([]);
    expect(prefs.restore()).toEqual(saved);
    prefs.write(defaults);
    expect(prefs.restore()).toEqual(saved);
    expect(createDebugPreferences('two', store).restore()).toEqual(defaults);
    expect(store.writes).toEqual(['one']);
  });
  it('validates malformed JSON, field types and every enum', () => {
    for (const value of [
      '{',
      'null',
      '[]',
      '1',
      '{"open":"true"}',
      '{"dock":"top"}',
      '{"tab":"secret"}',
      JSON.stringify({ ...defaults, open: 'true' }),
      JSON.stringify({ ...defaults, dock: 'top' }),
      JSON.stringify({ ...defaults, tab: 'secret' }),
    ]) {
      expect(
        createDebugPreferences('one', storage({ one: value })).restore()
      ).toEqual(defaults);
    }
    for (const dock of ['left', 'right', 'bottom']) {
      expect(
        createDebugPreferences(
          'one',
          storage({ one: JSON.stringify({ ...defaults, dock }) })
        ).restore().dock
      ).toBe(dock);
    }
  });
  it('handles denied reads and writes', () => {
    const denied: DebugStorage = {
      getItem() {
        throw new Error('denied');
      },
      setItem() {
        throw new Error('denied');
      },
    };
    const prefs = createDebugPreferences('one', denied);
    expect(prefs.restore()).toEqual(defaults);
    expect(() => prefs.write(defaults)).not.toThrow();
  });
  it('writes only UI fields even when runtime callers supply application data', () => {
    const store = storage();
    const prefs = createDebugPreferences('one', store);
    prefs.restore();
    prefs.write({
      ...defaults,
      messages: ['secret'],
      contextKey: 'private',
    } as DebugPreferences);
    expect(JSON.parse(store.values.get('one')!)).toEqual(defaults);
    prefs.write({
      ...defaults,
      dock: 'invalid',
    } as unknown as DebugPreferences);
    expect(store.writes).toHaveLength(1);
  });
});
