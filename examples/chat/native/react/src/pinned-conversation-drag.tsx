import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { ReactApplication, ReactApplicationSnapshot } from './application';
import type { ThreadRow } from '../../shared/contracts';
import { orderActiveThreads } from '../../shared/projection';

interface PinnedConversationDragOptions {
  readonly application: ReactApplication;
  readonly list: ReactApplicationSnapshot['list'];
  readonly visibleRows: readonly ThreadRow[];
  readonly contextKey: string;
  readonly blocked: boolean;
  readonly onReorder: (row: ThreadRow, beforeId: string | null) => void;
}

const markerType = 'application/x-threadplane-native-pinned-drag';
const activePin = (row: ThreadRow) =>
  row.pinned === true && row.archived !== true;
const uncertain = (status: string) =>
  status === 'pending' || status === 'unconfirmed';

function visible(element: HTMLElement) {
  if (!element.isConnected || !element.getClientRects().length) return false;
  for (
    let ancestor: HTMLElement | null = element;
    ancestor;
    ancestor = ancestor.parentElement
  ) {
    if (
      ancestor.hidden ||
      ancestor.hasAttribute('inert') ||
      ancestor.getAttribute('aria-hidden') === 'true'
    )
      return false;
    const style =
      ancestor.ownerDocument.defaultView?.getComputedStyle(ancestor);
    if (
      style?.visibility === 'hidden' ||
      style?.visibility === 'collapse' ||
      style?.display === 'none'
    )
      return false;
  }
  return true;
}

export function usePinnedConversationDrag(
  options: PinnedConversationDragOptions
): { handleFor: (row: ThreadRow) => ReactNode } {
  const { application, list, contextKey, blocked, visibleRows } = options;
  // Every committed transition gets a distinct identity, including A -> B -> A.
  const scope = useMemo(
    () => ({ application, rows: list.rows, status: list.status, blocked }),
    [application, list.rows, list.status, contextKey, blocked]
  );
  const committed = useRef<typeof scope | null>(null);
  const handles = useRef(new Map<string, HTMLButtonElement>());
  const capture = useRef<{
    scope: typeof scope;
    id: string;
    element: HTMLButtonElement;
    token: string;
  } | null>(null);
  const [feedback, setFeedback] = useState<{
    source: string;
    target?: string;
    position?: 'before' | 'after';
  } | null>(null);
  const cancel = () => {
    capture.current = null;
    setFeedback(null);
  };

  useLayoutEffect(() => {
    committed.current = scope;
    return () => {
      committed.current = null;
      capture.current = null;
    };
  }, [scope]);

  useLayoutEffect(() => {
    setFeedback(null);
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel();
    };
    window.addEventListener('blur', cancel);
    window.addEventListener('dragend', cancel);
    document.addEventListener('keydown', escape, true);
    return () => {
      window.removeEventListener('blur', cancel);
      window.removeEventListener('dragend', cancel);
      document.removeEventListener('keydown', escape, true);
    };
  }, [scope]);

  const pins = orderActiveThreads(list.rows).filter(activePin);
  const eligible = (id: string) =>
    visibleRows.some((row) => row.id === id && activePin(row)) &&
    pins.some((row) => row.id === id);
  const liveReady = (requireCommitted = true) => {
    const live = application.getSnapshot();
    return (
      (!requireCommitted || committed.current === scope) &&
      !blocked &&
      list.status === 'ready' &&
      live.list.rows === scope.rows &&
      live.list.status === 'ready' &&
      !uncertain(live.deletion.status) &&
      !uncertain(live.ordering.status) &&
      application.canReorderPinned()
    );
  };
  const enabled =
    pins.length >= 2 &&
    pins.length <= 50 &&
    visibleRows.filter(activePin).length >= 2 &&
    liveReady(false);
  const owned = (target: HTMLButtonElement, targetId: string) => {
    const session = capture.current;
    return session &&
      session.scope === scope &&
      enabled &&
      liveReady() &&
      eligible(session.id) &&
      eligible(targetId) &&
      handles.current.get(session.id) === session.element &&
      handles.current.get(targetId) === target &&
      session.element.ownerDocument === target.ownerDocument &&
      visible(session.element) &&
      visible(target)
      ? session
      : null;
  };
  const position = (target: HTMLElement, y: number): 'before' | 'after' => {
    const rect = target.getBoundingClientRect();
    return y < rect.top + rect.height / 2 ? 'before' : 'after';
  };

  return {
    handleFor: (row) => {
      if (!activePin(row) || pins.length < 2 || !eligible(row.id)) return null;
      return (
        <button
          ref={(element) => {
            if (element) handles.current.set(row.id, element);
            else handles.current.delete(row.id);
          }}
          type="button"
          className="native-pinned-drag"
          draggable={enabled}
          disabled={!enabled}
          aria-label={`Drag to reorder conversation for ${row.title} (${row.id})`}
          title="Drag to reorder. Use Move up or Move down via Actions for keyboard or touch."
          data-dragging={
            feedback?.source === row.id && capture.current?.scope === scope
              ? 'true'
              : undefined
          }
          data-drop-position={
            feedback?.target === row.id && capture.current?.scope === scope
              ? feedback.position
              : undefined
          }
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onDragStart={(event) => {
            cancel();
            if (
              !enabled ||
              !liveReady() ||
              !eligible(row.id) ||
              handles.current.get(row.id) !== event.currentTarget ||
              !visible(event.currentTarget) ||
              !event.dataTransfer
            ) {
              event.preventDefault();
              return;
            }
            const token = crypto.randomUUID();
            try {
              event.dataTransfer.setData(markerType, token);
              event.dataTransfer.effectAllowed = 'move';
            } catch {
              event.preventDefault();
              return;
            }
            capture.current = {
              scope,
              id: row.id,
              element: event.currentTarget,
              token,
            };
            setFeedback({ source: row.id });
            event.stopPropagation();
          }}
          onDragOver={(event) => {
            const session = owned(event.currentTarget, row.id);
            if (!session) return;
            // Browsers protect transfer contents until drop; local capture is the authority here.
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = 'move';
            setFeedback({
              source: session.id,
              target: row.id,
              position: position(event.currentTarget, event.clientY),
            });
          }}
          onDragLeave={() => {
            if (capture.current) setFeedback({ source: capture.current.id });
          }}
          onDragEnd={cancel}
          onDrop={(event) => {
            const session = owned(event.currentTarget, row.id);
            let marker = '';
            try {
              marker = event.dataTransfer.getData(markerType);
            } catch {
              /* External transfer is never an authority. */
            }
            const side = position(event.currentTarget, event.clientY);
            cancel();
            if (!session || marker !== session.token) return;
            event.preventDefault();
            event.stopPropagation();
            if (session.id === row.id) return;
            const remaining = pins.filter((pin) => pin.id !== session.id);
            const targetIndex = remaining.findIndex((pin) => pin.id === row.id);
            const beforeId =
              side === 'before'
                ? row.id
                : remaining[targetIndex + 1]?.id ?? null;
            const sourceIndex = pins.findIndex((pin) => pin.id === session.id);
            if ((pins[sourceIndex + 1]?.id ?? null) === beforeId) return;
            const source = pins[sourceIndex];
            if (source && liveReady()) options.onReorder(source, beforeId);
          }}
        >
          <span aria-hidden="true">⠿</span>
        </button>
      );
    },
  };
}
