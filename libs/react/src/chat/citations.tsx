'use client';
import type { Citation } from '@threadplane/core';
import {
  markdownUrl,
  type MarkdownSnapshot,
} from '@threadplane/content/markdown';
import { definitionToCitation } from '../markdown/citation-source.js';
import { CitationPreview } from './citation-preview.js';
import { useId, useRef, useState } from 'react';
import { useIsomorphicLayoutEffect } from './internal/isomorphic-layout-effect.js';
import { availableDialogTarget } from './internal/dialog-presentation.js';

/** Borrowed unique provider citations and optional accepted Markdown source definitions. */
export interface CitationsProps {
  readonly citations: readonly Citation[];
  /** Borrow accepted Markdown definitions to merge and sort Sources by index. */
  readonly snapshot?: MarkdownSnapshot;
  readonly label?: string;
  readonly className?: string;
  readonly preview?: boolean;
  /** Literal true enables an initially closed Sources panel with local presentation state. */
  readonly collapsible?: boolean;
}

/** Present sources; accepted metadata and message owner lifetime belong to the app. */
export function Citations({
  citations,
  snapshot,
  label = 'Sources',
  className,
  preview,
  collapsible,
}: CitationsProps) {
  if (
    new Set(citations.map((citation) => citation.id)).size !== citations.length
  )
    throw new TypeError('Duplicate citation IDs in Sources.');
  if (snapshot !== undefined) {
    const merged = new Map(
      citations.map((citation) => [citation.id, citation])
    );
    for (const definition of snapshot.root?.citations.values() ?? []) {
      if (!merged.has(definition.id))
        merged.set(definition.id, definitionToCitation(definition));
    }
    citations = [...merged.values()].sort((a, b) => a.index - b.index);
  }
  if (!citations.length) return null;
  if (collapsible === true)
    return (
      <Disclosure
        citations={citations}
        label={label}
        className={className}
        preview={preview}
      />
    );
  return (
    <section
      aria-label={label}
      className={['tp-citations', className].filter(Boolean).join(' ')}
    >
      <h4 className="tp-citations__heading">{label}</h4>
      <SourceList citations={citations} preview={preview} />
    </section>
  );
}

function Disclosure({ citations, label, className, preview }: CitationsProps) {
  const id = useId();
  const header = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  useIsomorphicLayoutEffect(() => {
    const button = header.current;
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
    const ignored = (event: KeyboardEvent) =>
      event.defaultPrevented ||
      event.repeat ||
      event.isComposing ||
      event.keyCode === 229 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey;
    const keydown = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === ' ') {
        if (!event.repeat) {
          spaceTarget = event.target;
          spaceBlocked = ignored(event);
        } else spaceBlocked = true;
        if (spaceBlocked) event.preventDefault();
      } else if (event.key === 'Enter' && ignored(event))
        event.preventDefault();
    };
    const keyup = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === ' ') {
        if (ignored(event) || spaceBlocked || spaceTarget !== event.target)
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
    <section
      aria-label={label}
      className={['tp-citations', className].filter(Boolean).join(' ')}
    >
      <h4 className="tp-citations__heading">
        <button
          ref={header}
          type="button"
          className="tp-citations__toggle"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={(event) => {
            event.stopPropagation();
            if (
              event.defaultPrevented ||
              event.altKey ||
              event.ctrlKey ||
              event.metaKey ||
              event.shiftKey
            )
              return;
            const button = header.current;
            if (
              expanded &&
              button &&
              body.current?.contains(button.ownerDocument.activeElement) &&
              availableDialogTarget(button, button.ownerDocument)
            )
              button.focus();
            setExpanded(!expanded);
          }}
        >
          {label} ({citations.length})
        </button>
      </h4>
      <div ref={body} id={id} hidden={!expanded}>
        {expanded && <SourceList citations={citations} preview={preview} />}
      </div>
    </section>
  );
}

function SourceList({
  citations,
  preview,
}: Pick<CitationsProps, 'citations' | 'preview'>) {
  return (
    <ul className="tp-citations__list">
      {citations.map((citation) => {
        if (preview === true)
          return (
            <li key={citation.id} className="tp-citations__item">
              <CitationPreview citation={citation} />
            </li>
          );
        const title =
          citation.title ?? citation.url ?? `Source ${citation.index}`;
        const href =
          citation.url === undefined
            ? undefined
            : markdownUrl(citation.url, 'link');
        return (
          <li key={citation.id} className="tp-citations__item">
            <span className="tp-citations__index">[{citation.index}] </span>
            {href === undefined ? (
              <span className="tp-citations__title">{title}</span>
            ) : (
              <a
                className="tp-citations__title"
                href={href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {title}
              </a>
            )}
            {citation.sourceType !== undefined && (
              <span className="tp-citations__type">{citation.sourceType}</span>
            )}
            {citation.snippet !== undefined && (
              <p className="tp-citations__snippet">{citation.snippet}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
