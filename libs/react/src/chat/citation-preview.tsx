'use client';
import type { Citation } from '@threadplane/core';
import { markdownUrl } from '@threadplane/content/markdown';
import { useId, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useIsomorphicLayoutEffect } from './internal/isomorphic-layout-effect.js';
import {
  dialogPresentation,
  availableDialogTarget,
} from './internal/dialog-presentation.js';

/** Borrowed source metadata and an optional trigger class. */
export interface CitationPreviewProps {
  readonly citation: Citation;
  readonly className?: string;
}

/** Explicit source details with local presentation state and no source fetching. */
export function CitationPreview(props: CitationPreviewProps) {
  return <SourcePreview key={props.citation.id} {...props} />;
}

type Presentation = {
  document: Document;
  style: CSSProperties;
  invoker: HTMLButtonElement;
};
function SourcePreview({ citation, className }: CitationPreviewProps) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const title = citation.title ?? citation.url ?? `Source ${citation.index}`;
  useIsomorphicLayoutEffect(() => {
    const button = trigger.current;
    if (!button) return;
    const doc = button.ownerDocument;
    const win = doc.defaultView;
    let spaceTarget: EventTarget | null = null;
    let spaceBlocked = false;
    const releaseKeyboard = () => {
      spaceTarget = null;
      spaceBlocked = false;
    };
    const visibility = () => {
      if (doc.visibilityState === 'hidden') releaseKeyboard();
    };
    const keydown = (event: KeyboardEvent) => {
      event.stopPropagation();
      const ignored =
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.keyCode === 229 ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey;
      if (event.key === ' ') {
        if (!event.repeat) {
          spaceTarget = event.target;
          spaceBlocked = ignored;
        } else spaceBlocked = true;
        if (spaceBlocked) event.preventDefault();
      } else if (event.key === 'Enter' && ignored) event.preventDefault();
    };
    const keyup = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === ' ') {
        if (
          event.defaultPrevented ||
          event.repeat ||
          event.isComposing ||
          event.keyCode === 229 ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          spaceBlocked ||
          spaceTarget !== event.target
        )
          event.preventDefault();
        releaseKeyboard();
      }
    };
    button.addEventListener('keydown', keydown);
    button.addEventListener('keyup', keyup);
    button.addEventListener('blur', releaseKeyboard);
    doc.addEventListener('visibilitychange', visibility);
    win?.addEventListener('blur', releaseKeyboard);
    return () => {
      button.removeEventListener('keydown', keydown);
      button.removeEventListener('keyup', keyup);
      button.removeEventListener('blur', releaseKeyboard);
      doc.removeEventListener('visibilitychange', visibility);
      win?.removeEventListener('blur', releaseKeyboard);
    };
  }, []);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={['tp-citation-preview__trigger', className]
          .filter(Boolean)
          .join(' ')}
        aria-label={`Preview source ${citation.index}: ${title}`}
        onClick={(event) => {
          event.stopPropagation();
          if (
            event.defaultPrevented ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            !trigger.current
          )
            return;
          setPresentation({
            document: trigger.current.ownerDocument,
            style: dialogPresentation(trigger.current),
            invoker: trigger.current,
          });
        }}
      >
        [{citation.index}] {title}
      </button>
      {presentation && (
        <SourceDialog
          citation={citation}
          presentation={presentation}
          dismiss={() => setPresentation(null)}
        />
      )}
    </>
  );
}

