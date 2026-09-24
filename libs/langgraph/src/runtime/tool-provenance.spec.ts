import { describe, expect, it } from 'vitest';
import type { PlainValue } from '@threadplane/core';
import { ownValue, sameOwnedValue } from './ownership';
import {
  canonicalInvocation,
  captureAcquisition,
  captureSettlement,
  decodeResult,
  encodeResult,
} from './tool-provenance';

describe('durable tool provenance representation', () => {
  it('agrees with owned equality over scalar, object and sparse array shapes', () => {
    const values: PlainValue[] = [
      undefined,
      null,
      false,
      true,
      0,
      -0,
      NaN,
      Infinity,
      -Infinity,
      '',
      'undefined',
      'null',
      '["number","NaN"]',
      'a:b',
      [],
      Array(1),
      Array(2),
      [undefined],
      [null],
      Object.assign(Array(2), { 0: 1 }),
      [1],
      {},
      { x: undefined },
      { x: 1, y: 2 },
      { y: 2, x: 1 },
      Object.assign(Object.create(null), { x: 1, y: 2 }),
      { a: [1, { b: null }] },
      JSON.parse('{"__proto__":{"x":1}}'),
    ];
    for (const left of values)
      for (const right of values) {
        expect(
          canonicalInvocation('tool', left) ===
            canonicalInvocation('tool', right)
        ).toBe(sameOwnedValue(ownValue(left), ownValue(right)));
      }
    expect(canonicalInvocation('a:b', 'c')).not.toBe(
      canonicalInvocation('a', 'b:c')
    );
  });
  it('captures caller getters once before canonicalizing', () => {
    let reads = 0;
    const args = {
      get x() {
        return ++reads;
      },
    };
    expect(canonicalInvocation('tool', args)).toBe(
      canonicalInvocation('tool', { x: 1 })
    );
    expect(reads).toBe(1);
  });
  it.each([
    null,
    false,
    0,
    '',
    'Error: literal',
    '{"ok":false}',
    { a: [1, 'x'] },
    JSON.parse('{"__proto__":1}'),
  ])('reuses exact JSON result %j', (value) => {
    const result = { ok: true as const, value };
    const encoded = encodeResult(result);
    expect(typeof encoded).toBe('string');
    expect(decodeResult(encoded)).toEqual(result);
  });
  it.each([
    undefined,
    -0,
    NaN,
    Infinity,
    -Infinity,
    { a: undefined },
    [undefined],
    Array(1),
    Object.assign(Array(2), { 0: 1 }),
  ])('marks lossy result %j non-reusable', (value) => {
    expect(encodeResult({ ok: true, value })).toBeNull();
  });
  it('preserves an error envelope and owns decoded nested values', () => {
    expect(decodeResult(encodeResult({ ok: false, error: 'literal' }))).toEqual(
      { ok: false, error: 'literal' }
    );
    const result = decodeResult('{"ok":true,"value":{"a":[]}}');
    expect(Object.isFrozen(result)).toBe(true);
    expect(result?.ok && Object.isFrozen(result.value)).toBe(true);
  });
  it.each([
    null,
    undefined,
    1,
    '',
    '{',
    'null',
    'true',
    '{}',
    '{"ok":true}',
    '{"ok":false}',
    '{"ok":1,"value":2}',
    '{"ok":true,"value":1,"extra":2}',
    '{"ok":false,"error":1}',
    '{"ok":false,"error":"x","value":2}',
  ])('rejects malformed reusable envelope %j', (value) => {
    expect(decodeResult(value)).toBeUndefined();
  });
  it.each([
    null,
    undefined,
    1,
    'acquired',
    {},
    { status: 'unknown' },
    { status: 'acquired' },
    { status: 'acquired', token: '' },
    { status: 'acquired', token: 1 },
    { status: 'complete' },
    { status: 'complete', result: '{}' },
  ])('fails closed for malformed acquisition %j', (value) => {
    expect(captureAcquisition(value)).toEqual({ status: 'unavailable' });
  });
  it('captures protocol getters exactly once and catches throws', () => {
    let statuses = 0,
      tokens = 0,
      results = 0;
    expect(
      captureAcquisition({
        get status() {
          statuses++;
          return 'acquired';
        },
        get token() {
          return ++tokens === 1 ? 'first' : '';
        },
      })
    ).toEqual({ status: 'acquired', token: 'first' });
    expect([statuses, tokens]).toEqual([1, 1]);
    expect(
      captureAcquisition({
        status: 'complete',
        get result() {
          results++;
          return '{"ok":true,"value":"x"}';
        },
      })
    ).toEqual({ status: 'complete', result: { ok: true, value: 'x' } });
    expect(results).toBe(1);
    expect(
      captureAcquisition({
        get status() {
          throw new Error('bad');
        },
      })
    ).toEqual({ status: 'unavailable' });
    expect(captureAcquisition({ status: 'conflict' })).toEqual({
      status: 'conflict',
    });
  });
  it('accepts only an exact settlement acknowledgment', () => {
    expect(captureSettlement('accepted')).toBe(true);
    for (const value of [
      null,
      undefined,
      false,
      'rejected',
      {},
      { status: 'accepted' },
      'unknown',
    ])
      expect(captureSettlement(value)).toBe(false);
  });
  it.each(['{"ok":true,"value":-0}', '{"ok":true,"value":1e400}'])(
    'rejects an externally supplied non-reusable special number %s',
    (encoded) => {
      expect(decodeResult(encoded)).toBeUndefined();
    }
  );
});
