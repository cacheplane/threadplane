import {
  createMarkdown,
  type Markdown,
  type MarkdownDocument,
  type MarkdownNode,
} from '@threadplane/content/markdown';
import { useAgent } from '@threadplane/react';
import { observeAgent } from '@threadplane/angular';

const initial = {
  generation: 'a',
  phase: 'streaming',
  content: 'text',
} as const satisfies MarkdownDocument;
const owner: Markdown = createMarkdown(initial);
const snapshot = owner.getSnapshot();
export function bindings() {
  const react = useAgent(owner),
    angular = observeAgent(owner)();
  const same: typeof react = angular;
  // @ts-expect-error No backend message aggregate.
  void react.messages;
  // @ts-expect-error Framework inference preserves readonly input.
  angular.document.content = 'changed';
  return same;
}
export function nodeContracts(node: MarkdownNode) {
  const parent: null = node.parent;
  void parent;
  if (node.type === 'list-item' && node.task) {
    // @ts-expect-error Nested task is readonly.
    node.task.checked = true;
  }
  if (node.type === 'table') {
    // @ts-expect-error Nested alignments are readonly.
    node.alignments[0] = null;
  }
}
if (snapshot.root) {
  // @ts-expect-error Children are readonly.
  snapshot.root.children.pop();
  // @ts-expect-error Definitions expose no mutator.
  snapshot.root.linkDefinitions.clear();
  snapshot.root.linkDefinitions.forEach((value, _key, map) => {
    // @ts-expect-error Definition values are readonly.
    value.url = '/other';
    // @ts-expect-error Callback map is also readonly.
    map.delete('a');
  });
  const citation = snapshot.root.citations.get('ref');
  if (citation) {
    // @ts-expect-error Definition children are readonly.
    citation.children.length = 0;
  }
}
// @ts-expect-error Public factory does not expose its private parser seam.
createMarkdown(initial, { createParser: () => null });
// @ts-expect-error Missing phase is not defaulted.
owner.update({ generation: 'a', content: 'x' });
// @ts-expect-error Plain text required.
owner.update({ generation: 'a', phase: 'streaming', content: {} });
