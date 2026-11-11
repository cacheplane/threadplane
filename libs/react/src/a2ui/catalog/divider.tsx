import type { RenderViewProps } from '../../render/index.js';

/** A2UI Divider: a thematic break, or a decorative vertical rule between row items. */
export function A2uiDivider({ props }: RenderViewProps) {
  return props['axis'] === 'vertical' ? (
    <div className="a2ui-divider a2ui-divider--vertical" />
  ) : (
    <hr className="a2ui-divider a2ui-divider--horizontal" />
  );
}
