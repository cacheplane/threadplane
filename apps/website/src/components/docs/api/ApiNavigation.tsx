'use client';

import Link from 'next/link';
import { Suspense } from 'react';
import { ApiNavigationWindow } from './ApiNavigationWindow';
import {
  apiSymbolHref,
  matchesApiFramework,
  type ApiEntrypoint,
  type ApiSymbolSummary,
} from '../../../lib/api-reference-model';
import { ApiScopePicker } from './ApiScopePicker';
import { apiRouteScope, useApiScope, type ApiScope } from './use-api-scope';

export interface ApiNavigationProps {
  entrypoints: ApiEntrypoint[];
  symbols: Pick<
    ApiSymbolSummary,
    'name' | 'entrypointId' | 'href' | 'isDeprecated'
  >[];
  activeHref: string;
}

/** Generated import-path tree shared by desktop and mobile docs navigation. */
type NavigationProps = ApiNavigationProps & {
  onNavigate?: () => void;
  resolveHref?: (href: string) => string;
};

const libraryNames: Record<string, string> = {
  'ag-ui': 'AG-UI',
  a2ui: 'A2UI',
  angular: 'Angular',
  react: 'React',
  chat: 'Chat',
  content: 'Content',
  core: 'Core',
  langgraph: 'LangGraph',
  middleware: 'Middleware',
  render: 'Render',
  telemetry: 'Telemetry',
};

export function ApiNavigation(props: NavigationProps) {
  return (
    <Suspense
      fallback={
        <ApiNavigationContent
          {...props}
          scope={apiRouteScope(props.entrypoints, props.activeHref)}
        />
      }
    >
      <ScopedApiNavigation {...props} />
    </Suspense>
  );
}

function ScopedApiNavigation(props: NavigationProps) {
  const { scope, chooseScope } = useApiScope(
    props.entrypoints,
    props.activeHref
  );
  return (
    <ApiNavigationContent
      {...props}
      scope={scope}
      onScopeChange={chooseScope}
    />
  );
}

function ApiNavigationContent({
  entrypoints,
  symbols,
  activeHref,
  onNavigate,
  resolveHref = (href) => href,
  scope,
  onScopeChange,
}: NavigationProps & {
  scope: ApiScope;
  onScopeChange?: (scope: ApiScope) => void;
}) {
  const groups = new Map<string, ApiEntrypoint[]>();
  for (const entry of entrypoints.filter((item) =>
    matchesApiFramework(item.framework, scope)
  )) {
    const family = entry.docLibrary ?? entry.packageName;
    groups.set(family, [...(groups.get(family) ?? []), entry]);
  }
  const libraries = [...groups]
    .map(([id, entries]) => ({
      id,
      label: libraryNames[id] ?? id,
      entries,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const activeEntry = entrypoints
    .filter(
      (entry) =>
        activeHref === apiSymbolHref(entry.id) ||
        activeHref.startsWith(`${apiSymbolHref(entry.id)}/`)
    )
    .sort((a, b) => b.id.length - a.id.length)[0];
  return (
    <>
      {onScopeChange ? (
        <ApiScopePicker value={scope} onChange={onScopeChange} />
      ) : null}
      <nav className="api-reference-navigation" aria-label="API reference">
        <div className="api-navigation-shortcuts">
          <Link
            href={resolveHref('/docs/api')}
            onClick={onNavigate}
            aria-current={activeHref === '/docs/api' ? 'page' : undefined}
          >
            All APIs
          </Link>
          <Link href={resolveHref('/docs')} onClick={onNavigate}>
            Guides and examples
          </Link>
        </div>
        <ApiNavigationWindow
          key={`${scope}:${activeHref}`}
          libraries={libraries}
          symbols={symbols}
          activeEntryId={activeEntry?.id}
          activeHref={activeHref}
          resolveHref={resolveHref}
          onNavigate={onNavigate}
        />
      </nav>
    </>
  );
}
