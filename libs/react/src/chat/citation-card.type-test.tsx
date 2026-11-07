import type { Citation } from '@threadplane/core';
import { CitationCard, type CitationCardProps } from './index.js';

const citation: Citation = { id: 'a', index: 1 };
const props: CitationCardProps = { citation, className: 'source' };
<CitationCard {...props} />;
<CitationCard citation={citation} />;
// @ts-expect-error Card metadata is required.
<CitationCard />;
// @ts-expect-error The borrowed citation prop is readonly.
props.citation = citation;
// @ts-expect-error The class prop is readonly.
props.className = 'changed';
// @ts-expect-error Borrowed citation fields remain readonly.
props.citation.title = 'changed';
// @ts-expect-error Cards do not accept an owner or commands.
<CitationCard citation={citation} onSelect={() => undefined} />;
