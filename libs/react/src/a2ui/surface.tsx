'use client';
import { useMemo } from 'react';
import type { A2uiSurfaceSnapshot } from '@threadplane/content/a2ui';
import { RenderSpec, type ReactRenderRegistry } from '../render/index.js';
import { a2uiBasicCatalog } from './catalog/index.js';
import { A2uiDefaultFallback } from './default-fallback.js';
import { a2uiSurfaceSpec } from './surface-spec.js';

/** Supplies one published surface snapshot and, optionally, the components that render it. */
export interface A2uiSurfaceProps {
  /** A surface from `createA2uiSurfaces().getSnapshot().surfaces`. Snapshots are immutable; pass the current one. */
  readonly surface: A2uiSurfaceSnapshot;
  /** Components by A2UI name. Defaults to `a2uiBasicCatalog()`; keep it stable. */
  readonly catalog?: ReactRenderRegistry;
  readonly className?: string;
}

/**
 * Renders one A2UI surface read-only. Text, Row, Column, Card and Divider come
 * from the basic catalog; a component the catalog lacks keeps its children.
 * Actions, inputs, function calls and child templates are not handled yet.
 */
export function A2uiSurface({ surface, catalog, className }: A2uiSurfaceProps) {
  const { spec, state } = useMemo(() => a2uiSurfaceSpec(surface), [surface]);
  return (
    <div
      className={['a2ui-surface', className].filter(Boolean).join(' ')}
      data-surface-id={surface.surfaceId}
    >
      <RenderSpec
        spec={spec}
        registry={catalog ?? a2uiBasicCatalog()}
        state={state}
        fallback={A2uiDefaultFallback}
      />
    </div>
  );
}
