/** Application-private bounded, descriptor-only immutable data capture. */
export type Data =
  | undefined
  | null
  | boolean
  | number
  | string
  | readonly Data[]
  | { readonly [key: string]: Data };
const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);
export function plainRecord(value: unknown): value is Record<string, Data> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) return false;
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== 'string' || unsafeKeys.has(key)) return false;
    const d = Object.getOwnPropertyDescriptor(value, key);
    return !!d && 'value' in d && d.enumerable === true;
  });
}
export function closedFields(value: unknown, keys: readonly string[]): boolean {
  return (
    plainRecord(value) && Object.keys(value).every((key) => keys.includes(key))
  );
}
export function copyData(value: unknown): Data {
  let bytes = 0,
    nodes = 0;
  const parents = new Set<object>();
  function text(value: string) {
    if (value.length > 1048576) throw Error('Data byte bound');
    bytes += new TextEncoder().encode(value).length;
    if (bytes > 1048576) throw Error('Data byte bound');
    return value;
  }
  function visit(value: unknown, depth: number): Data {
    if (depth > 64 || ++nodes > 65536) throw Error('Data structure bound');
    if (value === null || value === undefined || typeof value === 'boolean')
      return value;
    if (typeof value === 'string') return text(value);
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'object' || !value) throw Error('Unsupported data');
    if (parents.has(value)) throw Error('Cyclic data');
    parents.add(value);
    try {
      if (Array.isArray(value)) {
        if (
          Object.getPrototypeOf(value) !== Array.prototype ||
          value.length > 65536 ||
          Reflect.ownKeys(value).length !== value.length + 1
        )
          throw Error('Invalid array');
        const result: Data[] = [];
        for (let i = 0; i < value.length; i++) {
          const d = Object.getOwnPropertyDescriptor(value, String(i));
          if (!d || !('value' in d) || !d.enumerable)
            throw Error('Invalid array member');
          result.push(visit(d.value, depth + 1));
        }
        return Object.freeze(result);
      }
      if (!plainRecord(value)) throw Error('Invalid plain record');
      const result: Record<string, Data> = {};
      for (const key of Object.keys(value)) {
        text(key);
        result[key] = visit(
          Object.getOwnPropertyDescriptor(value, key)!.value,
          depth + 1
        );
      }
      return Object.freeze(result);
    } finally {
      parents.delete(value);
    }
  }
  return visit(value, 0);
}
/** Structural equality only for capturable finite plain data; key order is immaterial. */
export function equalData(left: unknown, right: unknown): boolean {
  try {
    const a = copyData(left),
      b = copyData(right);
    function same(a: Data, b: Data): boolean {
      if (Object.is(a, b)) return true;
      if (Array.isArray(a) || Array.isArray(b))
        return (
          Array.isArray(a) &&
          Array.isArray(b) &&
          a.length === b.length &&
          a.every((v, i) => same(v, b[i]))
        );
      if (!plainRecord(a) || !plainRecord(b)) return false;
      return (
        Object.keys(a).length === Object.keys(b).length &&
        Object.keys(a).every((k) => Object.hasOwn(b, k) && same(a[k], b[k]))
      );
    }
    return same(a, b);
  } catch {
    return false;
  }
}
