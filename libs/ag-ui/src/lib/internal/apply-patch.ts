// Minimal RFC-6902 JSON Patch implementation, scoped to the ops the AG-UI
// reducer actually receives via STATE_DELTA events: add, replace, remove,
// move, copy, test. Pure ESM, zero deps. Replaces a CommonJS-only third-party
// dependency that broke ESM-strict consumers (Vitest, Vite test envs).

import { copyData } from './copy-data';

export interface JsonPatchOp {
  readonly op: 'add' | 'replace' | 'remove' | 'move' | 'copy' | 'test';
  readonly path: string;
  readonly value?: unknown;
  readonly from?: string;
}

/**
 * Apply a sequence of JSON Patch (RFC-6902) operations to `target`. Returns a
 * new document. The input is not mutated.
 *
 * Operations apply in order; if any operation fails (invalid path, failed
 * test, etc.) the whole patch throws without changing the input. Paths must
 * resolve through existing own members; only a final add may create a member
 * or insert at the array end. Root add/replace is supported, root remove is not.
 */
export function applyPatch<T>(target: T, ops: readonly JsonPatchOp[]): T {
  let current: unknown = target;
  for (const op of ops) {
    current = applyOne(current, op);
  }
  return current as T;
}

function applyOne(doc: unknown, op: JsonPatchOp): unknown {
  switch (op.op) {
    case 'add':     return setAt(doc, parsePointer(op.path), op.value, /*add*/ true);
    case 'replace': return setAt(doc, parsePointer(op.path), op.value, /*add*/ false);
    case 'remove':  return removeAt(doc, parsePointer(op.path));
    case 'move': {
      if (op.from == null) throw new Error("'move' op requires 'from'");
      const fromTokens = parsePointer(op.from);
      const value = getAt(doc, fromTokens);
      const removed = removeAt(doc, fromTokens);
      return setAt(removed, parsePointer(op.path), value, true);
    }
    case 'copy': {
      if (op.from == null) throw new Error("'copy' op requires 'from'");
      const value = getAt(doc, parsePointer(op.from));
      return setAt(doc, parsePointer(op.path), value, true);
    }
    case 'test': {
      const actual = getAt(doc, parsePointer(op.path));
      if (!deepEqual(actual, op.value)) {
        throw new Error(`'test' op failed at path ${op.path}`);
      }
      return doc;
    }
    default: {
      const o: { op: string } = op as never;
      throw new Error(`Unsupported JSON Patch op: ${o.op}`);
    }
  }
}

/**
 * Parse an RFC-6901 JSON Pointer string into its tokens.
 *   ""        → []
 *   "/foo/0"  → ["foo", "0"]
 *   "/a~1b"   → ["a/b"]   (~1 → /)
 *   "/a~0b"   → ["a~b"]   (~0 → ~)
 */
