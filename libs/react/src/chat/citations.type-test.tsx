import { Citations, type CitationsProps } from './index.js';
import type { Citation } from '@threadplane/core';
import { createMarkdown } from '@threadplane/content/markdown';
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
<Citations citations={citations} preview />;
<Citations citations={citations} preview={false} />;
// @ts-expect-error Preview requires a boolean flag.
<Citations citations={citations} preview="true" />;
// @ts-expect-error The preview prop is readonly.
props.preview = true;
<Citations citations={citations} collapsible />;
<Citations citations={citations} collapsible={false} />;
// @ts-expect-error Collapsible requires a boolean flag.
<Citations citations={citations} collapsible="true" />;
// @ts-expect-error The collapsible prop is readonly.
props.collapsible = true;
// @ts-expect-error Disclosure state is local and cannot be controlled.
<Citations citations={citations} expanded />;
const owner = createMarkdown({
  generation: 'a',
  phase: 'complete',
  content: '',
});
const snapshot = owner.getSnapshot();
<Citations citations={citations} snapshot={snapshot} />;
<Citations citations={citations} snapshot={undefined} />;
// @ts-expect-error Snapshot is borrowed and readonly.
props.snapshot = snapshot;
// @ts-expect-error A string is not an accepted snapshot.
<Citations citations={citations} snapshot="markdown" />;
// @ts-expect-error Owners are not snapshots.
<Citations citations={citations} snapshot={owner} />;
// @ts-expect-error Snapshot metadata remains readonly.
snapshot.root = null;
owner.dispose();
