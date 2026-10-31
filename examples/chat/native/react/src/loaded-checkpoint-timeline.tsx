import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Timeline } from '@threadplane/react/chat';
import type { ReactApplication } from './application';
import {
  projectCheckpointMetadata,
  type CheckpointPage,
} from './checkpoint-metadata';

export function LoadedCheckpointTimeline({
  application,
  threadId,
  page,
}: {
  readonly application: ReactApplication;
  readonly threadId: string;
  readonly page: CheckpointPage;
}) {
  const projection = useMemo(() => projectCheckpointMetadata(page), [page]);
  const scope = useMemo(() => ({}), [application, threadId, page]);
  const committed = useRef<object | null>(null);
  const [selection, setSelection] = useState<{
    scope: object;
    rowId: string;
  } | null>(null);
  const headingId = useId();
  useLayoutEffect(() => {
    committed.current = scope;
    // Same-scope StrictMode replay keeps accepted local selection intact.
    setSelection((previous) => (previous?.scope === scope ? previous : null));
    return () => {
      if (committed.current === scope) committed.current = null;
    };
  }, [scope]);
  const selected =
    selection?.scope === scope
      ? projection.rows.find((row) => row.id === selection.rowId)
      : undefined;
  const pick = (rowId: string) => {
    if (committed.current !== scope) return;
    const live = application.getSnapshot();
    if (
      live.selection.status !== 'ready' ||
      live.selection.id !== threadId ||
      live.runtime?.history !== page ||
      !projection.rows.some((row) => row.id === rowId)
    )
      return;
    setSelection({ scope, rowId });
  };
  return (
    <details className="loaded-checkpoint-timeline">
      <summary>Loaded checkpoint timeline</summary>
      <p className="muted">
        Metadata from the last explicitly loaded page, in supplied order (up to
        ten checkpoints). This is not live execution history. Inspecting
        metadata does not change the conversation.
      </p>
      {!projection.loaded ? (
        <p>Checkpoint history has not been loaded.</p>
      ) : projection.rows.length === 0 ? (
        <p>No checkpoints in the loaded page.</p>
      ) : (
        <Timeline
          items={projection.rows}
          selectedId={selected?.id}
          onSelect={pick}
          label="Loaded checkpoints"
        />
      )}
      {projection.omittedRows > 0 && (
        <p>
          {projection.omittedRows} additional checkpoints omitted; showing the
          first 10.
        </p>
      )}
      {selected && (
        <section aria-labelledby={headingId}>
          <h2 id={headingId}>Selected checkpoint metadata</h2>
          <dl>
            <dt>Checkpoint ID</dt>
            <dd>{selected.metadata.checkpointId}</dd>
            <dt>Namespace</dt>
            <dd>{selected.metadata.namespace}</dd>
            <dt>Created timestamp</dt>
            <dd>{selected.metadata.createdAt}</dd>
            <dt>Parent checkpoint ID</dt>
            <dd>{selected.metadata.parentId}</dd>
            <dt>Next node names</dt>
            <dd>{selected.metadata.nextNames}</dd>
          </dl>
          {selected.metadata.truncated && (
            <p>
              Metadata truncated for display; showing up to 10 next-node names.
            </p>
          )}
        </section>
      )}
    </details>
  );
}
