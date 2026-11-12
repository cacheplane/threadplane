'use client';
import { useMemo, useRef, useState } from 'react';
import {
  createA2uiActionMessage,
  evaluateA2uiChecks,
  type A2uiActionMessage,
  type A2uiCheckFailure,
  type A2uiValidationErrorMessage,
  type A2uiSurfaces,
  type A2uiSurfaceSnapshot,
} from '@threadplane/content/a2ui';
import { RenderSpec, type ReactRenderRegistry } from '../render/index.js';
import { a2uiBasicCatalog } from './catalog/index.js';
import { A2uiDefaultFallback } from './default-fallback.js';
import {
  A2uiActionContext,
  A2uiSurfaceContext,
  type A2uiSurfaceActions,
  type A2uiSurfaceWriter,
} from './surface-context.js';
import { a2uiSurfaceSpec } from './surface-spec.js';

const NONE: ReadonlyMap<string, A2uiCheckFailure> = new Map();

/** Failing checks by component: a Button's own disable it, every other one blocks a press. */
function split(surface: A2uiSurfaceSnapshot) {
  const buttons = new Set<string>();
  const inputs = new Map<string, A2uiCheckFailure>();
  const kinds = new Map(surface.components.map((item) => [item.id, item.component]));
  for (const failure of evaluateA2uiChecks(surface))
    if (kinds.get(failure.componentId) === 'Button') buttons.add(failure.componentId);
    else inputs.set(failure.componentId, failure);
  return { buttons, inputs };
}

/** Supplies one published surface snapshot and, optionally, the components that render it. */
export interface A2uiSurfaceProps {
  /** A surface from `createA2uiSurfaces().getSnapshot().surfaces`. Snapshots are immutable; pass the current one. */
  readonly surface: A2uiSurfaceSnapshot;
  /**
   * The store this snapshot came from. With it, input components write each
   * edit into that surface's data model, and the store publishes a new
   * snapshot for you to pass back. Without it the surface is read-only.
   */
  readonly surfaces?: A2uiSurfaces;
  /**
   * Receives the action message when a Button with an event action is
   * pressed. Its context is resolved from this surface's current data model.
   * Sending it to the agent is the application's job. Without it, Buttons are
   * disabled.
   */
  readonly onAction?: (message: A2uiActionMessage) => void;
  /**
   * Called when a press was blocked because an input's validation checks do
   * not pass, with the first failure as a v0.9 `VALIDATION_FAILED` error.
   * `onAction` is not called for that press.
   */
  readonly onValidationError?: (error: A2uiValidationErrorMessage) => void;
  /** Components by A2UI name. Defaults to `a2uiBasicCatalog()`; keep it stable. */
  readonly catalog?: ReactRenderRegistry;
  readonly className?: string;
}

/**
 * Renders one A2UI surface from a snapshot. Given the store as `surfaces`, its
 * input components write edits into that store; the application keeps passing
 * the store's current snapshot. Edits stay local. A pressed Button hands its
 * resolved action message to `onAction`, and the application transports it.
 * A press is blocked while any input's `checks` fail; the failing inputs then
 * show their messages until they pass. A Button whose own `checks` fail is
 * disabled. A component the catalog lacks keeps its children. Function calls
 * outside checks and child templates are not handled yet.
 */
export function A2uiSurface({
  surface,
  surfaces,
  onAction,
  onValidationError,
  catalog,
  className,
}: A2uiSurfaceProps) {
  const { spec, state } = useMemo(() => a2uiSurfaceSpec(surface), [surface]);
  const { surfaceId } = surface;
  const writer = useMemo<A2uiSurfaceWriter>(
    () => ({
      editable: surfaces !== undefined,
      write: (path, value) => {
        if (surfaces !== undefined && path !== undefined)
          surfaces.setValue(surfaceId, path, value);
      },
    }),
    [surfaces, surfaceId]
  );
  // A press reads the snapshot and handler of the latest render, not of the render that mounted the button.
  const latest = useRef({ surface, onAction, onValidationError });
  latest.current = { surface, onAction, onValidationError };
  // Messages stay hidden until a press was blocked, then follow the data model.
  const [blocked, setBlocked] = useState<string | null>(null);
  const failures = useMemo(() => split(surface), [surface]);
  const shown = blocked === surfaceId ? failures.inputs : NONE;
  const sendable = useMemo(
    () =>
      new Set(
        surface.components
          .filter((item) => createA2uiActionMessage(surface, item.id, '') !== null)
          .map((item) => item.id)
      ),
    [surface]
  );
  const handled = onAction !== undefined;
  const actions = useMemo<A2uiSurfaceActions>(
    () => ({
      actionable: (id) =>
        handled && sendable.has(id) && !failures.buttons.has(id),
      act: (id) => {
        const current = latest.current;
        const now = split(current.surface);
        if (now.buttons.has(id)) return;
        const [first] = now.inputs.values();
        if (first !== undefined) {
          setBlocked(current.surface.surfaceId);
          current.onValidationError?.({
            version: 'v0.9',
            error: {
              code: 'VALIDATION_FAILED',
              surfaceId: current.surface.surfaceId,
              ...(first.path === undefined ? {} : { path: first.path }),
              message: first.message,
            },
          });
          return;
        }
        setBlocked(null);
        const message = createA2uiActionMessage(current.surface, id);
        if (message !== null) current.onAction?.(message);
      },
      error: (id) => shown.get(id)?.message ?? '',
    }),
    [handled, sendable, failures, shown]
  );
  return (
    <div
      className={['a2ui-surface', className].filter(Boolean).join(' ')}
      data-surface-id={surface.surfaceId}
    >
      <A2uiSurfaceContext.Provider value={writer}>
        <A2uiActionContext.Provider value={actions}>
          <RenderSpec
            spec={spec}
            registry={catalog ?? a2uiBasicCatalog()}
            state={state}
            fallback={A2uiDefaultFallback}
          />
        </A2uiActionContext.Provider>
      </A2uiSurfaceContext.Provider>
    </div>
  );
}
