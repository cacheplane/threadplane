import {
  DocExcerpt,
  DocLinkTag,
  type DocDeclarationReference,
  type DocNode,
  TSDocParser,
} from '@microsoft/tsdoc';
import type { ApiDocs } from '../../src/lib/api-reference-model';
import { assertPublicDocOutput } from '../public-doc-projection';
const parser = new TSDocParser();

/** Parse TSDoc declaration syntax, including import paths and selectors. */
export function parseDocReference(
  reference: string
): DocDeclarationReference | undefined {
  const parsed = parser.parseString(`/** {@link ${reference}} */`);
  if (parsed.log.messages.length) return undefined;
  let result: DocDeclarationReference | undefined;
  const visit = (node: DocNode): void => {
    if (node instanceof DocLinkTag) result = node.codeDestination;
    else node.getChildNodes().forEach(visit);
  };
  visit(parsed.docComment);
  return result;
}

function render(node?: DocNode): string {
  if (!node) return '';
  if (node instanceof DocLinkTag) {
    const destination =
      node.urlDestination ?? node.codeDestination?.emitAsTsdoc() ?? '';
    return `{@link ${destination}${
      node.linkText ? ` | ${node.linkText}` : ''
    }}`;
  }
  if (node instanceof DocExcerpt) return node.content.toString();
  return node.getChildNodes().map(render).join('');
}
export function parseDocs(comment: string): ApiDocs {
  assertPublicDocOutput('source TSDoc', comment);
  const parsed = parser.parseString(comment).docComment;
  const block = (node?: DocNode) =>
    render(node)
      .replace(/^@\w+\s*/, '')
      .trim();
  return {
    summary: block(parsed.summarySection),
    remarks: block(parsed.remarksBlock),
    deprecated: block(parsed.deprecatedBlock),
    returns: block(parsed.returnsBlock),
    examples: parsed.customBlocks
      .filter((item) => item.blockTag.tagName === '@example')
      .map(block),
    see: parsed.seeBlocks.map(block),
    params: parsed.params.blocks.map((item) => ({
      name: item.parameterName,
      description: block(item.content),
    })),
    typeParams: parsed.typeParams.blocks.map((item) => ({
      name: item.parameterName,
      description: block(item.content),
    })),
  };
}