export function parsePointer(pointer: string): string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) {
    throw new Error(`Invalid JSON Pointer: ${pointer}`);
  }
  return pointer
    .slice(1)
    .split('/')
    .map(token => token.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function getAt(doc: unknown, tokens: readonly string[]): unknown {
  let cur: unknown = doc;
  for (const token of tokens) {
    cur = stepInto(cur, token);
  }
  return cur;
}

function stepInto(node: unknown, token: string): unknown {
  if (Array.isArray(node)) {
    const i = existingArrayIndex(node, token);
    return node[i];
  }
  if (node !== null && typeof node === 'object') {
    if (!Object.hasOwn(node, token)) throw new Error(`Cannot read non-existent key "${token}"`);
    return (node as Record<string, unknown>)[token];
  }
  throw new Error(`Cannot traverse non-container at token "${token}"`);
}

function setAt(
  doc: unknown,
  tokens: readonly string[],
  value: unknown,
  add: boolean,
): unknown {
  if (tokens.length === 0) {
    // Replace root.
    return copyData(value, false);
  }
  const [head, ...rest] = tokens;
  if (Array.isArray(doc)) {
    const i = add && rest.length === 0
      ? head === '-' ? doc.length : parseArrayIndex(head!, doc.length)
      : existingArrayIndex(doc, head!);
    const arr = copyContainer(doc);
    if (rest.length === 0) {
      if (add) {
        // RFC-6902 add: insert at index, shifting elements right
        const length = arr.length;
        for (let index = length; index > i; index--) {
          if (Object.hasOwn(arr, index - 1)) arr[index] = arr[index - 1];
          else delete arr[index];
        }
        arr[i] = copyData(value, false);
        arr.length = length + 1;
      } else {
        // replace: overwrite at index
        arr[i] = copyData(value, false);
      }
    } else {
      arr[i] = setAt(arr[i], rest, value, add);
    }
    return arr;
  }
  if (doc === null || typeof doc !== 'object') {
    throw new Error(`Cannot descend into non-container at "/${tokens.join('/')}"`);
  }
  const obj = doc as Record<string, unknown>;
  if ((!add || rest.length > 0) && !Object.hasOwn(obj, head!)) {
    throw new Error(`Cannot update missing path "/${tokens.join('/')}"`);
  }
  const out = copyContainer(obj);
  defineData(out, head!, rest.length === 0
    ? copyData(value, false)
    : setAt(obj[head!], rest, value, add));
  return out;
}

function removeAt(doc: unknown, tokens: readonly string[]): unknown {
  if (tokens.length === 0) {
    throw new Error('Cannot remove root');
  }
  const [head, ...rest] = tokens;
  if (Array.isArray(doc)) {
    const i = existingArrayIndex(doc, head!);
    const arr = copyContainer(doc);
    if (rest.length === 0) {
      const length = arr.length;
      for (let index = i; index < length - 1; index++) {
        if (Object.hasOwn(arr, index + 1)) arr[index] = arr[index + 1];
        else delete arr[index];
      }
      delete arr[length - 1];
      arr.length = length - 1;
    } else {
      arr[i] = removeAt(arr[i], rest);
    }
    return arr;
  }
  if (doc === null || typeof doc !== 'object') {
    throw new Error(`Cannot remove from non-container at token "${head}"`);
  }
  if (!Object.hasOwn(doc, head!)) throw new Error(`Cannot remove non-existent key "${head}"`);
  const obj = doc as Record<string, unknown>;
  const out = copyContainer(obj);
  if (rest.length === 0) {
    delete out[head!];
    return out;
  }
  defineData(out, head!, removeAt(obj[head!], rest));
  return out;
}

function existingArrayIndex(array: readonly unknown[], token: string): number {
  const i = parseArrayIndex(token, array.length - 1);
  if (!Object.hasOwn(array, i)) throw new Error(`Cannot access non-existent array index ${i}`);
  return i;
}

function parseArrayIndex(token: string, lengthBound: number): number {
  if (token === '-') {
    // "-" is the "after-last" sentinel; only valid for `add` (handled by caller)
    throw new Error(`Array end marker "-" not valid in this position`);
  }
  if (!/^(0|[1-9]\d*)$/.test(token)) {
    throw new Error(`Invalid array index: "${token}"`);
  }
  const i = Number.parseInt(token, 10);
  if (i > lengthBound) {
    throw new Error(`Array index ${i} exceeds bound ${lengthBound}`);
  }
  return i;
}

/** Detach a changed ancestor while retaining unaffected child references. */
function copyContainer<T extends object>(value: T): T {
  const copy = Array.isArray(value)
    ? new Array(value.length)
    : Object.create(Object.getPrototypeOf(value));
  for (const key of Object.keys(value)) {
    defineData(copy, key, (value as Record<string, unknown>)[key]);
  }
  return copy;
}

function defineData(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value, enumerable: true, writable: true, configurable: true,
  });
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const aKeys = Object.keys(ao);
  const bKeys = Object.keys(bo);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bo, k)) return false;
    if (!deepEqual(ao[k], bo[k])) return false;
  }
  return true;
}
