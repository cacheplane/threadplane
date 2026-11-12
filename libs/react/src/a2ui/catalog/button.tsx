import { useContext, useEffect } from 'react';
import type { RenderViewProps } from '../../render/index.js';
import {
  A2uiActionContext,
  A2uiModalTriggerContext,
} from '../surface-context.js';

const VARIANTS = ['primary', 'borderless'];

/**
 * A2UI Button: a native button around its child. Pressing it sends its event
 * action through the surface. It is disabled when the surface has no action
 * handler, when it has no event action, or when its `disabled` prop is true.
 * As a Modal's trigger it also opens the modal, and needs no action to do so.
 */
export function A2uiButton({ props, children, elementKey }: RenderViewProps) {
  const { actionable, act } = useContext(A2uiActionContext);
  const trigger = useContext(A2uiModalTriggerContext);
  const claim = trigger?.claim;
  useEffect(() => claim?.(), [claim]);
  const sends = actionable(elementKey);
  const variant = props['variant'];
  return (
    <button
      type="button"
      className={`a2ui-btn a2ui-btn--${
        typeof variant === 'string' && VARIANTS.includes(variant)
          ? variant
          : 'default'
      }`}
      disabled={props['disabled'] === true || (!sends && trigger === null)}
      aria-haspopup={trigger === null ? undefined : 'dialog'}
      aria-expanded={trigger === null ? undefined : trigger.expanded}
      onClick={() => {
        if (sends) act(elementKey);
        trigger?.open();
      }}
    >
      {children}
    </button>
  );
}
