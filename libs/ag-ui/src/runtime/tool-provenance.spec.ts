import type { PlainValue } from '@threadplane/core';
import type { ToolExecutionResult } from '@threadplane/core/tools';
import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @nx/enforce-module-boundaries -- The copied encoding is compared with its LangGraph source.
import * as langgraph from '../../../langgraph/src/runtime/tool-provenance';
import * as agui from './tool-provenance';

// One app execution store serves both runtimes only if both write the same
// invocation string and the same result encoding for every value.
const sparse: PlainValue[] = [1];
sparse[3] = 2;
const values: readonly PlainValue[] = [
  undefined,
  null,
  '',
  'text',
  true,
  false,
  0,
  -0,
  1.5,
  NaN,
  Infinity,
  -Infinity,
  [],
  {},
  [1, [2, [3, { a: -0 }]], { z: NaN, a: [undefined] }],
  { b: 1, a: { d: [null, true], c: 'x' } },
  { a: { c: 'x', d: [null, true] }, b: 1 },
  { __proto__: null, constructor: 'c', toString: 's' } as PlainValue,
  { list: [undefined, null], nested: { deep: { deeper: [Infinity] } } },
  sparse,
];

describe('tool provenance copies', () => {
  it.each(values.map((value, index) => [index, value] as const))(
    'write the same invocation for value %i',
    (_index, value) => {
      expect(agui.canonicalInvocation('tool', value)).toBe(
        langgraph.canonicalInvocation('tool', value)
      );
    }
  );

  it('ignores key order and separates -0, NaN and holes the same way', () => {
    const a = agui.canonicalInvocation('t', { b: 1, a: 2 });
    expect(a).toBe(agui.canonicalInvocation('t', { a: 2, b: 1 }));
    expect(agui.canonicalInvocation('t', -0)).not.toBe(
      agui.canonicalInvocation('t', 0)
    );
    expect(agui.canonicalInvocation('t', sparse)).not.toBe(
      agui.canonicalInvocation('t', [1, undefined, undefined, 2])
    );
  });

  it.each(values.map((value, index) => [index, value] as const))(
    'encode and decode the same result for value %i',
    (_index, value) => {
      for (const result of [
        { ok: true, value },
        { ok: false, error: String(_index) },
      ] as ToolExecutionResult[]) {
        const encoded = agui.encodeResult(result);
        expect(encoded).toBe(langgraph.encodeResult(result));
        expect(agui.decodeResult(encoded)).toEqual(
          langgraph.decodeResult(encoded)
        );
      }
    }
  );

  it.each([
    { status: 'acquired', token: 'owner' },
    { status: 'acquired', token: '' },
    { status: 'complete', result: '{"ok":true,"value":{"b":1,"a":[2]}}' },
    { status: 'complete', result: '{"ok":false,"error":"no"}' },
    { status: 'complete', result: '{"ok":true}' },
    { status: 'complete', result: 'not json' },
    { status: 'conflict' },
    { status: 'unavailable' },
    { status: 'executing' },
    null,
    'acquired',
  ])('capture the same acquisition %#', (value) => {
    expect(agui.captureAcquisition(value)).toEqual(
      langgraph.captureAcquisition(value)
    );
  });

  it('accept only the accepted settlement', () => {
    for (const value of ['accepted', 'rejected', undefined, true])
      expect(agui.captureSettlement(value)).toBe(
        langgraph.captureSettlement(value)
      );
  });
});
