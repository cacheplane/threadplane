import type { Citation } from '@threadplane/core';
import { InlinePreview } from './inline-preview.js';
import {
  markdownUrl,
  type CitationDefinition,
  type MarkdownNode,
} from '@threadplane/content/markdown';

function literalText(node: MarkdownNode): string {
  if ('text' in node) return node.text;
  if ('children' in node) return node.children.map(literalText).join('');
  return '';
}

function fromDefinition(definition: CitationDefinition): Citation {
  const parts: string[] = [];
  let url: string | undefined;
  for (const child of definition.children) {
    if (child.type === 'link' || child.type === 'autolink') {
      url = child.url;
      break;
    }
    parts.push(literalText(child));
  }
  return {
    id: definition.id,
    index: definition.index,
    title: parts.join('').trim() || undefined,
    url,
  };
}

export function InlineCitation({
  refId,
  sources,
  definitions,
  insideAnchor,
  preview = false,
}: {
  readonly refId: string;
  readonly sources: ReadonlyMap<string, Citation>;
  readonly definitions: ReadonlyMap<string, CitationDefinition>;
  readonly insideAnchor: boolean;
  readonly preview?: boolean;
}) {
  const definition = definitions.get(refId);
  const citation =
    sources.get(refId) ?? (definition && fromDefinition(definition));
  if (!citation)
    return <sup aria-label={`Unresolved citation ${refId}`}>[^{refId}]</sup>;
  const label = `Citation ${citation.index}${
    citation.title ? `: ${citation.title}` : ''
  }`;
  if (preview === true && !insideAnchor)
    return (
      <InlinePreview key={citation.id} citation={citation} label={label} />
    );
  const href =
    !insideAnchor && citation.url !== undefined
      ? markdownUrl(citation.url, 'link')
      : undefined;
  return href === undefined ? (
    <sup aria-label={label}>[{citation.index}]</sup>
  ) : (
    <sup>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${label} (opens in new tab)`}
      >
        [{citation.index}]
      </a>
    </sup>
  );
}
