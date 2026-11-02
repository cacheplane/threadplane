// @vitest-environment node
import { expect, it } from 'vitest';
import { buildApiSearchIndex } from './api-search-index';
import { searchIndexedDocs } from './docs-search-query';
import type { ApiIndex, ApiSymbol } from './api-reference-model';

it('indexes extracted declarations and returns canonical import-path-qualified URLs', () => {
  const entry = {
    id: 'react/chat',
    framework: 'react',
    importPath: '@threadplane/react/chat',
  };
  const symbol = {
    name: 'Chat',
    entrypointId: entry.id,
    href: '/docs/api/react/chat/Chat',
    summary: 'Conversation',
    declarations: [
      {
        excerptTokens: [
          {
            text: 'export function Chat(props: ConversationOptions): ReactNode;',
          },
        ],
        docs: { summary: 'Conversation', remarks: '', returns: '', params: [] },
        members: [],
      },
    ],
  } as unknown as ApiSymbol;
  const index = {
    schemaVersion: 1,
    entrypoints: [entry],
    symbols: [symbol],
    undocumented: [],
  } as unknown as ApiIndex;
  const documents = buildApiSearchIndex(index, () => symbol);
  const result = searchIndexedDocs(documents, 'ConversationOptions');
  expect(result[0]?.href).toBe(symbol.href);
  expect(result[0]?.libraryTitle).toBe('@threadplane/react/chat');
});
