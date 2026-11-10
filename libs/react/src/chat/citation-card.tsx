import type { Citation } from '@threadplane/core';
import { markdownUrl } from '@threadplane/content/markdown';
import {
  citationTypeMeta,
  deriveDomain,
  formatPublished,
} from '@threadplane/content/messages';

import { CitationSourceMarker } from './internal/citation-source-marker.js';

/** Borrowed source metadata and an optional card class. */
export interface CitationCardProps {
  readonly citation: Citation;
  readonly className?: string;
}

/** Pure source presentation with local decorative visuals and policy-checked navigation. */
export function CitationCard({ citation, className }: CitationCardProps) {
  const meta = citationTypeMeta(citation);
  const domain = deriveDomain(citation.url);
  const published = formatPublished(citation.publishedAt);
  const title = citation.title ?? citation.url ?? `Source ${citation.index}`;
  const href =
    citation.url === undefined ? undefined : markdownUrl(citation.url, 'link');
  return (
    <div className={['tp-citation-card', className].filter(Boolean).join(' ')}>
      <span className="tp-citations__index tp-citation-card__index">
        {citation.index}
      </span>
      <div className="tp-citation-card__body">
        <div className="tp-citation-card__metadata">
          <CitationSourceMarker
            citation={citation}
            className="tp-citation-card__visual"
          />
          {domain && <span className="tp-citation-card__domain">{domain}</span>}
          {published !== null && (
            <span className="tp-citation-card__published">{published}</span>
          )}
          {meta.label !== null && (
            <span
              className={`tp-citations__type tp-citation-card__badge tp-citation-card__badge--${meta.tone}`}
            >
              {meta.label}
            </span>
          )}
        </div>
        <div className="tp-citation-card__heading">
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
        </div>
        {citation.snippet !== undefined && (
          <p className="tp-citations__snippet tp-citation-card__snippet">
            {citation.snippet}
          </p>
        )}
      </div>
    </div>
  );
}
