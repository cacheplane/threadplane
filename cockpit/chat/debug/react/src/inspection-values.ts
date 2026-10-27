/** Own-data capture only. This does not isolate hostile proxies or bound SDK JSON decoding. */
export function plainRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}
export function ownField(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') throw Error('Expected own data.');
  const d = Object.getOwnPropertyDescriptor(value, key);
  if (!d) return undefined;
  if (!('value' in d) || !d.enumerable)
    throw Error('Expected enumerable data.');
  return d.value;
}
export function boundedText(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const points = value[Symbol.iterator]();
  for (let i = 0; i <= 2000; i++) if (points.next().done) return true;
  return false;
}
export type Json =
  | null
  | boolean
  | number
  | string
  | readonly Json[]
  | { readonly [key: string]: Json };
/** Independent app-side 128KiB cap; the passive panel has a separate 32KiB display cap. */
export function captureData(input: unknown, omitMessages = false): Json {
  let entries = 0,
    bytes = 0;
  const spend = (count: number) => {
    bytes += count;
    if (bytes > 131072) throw Error('Byte limit.');
  };
  const stringBytes = (value: string): number => {
    let points = 0,
      size = 2;
    for (const char of value) {
      if (++points > 2000) throw Error('String limit.');
      const cp = char.codePointAt(0) ?? 0;
      size +=
        char === '"' ||
        char === '\\' ||
        ['\b', '\f', '\n', '\r', '\t'].includes(char)
          ? 2
          : cp < 32 || (cp >= 0xd800 && cp <= 0xdfff)
          ? 6
          : cp < 128
          ? 1
          : cp < 2048
          ? 2
          : cp < 65536
          ? 3
          : 4;
    }
    return size;
  };
  const seen = new Set<object>();
  const walk = (value: unknown, depth: number): Json => {
    if (depth > 6) throw Error('Depth exceeded.');
    if (value === null) {
      spend(4);
      return value;
    }
    if (typeof value === 'boolean') {
      spend(value ? 4 : 5);
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      spend(String(value).length);
      return value;
    }
    if (typeof value === 'string') {
      spend(stringBytes(value));
      return value;
    }
    if (typeof value !== 'object' || value === null || seen.has(value))
      throw Error('Unsupported data.');
    const isArray = Array.isArray(value);
    if (isArray && Object.getPrototypeOf(value) !== Array.prototype)
      throw Error('Unsupported array class.');
    if (!isArray && !plainRecord(value)) throw Error('Unsupported object.');
    seen.add(value);
    spend(2);
    try {
      if (isArray) {
        const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
        if (typeof length !== 'number' || length > 200 - entries)
          throw Error('Entry limit.');
        const result: Json[] = [];
        for (let i = 0; i < length; i++) {
          if (++entries > 200) throw Error('Entry limit.');
          if (i) spend(1);
          const d = Object.getOwnPropertyDescriptor(value, String(i));
          if (!d || !d.enumerable || !('value' in d))
            throw Error('Sparse or accessor array.');
          result.push(walk(d.value, depth + 1));
        }
        for (const key in value)
          if (
            Object.hasOwn(value, key) &&
            (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length)
          )
            throw Error('Decorated array.');
        return Object.freeze(result);
      }
      const result: Record<string, Json> = Object.create(null);
      let count = 0;
      // Incremental enumeration: no whole-source key list, string spread, or serialization.
      for (const key in value) {
        if (
          !Object.hasOwn(value, key) ||
          (omitMessages && depth === 0 && key === 'messages')
        )
          continue;
        if (++entries > 200) throw Error('Entry limit.');
        spend(stringBytes(key) + 1 + (count++ ? 1 : 0));
        const child = walk(ownField(value, key), depth + 1);
        Object.defineProperty(result, key, { value: child, enumerable: true });
      }
      return Object.freeze(result);
    } finally {
      seen.delete(value);
    }
  };
  return walk(input, 0);
}

export type InspectionValues =
  | { readonly kind: 'unavailable' }
  | {
      readonly kind: 'available';
      readonly values: Readonly<Record<string, Json>>;
    };
export function captureInspectionValues(input: unknown): InspectionValues {
  try {
    if (!plainRecord(input)) throw Error('Values unavailable.');
    return Object.freeze({
      kind: 'available',
      values: captureData(input, true) as Readonly<Record<string, Json>>,
    });
  } catch {
    return Object.freeze({ kind: 'unavailable' });
  }
}
