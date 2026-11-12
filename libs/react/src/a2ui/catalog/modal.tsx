import {
  Children,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import type { RenderViewProps } from '../../render/index.js';
import {
  A2uiModalTriggerContext,
  type A2uiModalTrigger,
} from '../surface-context.js';

/**
 * A2UI Modal: its first child is an inline trigger and its second is shown in
 * a native modal dialog. Opening is local to the mounted surface. A Button as
 * the trigger is the control that opens it; any other trigger is wrapped in
 * one. Escape, the
 * Close button and a press on the backdrop dismiss it; the browser returns
 * focus to the trigger.
 */
export function A2uiModal({ children }: RenderViewProps) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  // A Button inside the trigger is the control; the wrapper then stops being one.
  const [buttons, setButtons] = useState(0);
  const claim = useCallback(() => {
    setButtons((count) => count + 1);
    return () => setButtons((count) => count - 1);
  }, []);
  const opener = useMemo<A2uiModalTrigger>(
    () => ({ expanded: open, open: () => setOpen(true), claim }),
    [open, claim]
  );
  const [trigger, content] = Children.toArray(children);
  useEffect(() => {
    const panel = dialog.current;
    if (!open || !panel) return;
    if (!panel.open) panel.showModal();
    return () => {
      if (panel.open) panel.close();
    };
  }, [open]);
  if (trigger === undefined) return null;
  const key = (event: KeyboardEvent<HTMLSpanElement>) => {
    // Only the wrapper's own keys: a control inside the trigger keeps its keyboard.
    if (event.target !== event.currentTarget || event.repeat) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setOpen(true);
    }
  };
  return (
    <>
      <span
        id={`${id}trigger`}
        className="a2ui-modal__trigger"
        {...(buttons > 0
          ? {}
          : {
              role: 'button',
              tabIndex: 0,
              'aria-haspopup': 'dialog' as const,
              'aria-expanded': open,
              onClick: () => setOpen(true),
              onKeyDown: key,
            })}
      >
        <A2uiModalTriggerContext.Provider value={opener}>
          {trigger}
        </A2uiModalTriggerContext.Provider>
      </span>
      {open ? (
        <dialog
          ref={dialog}
          className="a2ui-modal"
          aria-labelledby={`${id}trigger`}
          onClose={() => setOpen(false)}
          onClick={(event) => {
            // The dialog element itself is only hit outside its panel: the backdrop.
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div className="a2ui-modal__panel">
            <button
              type="button"
              className="a2ui-modal__close"
              onClick={() => setOpen(false)}
            >
              Close
            </button>
            {content}
          </div>
        </dialog>
      ) : null}
    </>
  );
}
