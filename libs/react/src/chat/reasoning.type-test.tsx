import type { MarkdownSnapshot } from '@threadplane/content/markdown';
import { Reasoning, type ReasoningProps } from './index.js';
declare const snapshot: MarkdownSnapshot;
const props: ReasoningProps = {
  snapshot,
  durationMs: 1234,
  label: 'Analysis',
  defaultExpanded: true,
  className: 'custom',
};
<Reasoning {...props} />;
// @ts-expect-error Snapshot is required.
<Reasoning />;
// @ts-expect-error Raw text is not an owned snapshot.
<Reasoning snapshot="Why" />;
// @ts-expect-error Duration must be a number supplied by the app.
<Reasoning snapshot={snapshot} durationMs="1s" />;
// @ts-expect-error Presentation props are readonly.
props.defaultExpanded = false;
