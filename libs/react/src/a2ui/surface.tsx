'use client';
import { useMemo } from 'react';
import type {
  A2uiSurfaces,
  A2uiSurfaceSnapshot,
} from '@threadplane/content/a2ui';
import { RenderSpec, type ReactRenderRegistry } from '../render/index.js';
import { a2uiBasicCatalog } from './catalog/index.js';
import { A2uiDefaultFallback } from './default-fallback.js';
import { A2uiSurfaceContext, type A2uiSurfaceWriter } from './surface-context.js';
import { a2uiSurfaceSpec } from './surface-spec.js';

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
  /** Components by A2UI name. Defaults to `a2uiBasicCatalog()`; keep it stable. */
  readonly catalog?: ReactRenderRegistry;
  readonly className?: string;
}

/**
 * Renders one A2UI surface from a snapshot. Given the store as `surfaces`, its
 * input components write edits into that store; the application keeps passing
 * the store's current snapshot. Edits stay local: nothing is sent to an agent.
 * A component the catalog lacks keeps its children. Actions, validation,
 * function calls and child templates are not handled yet.
 */
export function A2uiSurface({
  surface,
  surfaces,
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
  return (
    <div
      className={['a2ui-surface', className].filter(Boolean).join(' ')}
      data-surface-id={surface.surfaceId}
    >
      <A2uiSurfaceContext.Provider value={writer}>
        <RenderSpec
          spec={spec}
          registry={catalog ?? a2uiBasicCatalog()}
          state={state}
          fallback={A2uiDefaultFallback}
        />
      </A2uiSurfaceContext.Provider>
    </div>
  );
}
