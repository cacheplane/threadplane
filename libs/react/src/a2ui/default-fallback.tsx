import type { RenderViewProps } from '../render/index.js';

/** Keeps the children of a component this catalog does not provide, and marks where it was. */
export function A2uiDefaultFallback({ elementKey, children }: RenderViewProps) {
  return (
    <div className="a2ui-unsupported" data-a2ui-unsupported={elementKey}>
      {children}
    </div>
  );
}
