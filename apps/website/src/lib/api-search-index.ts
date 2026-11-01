import { readApiIndex, readApiSymbol } from './api-reference';
import type { ApiIndex, ApiMember, ApiSymbol } from './api-reference-model';
import type { IndexedDoc } from './docs-search-query';

function declarationText(member: ApiMember): string {
  return [
    member.excerptTokens.map((token) => token.text).join(''),
    member.docs.summary,
    member.docs.remarks,
    member.docs.returns,
    ...member.docs.params.map((parameter) => parameter.description),
    ...member.members.map(declarationText),
  ]
    .join(' ')
    .replace(/\s+/gu, ' ');
}

/** Index signature text explicitly; the prose index deliberately drops fences. */
export function buildApiSearchIndex(
  index: ApiIndex = readApiIndex(),
  load: (entrypointId: string, name: string) => ApiSymbol | null = readApiSymbol
): IndexedDoc[] {
  return index.symbols.map((summary) => {
    const symbol = load(summary.entrypointId, summary.name);
    if (!symbol) throw new Error(`API search symbol missing: ${summary.href}`);
    const entrypoint = index.entrypoints.find(
      (entry) => entry.id === summary.entrypointId
    );
    return {
      href: summary.href,
      library: entrypoint?.docLibrary ?? entrypoint?.project ?? 'api',
      libraryTitle: entrypoint?.importPath ?? summary.entrypointId,
      section: 'api',
      slug: summary.name,
      title: summary.name,
      sections: [
        {
          heading: null,
          anchor: null,
          text: `${entrypoint?.importPath ?? ''} ${symbol.declarations
            .map(declarationText)
            .join(' ')}`,
        },
      ],
    };
  });
}
