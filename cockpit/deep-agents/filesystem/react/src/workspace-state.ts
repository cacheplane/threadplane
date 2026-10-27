export const MAX_TEXT = 65536;
export const MAX_TOTAL_TEXT = 1048576;
export type PlainValue =
  | null
  | string
  | boolean
  | number
  | readonly PlainValue[]
  | { readonly [key: string]: PlainValue };
export function plainRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
export function ownValue(object: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor) return undefined;
  if (!('value' in descriptor) || (key !== 'length' && !descriptor.enumerable))
    throw new Error('Non-data property');
  return descriptor.value;
}
/** Inspect descriptors before reading. Never evaluate getters or drop keys. */
export function inspectJson(
  input: unknown,
  optionalUndefined = false,
  filesystemValues: readonly (readonly string[])[] = []
): void {
  const parents = new Set<object>();
  let nodes = 0,
    fileLines = 0;
  // Only explicitly authorized values.files[path].content arrays receive this
  // separate descriptor traversal budget. Generic JSON evidence stays at 100k
  // nodes. A supported file has at most MAX_TEXT + 1 legacy lines; one extra
  // line is inspectable as a visibly unavailable oversized record.
  const maxRawLines = MAX_TEXT + 2;
  const maxFileLines = filesystemValues.length * 100 * maxRawLines;
  function visit(value: unknown, depth: number, path: readonly string[]): void {
    if (++nodes > 100000 || depth > 100)
      throw new Error('JSON bounds exceeded');
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    )
      return;
    const array = Array.isArray(value);
    if (!array && !plainRecord(value)) throw new Error('Unsupported JSON');
    const object = value as object;
    if (
      parents.has(object) ||
      (array && Object.getPrototypeOf(value) !== Array.prototype)
    )
      throw new Error('Unsupported JSON');
    parents.add(object);
    const keys = Reflect.ownKeys(object).filter(
      (k) => !(array && k === 'length')
    );
    const length = array ? (ownValue(object, 'length') as number) : 0;
    if (array && keys.length !== length) throw new Error('Sparse array');
    const fileContent =
      array &&
      filesystemValues.some(
        (root) =>
          path.length === root.length + 3 &&
          root.every((part, i) => path[i] === part) &&
          path[root.length] === 'files' &&
          canonicalPath(path[root.length + 1]) &&
          path[root.length + 2] === 'content'
      );
    if (fileContent && length > maxRawLines)
      throw new Error('Raw legacy file line bounds exceeded');
    for (const key of keys) {
      const d = Object.getOwnPropertyDescriptor(object, key);
      if (
        typeof key !== 'string' ||
        !d ||
        !('value' in d) ||
        !d.enumerable ||
        (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length))
      )
        throw new Error('Non-JSON property');
      if (!array && optionalUndefined && d.value === undefined) continue;
      if (fileContent && typeof d.value === 'string') {
        if (++fileLines > maxFileLines)
          throw new Error('Raw legacy workspace line bounds exceeded');
      } else visit(d.value, depth + 1, [...path, key]);
    }
    parents.delete(object);
  }
  visit(input, 0, []);
}
export function copyJson(
  input: unknown,
  optionalUndefined = false,
  maxText = 8388608
): unknown {
  const parents = new Set<object>();
  let nodes = 0,
    text = 0;
  function copy(value: unknown, depth: number): unknown {
    if (++nodes > 100000 || depth > 100)
      throw new Error('JSON bounds exceeded');
    if (typeof value === 'string') {
      text += value.length;
      if (text > maxText) throw new Error('Evidence text bounds exceeded');
      return value;
    }
    if (
      value === null ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    )
      return value;
    const array = Array.isArray(value);
    if (
      (!array && !plainRecord(value)) ||
      (array && Object.getPrototypeOf(value) !== Array.prototype) ||
      parents.has(value as object)
    )
      throw new Error('Unsupported JSON');
    const object = value as object;
    parents.add(object);
    const descriptors = Object.getOwnPropertyDescriptors(object);
    const keys = Reflect.ownKeys(descriptors).filter(
      (k) => !(array && k === 'length')
    );
    const length = array ? descriptors.length?.value : 0;
    if (
      array &&
      (!Number.isInteger(length) || length < 0 || keys.length !== length)
    )
      throw new Error('Sparse array');
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      if (typeof key !== 'string') throw new Error('Symbol key');
      const d = descriptors[key];
      if (
        !d ||
        !('value' in d) ||
        !d.enumerable ||
        (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length))
      )
        throw new Error('Non-JSON property');
      if (!array && optionalUndefined && d.value === undefined) continue;
      text += key.length;
      if (text > maxText) throw new Error('Evidence text bounds exceeded');
      Object.defineProperty(result, key, {
        value: copy(d.value, depth + 1),
        enumerable: true,
      });
    }
    parents.delete(object);
    return Object.freeze(
      array ? Array.from({ length }, (_, i) => result[String(i)]) : result
    );
  }
  return copy(input, 0);
}
export function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    const length = ownValue(left, 'length') as number;
    if (length !== ownValue(right, 'length')) return false;
    for (let i = 0; i < length; i++)
      if (!sameJson(ownValue(left, String(i)), ownValue(right, String(i))))
        return false;
    return true;
  }
  if (!plainRecord(left) || !plainRecord(right)) return false;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (k) =>
        Object.hasOwn(right, k) &&
        sameJson(ownValue(left, k), ownValue(right, k))
    )
  );
}
export function canonicalPath(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    path.length <= 1024 &&
    path.startsWith('/') &&
    !/[\u0000-\u001f\u007f-\u009f\\]/.test(path) &&
    path
      .slice(1)
      .split('/')
      .every((s) => s !== '' && s !== '.' && s !== '..')
  );
}
export type WorkspaceFile =
  | {
      readonly path: string;
      readonly kind: 'text';
      readonly content: string;
      readonly created_at?: string;
      readonly modified_at?: string;
    }
  | {
      readonly path: string;
      readonly kind: 'unavailable';
      readonly reason: string;
    };
