import {
  createMarkdown,
  type MarkdownSnapshot,
} from '@threadplane/content/markdown';
import {
  Markdown,
  MarkdownComponentsProvider,
  type MarkdownComponentProps,
  type MarkdownComponents,
  type MarkdownProps,
} from './index.js';
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
function CodeBlock({ node, defaultView }: MarkdownComponentProps<'code-block'>) {
  const text: string = node.text;
  return (
    <>
      {text}
      {defaultView}
    </>
  );
}
function Link({ node, url }: MarkdownComponentProps<'link'>) {
  const safe: string | undefined = url;
  return <a href={safe}>{node.title}</a>;
}
const components: MarkdownComponents = { 'code-block': CodeBlock, link: Link };
<Markdown snapshot={snapshot} components={components} />;
<MarkdownComponentsProvider components={components}>
  <Markdown snapshot={snapshot} />
</MarkdownComponentsProvider>;
// @ts-expect-error A code-block replacement cannot stand in for a link.
const mismatched: MarkdownComponents = { link: CodeBlock };
// @ts-expect-error Only parser node types can be replaced.
const unknownType: MarkdownComponents = { 'code-fence': CodeBlock };
// @ts-expect-error The map is readonly.
components.link = Link;
export function readonlyInput(value: MarkdownSnapshot) {
  // @ts-expect-error Nested document is readonly.
  value.document.content = 'changed';
  if (value.root) {
    // @ts-expect-error Owned nodes cannot be changed by a view.
    value.root.children.pop();
  }
}