function SourceDialog({
  citation,
  presentation,
  dismiss,
}: {
  citation: Citation;
  presentation: Presentation;
  dismiss: () => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const callback = useRef(dismiss);
  callback.current = dismiss;
  const title = citation.title ?? citation.url ?? `Source ${citation.index}`;
  const href =
    citation.url === undefined ? undefined : markdownUrl(citation.url, 'link');
  useIsomorphicLayoutEffect(() => {
    const panel = dialog.current;
    if (!panel) return;
    const doc = presentation.document;
    const win = doc.defaultView;
    let ownedFocus = false;
    let escapeHeld = false;
    let spaceTarget: EventTarget | null = null;
    let spaceBlocked = false;
    const releaseKeyboard = () => {
      escapeHeld = false;
      spaceTarget = null;
      spaceBlocked = false;
    };
    const visibility = () => {
      if (doc.visibilityState === 'hidden') releaseKeyboard();
    };
    const focus = () => {
      ownedFocus = panel.contains(doc.activeElement);
    };
    const keydown = (event: KeyboardEvent) => {
      event.stopPropagation();
      const claimed = event.defaultPrevented;
      const composing = event.isComposing || event.keyCode === 229;
      const ignored = event.repeat || composing;
      if (event.key === 'Tab' && !claimed && !composing) {
        const targets = Array.from(
          panel.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]')
        ).filter(
          (target) => target.tabIndex >= 0 && availableDialogTarget(target, doc)
        );
        const first = targets[0];
        const last = targets[targets.length - 1];
        if (
          doc.activeElement === panel ||
          (event.shiftKey
            ? doc.activeElement === first
            : doc.activeElement === last)
        ) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        }
      } else if (event.key === 'Escape') {
        event.preventDefault();
        // A rejected press must also suppress its native cancel default.
        escapeHeld = true;
        if (!claimed && !ignored) callback.current();
      } else if (event.key === ' ') {
        if (!event.repeat) {
          spaceTarget = event.target;
          spaceBlocked = claimed || ignored;
        } else spaceBlocked = true;
        if (spaceBlocked) event.preventDefault();
      } else if (event.key === 'Enter' && ignored) event.preventDefault();
    };
    const keyup = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === 'Escape') escapeHeld = false;
      if (event.key === ' ') {
        if (
          event.defaultPrevented ||
          event.repeat ||
          event.isComposing ||
          event.keyCode === 229 ||
          spaceBlocked ||
          spaceTarget !== event.target
        )
          event.preventDefault();
        spaceTarget = null;
        spaceBlocked = false;
      }
    };
    const cancel = (event: Event) => {
      const claimed = event.defaultPrevented;
      event.preventDefault();
      event.stopPropagation();
      if (!claimed && !escapeHeld) callback.current();
    };
    panel.addEventListener('keydown', keydown);
    panel.addEventListener('keyup', keyup);
    panel.addEventListener('cancel', cancel);
    doc.addEventListener('focusin', focus);
    doc.addEventListener('visibilitychange', visibility);
    win?.addEventListener('blur', releaseKeyboard);
    panel.showModal();
    close.current?.focus();
    focus();
    return () => {
      const active = doc.activeElement;
      const restore =
        panel.contains(active) || (active === doc.body && ownedFocus);
      panel.removeEventListener('keydown', keydown);
      panel.removeEventListener('keyup', keyup);
      panel.removeEventListener('cancel', cancel);
      doc.removeEventListener('focusin', focus);
      doc.removeEventListener('visibilitychange', visibility);
      win?.removeEventListener('blur', releaseKeyboard);
      if (panel.open) panel.close();
      if (restore && availableDialogTarget(presentation.invoker, doc))
        presentation.invoker.focus();
    };
  }, [presentation]);
  return createPortal(
    <dialog
      ref={dialog}
      className="tp-citation-preview__dialog"
      aria-modal="true"
      aria-label={`Source ${citation.index}`}
      aria-describedby={`${id}-title`}
      dir={presentation.style.direction === 'rtl' ? 'rtl' : 'ltr'}
      style={presentation.style}
      onClick={(event) => {
        event.stopPropagation();
        if (
          event.defaultPrevented ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          event.target !== event.currentTarget
        )
          return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          callback.current();
      }}
    >
      <button
        ref={close}
        type="button"
        className="tp-citation-preview__close"
        onClick={(event) => {
          event.stopPropagation();
          if (
            !event.defaultPrevented &&
            !event.altKey &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.shiftKey
          )
            callback.current();
        }}
      >
        Close
      </button>
      <h2 id={`${id}-title`}>{title}</h2>
      <dl>
        <dt>Index</dt>
        <dd>{citation.index}</dd>
        {(['snippet', 'sourceType', 'publishedAt', 'url'] as const).map(
          (field) =>
            citation[field] !== undefined && (
              <SourceField key={field} field={field} value={citation[field]} />
            )
        )}
      </dl>
      {href !== undefined && (
        <a href={href} target="_blank" rel="noopener noreferrer">
          Open source
        </a>
      )}
    </dialog>,
    presentation.document.body
  );
}
function SourceField({
  field,
  value,
}: {
  field: 'snippet' | 'sourceType' | 'publishedAt' | 'url';
  value: string | number;
}) {
  const labels = {
    snippet: 'Snippet',
    sourceType: 'Source type',
    publishedAt: 'Published at',
    url: 'URL',
  };
  return (
    <>
      <dt>{labels[field]}</dt>
      <dd data-field={field}>{value}</dd>
    </>
  );
}
