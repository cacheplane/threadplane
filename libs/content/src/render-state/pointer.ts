import type { RenderStateSnapshot, RenderStateValue } from './types.js';
import { isArrayIndex, isRecord } from './owned-value.js';

/** This narrowing is only valid for values whose ownership is already established. */
function isOwnedRecord(value: RenderStateValue): value is RenderStateSnapshot {
  return isRecord(value);
}

/** Slash is a retained root alias, so this is intentionally not full RFC 6901. */
export function parsePointer(path: string): readonly string[] {
  if (typeof path !== 'string') throw new TypeError('Render-state path must be a string');
  if (path === '' || path === '/') return Object.freeze([]);
  if (!path.startsWith('/')) throw new TypeError('Render-state path must begin with slash');
  return Object.freeze(path.slice(1).split('/').map(segment => {
    if (/~(?:[^01]|$)/.test(segment)) throw new TypeError('Malformed render-state path escape');
    return segment.replace(/~[01]/g, escape => escape === '~0' ? '~' : '/');
  }));
}

function validateArrayKey(key: string): void {
  if (!isArrayIndex(key)) throw new TypeError('Render-state arrays require canonical indices');
}

export function readPointer(state: RenderStateSnapshot, path: readonly string[]): RenderStateValue {
  let current: RenderStateValue = state;
  for (const key of path) {
    if (Array.isArray(current)) {
      validateArrayKey(key);
      current = Object.hasOwn(current, key) ? current[Number(key)] : undefined;
    } else if (isOwnedRecord(current)) {
      current = Object.hasOwn(current, key) ? current[key] : undefined;
    } else {
      return undefined;
    }
  }
  return current;
}

/** Values are already captured. This helper never publishes or changes its inputs. */
export function applyPointer(state: RenderStateSnapshot, path: readonly string[], value: RenderStateValue): RenderStateSnapshot {
  if (path.length === 0) {
    if (!isOwnedRecord(value)) throw new TypeError('Render-state root must be a plain record');
    return value;
  }
  return replace(state, 0) as RenderStateSnapshot;

  function replace(current: RenderStateValue, depth: number): RenderStateValue {
    if (depth === path.length) return value;
    const key = path[depth];
    if (Array.isArray(current)) {
      validateArrayKey(key);
      const index = Number(key);
      const next = replace(Object.hasOwn(current, key) ? current[index] : undefined, depth + 1);
      const output: RenderStateValue[] = current.slice();
      while (output.length <= index) output.push(undefined);
      output[index] = next;
      return Object.freeze(output);
    }
    const record = isOwnedRecord(current) ? current : undefined;
    const next = replace(record && Object.hasOwn(record, key) ? record[key] : undefined, depth + 1);
    const output: Record<string, RenderStateValue> = Object.assign(Object.create(null), record);
    output[key] = next;
    return Object.freeze(output);
  }
}
