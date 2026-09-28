import {
  createMarkdown,
  type MarkdownSnapshot,
} from '@threadplane/content/markdown';
import { Markdown, type MarkdownProps } from './index.js';
const snapshot = createMarkdown({
  generation: 'a',
  phase: 'complete',
  content: '',
}).getSnapshot();
const props: MarkdownProps = { snapshot };
<Markdown {...props} />;
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
