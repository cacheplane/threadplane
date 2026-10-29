import { useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '@threadplane/react/chat';
import type { NativeProject } from './project-catalog';

export interface ProjectDeletionOwner {
  canDeleteProject(id: string): boolean;
  deleteProject(id: string): Promise<boolean>;
}
type Request = Readonly<
  NativeProject & {
    owner: ProjectDeletionOwner;
    invoker: HTMLButtonElement;
  }
>;
type Status = 'confirm' | 'pending' | 'failed' | 'storage' | 'done';

/** Owns confirmation and local persistence after backend association removal. */
export function useProjectDeletion({
  owner,
  selectedId,
  onSelect,
  onRemoved,
  fallbackFocusTo,
}: {
  owner?: ProjectDeletionOwner;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onRemoved: (id: string) => void;
  fallbackFocusTo: () => HTMLElement | null;
}) {
  const [request, setRequest] = useState<Request | null>(null);
  const [status, setStatus] = useState<Status>('confirm');
  const current = useRef<Request | null>(null);
  const pending = useRef(false);
  const live = useRef(false);
  const restoreFocus = useRef(false);
  const latest = useRef({ selectedId, onSelect, onRemoved, owner });
  latest.current = { selectedId, onSelect, onRemoved, owner };
  useEffect(() => {
    live.current = true;
    current.current = null;
    pending.current = false;
    setRequest(null);
    return () => {
      live.current = false;
      current.current = null;
    };
  }, [owner]);
  useEffect(() => {
    if (
      status !== 'pending' ||
      !restoreFocus.current ||
      !request ||
      request.owner !== owner
    )
      return;
    restoreFocus.current = false;
    const doc = request.invoker.ownerDocument;
    queueMicrotask(() => {
      if (
        live.current &&
        current.current === request &&
        latest.current.owner === owner &&
        doc.activeElement === doc.body
      )
        fallbackFocusTo()?.focus({ preventScroll: true });
    });
  }, [status, request, owner, fallbackFocusTo]);
  const owned = (target: Request) =>
    live.current &&
    current.current === target &&
    latest.current.owner === target.owner;
  const execute = async (target: Request) => {
    if (!owned(target) || pending.current) return;
    const doc = target.invoker.ownerDocument;
    restoreFocus.current =
      !!doc.activeElement?.closest('[role="alertdialog"]') ||
      doc.activeElement?.textContent === 'Retry project deletion';
    pending.current = true;
    setStatus('pending');
    let confirmed = false;
    try {
      confirmed = await target.owner.deleteProject(target.id);
    } catch {
      /* explicit retry */
    }
    if (!owned(target)) return;
    pending.current = false;
    if (!confirmed) {
      setStatus('failed');
      return;
    }
    try {
      latest.current.onRemoved(target.id);
    } catch {
      setStatus('storage');
      return;
    }
    if (!owned(target)) return;
    setStatus('done');
    if (latest.current.selectedId === target.id) latest.current.onSelect(null);
  };
  const visible = request?.owner === owner ? request : null;
  return {
    busy: !!visible && status === 'pending',
    request(project: NativeProject, invoker: HTMLButtonElement) {
      if (
        !owner?.canDeleteProject(project.id) ||
        pending.current ||
        (visible && status !== 'done' && status !== 'confirm')
      )
        return;
      const target = Object.freeze({
        id: project.id,
        name: project.name,
        invoker,
        owner,
      });
      current.current = target;
      setRequest(target);
      setStatus('confirm');
    },
    content: visible ? (
      <>
        <ConfirmDialog
          open={status === 'confirm'}
          title="Delete project?"
          body={`Delete ${visible.name} (${visible.id})? Conversations will remain and become unassigned. This also includes archived conversations and those outside the loaded list.`}
          confirmLabel="Delete project"
          tone="destructive"
          returnFocusTo={visible.invoker}
          onConfirm={() => void execute(visible)}
          onCancel={() => {
            if (!owned(visible) || pending.current) return;
            current.current = null;
            setRequest(null);
          }}
        />
        {status === 'pending' && (
          <p role="status">
            Deleting project: {visible.name} ({visible.id}). Conversations are
            being preserved…
          </p>
        )}
        {(status === 'failed' || status === 'storage') && (
          <div>
            <p role="alert">
              {status === 'storage'
                ? `Conversations were preserved, but the project label could not be removed: ${visible.name} (${visible.id}). Retry checks backend membership again.`
                : `Project deletion is unconfirmed: ${visible.name} (${visible.id}). Some conversations may already be unassigned. Retry checks remaining membership.`}
            </p>
            <button type="button" onClick={() => void execute(visible)}>
              Retry project deletion
            </button>
          </div>
        )}
        {status === 'done' && (
          <p role="status">
            Project deleted: {visible.name} ({visible.id}). Conversations were
            preserved.
          </p>
        )}
      </>
    ) : null,
  };
}
