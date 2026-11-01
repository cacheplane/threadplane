// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import ts from 'typescript';
import {
  apiSourceUrl,
  apiMemberCode,
  apiImport,
  apiSymbolMarkdown,
  readApiIndex,
  readApiSymbol,
  resolveApiPage,
} from './api-reference';
import type { ApiIndex, ApiSymbol } from './api-reference-model';
import { apiSymbolFileName } from './api-reference-model';

const entry = {
  id: 'react/chat',
  importPath: '@threadplane/react/chat',
  packageName: '@threadplane/react',
  project: 'react',
  framework: 'react',
  version: '0.0.0',
  status: 'development',
} as const;
const symbol: ApiSymbol = {
  name: 'Chat',
  entrypointId: entry.id,
  kind: 'Function',
  href: '/docs/api/react/chat/Chat',
  canonicalReference: '@threadplane/react!Chat:function',
  isDeprecated: false,
  summary: 'A chat surface.',
  declarations: [
    {
      name: 'Chat',
      kind: 'Function',
      canonicalReference: '@threadplane/react!Chat:function(1)',
      excerptTokens: [
        {
          kind: 'Content',
          text: 'export declare function Chat(props: ChatProps): ReactNode;',
        },
      ],
      members: [],
      docs: {
        summary: 'A chat surface.',
        remarks: '',
        deprecated: '',
        returns: 'The conversation.',
        examples: ['```tsx\n<Chat />\n```'],
        see: [],
        params: [],
        typeParams: [],
      },
    },
  ],
};
const index: ApiIndex = {
  schemaVersion: 1,
  entrypoints: [entry],
  symbols: [symbol],
  undocumented: [],
};
const directories: string[] = [];
afterEach(() =>
  directories
    .splice(0)
    .forEach((directory) => rmSync(directory, { recursive: true, force: true }))
);

describe('generated API reference consumers', () => {
  it('copies a type-only namespace import for a namespace type member', () => {
    expect(
      apiImport(
        {
          ...symbol,
          name: 'Tools.Options',
          kind: 'Interface',
          isTypeOnly: true,
        },
        entry
      )
    ).toBe("import type { Tools } from '@threadplane/react/chat';");
  });
  it('renders enum containers as valid TypeScript declarations', () => {
    const member = {
      ...symbol.declarations[0],
      name: 'State',
      kind: 'Enum',
      excerptTokens: [
        { kind: 'Content' as const, text: 'export declare enum State' },
      ],
      members: [
        {
          ...symbol.declarations[0],
          name: 'Ready',
          kind: 'EnumMember',
          excerptTokens: [{ kind: 'Content' as const, text: 'Ready = 1' }],
        },
        {
          ...symbol.declarations[0],
          name: 'Done',
          kind: 'EnumMember',
          excerptTokens: [{ kind: 'Content' as const, text: 'Done = 2' }],
        },
      ],
    };
    const result = ts.transpileModule(apiMemberCode(member), {
      reportDiagnostics: true,
    });
    expect(
      result.diagnostics?.map((diagnostic) => diagnostic.messageText)
    ).toEqual([]);
  });
  it('resolves indexes, exact subpath symbols, and unknown paths', () => {
    expect(resolveApiPage([], index)?.kind).toBe('index');
    expect(resolveApiPage(['react', 'chat'], index)?.kind).toBe('index');
    expect(resolveApiPage(['react', 'chat', 'Chat'], index)?.kind).toBe(
      'symbol'
    );
    expect(resolveApiPage(['react', 'Chat'], index)).toBeNull();
    expect(resolveApiPage(['..', 'Chat'], index)).toBeNull();
  });

  it('reads only registered symbol paths from the generated artifacts', () => {
    const root = mkdtempSync(join(tmpdir(), 'api-reader-'));
    directories.push(root);
    mkdirSync(join(root, 'react', 'chat'), { recursive: true });
    writeFileSync(join(root, 'index.json'), JSON.stringify(index));
    writeFileSync(
      join(root, 'react', 'chat', apiSymbolFileName('Chat')),
      JSON.stringify(symbol)
    );
    expect(readApiIndex(root).entrypoints).toEqual([entry]);
    expect(readApiSymbol('react/chat', 'Chat', root)).toEqual(symbol);
    expect(readApiSymbol('../escape', 'index', root)).toBeNull();
    expect(readApiSymbol('react/chat', 'Unknown', root)).toBeNull();
  });

  it('exports declaration-based markdown with development status and examples', () => {
    const markdown = apiSymbolMarkdown(symbol, entry);
    expect(markdown).toContain('@threadplane/react/chat');
    expect(markdown).toContain('Unpublished development API');
    expect(markdown).toContain(
      'export declare function Chat(props: ChatProps): ReactNode;'
    );
    expect(markdown).toContain('<Chat />');
    expect(markdown).toContain('The conversation.');
  });

  it('pins source links to a revision without accepting paths outside the repository', () => {
    const revision = 'a'.repeat(40);
    expect(
      apiSourceUrl({ path: 'libs/react/src/chat/chat.tsx', line: 12 }, revision)
    ).toBe(
      `https://github.com/cacheplane/threadplane/blob/${revision}/libs/react/src/chat/chat.tsx#L12`
    );
    expect(apiSourceUrl({ path: '../secret', line: 1 }, revision)).toBeNull();
  });
});
