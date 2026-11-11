import type { RenderViewProps } from '../../render/index.js';

/** A2UI Card: one child on a raised, bordered surface. */
export function A2uiCard({ children }: RenderViewProps) {
  return <div className="a2ui-card">{children}</div>;
}
