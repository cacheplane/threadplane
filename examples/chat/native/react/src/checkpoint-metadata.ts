import type { ReactApplicationSnapshot } from './application';

export type CheckpointPage = NonNullable<
  ReactApplicationSnapshot['runtime']
>['history'];

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** Bounded display metadata only; raw history never becomes a view model. */
export function projectCheckpointMetadata(page: CheckpointPage) {
  const rows = Array.from(Array.isArray(page) ? page.slice(0, 10) : []).map(
    (raw, index) => {
      const entry = record(raw);
      const checkpoint = record(entry?.checkpoint);
      const parentValue = entry?.parent_checkpoint;
      const parent = record(parentValue);
      let truncated = false;
      const text = (
        value: unknown,
        unavailable: string,
        emptyLabel: string
      ) => {
        if (typeof value !== 'string') return unavailable;
        if (value === '') return emptyLabel;
        if (value.length > 512) truncated = true;
        return value.slice(0, 512);
      };
      const checkpointId = text(
        checkpoint?.checkpoint_id,
        'Checkpoint ID unavailable',
        'Checkpoint ID empty'
      );
      const namespace = text(
        checkpoint?.checkpoint_ns,
        'Namespace unavailable',
        'Root namespace (empty)'
      );
      const createdAt = text(
        entry?.created_at,
        'Created timestamp unavailable',
        'Created timestamp empty'
      );
      const parentId =
        parentValue === null
          ? 'No parent checkpoint'
          : text(
              parent?.checkpoint_id,
              'Parent checkpoint ID unavailable',
              'Parent checkpoint ID empty'
            );
      const next = entry?.next;
      let nextNames = 'Next nodes unavailable';
      if (Array.isArray(next)) {
        const names = Array.from(next.slice(0, 10));
        if (next.length > 10) truncated = true;
        if (names.every((name) => typeof name === 'string')) {
          nextNames =
            next.length === 0
              ? 'No next nodes'
              : names
                  .map((name) => text(name, '', 'Empty next-node name'))
                  .join(', ');
        }
      }
      return Object.freeze({
        id: String(index),
        label: `Checkpoint ${index + 1}`,
        description: checkpointId,
        metadata: Object.freeze({
          checkpointId,
          namespace,
          createdAt,
          parentId,
          nextNames,
          truncated,
        }),
      });
    }
  );
  return Object.freeze({
    loaded: page !== undefined,
    rows: Object.freeze(rows),
    omittedRows: Array.isArray(page) ? Math.max(0, page.length - 10) : 0,
  });
}
