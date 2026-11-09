import { renderHook, act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRouteScope, useApiScope } from './use-api-scope';
import type { ApiEntrypoint } from '../../../lib/api-reference-model';

const navigation = vi.hoisted(() => ({
  pathname: '/docs/api',
  search: '',
  push: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
  useRouter: () => ({ push: navigation.push }),
}));
const entrypoints = [
  { id: 'react', framework: 'react' },
  { id: 'react/chat', framework: 'react' },
  { id: 'core', framework: 'shared' },
  { id: 'middleware/langgraph', framework: 'backend' },
] as ApiEntrypoint[];
beforeEach(() => {
  navigation.pathname = '/docs/api';
  navigation.search = '';
  navigation.push.mockClear();
  window.history.replaceState(null, '', '/docs/api');
});
afterEach(cleanup);

describe('API scope routing', () => {
  it('follows URL scope and safely falls back for invalid values', () => {
    navigation.search = 'apiFramework=react';
    const hook = renderHook(() => useApiScope(entrypoints));
    expect(hook.result.current.scope).toBe('react');
    navigation.search = 'apiFramework=unknown';
    hook.rerender();
    expect(hook.result.current.scope).toBe('all');
  });
  it.each([
    ['/docs/api/react/chat/Chat', 'react'],
    ['/docs/api/core/AgentSession', 'shared'],
    ['/docs/api/middleware/langgraph', 'backend'],
  ])(
    'uses the explicit package identity for %s even with a conflicting query',
    (path, scope) => {
      navigation.pathname = path;
      navigation.search = 'apiFramework=angular';
      expect(apiRouteScope(entrypoints, path)).toBe(scope);
      expect(
        renderHook(() => useApiScope(entrypoints)).result.current.scope
      ).toBe(scope);
    }
  );
  it('preserves unrelated query parameters and fragments for same-page scope changes', () => {
    navigation.search = 'mode=api&keep=yes';
    window.history.replaceState(
      null,
      '',
      '/docs/api?mode=api&keep=yes#reference'
    );
    const hook = renderHook(() => useApiScope(entrypoints));
    act(() => hook.result.current.chooseScope('react'));
    expect(window.location.search).toBe(
      '?mode=api&keep=yes&apiFramework=react'
    );
    expect(window.location.hash).toBe('#reference');
  });
  it('returns to the index when changing the scope of an explicit package', () => {
    navigation.pathname = '/docs/api/react/chat/Chat';
    const hook = renderHook(() => useApiScope(entrypoints));
    act(() => hook.result.current.chooseScope('angular'));
    expect(navigation.push).toHaveBeenCalledWith(
      '/docs/api?apiFramework=angular'
    );
  });
});
