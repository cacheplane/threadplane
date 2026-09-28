import {
  createMarkdown,
  type MarkdownDocument,
  type MarkdownNode,
} from './index.js';

const input = {
  generation: 'a',
  phase: 'streaming',
  content: '- [ ] task',
} as const satisfies MarkdownDocument;
const owner = createMarkdown(input, { violationPolicy: 'rebuild' });
const snapshot = owner.getSnapshot();
// @ts-expect-error Accepted document is immutable.
snapshot.document.content = 'changed';
// @ts-expect-error No public parser factory.
createMarkdown(input, { createParser: () => null });
// @ts-expect-error No implicit streaming phase.
createMarkdown({ generation: 'a', content: 'text' });
// @ts-expect-error Content is primitive text.
owner.update({ generation: 'a', phase: 'streaming', content: 4 });
// @ts-expect-error No model or backend configuration.
createMarkdown(input, { model: 'anything' });
if (snapshot.root) {
  // @ts-expect-error Child arrays are readonly.
  snapshot.root.children.push(snapshot.root.children[0]);
  // @ts-expect-error Definitions expose no mutator.
  snapshot.root.linkDefinitions.clear();
  const link = snapshot.root.linkDefinitions.get('ref');
  if (link) {
    // @ts-expect-error Definition records are readonly.
    link.url = '/changed';
  }
  const citation = snapshot.root.citations.get('ref');
  if (citation) {
    // @ts-expect-error Definition child arrays are readonly.
    citation.children.length = 0;
    // @ts-expect-error Definition fields are readonly.
    citation.status = 'complete';
  }
  snapshot.root.linkDefinitions.forEach((_value, _key, map) => {
    // @ts-expect-error The callback also receives only readonly map behavior.
    map.delete('ref');
  });
}
// @ts-expect-error Root is immutable (after nested probes to avoid narrowing them).
snapshot.root = null;
export function checkNode(node: MarkdownNode): void {
  const parent: null = node.parent;
  void parent;
  // @ts-expect-error Published status is immutable.
  node.status = 'complete';
  if (node.type === 'list-item' && node.task) {
    // @ts-expect-error Nested task is immutable.
    node.task.checked = true;
  }
  if (node.type === 'table') {
    // @ts-expect-error Alignment array is immutable.
    node.alignments[0] = 'right';
  }
  if (node.type === 'link-reference') {
    const url: string = node.url;
    const resolved: boolean = node.resolved;
    void url;
    void resolved;
  }
}
