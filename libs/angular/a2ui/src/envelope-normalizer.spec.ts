// libs/angular/a2ui/src/envelope-normalizer.spec.ts
import { describe, it, expect } from 'vitest';
import { normalizeEnvelopeArgs } from './envelope-normalizer';

describe('normalizeEnvelopeArgs', () => {
  it('returns the list for the canonical {envelopes: [...]} shape', () => {
    const args = { envelopes: [{ updateComponents: { surfaceId: 's', components: [] } }] };
    expect(normalizeEnvelopeArgs(args)).toEqual(args.envelopes);
  });

  it('returns the list for the singular {envelope: [...]} typo shape', () => {
    const args = { envelope: [{ createSurface: { surfaceId: 's', catalogId: 'basic' } }] };
    expect(normalizeEnvelopeArgs(args)).toEqual(args.envelope);
  });

  it('unflattens positional {0: ..., 1: ...} keys in numeric order', () => {
    const e1 = { updateComponents: { surfaceId: 's', components: [] } };
    const e2 = { createSurface: { surfaceId: 's', catalogId: 'basic' } };
    const args = { 1: e2, 0: e1 };
    expect(normalizeEnvelopeArgs(args)).toEqual([e1, e2]);
  });

  it('wraps a flat single envelope into a one-element array', () => {
    const args = { updateComponents: { surfaceId: 's', components: [] } };
    expect(normalizeEnvelopeArgs(args)).toEqual([args]);
  });

  it('returns null for an empty object', () => {
    expect(normalizeEnvelopeArgs({})).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(normalizeEnvelopeArgs(null as unknown as Record<string, unknown>)).toBeNull();
    expect(normalizeEnvelopeArgs('x' as unknown as Record<string, unknown>)).toBeNull();
  });
});
