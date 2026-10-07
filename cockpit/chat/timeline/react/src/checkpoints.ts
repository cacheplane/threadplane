/** Descriptor capture never evaluates accessors; every returned container is owned. */
export function copyData(value: unknown, parents = new Set<object>()): unknown {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  )
    return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (
    typeof value !== 'object' ||
    parents.has(value) ||
    Object.getOwnPropertySymbols(value).length
  )
    throw new Error('Unsupported data');
  const array = Array.isArray(value),
    prototype = Object.getPrototypeOf(value);
  if (
    array
      ? prototype !== Array.prototype
      : prototype !== Object.prototype && prototype !== null
  )
    throw new Error('Unsupported data');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors);
  if (
    array &&
    (keys.length !== descriptors['length'].value + 1 ||
      keys.some(
        (key) =>
          key !== 'length' &&
          (!/^(0|[1-9]\d*)$/.test(key) ||
            Number(key) >= descriptors['length'].value)
      ))
  )
    throw new Error('Malformed array');
  parents.add(value);
  const result = array ? [] : Object.create(null);
  for (const key of keys.sort()) {
    if (array && key === 'length') continue;
    const descriptor = descriptors[key];
    if (!('value' in descriptor)) throw new Error('Accessor data');
    Object.defineProperty(result, key, {
      value: copyData(descriptor.value, parents),
      enumerable: true,
    });
  }
  parents.delete(value);
  return Object.freeze(result);
}
export const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
export const text = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
export interface ForkSource {
  readonly thread_id: string;
  readonly checkpoint_ns: '';
  readonly checkpoint_id: string;
  readonly checkpoint_map?: Readonly<Record<string, string>>;
}
/** Called on captured data only. A missing map differs from an explicit map. */
export function checkpointSource(
  value: unknown,
  threadId: string
): ForkSource | null {
  if (
    !text(threadId) ||
    !record(value) ||
    value['thread_id'] !== threadId ||
    value['checkpoint_ns'] !== '' ||
    !text(value['checkpoint_id'])
  )
    return null;
  const map = value['checkpoint_map'];
  if (
    map !== undefined &&
    (!record(map) || Object.values(map).some((item) => !text(item)))
  )
    return null;
  return Object.freeze({
    thread_id: threadId,
    checkpoint_ns: '',
    checkpoint_id: value['checkpoint_id'],
    ...(map === undefined
      ? {}
      : { checkpoint_map: map as Readonly<Record<string, string>> }),
  });
}
export interface CheckpointRow {
  readonly id: string | null;
  readonly namespace: string | null;
  readonly createdAt: string | null;
  readonly parentId: string | null;
  readonly next: readonly string[] | null;
  readonly source: ForkSource | null;
  readonly unavailable: string | null;
}
/** Retains metadata only, in server order. Malformed pages grant no authority. */
export function captureHistoryPage(
  input: unknown,
  threadId: string
): readonly CheckpointRow[] | undefined {
  try {
    const page = copyData(input);
    if (!Array.isArray(page)) return;
    const counts = new Map<string, number>();
    const rows = page.map((entry) => {
      const item = record(entry) ? entry : {};
      const checkpoint = record(item['checkpoint']) ? item['checkpoint'] : {};
      const id =
        typeof checkpoint['checkpoint_id'] === 'string'
          ? checkpoint['checkpoint_id']
          : null;
      if (id !== null) counts.set(id, (counts.get(id) ?? 0) + 1);
      const next =
        Array.isArray(item['next']) &&
        item['next'].every((node) => typeof node === 'string')
          ? (item['next'] as readonly string[])
          : null;
      const source =
        next?.length === 0 ? checkpointSource(checkpoint, threadId) : null;
      const parent = item['parent_checkpoint'];
      return {
        id,
        namespace:
          typeof checkpoint['checkpoint_ns'] === 'string'
            ? checkpoint['checkpoint_ns']
            : null,
        createdAt:
          typeof item['created_at'] === 'string' ? item['created_at'] : null,
        parentId:
          record(parent) && typeof parent['checkpoint_id'] === 'string'
            ? parent['checkpoint_id']
            : null,
        next,
        source,
        unavailable: source ? null : 'Checkpoint is unavailable.',
      };
    });
    return Object.freeze(
      rows.map((row) =>
        Object.freeze(
          row.source && counts.get(row.id!) !== 1
            ? {
                ...row,
                source: null,
                unavailable: 'Duplicate checkpoint identity.',
              }
            : row
        )
      )
    );
  } catch {
    return;
  }
}
