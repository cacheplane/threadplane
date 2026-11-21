import { describe, it, expect } from 'vitest';
import type { RenderHost } from '@threadplane/angular/render';
import { A2uiChoicePickerComponent } from './choice-picker.component';
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

describe('A2uiChoicePickerComponent — v0.9 protocol', () => {
  // NOTE: Angular signal-based inputs can't be tested via TestBed without the
  // angular() vite plugin (NG0303). v0.9: `value` (string[]) holds the current
  // selection; `variant` 'mutuallyExclusive' (default) is single-select radio
  // semantics, 'multipleSelection' is multi-select; `displayStyle` picks
  // 'checkbox' rows (default) or 'chips'; `filterable` shows a client-side
  // option filter. Writes go back through the `value` binding.

  it('exports the component class', () => {
    expect(A2uiChoicePickerComponent).toBeDefined();
  });

  describe('isSingleSelect logic', () => {
    const isSingle = (variant: string) => variant !== 'multipleSelection';
    it('is single-select for mutuallyExclusive (default)', () =>
      expect(isSingle('mutuallyExclusive')).toBe(true));
    it('is multi-select for multipleSelection', () =>
      expect(isSingle('multipleSelection')).toBe(false));
  });

  describe('isSelected logic', () => {
    const isSelected = (value: string[], v: string) => value.includes(v);
    it('returns true when value contains the option', () => {
      expect(isSelected(['a', 'b'], 'a')).toBe(true);
    });
    it('returns false when value does not contain the option', () => {
      expect(isSelected(['a', 'b'], 'c')).toBe(false);
    });
    it('returns false when value is empty', () => {
      expect(isSelected([], 'a')).toBe(false);
    });
  });

  describe('single-select emit logic (mutuallyExclusive)', () => {
    it('writes the value binding with a one-element array', () => {
      const { host, writes } = makeHost();
      const bindings = { value: '/department' };
      emitBinding(host, bindings, 'value', ['Engineering']);
      expect(writes).toEqual([['/department', ['Engineering']]]);
    });
  });

  describe('multi-select toggle logic (multipleSelection)', () => {
    const toggle = (current: string[], value: string, checked: boolean): string[] => {
      const result = [...current];
      const idx = result.indexOf(value);
      if (checked && idx === -1) result.push(value);
      else if (!checked && idx !== -1) result.splice(idx, 1);
      return result;
    };

    it('adds value when checked', () => {
      expect(toggle(['a'], 'b', true)).toEqual(['a', 'b']);
    });
    it('removes value when unchecked', () => {
      expect(toggle(['a', 'b'], 'a', false)).toEqual(['b']);
    });
    it('does not duplicate when value already selected', () => {
      expect(toggle(['a', 'b'], 'a', true)).toEqual(['a', 'b']);
    });
    it('is a no-op when removing a value not in selections', () => {
      expect(toggle(['a'], 'b', false)).toEqual(['a']);
    });

    it('writes binding with actual array (not JSON string)', () => {
      const { host, writes } = makeHost();
      const bindings = { value: '/colors' };
      emitBinding(host, bindings, 'value', ['red', 'blue']);
      expect(writes).toHaveLength(1);
      expect(writes[0][0]).toBe('/colors');
      expect(writes[0][1]).toEqual(['red', 'blue']);
      expect(Array.isArray(writes[0][1])).toBe(true);
    });
  });

  describe('filter logic (filterable)', () => {
    const filterOptions = (
      options: { label: string; value: string }[],
      filter: string,
    ) => {
      const f = filter.trim().toLowerCase();
      return f ? options.filter(o => o.label.toLowerCase().includes(f)) : options;
    };
    const opts = [
      { label: 'Engineering', value: 'eng' },
      { label: 'Marketing', value: 'mkt' },
      { label: 'Design', value: 'dsn' },
    ];

    it('shows all options when the filter is empty', () => {
      expect(filterOptions(opts, '')).toEqual(opts);
    });
    it('filters by label, case-insensitively', () => {
      expect(filterOptions(opts, 'eng')).toEqual([opts[0]]);
      expect(filterOptions(opts, 'ING')).toEqual([opts[0], opts[1]]);
    });
    it('returns empty when nothing matches', () => {
      expect(filterOptions(opts, 'zzz')).toEqual([]);
    });
  });
});
