import {
  createMarkdown,
  type MarkdownSnapshot,
} from '@threadplane/content/markdown';
import { Markdown, type MarkdownProps } from './index.js';
import type { Citation } from '@threadplane/core';
const snapshot = createMarkdown({
  generation: 'a',
  phase: 'complete',
  content: '',
}).getSnapshot();
const props: MarkdownProps = { snapshot };
<Markdown {...props} />;
const citations: readonly Citation[] = [{ id: 'source', index: 1 }];
const sourced: MarkdownProps = { snapshot, citations };
<Markdown {...sourced} />;
const preview: MarkdownProps = { snapshot, citations, citationPreview: true };
<Markdown {...preview} />;
// @ts-expect-error Preview opt-in is readonly.
preview.citationPreview = false;
// @ts-expect-error Preview opt-in accepts a boolean only.
<Markdown snapshot={snapshot} citationPreview="true" />;
// @ts-expect-error Props are readonly.
sourced.citations = [];
// @ts-expect-error Citation identity is required.
<Markdown snapshot={snapshot} citations={[{ index: 1 }]} />;
// @ts-expect-error Whole accepted snapshot is required.
<Markdown />;
// @ts-expect-error String parsing is not a view responsibility.
<Markdown snapshot="text" />;
// @ts-expect-error No owner convenience prop.
<Markdown snapshot={snapshot} owner={{}} />;
// @ts-expect-error Props are readonly.
props.snapshot = snapshot;
export function readonlyInput(value: MarkdownSnapshot) {
  // @ts-expect-error Nested document is readonly.
  value.document.content = 'changed';
  if (value.root) {
    // @ts-expect-error Owned nodes cannot be changed by a view.
    value.root.children.pop();
  }
}
