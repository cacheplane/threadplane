import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiSymbolView } from './ApiSymbolView';
import type {
  ApiEntrypoint,
  ApiMember,
  ApiSymbol,
  ApiToken,
} from '../../../lib/api-reference-model';

vi.mock('./ApiCode', () => ({
  ApiCode: ({ tokens }: { tokens: ApiToken[] }) => (
    <pre>{tokens.map((token) => token.text).join('')}</pre>
  ),
}));
afterEach(cleanup);

it('shows every documented overload even when the first declaration has no summary', async () => {
  const declaration = (summary: string, overloadIndex: number): ApiMember => ({
    name: 'read',
    kind: 'Function',
    overloadIndex,
    canonicalReference: `pkg!read:function(${overloadIndex})`,
    excerptTokens: [{ kind: 'Content', text: 'function read(): void;' }],
    members: [],
    docs: {
      summary,
      remarks: '',
      deprecated: '',
      returns: '',
      examples: [],
      see: [],
      params: [],
      typeParams: [],
    },
  });
  const symbol: ApiSymbol = {
    name: 'read',
    entrypointId: 'fixture',
    kind: 'Function',
    href: '/docs/api/fixture/read',
    canonicalReference: 'pkg!read:function',
    isDeprecated: false,
    summary: '',
    declarations: [
      declaration('', 1),
      declaration('Read a string.', 2),
      declaration('Read a number.', 3),
    ],
  };
  const entrypoint: ApiEntrypoint = {
    id: 'fixture',
    importPath: '@fixture/sdk',
    packageName: '@fixture/sdk',
    project: 'fixture',
    framework: 'shared',
    version: '1.0.0',
    status: 'published',
  };
  render(await ApiSymbolView({ symbol, entrypoint }));
  expect(screen.getAllByText('Read a string.').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Read a number.').length).toBeGreaterThan(0);
  expect(screen.queryByText(/has no source documentation/)).toBeNull();
});
