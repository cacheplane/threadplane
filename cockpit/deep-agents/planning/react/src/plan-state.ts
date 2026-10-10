export interface PlanItem {
  readonly content: string;
  readonly status: 'pending' | 'in_progress' | 'completed';
}
export type PlanState =
  | { readonly kind: 'valid'; readonly items: readonly PlanItem[] }
  | { readonly kind: 'missing' }
  | { readonly kind: 'invalid' };

export function plainRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/** Capture own JSON data without invoking accessors. Reject unsupported values,
 * cycles, sparse arrays and excessive depth; never coerce or truncate. */
export function copyJson(
  input: unknown,
  omitOptionalUndefined = false
): unknown {
  const path = new Set<object>();
  let nodes = 0;
  function copy(value: unknown, depth: number): unknown {
    if (++nodes > 100000 || depth > 100)
      throw new Error('Unsupported JSON size');
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean'
    )
      return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (!Array.isArray(value) && !plainRecord(value))
      throw new Error('Unsupported JSON value');
    const object = value as object;
    if (path.has(object)) throw new Error('Cyclic data');
    path.add(object);
    const keys = Reflect.ownKeys(object);
    const array = Array.isArray(value);
    if (array && Object.getPrototypeOf(value) !== Array.prototype)
      throw new Error('Unsupported array');
    const entries = keys.filter((k) => !(array && k === 'length'));
    if (array && entries.length !== value.length)
      throw new Error('Sparse or extended array');
    const output: Record<string, unknown> = {};
    for (const key of entries) {
      if (typeof key !== 'string') throw new Error('Symbol key');
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
        throw new Error('Non-JSON property');
      // Native contracts have optional own fields; raw graph evidence does not.
      if (!array && omitOptionalUndefined && descriptor.value === undefined)
        continue;
      if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length))
        throw new Error('Extended array');
      Object.defineProperty(output, key, {
        value: copy(descriptor.value, depth + 1),
        enumerable: true,
      });
    }
    path.delete(object);
    return Object.freeze(
      array
        ? Array.from({ length: value.length }, (_, i) => output[String(i)])
        : output
    );
  }
  return copy(input, 0);
}

export function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right))
    return (
      left.length === right.length &&
      left.every((v, i) => sameJson(v, right[i]))
    );
  if (!plainRecord(left) || !plainRecord(right)) return false;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((k) => Object.hasOwn(right, k) && sameJson(left[k], right[k]))
  );
}

export function planState(input: unknown): PlanState {
  if (input === undefined) return Object.freeze({ kind: 'missing' });
  try {
    const root = copyJson(input);
    if (!plainRecord(root)) return Object.freeze({ kind: 'invalid' });
    if (!Object.hasOwn(root, 'todos'))
      return Object.freeze({ kind: 'missing' });
    const todos = root.todos;
    if (
      !Array.isArray(todos) ||
      todos.length > 50 ||
      todos.some(
        (row) =>
          !plainRecord(row) ||
          Object.keys(row).length !== 2 ||
          !Object.hasOwn(row, 'content') ||
          !Object.hasOwn(row, 'status') ||
          typeof row.content !== 'string' ||
          row.content.length > 2000 ||
          !['pending', 'in_progress', 'completed'].includes(
            row.status as string
          )
      )
    )
      return Object.freeze({ kind: 'invalid' });
    return Object.freeze({
      kind: 'valid',
      items: todos as readonly PlanItem[],
    });
  } catch {
    return Object.freeze({ kind: 'invalid' });
  }
}

export function planProgress(items: readonly PlanItem[]) {
  return Object.freeze({
    completed: items.filter((row) => row.status === 'completed').length,
    total: items.length,
  });
}
