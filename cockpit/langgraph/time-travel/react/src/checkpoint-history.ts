export interface ForkSource {
  readonly thread_id: string;
  readonly checkpoint_ns: '';
  readonly checkpoint_id: string;
  readonly checkpoint_map?: Readonly<Record<string, string>>;
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

function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Owns metadata from one explicit read. Eligibility never replaces fork preflight. */
export function captureHistoryPage(
  value: unknown,
  threadId: string,
  valid: () => boolean = () => true
): readonly CheckpointRow[] | undefined {
  if (!valid() || !Array.isArray(value)) return;
  const cancelled = Symbol('cancelled');
  const read = (object: unknown, key: string): unknown => {
    if (!valid()) throw cancelled;
    const result =
      record(object) && Object.hasOwn(object, key) ? object[key] : undefined;
    if (!valid()) throw cancelled;
    return result;
  };
  try {
    const rows: CheckpointRow[] = [];
    const counts = new Map<string, number>();
    for (const entry of value) {
      if (!valid()) return;
      const checkpoint = read(entry, 'checkpoint');
      const owner = read(checkpoint, 'thread_id');
      const ns = read(checkpoint, 'checkpoint_ns');
      const id = read(checkpoint, 'checkpoint_id');
      const map = read(checkpoint, 'checkpoint_map');
      const parent = read(entry, 'parent_checkpoint');
      const parentId = read(parent, 'checkpoint_id');
      const createdAt = read(entry, 'created_at');
      const rawNext = read(entry, 'next');
      const next =
        Array.isArray(rawNext) &&
        rawNext.every((node) => typeof node === 'string')
          ? (Object.freeze([...rawNext]) as readonly string[])
          : null;
      let ownedMap: Readonly<Record<string, string>> | undefined;
      let mapValid = map === undefined;
      if (record(map)) {
        const entries = Object.keys(map).map(
          (key) => [key, read(map, key)] as const
        );
        mapValid = entries.every(([, item]) => typeof item === 'string');
        if (mapValid)
          ownedMap = Object.freeze(Object.fromEntries(entries)) as Readonly<
            Record<string, string>
          >;
      }
      if (!valid()) return;
      const root =
        owner === threadId &&
        ns === '' &&
        typeof id === 'string' &&
        id.trim().length > 0;
      if (root) counts.set(id, (counts.get(id) ?? 0) + 1);
      const source: ForkSource | null =
        root && mapValid && next?.length === 0
          ? Object.freeze({
              thread_id: threadId,
              checkpoint_ns: '',
              checkpoint_id: id,
              ...(ownedMap ? { checkpoint_map: ownedMap } : {}),
            })
          : null;
      rows.push(
        Object.freeze({
          id: typeof id === 'string' ? id : null,
          namespace: typeof ns === 'string' ? ns : null,
          createdAt: typeof createdAt === 'string' ? createdAt : null,
          parentId: typeof parentId === 'string' ? parentId : null,
          next,
          source,
          unavailable: source
            ? null
            : 'This checkpoint is unavailable as a fork source.',
        })
      );
    }
    if (!valid()) return;
    return Object.freeze(
      rows.map((row) =>
        row.source && counts.get(row.source.checkpoint_id) !== 1
          ? Object.freeze({
              ...row,
              source: null,
              unavailable: 'Duplicate checkpoint identity.',
            })
          : row
      )
    );
  } catch (error) {
    if (error === cancelled) return;
    throw error;
  }
}
