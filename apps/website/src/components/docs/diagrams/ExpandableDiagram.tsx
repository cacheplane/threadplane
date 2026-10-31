'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Maximize2, X } from 'lucide-react';

interface ExpandableDiagramProps {
  label: string;
  caption?: string;
  description?: string;
  kind?: 'architecture' | 'sequence' | 'state' | 'flow' | 'erd';
  children: ReactNode;
}

/** One diagram instance, moved into the native modal only when requested. */
export function ExpandableDiagram({
  label,
  caption,
  description,
  kind,
  children,
}: ExpandableDiagramProps) {
  const [expanded, setExpanded] = useState(false);
  const [reservedHeight, setReservedHeight] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const descriptionSummary = useRef<HTMLElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const alternative = description ?? [label, caption].filter(Boolean).join(' ');

  useEffect(() => {
    if (expanded) dialog.current?.showModal();
  }, [expanded]);

  const restore = () => {
    setExpanded(false);
    trigger.current?.focus({ preventScroll: true });
  };
  const diagram = (
    <div
      className="tp-diagram-scroll"
      role="region"
      tabIndex={0}
      aria-label={`${label.replace(
        /[.!?]$/,
        ''
      )}. Scroll horizontally to read the diagram.`}
    >
      {children}
    </div>
  );
  const explanation = (
    <details className="tp-diagram-description">
      <summary ref={descriptionSummary}>Read diagram description</summary>
      <p>{alternative}</p>
    </details>
  );

  return (
    <figure
      className="tp-diagram-figure"
      data-scale="docs"
      data-docs-diagram
      data-diagram-kind={kind}
    >
      <div className="tp-diagram-toolbar">
        <span>
          {kind
            ? `${
                kind === 'erd'
                  ? 'Data model'
                  : kind[0].toUpperCase() + kind.slice(1)
              } diagram`
            : 'Diagram'}
        </span>
        <button
          ref={trigger}
          type="button"
          aria-label={`Expand diagram: ${label}`}
          aria-haspopup="dialog"
          onClick={() => {
            setReservedHeight(
              surface.current?.getBoundingClientRect().height ?? 0
            );
            setExpanded(true);
          }}
        >
          <Maximize2 size={16} aria-hidden="true" /> Expand
        </button>
      </div>
      <div ref={surface}>
        {expanded ? (
          <div
            aria-hidden="true"
            className="tp-diagram-placeholder"
            style={
              {
                '--diagram-reserved-height': `${reservedHeight}px`,
              } as CSSProperties
            }
          />
        ) : (
          diagram
        )}
      </div>
      {caption ? (
        <figcaption className="tp-diagram-caption">{caption}</figcaption>
      ) : null}
      {!expanded && explanation}
      {expanded ? (
        <dialog
          ref={dialog}
          className="tp-diagram-dialog"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          onClose={restore}
          onKeyDown={(event) => {
            if (event.key !== 'Tab') return;
            // Native modal inertness blocks the page, but some browsers still
            // cycle through their chrome. Keep the document's focus cycle here.
            if (event.shiftKey && event.target === closeButton.current) {
              event.preventDefault();
              descriptionSummary.current?.focus();
            } else if (
              !event.shiftKey &&
              event.target === descriptionSummary.current
            ) {
              event.preventDefault();
              closeButton.current?.focus();
            }
          }}
        >
          <div className="tp-diagram-dialog-header">
            <h2 id={titleId}>{label}</h2>
            <button
              ref={closeButton}
              type="button"
              aria-label="Close diagram"
              onClick={() => dialog.current?.close()}
            >
              <X size={20} aria-hidden="true" /> Close
            </button>
          </div>
          <p id={descriptionId} className="tp-diagram-dialog-hint">
            Press Escape to close. Use the arrow keys to scroll a wide diagram.
          </p>
          {diagram}
          {explanation}
        </dialog>
      ) : null}
    </figure>
  );
}
