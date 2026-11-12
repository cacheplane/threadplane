import { useContext, useId, type ReactNode } from 'react';
import { A2uiActionContext } from '../surface-context.js';

/** What an input shows and announces while its validation message is visible. */
export interface A2uiCheckError {
  /** Spread onto the control: marks it invalid and points at the message. */
  readonly control: {
    readonly 'aria-invalid'?: true;
    readonly 'aria-describedby'?: string;
  };
  /** The message element, or null while there is nothing to show. */
  readonly message: ReactNode;
}

/** The surface's current validation message for one component, ready to render. */
export function useA2uiCheckError(elementKey: string): A2uiCheckError {
  const id = useId();
  const text = useContext(A2uiActionContext).error(elementKey);
  if (text === '') return { control: {}, message: null };
  return {
    control: { 'aria-invalid': true, 'aria-describedby': id },
    message: (
      <div id={id} className="a2ui-check-error" role="alert">
        {text}
      </div>
    ),
  };
}
