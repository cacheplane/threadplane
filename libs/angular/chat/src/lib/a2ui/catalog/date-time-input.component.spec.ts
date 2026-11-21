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

describe('A2uiDateTimeInputComponent — v0.9 protocol', () => {
  // NOTE: Angular signal-based inputs can't be tested via TestBed without the
  // angular() vite plugin (NG0303). v0.9: enableDate + enableTime booleans drive
  // htmlInputType; optional `min`/`max` ISO strings map to the native input's
  // min/max attributes (null when absent so the attribute is omitted).

  describe('htmlInputType logic', () => {
    const getType = (enableDate: boolean, enableTime: boolean): string => {
      if (enableDate && enableTime) return 'datetime-local';
      if (enableTime) return 'time';
      return 'date';
    };

    it('returns date when only enableDate is true', () => {
      expect(getType(true, false)).toBe('date');
    });

    it('returns time when only enableTime is true', () => {
      expect(getType(false, true)).toBe('time');
    });

    it('returns datetime-local when both are true', () => {
      expect(getType(true, true)).toBe('datetime-local');
    });

    it('defaults to date when both are false', () => {
      expect(getType(false, false)).toBe('date');
    });
  });

  describe('min/max attribute logic', () => {
    const attr = (v: string | undefined) => v || null;

    it('passes an ISO min through', () => expect(attr('2026-01-01')).toBe('2026-01-01'));
    it('passes an ISO max through', () => expect(attr('2026-12-31')).toBe('2026-12-31'));
    it('omits the attribute when unset', () => expect(attr(undefined)).toBeNull());
    it('omits the attribute when empty', () => expect(attr('')).toBeNull());
  });

  describe('onChange emit logic', () => {
    it('writes binding with date value', () => {
      const { host, writes } = makeHost();
      const bindings = { value: '/appointmentDate' };
      const event = { target: { value: '2026-04-15' } } as unknown as Event;
      const val = (event.target as HTMLInputElement).value;
      emitBinding(host, bindings, 'value', val);
      expect(writes).toEqual([['/appointmentDate', '2026-04-15']]);
    });

    it('writes binding with datetime-local value', () => {
      const { host, writes } = makeHost();
      const bindings = { value: '/scheduledAt' };
      const event = { target: { value: '2026-04-15T14:30' } } as unknown as Event;
      const val = (event.target as HTMLInputElement).value;
      emitBinding(host, bindings, 'value', val);
      expect(writes).toEqual([['/scheduledAt', '2026-04-15T14:30']]);
    });

    it('does not write when no binding exists for value', () => {
      const { host, writes } = makeHost();
      emitBinding(host, {}, 'value', '2026-04-15');
      expect(writes).toHaveLength(0);
    });
  });
});
