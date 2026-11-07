import type { Citation } from '@threadplane/core';
import { markdownUrl } from '@threadplane/content/markdown';
import {
  citationSourceVisual,
  citationTypeMeta,
  deriveDomain,
  formatPublished,
  type CitationTypeIcon,
} from '@threadplane/content/messages';

/** Borrowed source metadata and an optional card class. */
export interface CitationCardProps {
  readonly citation: Citation;
  readonly className?: string;
}

const iconPaths: Record<CitationTypeIcon, string> = {
  web: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM3 12h18M12 3c4 5 4 13 0 18-4-5-4-13 0-18Z',
  file: 'M6 3h8l4 4v14H6V3Zm8 0v5h4M9 12h6m-6 4h6',
  app: 'M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z',
  memory:
    'M8 3v3m8-3v3M8 18v3m8-3v3M3 8h3m-3 8h3m12-8h3m-3 8h3M6 6h12v12H6V6Zm4 4h4v4h-4v-4Z',
  generic: 'M6 3h12v18H6V3Zm3 5h6m-6 4h6m-6 4h4',
};

/** Pure source presentation with local decorative visuals and policy-checked navigation. */
export function CitationCard({ citation, className }: CitationCardProps) {
  // Provider images are deliberately excluded without changing borrowed metadata.
  const visual = citationSourceVisual({ ...citation, iconUrl: undefined });
  const meta = citationTypeMeta(citation);
  const domain = deriveDomain(citation.url);
  const published = formatPublished(citation.publishedAt);
  const title = citation.title ?? citation.url ?? `Source ${citation.index}`;
  const href =
    citation.url === undefined ? undefined : markdownUrl(citation.url, 'link');
  return (
    <div className={['tp-citation-card', className].filter(Boolean).join(' ')}>
      <span
        className={`tp-citation-card__visual tp-citation-card__visual--${meta.tone}`}
        aria-hidden="true"
        style={
          visual.kind === 'monogram'
            ? { backgroundColor: visual.color }
            : undefined
        }
      >
        {visual.kind === 'monogram' ? (
          visual.monogram
        ) : (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            focusable="false"
          >
            <path d={iconPaths[meta.icon]} />
          </svg>
        )}
      </span>
      <div className="tp-citation-card__body">
        <div className="tp-citation-card__heading">
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
        </div>
        {(meta.label !== null || Boolean(domain) || published !== null) && (
          <div className="tp-citation-card__metadata">
            {meta.label !== null && (
              <span
                className={`tp-citations__type tp-citation-card__badge tp-citation-card__badge--${meta.tone}`}
              >
                {meta.label}
              </span>
            )}
            {domain && (
              <span className="tp-citation-card__domain">{domain}</span>
            )}
            {published !== null && (
              <span className="tp-citation-card__published">{published}</span>
            )}
          </div>
        )}
        {citation.snippet !== undefined && (
          <p className="tp-citations__snippet tp-citation-card__snippet">
            {citation.snippet}
          </p>
        )}
      </div>
    </div>
  );
}
