// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  apiSymbolHref,
  apiSymbolFileName,
  filterApiSymbols,
  apiMemberAnchor,
} from './api-reference-model';

describe('API reference identity and discovery', () => {
  it('keeps subpaths and duplicate exported names distinct', () => {
    expect(apiSymbolHref('react/chat', 'Chat')).toBe(
      '/docs/api/react/chat/Chat'
    );
    expect(apiSymbolHref('chat', 'Chat')).toBe('/docs/api/chat/Chat');
    expect(apiSymbolHref('core', 'Tools.define')).toBe(
      '/docs/api/core/Tools.define'
    );
    expect(() => apiSymbolHref('../escape', 'Chat')).toThrow();
    expect(apiSymbolFileName('A2uiClientCapabilities').toLowerCase()).not.toBe(
      apiSymbolFileName('a2uiClientCapabilities').toLowerCase()
    );
  });

  it('distinguishes static, instance and overload member anchors', () => {
    expect(apiMemberAnchor({ name: 'read', isStatic: true }, 1)).not.toBe(
      apiMemberAnchor({ name: 'read', isStatic: false }, 1)
    );
    expect(apiMemberAnchor({ name: 'read' }, 1)).not.toBe(
      apiMemberAnchor({ name: 'read' }, 2)
    );
    const member = {
      name: 'read',
      canonicalReference: '@threadplane/core!Client.read:member(1)',
    };
    expect(apiMemberAnchor(member, 1)).toBe(apiMemberAnchor(member, 9));
  });

  it('keeps deprecated and development symbols discoverable', () => {
    const symbols = [
      {
        name: 'Chat',
        entrypointId: 'react/chat',
        kind: 'Function',
        isDeprecated: true,
      },
      {
        name: 'ChatComponent',
        entrypointId: 'chat',
        kind: 'Class',
        isDeprecated: false,
      },
    ];
    const entries = [
      { id: 'react/chat', framework: 'react', status: 'development' },
      { id: 'chat', framework: 'angular', status: 'published' },
    ];
    expect(
      filterApiSymbols(symbols, entries, { query: 'chat', framework: 'react' })
    ).toEqual([symbols[0]]);
    expect(
      filterApiSymbols(symbols, entries, { query: '', framework: 'all' })
    ).toEqual(symbols);
  });
  it('keeps the dedicated shared and backend filters distinct', () => {
    const symbols = [
      { name: 'Protocol', entrypointId: 'core', kind: 'Interface' },
      {
        name: 'Middleware',
        entrypointId: 'middleware/langgraph',
        kind: 'Function',
      },
    ];
    const entries = [
      { id: 'core', framework: 'shared' as const },
      { id: 'middleware/langgraph', framework: 'backend' as const },
    ];
    expect(filterApiSymbols(symbols, entries, { framework: 'shared' })).toEqual(
      [symbols[0]]
    );
    expect(
      filterApiSymbols(symbols, entries, { framework: 'backend' })
    ).toEqual([symbols[1]]);
  });
});
