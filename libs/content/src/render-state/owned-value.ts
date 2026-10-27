import type { RenderStateSnapshot, RenderStateValue } from './types.js';

/** Container shape only; capture establishes the owned value contract. */
export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

export function isArrayIndex(key: string): boolean {
  return /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < 0xffffffff;
}

export function captureValue(value: unknown): RenderStateValue {
  return capture(value, new Set());
}

export function captureRecord(value: unknown): RenderStateSnapshot {
  if (!isRecord(value)) throw new TypeError('Render-state root must be a plain record');
  return captureValue(value) as RenderStateSnapshot;
}

function capture(value: unknown, active: Set<object>): RenderStateValue {
  if (value === null || value === undefined || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object') throw new TypeError('Unsupported render-state value');
  const array = Array.isArray(value);
  if (array ? Object.getPrototypeOf(value) !== Array.prototype : !isRecord(value)) {
    throw new TypeError('Render-state containers must be plain records or standard arrays');
  }
  if (active.has(value)) throw new TypeError('Cyclic render-state value');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  // Validate every descriptor before reading data; hidden accessors are rejected too.
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string') throw new TypeError('Symbol render-state keys are unsupported');
    if (!Object.hasOwn(descriptors[key], 'value')) throw new TypeError('Render-state accessors are unsupported');
    if (array && key !== 'length' && !isArrayIndex(key)) {
      throw new TypeError('Unsupported render-state array property');
    }
  }
  active.add(value);
  try {
    if (array) {
      const output: RenderStateValue[] = [];
      for (let i = 0; i < descriptors.length.value; i++) {
        output.push(capture(Object.hasOwn(descriptors, String(i)) ? descriptors[String(i)].value : undefined, active));
      }
      return Object.freeze(output);
    }
    const output: Record<string, RenderStateValue> = Object.create(null);
    for (const key of Object.keys(descriptors)) {
      if (descriptors[key].enumerable) output[key] = capture(descriptors[key].value, active);
    }
    return Object.freeze(output);
  } finally {
    active.delete(value);
  }
}
