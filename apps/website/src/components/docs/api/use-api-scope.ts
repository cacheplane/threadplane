'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  apiSymbolHref,
  type ApiEntrypoint,
  type ApiFramework,
} from '../../../lib/api-reference-model';

export type ApiScope = ApiFramework | 'all';
export const API_SCOPES: ReadonlyArray<{ value: ApiScope; label: string }> = [
  { value: 'all', label: 'All frameworks' },
  { value: 'angular', label: 'Angular' },
  { value: 'react', label: 'React' },
  { value: 'shared', label: 'Shared TypeScript' },
  { value: 'backend', label: 'Backend' },
];

export function apiRouteScope(
  entrypoints: readonly ApiEntrypoint[],
  pathname: string
): ApiScope {
  return (
    [...entrypoints]
      .sort((a, b) => b.id.length - a.id.length)
      .find(
        (entry) =>
          pathname === apiSymbolHref(entry.id) ||
          pathname.startsWith(`${apiSymbolHref(entry.id)}/`)
      )?.framework ?? 'all'
  );
}

/** URL state reaches both the persistent workspace and its registered article. */
export function useApiScope(
  entrypoints: readonly ApiEntrypoint[],
  activeHref?: string
) {
  const pathname = usePathname() ?? '/docs/api';
  const params = useSearchParams();
  const router = useRouter();
  const routeScope = apiRouteScope(entrypoints, activeHref ?? pathname);
  const requested = params?.get('apiFramework');
  const scope =
    routeScope !== 'all'
      ? routeScope
      : API_SCOPES.find((item) => item.value === requested)?.value ?? 'all';
  const chooseScope = (next: ApiScope) => {
    const query = new URLSearchParams(params?.toString());
    if (next === 'all') query.delete('apiFramework');
    else query.set('apiFramework', next);
    const target = `${routeScope === 'all' ? pathname : '/docs/api'}${
      query.size ? `?${query}` : ''
    }${window.location.hash}`;
    if (routeScope === 'all') window.history.pushState(null, '', target);
    else router.push(target);
  };
  return { scope, chooseScope };
}
