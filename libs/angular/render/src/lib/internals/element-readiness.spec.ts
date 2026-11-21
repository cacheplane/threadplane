import { describe, it, expect } from 'vitest';
import { z } from 'zod/v4';
import { isElementReady } from './element-readiness';
import type { NormalizedEntry } from '../render.types';

// eslint-disable-next-line @typescript-eslint/no-empty-function
const C = (() => {}) as never;
const entry = (over: Partial<NormalizedEntry> = {}): NormalizedEntry =>
  ({ component: C, fallback: C, ...over });

describe('isElementReady', () => {
  it('ready when no schema and no undefined props', () => {
    expect(isElementReady(entry(), { a: 1, b: 'x' })).toBe(true);
  });

  it('not ready when any prop value is undefined (json-render state binding loading)', () => {
    expect(isElementReady(entry(), { a: 1, b: undefined })).toBe(false);
  });

  it('not ready while a sync schema does not validate (required keys absent during streaming)', () => {
    const schema = z.object({ day: z.number(), places: z.array(z.string()) });
    expect(isElementReady(entry({ schema }), { status: 'running' })).toBe(false);
    expect(isElementReady(entry({ schema }), { day: 2 })).toBe(false);
  });

  it('ready once a sync schema validates (extra status/result keys ignored by non-strict object)', () => {
    const schema = z.object({ day: z.number(), places: z.array(z.string()) });
    expect(
      isElementReady(entry({ schema }), { day: 2, places: ['Eiffel'], status: 'complete', result: {} }),
    ).toBe(true);
  });

  it('ready when there is no schema regardless of which keys are present', () => {
    expect(isElementReady(entry(), { anything: true })).toBe(true);
  });

  it('ready (not gated) when the schema validates asynchronously (Promise result)', () => {
    const asyncSchema = {
      '~standard': { version: 1 as const, vendor: 'test', validate: () => Promise.resolve({ issues: [{ message: 'x' }] }) },
    };
    expect(isElementReady(entry({ schema: asyncSchema as never }), {})).toBe(true);
  });

  it('treats an undefined entry as having no schema (ready unless undefined props)', () => {
    expect(isElementReady(undefined, { a: 1 })).toBe(true);
    expect(isElementReady(undefined, { a: undefined })).toBe(false);
  });
});
