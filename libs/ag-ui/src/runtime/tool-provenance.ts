import type { PlainValue } from '@threadplane/core';
import type { ToolExecutionResult } from '@threadplane/core/tools';

/* A copy of the LangGraph runtime's tool provenance helpers
 * (libs/langgraph/src/runtime/tool-provenance.ts and the ownership pieces they
 * use). One app execution store can serve both runtimes only when both write
 * the same invocation string and result encoding. tool-provenance.spec.ts pins
 * the two copies to identical output. Change them together. */

const owned = new WeakSet<object>();

function freeze<T extends object>(value: T): T {
  owned.add(value);
  return Object.freeze(value);
}

function ownValue(
  value: PlainValue,
  ancestors = new Set<object>()
): PlainValue {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
    return value;
  if (typeof value !== 'object')
    throw new TypeError('Tool snapshots require plain data.');
  if (owned.has(value)) return value;
  if (
    ancestors.has(value) ||
    (!Array.isArray(value) &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new TypeError('Tool snapshots require acyclic plain data.');
  }
  ancestors.add(value);
  const result = Array.isArray(value)
    ? freeze(value.map((item) => ownValue(item, ancestors)))
    : freeze(
        Object.fromEntries(
          Object.entries(value).map(([key, item]) => [
            key,
            ownValue(item, ancestors),
          ])
        )
      );
  ancestors.delete(value);
  return result;
}

function sameOwnedValue(a: PlainValue, b: PlainValue): boolean {
  if (Object.is(a, b)) return true;
  if (
    a === null ||
    b === null ||
    typeof a !== 'object' ||
    typeof b !== 'object'
  )
    return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length)
    return false;
  const left = Object.keys(a);
  const right = Object.keys(b);
  return (
    left.length === right.length &&
    left.every(
      (key) =>
        Object.hasOwn(b, key) &&
        sameOwnedValue(
          (a as Record<string, PlainValue>)[key],
          (b as Record<string, PlainValue>)[key]
        )
    )
  );
}

/** Comparison representation only: versioned, unambiguous, and never a hash. */
export function canonicalInvocation(name: string, args: PlainValue): string {
  return JSON.stringify([
    'threadplane-tool-invocation',
    1,
    name,
    tagged(ownValue(args)),
  ]);
}

function tagged(value: PlainValue): unknown {
  if (value === undefined) return ['undefined'];
  if (value === null) return ['null'];
  if (typeof value === 'string') return ['string', value];
  if (typeof value === 'boolean') return ['boolean', value];
  if (typeof value === 'number') {
    return [
      'number',
      Object.is(value, -0)
        ? '-0'
        : Number.isNaN(value)
        ? 'NaN'
        : value === Infinity
        ? '+Infinity'
        : value === -Infinity
        ? '-Infinity'
        : value,
    ];
  }
  if (Array.isArray(value)) {
    return [
      'array',
      value.length,
      Object.keys(value).map((key) => [
        Number(key),
        tagged(value[Number(key)]),
      ]),
    ];
  }
  return [
    'object',
    Object.keys(value)
      .sort()
      .map((key) => [key, tagged((value as Record<string, PlainValue>)[key])]),
  ];
}

export function ownResult(result: ToolExecutionResult): ToolExecutionResult {
  return Object.freeze(
    result.ok
      ? { ok: true, value: ownValue(result.value) }
      : { ok: false, error: result.error }
  );
}

/** Store only envelopes whose complete plain value survives JSON exactly. */
export function encodeResult(result: ToolExecutionResult): string | null {
  const captured = ownResult(result);
  const encoded = JSON.stringify(captured);
  return sameOwnedValue(captured, JSON.parse(encoded)) ? encoded : null;
}

export function decodeResult(
  encoded: unknown
): ToolExecutionResult | undefined {
  if (typeof encoded !== 'string') return undefined;
  try {
    const result: unknown = JSON.parse(encoded);
    if (!result || typeof result !== 'object' || Array.isArray(result))
      return undefined;
    const envelope = result as Record<string, unknown>;
    const keys = Object.keys(envelope);
    if (keys.length !== 2 || !Object.hasOwn(envelope, 'ok')) return undefined;
    if (envelope['ok'] === true && Object.hasOwn(envelope, 'value')) {
      const captured = ownResult({
        ok: true,
        value: envelope['value'] as PlainValue,
      });
      return encodeResult(captured) === null ? undefined : captured;
    }
    if (
      envelope['ok'] === false &&
      Object.hasOwn(envelope, 'error') &&
      typeof envelope['error'] === 'string'
    )
      return ownResult({ ok: false, error: envelope['error'] });
  } catch {
    /* Malformed stored data never authorizes reuse. */
  }
  return undefined;
}

export type CapturedAcquisition =
  | { readonly status: 'acquired'; readonly token: string }
  | { readonly status: 'complete'; readonly result: ToolExecutionResult }
  | { readonly status: 'unavailable' }
  | { readonly status: 'conflict' };

/** Read untrusted provider fields once; no later getter can change authority. */
export function captureAcquisition(value: unknown): CapturedAcquisition {
  try {
    if (!value || typeof value !== 'object') return { status: 'unavailable' };
    const response = value as Record<string, unknown>;
    const status = response['status'];
    if (status === 'acquired') {
      const token = response['token'];
      if (typeof token === 'string' && token.length > 0)
        return { status, token };
    }
    if (status === 'complete') {
      const result = decodeResult(response['result']);
      if (result) return { status, result };
    }
    if (status === 'conflict') return { status };
  } catch {
    /* Provider exceptions do not grant authority. */
  }
  return { status: 'unavailable' };
}

export function captureSettlement(value: unknown): boolean {
  return value === 'accepted';
}
