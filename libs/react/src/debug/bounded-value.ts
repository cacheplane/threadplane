export const DEBUG_VIEW_BYTES = 32_768;
export const DEBUG_OWNED_BYTES = 131_072;
export type DebugTruncationReason = 'depth' | 'entries' | 'string' | 'bytes';
export type DebugProjection =
  | {
      readonly status: 'ready';
      readonly text: string;
      readonly truncated: boolean;
      readonly reason: DebugTruncationReason | null;
    }
  | {
      readonly status: 'unavailable';
      readonly text: null;
      readonly truncated: false;
      readonly reason: 'invalid';
    };
/** Incrementally project plain JSON data. Only visited values are validated; a
 * truncated prefix is never a complete authoritative snapshot. No getters or
 * toJSON methods run. Proxies are outside the plain-data contract.
 * The larger ceiling is for app-owned capture; panels use the default ceiling
 * and copy exactly the returned text, with the separate truncation notice.
 */
export function projectDebugValue(
  value: unknown,
  bytes: typeof DEBUG_VIEW_BYTES | typeof DEBUG_OWNED_BYTES = DEBUG_VIEW_BYTES
): DebugProjection {
  const limit =
    bytes === DEBUG_OWNED_BYTES ? DEBUG_OWNED_BYTES : DEBUG_VIEW_BYTES;
  let text = '';
  let remaining = limit;
  let entries = 0;
  let reason: DebugTruncationReason | null = null;
  const ancestors = new Set<object>();
  const truncate = (why: DebugTruncationReason) => {
    reason ??= why;
  };
  const append = (part: string) => {
    text += part;
    remaining -= utf8Bytes(part);
  };

  function stringToken(source: string, budget: number): string {
    let result = '"';
    let used = 2;
    let points = 0;
    for (const point of source) {
      if (points === 2000) {
        truncate('string');
        break;
      }
      const escaped = JSON.stringify(point).slice(1, -1);
      const size = utf8Bytes(escaped);
      if (used + size > budget) {
        truncate('bytes');
        break;
      }
      result += escaped;
      used += size;
      points++;
    }
    return result + '"';
  }

  function visit(item: unknown, depth: number, reserved: number): void {
    const available = remaining - reserved;
    if (item === null) {
      append('null');
      return;
    }
    if (typeof item === 'string') {
      append(stringToken(item, available));
      return;
    }
    if (typeof item === 'boolean' || typeof item === 'number') {
      if (typeof item === 'number' && !Number.isFinite(item))
        throw new Error('invalid');
      const token = String(item);
      if (utf8Bytes(token) > available) {
        truncate('bytes');
        append('null');
      } else append(token);
      return;
    }
    if (typeof item !== 'object') throw new Error('invalid');
    const array = Array.isArray(item);
    const prototype = Object.getPrototypeOf(item);
    if (
      (!array && prototype !== null && prototype !== Object.prototype) ||
      (array && prototype !== Array.prototype) ||
      ancestors.has(item)
    )
      throw new Error('invalid');
    if (depth >= 6) {
      truncate('depth');
      append('null');
      return;
    }
    ancestors.add(item);
    append(array ? '[' : '{');
    let count = 0;
    const child = (key: string): boolean => {
      if (entries === 200) {
        truncate('entries');
        return false;
      }
      // Do not allocate or stringify an enormous property name.
      if (!array && key.length > 4000) {
        truncate('string');
        return false;
      }
      if (!array) {
        let points = 0;
        for (const _point of key)
          if (++points > 2000) {
            truncate('string');
            return false;
          }
      }
      const keyToken = array ? '' : JSON.stringify(key) + ':';
      const prefix = (count ? ',' : '') + keyToken;
      // Four bytes permit any fallback JSON token (null); reserve every close.
      if (utf8Bytes(prefix) + 4 + reserved + 1 > remaining) {
        truncate('bytes');
        return false;
      }
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor || !('value' in descriptor)) throw new Error('invalid');
      append(prefix);
      entries++;
      count++;
      visit(descriptor.value, depth + 1, reserved + 1);
      return true;
    };
    if (array) {
      for (let index = 0; index < item.length; index++)
        if (!child(String(index))) break;
    } else {
      // Stop traversal at the budget, without Object.keys/entries arrays.
      for (const key in item) {
        if (Object.prototype.hasOwnProperty.call(item, key) && !child(key))
          break;
      }
    }
    append(array ? ']' : '}');
    ancestors.delete(item);
  }
  try {
    visit(value, 0, 0);
    return { status: 'ready', text, truncated: reason !== null, reason };
  } catch {
    return {
      status: 'unavailable',
      text: null,
      truncated: false,
      reason: 'invalid',
    };
  }
}

function utf8Bytes(text: string): number {
  let bytes = 0;
  for (const point of text) {
    const code = point.codePointAt(0)!;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return bytes;
}
