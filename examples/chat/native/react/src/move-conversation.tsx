import { useEffect, useId, useRef, useState } from 'react';
import { ProjectList } from '@threadplane/react/chat';
import type { ThreadRow } from '../../shared/contracts';
import {
  PROJECT_CATALOG_KEY,
  mergeProjects,
  readProjectCatalog,
  type NativeProject,
} from './project-catalog';

export interface MoveRequest {
  readonly id: string;
  readonly title: string;
  readonly projectId: string | null;
  readonly token: number;
  readonly returnFocusTo: HTMLElement | null;
}

function available(
  target: HTMLElement | null,
  doc: Document
): target is HTMLElement {
  if (
    !target ||
    target.ownerDocument !== doc ||
    !target.isConnected ||
    target.matches(':disabled') ||
    !target.getClientRects().length
  )
    return false;
  const win = doc.defaultView;
  for (let node: HTMLElement | null = target; node; node = node.parentElement) {
    const style = win?.getComputedStyle(node);
    if (
      node.hidden ||
      node.hasAttribute('inert') ||
      style?.display === 'none' ||
      ['hidden', 'collapse'].includes(style?.visibility ?? '')
    )
      return false;
  }
  return true;
}

/** Key by request token; only explicit Save dispatches a captured association. */
export function MoveConversation({
  request,
  rows,
  currentProjectId = request.projectId,
  pending,
  blocked,
  onMove,
  onClose,
  fallbackFocusTo,
}: {
  readonly request: MoveRequest;
  readonly rows: readonly ThreadRow[];
  readonly currentProjectId?: string | null;
  readonly pending: boolean;
  readonly blocked: boolean;
  readonly onMove: (projectId: string | null, name: string) => Promise<boolean>;
  readonly onClose: (request: MoveRequest) => void;
  readonly fallbackFocusTo: HTMLElement | null | (() => HTMLElement | null);
}) {
  const id = useId();
  const root = useRef<HTMLFormElement>(null);
  const mounted = useRef(false);
  const closed = useRef(false);
  const inFlight = useRef(false);
  const ownsFocus = useRef(false);
  const focused = useRef(false);
  const [selected, setSelected] = useState(request.projectId);
  const [catalog, setCatalog] = useState<readonly NativeProject[]>([]);
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const reload = () => {
    try {
      const next = readProjectCatalog(window.localStorage);
      setCatalog(next);
      setProblem(false);
      setReady(true);
      return next;
    } catch {
      setCatalog([]);
      setProblem(true);
      setReady(true);
      return undefined;
    }
  };
  useEffect(() => {
    mounted.current = true;
    reload();
    const storage = (event: StorageEvent) => {
      try {
        if (
          event.storageArea === window.localStorage &&
          (event.key === null || event.key === PROJECT_CATALOG_KEY)
        )
          reload();
      } catch {
        setProblem(true);
      }
    };
    const doc = root.current?.ownerDocument;
    const focus = (event: Event) => {
      if (event.target !== doc?.body)
        ownsFocus.current = !!root.current?.contains(event.target as Node);
    };
    const pointer = (event: Event) => {
      if (!root.current?.contains(event.target as Node))
        ownsFocus.current = false;
    };
    window.addEventListener('storage', storage);
    doc?.addEventListener('focusin', focus);
    doc?.addEventListener('pointerdown', pointer, true);
    return () => {
      mounted.current = false;
      window.removeEventListener('storage', storage);
      doc?.removeEventListener('focusin', focus);
      doc?.removeEventListener('pointerdown', pointer, true);
    };
  }, []);
  useEffect(() => {
    if (!ready || focused.current) return;
    const container = root.current;
    const active =
      container?.querySelector<HTMLButtonElement>(
        '[aria-current="true"]:not(:disabled)'
      ) ?? container?.querySelector<HTMLButtonElement>('button:not(:disabled)');
    if (active) {
      active.focus({ preventScroll: true });
      focused.current = true;
    }
  }, [ready, problem, pending, blocked]);
  const projects = mergeProjects(catalog, rows);
  const missing =
    selected !== null && !projects.some((project) => project.id === selected);
  const disabled = !ready || problem || pending || busy || blocked;
  const choose = (value: string | null) => {
    if (disabled || closed.current) return;
    setSelected(value);
    setError(undefined);
  };
  const close = () => {
    if (closed.current) return;
    const container = root.current;
    const doc = container?.ownerDocument;
    const active = doc?.activeElement;
    const owned =
      !!container &&
      !!doc &&
      (container.contains(active ?? null) ||
        (active === doc.body && ownsFocus.current));
    closed.current = true;
    onClose(request);
    if (owned && doc)
      queueMicrotask(() => {
        if (
          doc.activeElement !== doc.body &&
          !container?.contains(doc.activeElement)
        )
          return;
        const fallback =
          typeof fallbackFocusTo === 'function'
            ? fallbackFocusTo()
            : fallbackFocusTo;
        const target = available(request.returnFocusTo, doc)
          ? request.returnFocusTo
          : available(fallback, doc)
          ? fallback
          : null;
        target?.focus({ preventScroll: true });
      });
  };
  const save = async () => {
    if (
      disabled ||
      closed.current ||
      inFlight.current ||
      selected === currentProjectId ||
      missing
    )
      return;
    const latest = reload();
    if (!latest) return;
    const destination =
      selected === null
        ? { name: 'No project' }
        : mergeProjects(latest, rows).find(
            (project) => project.id === selected
          );
    if (!destination) return;
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    let confirmed = false;
    try {
      confirmed = await onMove(selected, destination.name);
    } catch {
      /* Unconfirmed writes retain intent for explicit retry. */
    }
    if (!mounted.current || closed.current) return;
    inFlight.current = false;
    setBusy(false);
    if (confirmed) close();
    else setError('Could not confirm the move. Refresh or try again.');
  };
  return (
    <form
      ref={root}
      className="move-conversation"
      role="region"
      aria-labelledby={id}
      onSubmit={(event) => {
        const claimed = event.defaultPrevented;
        event.preventDefault();
        if (!claimed) void save();
      }}
      onKeyDown={(event) => {
        if (event.defaultPrevented) return;
        const ignored =
          event.repeat ||
          event.nativeEvent.isComposing ||
          event.keyCode === 229;
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          if (!ignored) close();
        } else if (event.key === 'Enter' && ignored) event.preventDefault();
      }}
    >
      <h3 id={id}>
        Move conversation: {request.title} ({request.id})
      </h3>
      <p className="muted">
        Project names are saved in this browser. Conversation assignments are
        saved by the server.
      </p>
      {problem && (
        <>
          <p role="alert">
            Could not load projects. Saved catalog data has been preserved.
          </p>
          <button
            type="button"
            onClick={() => {
              reload();
              setError(undefined);
            }}
          >
            Retry
          </button>
        </>
      )}
      <fieldset disabled={disabled}>
        <legend>Destination project</legend>
        <button
          type="button"
          className="move-conversation__none"
          aria-current={selected === null ? 'true' : undefined}
          onClick={() => choose(null)}
        >
          No project
        </button>
        <ProjectList
          projects={projects}
          activeProjectId={selected}
          onSelect={choose}
          label="Destination projects"
        />
      </fieldset>
      {missing && (
        <p role="status">
          Selected project is no longer available. Choose another project.
        </p>
      )}
      {error && !problem && <p role="alert">{error}</p>}
      {(pending || busy) && <p role="status">Moving conversation…</p>}
      <div className="move-conversation__commands">
        <button
          type="submit"
          disabled={disabled || missing || selected === currentProjectId}
        >
          Save
        </button>
        <button type="button" onClick={close}>
          Cancel
        </button>
      </div>
    </form>
  );
}
