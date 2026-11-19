import type { ComponentType } from 'react';
import type { RenderViewProps } from './types.js';

/**
 * The placeholder `RenderSpec` shows in place of a registered element while any
 * of its resolved props is still undefined. It uses the `GenerativeUiSkeleton`
 * markup and classes, so the chat and A2UI stylesheets style it. Pass your own
 * component as `RenderSpec`'s `pendingFallback` to replace it.
 */
export const RenderPendingFallback: ComponentType<RenderViewProps> = () => (
  <div
    className="tp-genui-skeleton tp-render-pending"
    role="status"
    aria-live="polite"
    aria-atomic
  >
    <span className="tp-genui-skeleton__label">Building UI…</span>
    <span className="tp-genui-skeleton__rows" aria-hidden="true">
      <span className="tp-genui-skeleton__row" />
      <span className="tp-genui-skeleton__row" />
      <span className="tp-genui-skeleton__row" />
    </span>
  </div>
);
