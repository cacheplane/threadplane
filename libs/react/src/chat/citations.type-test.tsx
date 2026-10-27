import { Citations, type CitationsProps } from './index.js';
import type { Citation } from '@threadplane/core';
const citations: readonly Citation[] = [{ id: 'a', index: 1, title: 'Source' }];
const props: CitationsProps = { citations };
<Citations {...props} label="Evidence" />;
// @ts-expect-error Citation list is readonly.
props.citations.push({ id: 'b', index: 2 });
// @ts-expect-error Borrowed fields remain readonly.
props.citations[0].title = 'Changed';
// @ts-expect-error Citation metadata is required.
<Citations />;
// @ts-expect-error Presentation does not accept an owner or commands.
<Citations citations={citations} onSelect={() => undefined} />;
