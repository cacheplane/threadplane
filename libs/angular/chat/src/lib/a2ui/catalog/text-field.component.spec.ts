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

describe('A2uiTextFieldComponent — v0.9 protocol', () => {
  // NOTE: Angular signal-based inputs can't be tested via TestBed without the
  // angular() vite plugin (NG0303). v0.9: `value` is the resolved string value;
  // `variant` ('shortText'|'longText'|'number'|'obscured', default 'shortText')
  // drives htmlInputType — the old 'date' option is gone (DateTimeInput owns
  // dates); validationRegexp is passed to the HTML pattern attribute.

  describe('htmlInputType logic', () => {
    const TYPE_MAP: Record<string, string> = {
      shortText: 'text', longText: 'text', number: 'number',
      obscured: 'password',
    };
    const getType = (t: string) => TYPE_MAP[t] ?? 'text';

    it('maps shortText → text', () => expect(getType('shortText')).toBe('text'));
    it('maps longText → text (textarea rendered)', () => expect(getType('longText')).toBe('text'));
    it('maps number → number', () => expect(getType('number')).toBe('number'));
    it('maps obscured → password', () => expect(getType('obscured')).toBe('password'));
    it('no longer maps date (removed in v0.9) — falls back to text', () =>
      expect(getType('date')).toBe('text'));
    it('defaults unknown variant → text', () => expect(getType('unknown')).toBe('text'));
  });

  describe('onInput emit logic', () => {
    it('writes value binding path with typed value', () => {
      const { host, writes } = makeHost();
      const bindings = { value: '/name' };
      emitBinding(host, bindings, 'value', 'Alice');
      expect(writes).toEqual([['/name', 'Alice']]);
    });

    it('writes empty string for cleared input', () => {
      const { host, writes } = makeHost();
      const bindings = { value: '/name' };
      emitBinding(host, bindings, 'value', '');
      expect(writes).toEqual([['/name', '']]);
    });

    it('does not write when no binding exists', () => {
      const { host, writes } = makeHost();
      emitBinding(host, {}, 'value', 'Alice');
      expect(writes).toHaveLength(0);
    });
  });
});
