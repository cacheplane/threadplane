import type { PlainValue } from '@threadplane/core';
import type { ToolExecutionResult } from '@threadplane/core/tools';
import { ownValue, sameOwnedValue } from './ownership';

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

type CapturedAcquisition =
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
