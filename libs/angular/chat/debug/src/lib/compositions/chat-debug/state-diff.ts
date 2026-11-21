/**
 * Represents a single entry in a state diff.
 * - `added`: key exists in `after` but not `before`
 * - `removed`: key exists in `before` but not `after`
 * - `changed`: key exists in both but values differ
 */
export interface DiffEntry {
  path: string;
  type: 'added' | 'removed' | 'changed';
  before?: unknown;
  after?: unknown;
}

/**
 * Computes a recursive diff between two state objects.
 * Returns an array of DiffEntry describing added, removed, and changed keys.
 */
export function computeStateDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  prefix = '',
): DiffEntry[] {
  const entries: DiffEntry[] = [];
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of allKeys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const inBefore = key in before;
    const inAfter = key in after;

    if (!inBefore && inAfter) {
      entries.push({ path, type: 'added', after: after[key] });
    } else if (inBefore && !inAfter) {
      entries.push({ path, type: 'removed', before: before[key] });
    } else {
      const bVal = before[key];
      const aVal = after[key];

      // Recurse into nested plain objects
      if (isPlainObject(bVal) && isPlainObject(aVal)) {
        entries.push(
          ...computeStateDiff(
            bVal as Record<string, unknown>,
            aVal as Record<string, unknown>,
            path,
          ),
        );
      } else if (!deepEqual(bVal, aVal)) {
        entries.push({ path, type: 'changed', before: bVal, after: aVal });
      }
      // If equal, no entry
    }
  }

  return entries;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }

  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => key in b && deepEqual(a[key], b[key]));
  }

  return false;
}