export type WorkspaceState =
  | { readonly kind: 'missing'; readonly files: readonly WorkspaceFile[] }
  | { readonly kind: 'invalid'; readonly reason: string }
  | {
      readonly kind: 'valid';
      readonly files: readonly WorkspaceFile[];
      readonly complete: boolean;
    };
export function workspaceState(input: unknown): WorkspaceState {
  const missing = (): WorkspaceState =>
    Object.freeze({ kind: 'missing', files: Object.freeze([]) });
  if (input === undefined) return missing();
  try {
    // Inspect without copying legacy lines, then enforce budgets before joining.
    inspectJson(input, false, [[]]);
    if (!plainRecord(input)) throw new Error();
    if (!Object.hasOwn(input, 'files')) return missing();
    const map = ownValue(input, 'files');
    if (
      !plainRecord(map) ||
      Object.keys(map).length > 100 ||
      !Object.keys(map).every(canonicalPath)
    )
      throw new Error();
    let total = 0;
    const files = Object.keys(map)
      .sort()
      .map((path): WorkspaceFile => {
        const record = ownValue(map, path);
        const unavailable = (reason: string): WorkspaceFile =>
          Object.freeze({ path, kind: 'unavailable', reason });
        if (
          !plainRecord(record) ||
          Object.keys(record).some(
            (k) =>
              !['content', 'encoding', 'created_at', 'modified_at'].includes(k)
          ) ||
          !Object.hasOwn(record, 'content')
        )
          return unavailable('Unsupported file record');
        const encoding = ownValue(record, 'encoding');
        if (encoding !== undefined && encoding !== 'utf-8')
          return unavailable('Unsupported encoding');
        for (const key of ['created_at', 'modified_at'])
          if (
            ownValue(record, key) !== undefined &&
            (typeof ownValue(record, key) !== 'string' ||
              (ownValue(record, key) as string).length > 1024)
          )
            return unavailable('Unsupported timestamp');
        const raw = ownValue(record, 'content');
        let length: number;
        if (typeof raw === 'string') length = raw.length;
        else if (Array.isArray(raw)) {
          const count = ownValue(raw, 'length') as number;
          if (count > MAX_TEXT + 1)
            return unavailable('File content exceeds display limit');
          length = Math.max(0, count - 1);
          for (let i = 0; i < count; i++) {
            const line = ownValue(raw, String(i));
            if (typeof line !== 'string')
              return unavailable('Unsupported file content');
            length += line.length;
            if (length > MAX_TEXT) break;
          }
        } else return unavailable('Unsupported file content');
        if (length > MAX_TEXT)
          return unavailable('File content exceeds display limit');
        if (total + length > MAX_TOTAL_TEXT)
          return unavailable('Workspace content exceeds display budget');
        total += length;
        return Object.freeze({
          path,
          kind: 'text',
          content:
            typeof raw === 'string'
              ? raw
              : (copyJson(raw) as string[]).join('\n'),
          ...(ownValue(record, 'created_at') !== undefined
            ? { created_at: ownValue(record, 'created_at') as string }
            : {}),
          ...(ownValue(record, 'modified_at') !== undefined
            ? { modified_at: ownValue(record, 'modified_at') as string }
            : {}),
        });
      });
    return Object.freeze({
      kind: 'valid',
      files: Object.freeze(files),
      complete: files.every((f) => f.kind === 'text'),
    });
  } catch {
    return Object.freeze({
      kind: 'invalid',
      reason: 'Malformed or unbounded files data',
    });
  }
}
export function selectWorkspacePath(
  state: WorkspaceState,
  selected?: string
): string | undefined {
  return state.kind === 'valid'
    ? state.files.find((f) => f.path === selected)?.path ?? state.files[0]?.path
    : undefined;
}
