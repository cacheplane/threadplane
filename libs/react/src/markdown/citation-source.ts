import type { Citation } from '@threadplane/core';
import type {
  CitationDefinition,
  MarkdownNode,
} from '@threadplane/content/markdown';

function literalText(node: MarkdownNode): string {
  if ('text' in node) return node.text;
  if ('children' in node) return node.children.map(literalText).join('');
  return '';
}

/** Convert borrowed definition metadata without interpreting HTML or resolving destinations. */
export function definitionToCitation(definition: CitationDefinition): Citation {
  let url: string | undefined;
  const title: string[] = [];
  const snippet: string[] = [];
  for (const child of definition.children) {
    if (
      url === undefined &&
      (child.type === 'link' || child.type === 'autolink')
    ) {
      url = child.url;
      continue;
    }
    (url === undefined ? title : snippet).push(literalText(child));
  }
  return {
    id: definition.id,
    index: definition.index,
    title: title.join('').trim() || undefined,
    url,
    snippet: snippet.join('').trim() || undefined,
  };
}
