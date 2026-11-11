import type { RenderViewProps } from '../../render/index.js';
import { flexLayout } from './layout.js';

/** A2UI Row: children side by side, wrapping, with A2UI alignment and distribution. */
export function A2uiRow({ props, children }: RenderViewProps) {
  return <div {...flexLayout('a2ui-row', props)}>{children}</div>;
}
