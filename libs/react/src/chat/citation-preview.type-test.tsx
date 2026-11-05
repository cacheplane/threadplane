import { CitationPreview, type CitationPreviewProps } from './index.js';
import type { Citation } from '@threadplane/core';
const citation: Citation = { id: 'a', index: 1, title: 'Source' };
const props: CitationPreviewProps = { citation, className: 'source' };
<CitationPreview {...props} />;
// @ts-expect-error The borrowed citation prop is readonly.
props.citation = citation;
// @ts-expect-error Core citation metadata stays readonly.
props.citation.title = 'Changed';
// @ts-expect-error Citation metadata is required.
<CitationPreview />;
// @ts-expect-error Visibility and commands are presentation-owned.
<CitationPreview citation={citation} open onSelect={() => undefined} />;
