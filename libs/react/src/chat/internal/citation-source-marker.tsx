import type { Citation } from '@threadplane/core';
import {
  citationSourceVisual,
  citationTypeMeta,
  type CitationTypeIcon,
} from '@threadplane/content/messages';

const iconPaths: Record<CitationTypeIcon, string> = {
  web: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM3 12h18M12 3c4 5 4 13 0 18-4-5-4-13 0-18Z',
  file: 'M6 3h8l4 4v14H6V3Zm8 0v5h4M9 12h6m-6 4h6',
  app: 'M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z',
  memory:
    'M8 3v3m8-3v3M8 18v3m8-3v3M3 8h3m-3 8h3m12-8h3m-3 8h3M6 6h12v12H6V6Zm4 4h4v4h-4v-4Z',
  generic: 'M6 3h12v18H6V3Zm3 5h6m-6 4h6m-6 4h4',
};

/** Private, pure local source marker shared by cards and disclosure headers. */
export function CitationSourceMarker({
  citation,
  className,
}: {
  readonly citation: Citation;
  readonly className: string;
}) {
  // Never request provider images or change borrowed metadata.
  const visual = citationSourceVisual({ ...citation, iconUrl: undefined });
  const meta = citationTypeMeta(citation);
  return (
    <span
      className={`${className} ${className}--${meta.tone}`}
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
  );
}
