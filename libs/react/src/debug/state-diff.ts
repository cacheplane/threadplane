import { projectDebugValue } from './bounded-value.js';
import type { DebugValue } from './types.js';

type Change =
  | { kind: 'added'; path: string; after: DebugValue }
  | { kind: 'removed'; path: string; before: DebugValue }
  | { kind: 'changed'; path: string; before: DebugValue; after: DebugValue };
type Comparison =
  | { readonly status: 'ready'; readonly text: string; readonly count: number }
  | { readonly status: 'invalid' | 'input-limit' | 'output-limit' };

/** Compare only complete bounded plain-data projections; no raw values escape. */
export function compareDebugStates(
  before: unknown,
  after: unknown
): Comparison {
  const previous = projectDebugValue(before);
  const next = projectDebugValue(after);
  if (previous.status !== 'ready' || next.status !== 'ready')
    return { status: 'invalid' };
  if (previous.truncated || next.truncated) return { status: 'input-limit' };
  const changes: Change[] = [];
  visit(JSON.parse(previous.text), JSON.parse(next.text), '');
  const output = projectDebugValue(changes);
  if (output.status !== 'ready' || output.truncated)
    return { status: 'output-limit' };
  return { status: 'ready', text: output.text, count: changes.length };

  function visit(a: DebugValue, b: DebugValue, path: string): void {
    if (equal(a, b)) return;
    if (record(a) && record(b)) {
      for (const key of Object.keys(a)) {
        const childPath = `${path}/${pointerToken(key)}`;
        if (!Object.hasOwn(b, key))
          changes.push({ kind: 'removed', path: childPath, before: a[key] });
        else visit(a[key], b[key], childPath);
      }
      for (const key of Object.keys(b)) {
        if (!Object.hasOwn(a, key))
          changes.push({
            kind: 'added',
            path: `${path}/${pointerToken(key)}`,
            after: b[key],
          });
      }
    } else changes.push({ kind: 'changed', path, before: a, after: b });
  }
}

function record(
  value: DebugValue
): value is { readonly [key: string]: DebugValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function equal(a: DebugValue, b: DebugValue): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return (
      a.length === b.length && a.every((value, index) => equal(value, b[index]))
    );
  if (record(a) && record(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]))
    );
  }
  return false;
}
function pointerToken(key: string): string {
  return key.replace(/~/g, '~0').replace(/\//g, '~1');
}
