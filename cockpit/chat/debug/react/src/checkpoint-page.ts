import {
  captureData,
  boundedText,
  ownField,
  plainRecord,
} from './inspection-values';
export interface Checkpoint {
  readonly thread_id: string;
  readonly checkpoint_ns: '';
  readonly checkpoint_id: string;
  readonly checkpoint_map?: Readonly<Record<string, string>>;
}
export function captureCheckpoint(
  input: unknown,
  threadId: string
): Checkpoint | undefined {
  try {
    if (!plainRecord(input)) return undefined;
    const cp = captureData(input) as Record<string, unknown>;
    if (
      cp.thread_id !== threadId ||
      cp.checkpoint_ns !== '' ||
      typeof cp.checkpoint_id !== 'string' ||
      !cp.checkpoint_id ||
      Object.keys(cp).some(
        (k) =>
          ![
            'thread_id',
            'checkpoint_ns',
            'checkpoint_id',
            'checkpoint_map',
          ].includes(k)
      )
    )
      return undefined;
    if (
      Object.hasOwn(cp, 'checkpoint_map') &&
      (!plainRecord(cp.checkpoint_map) ||
        Object.values(cp.checkpoint_map).some((v) => typeof v !== 'string'))
    )
      return undefined;
    return cp as unknown as Checkpoint;
  } catch {
    return undefined;
  }
}
export interface CheckpointRow {
  readonly key: string;
  readonly ordinal: number;
  readonly inspectable: boolean;
  readonly checkpoint?: Checkpoint;
  readonly createdAt?: string;
  readonly next?: readonly string[];
  readonly parentCheckpoint?: Checkpoint;
}
export interface CheckpointPage {
  readonly kind: 'available' | 'unavailable';
  readonly context: string;
  readonly threadId: string;
  readonly generation: number;
  readonly rows: readonly CheckpointRow[];
}
export interface CheckpointSelection {
  readonly context: string;
  readonly threadId: string;
  readonly generation: number;
  readonly key: string;
}
/** Metadata capture intentionally never reads values, messages, or tasks. */
export function captureCheckpointPage(
  input: unknown,
  context: string,
  threadId: string,
  generation: number
): CheckpointPage {
  const unavailable = (): CheckpointPage =>
    Object.freeze({
      kind: 'unavailable',
      context,
      threadId,
      generation,
      rows: Object.freeze([]),
    });
  try {
    if (!Array.isArray(input) || input.length > 10) return unavailable();
    const rows: CheckpointRow[] = [],
      ids = new Map<string, number>();
    for (let i = 0; i < input.length; i++) {
      const row = ownField(input, String(i));
      const cp = plainRecord(row)
        ? captureCheckpoint(ownField(row, 'checkpoint'), threadId)
        : undefined;
      const createdAt = plainRecord(row)
        ? ownField(row, 'created_at')
        : undefined;
      const rawNext = plainRecord(row) ? ownField(row, 'next') : undefined,
        next = rawNext === undefined ? undefined : captureData(rawNext);
      if (
        next !== undefined &&
        (!Array.isArray(next) || next.some((v) => typeof v !== 'string'))
      )
        return unavailable();
      const parent = plainRecord(row)
        ? captureCheckpoint(ownField(row, 'parent_checkpoint'), threadId)
        : undefined;
      rows.push({
        key: `${context}:${generation}:${i}`,
        ordinal: i,
        inspectable: !!cp,
        ...(cp ? { checkpoint: cp } : {}),
        ...(boundedText(createdAt) ? { createdAt } : {}),
        ...(next !== undefined ? { next: next as readonly string[] } : {}),
        ...(parent ? { parentCheckpoint: parent } : {}),
      });
      if (cp) ids.set(cp.checkpoint_id, (ids.get(cp.checkpoint_id) ?? 0) + 1);
    }
    return Object.freeze({
      kind: 'available',
      context,
      threadId,
      generation,
      rows: Object.freeze(
        rows.map((r) =>
          Object.freeze({
            ...r,
            inspectable:
              r.inspectable &&
              !!r.checkpoint &&
              ids.get(r.checkpoint.checkpoint_id) === 1,
          })
        )
      ),
    });
  } catch {
    return unavailable();
  }
}
export function selectCheckpoint(
  page: CheckpointPage,
  selection: CheckpointSelection
): Checkpoint | undefined {
  if (
    page.kind !== 'available' ||
    selection.context !== page.context ||
    selection.threadId !== page.threadId ||
    selection.generation !== page.generation
  )
    return undefined;
  const row = page.rows.find((r) => r.key === selection.key);
  return row?.inspectable ? row.checkpoint : undefined;
}
export function sameCheckpoint(
  left: Checkpoint | undefined,
  right: Checkpoint | undefined
): boolean {
  return (
    !!left &&
    !!right &&
    left.thread_id === right.thread_id &&
    left.checkpoint_ns === right.checkpoint_ns &&
    left.checkpoint_id === right.checkpoint_id &&
    sameMap(left.checkpoint_map, right.checkpoint_map)
  );
}

function sameMap(
  a: Checkpoint['checkpoint_map'],
  b: Checkpoint['checkpoint_map']
): boolean {
  if (a === undefined || b === undefined) return a === b;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((k) => Object.hasOwn(b, k) && a[k] === b[k])
  );
}
