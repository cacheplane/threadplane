import type { RenderViewProps } from '../../render/index.js';
import { flexLayout } from './layout.js';

/** A2UI Column: children stacked, with A2UI alignment and distribution. */
export function A2uiColumn({ props, children }: RenderViewProps) {
  return <div {...flexLayout('a2ui-col', props)}>{children}</div>;
}
