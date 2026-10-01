'use client';
import type { Citation } from '@threadplane/core';
import { markdownUrl } from '@threadplane/content/markdown';

export interface CitationsProps {
  readonly citations: readonly Citation[];
  readonly label?: string;
  readonly className?: string;
}

/** Present supplied sources; selection, metadata and owner lifetime belong to the app. */
export function Citations({
  citations,
  label = 'Sources',
  className,
}: CitationsProps) {
  if (!citations.length) return null;
  if (
    new Set(citations.map((citation) => citation.id)).size !== citations.length
  )
    throw new TypeError('Duplicate citation IDs in Sources.');
  return (
    <section
      aria-label={label}
      className={['tp-citations', className].filter(Boolean).join(' ')}
    >
      <h4 className="tp-citations__heading">{label}</h4>
      <ul className="tp-citations__list">
        {citations.map((citation) => {
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
                <span className="tp-citations__type">
                  {citation.sourceType}
                </span>
              )}
              {citation.snippet !== undefined && (
                <p className="tp-citations__snippet">{citation.snippet}</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
