import type { Citation } from '@threadplane/core';
import {
  citationTypeMeta,
  deriveDomain,
  formatPublished,
} from '@threadplane/content/messages';
import { CitationSourceMarker } from './citation-source-marker.js';

/** Private presentation only; raw source details remain owned by each preview. */
export function CitationSourceSummary({
  citation,
}: {
  readonly citation: Citation;
}) {
  const meta = citationTypeMeta(citation);
  const domain = deriveDomain(citation.url);
  const published = formatPublished(citation.publishedAt);
  return (
    <div
      className="tp-citation-source-summary"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '0.375rem 0.625rem',
        minWidth: 0,
        maxInlineSize: '100%',
        overflowWrap: 'anywhere',
        color: 'inherit',
      }}
    >
      <CitationSourceMarker
        citation={citation}
        className="tp-citation-source-summary__visual"
        compact
      />
      {meta.label !== null && (
        <span
          className={`tp-citation-source-summary__type tp-citation-card__badge tp-citation-card__badge--${meta.tone}`}
          style={{
            minWidth: 0,
            maxInlineSize: '100%',
            boxSizing: 'border-box',
            paddingInline: '0.375rem',
            border: '1px solid currentColor',
            borderRadius: '0.25rem',
            color: 'inherit',
          }}
        >
          {meta.label}
        </span>
      )}
      {domain && (
        <span
          className="tp-citation-source-summary__domain"
          style={{ minWidth: 0, maxInlineSize: '100%' }}
        >
          {domain}
        </span>
      )}
      {published !== null && (
        <span
          className="tp-citation-source-summary__published"
          style={{ minWidth: 0, maxInlineSize: '100%' }}
        >
          {published}
        </span>
      )}
    </div>
  );
}
