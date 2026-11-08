'use client';

import Link from 'next/link';
import { Suspense, useEffect, useId, useRef, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import {
  apiSymbolHref,
  filterApiSymbols,
  matchesApiFramework,
  type ApiIndex,
} from '../../../lib/api-reference-model';
import {
  API_SCOPES,
  apiRouteScope,
  useApiScope,
  type ApiScope,
} from './use-api-scope';

interface ApiIndexProps {
  index: ApiIndex;
  entrypointId?: string;
  standalone?: boolean;
}

/** Searchable SDK index; deprecated and unpublished declarations stay visible. */
export function ApiIndexView(props: ApiIndexProps) {
  if (!props.standalone) return <ApiIndexContent {...props} />;
  const initialScope = props.entrypointId
    ? apiRouteScope(props.index.entrypoints, apiSymbolHref(props.entrypointId))
    : 'all';
  return (
    <Suspense fallback={<ApiIndexContent {...props} scope={initialScope} />}>
      <StandaloneApiIndex {...props} />
    </Suspense>
  );
}

function StandaloneApiIndex(props: ApiIndexProps) {
  const { scope, chooseScope } = useApiScope(props.index.entrypoints);
  return (
    <ApiIndexContent {...props} scope={scope} onScopeChange={chooseScope} />
  );
}

function ApiIndexContent({
  index,
  entrypointId,
  scope,
  onScopeChange,
}: ApiIndexProps & {
  scope?: ApiScope;
  onScopeChange?: (scope: ApiScope) => void;
}) {
  const [query, setQuery] = useState('');
  const [localScope, setLocalScope] = useState<ApiScope>('all');
  const framework = scope ?? localScope;
  const [entrypoint, setEntrypoint] = useState(entrypointId ?? '');
  const [kind, setKind] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const entries = index.entrypoints.filter((entry) =>
    matchesApiFramework(entry.framework, framework)
  );
  const effectiveEntrypoint = entries.some((entry) => entry.id === entrypoint)
    ? entrypoint
    : '';
  const kinds = [
    ...new Set(
      filterApiSymbols(index.symbols, index.entrypoints, { framework }).map(
        (symbol) => symbol.kind
      )
    ),
  ].sort();
  const effectiveKind = kinds.includes(kind) ? kind : '';
  useEffect(() => {
    if (
      kind &&
      !filterApiSymbols(index.symbols, index.entrypoints, { framework }).some(
        (symbol) => symbol.kind === kind
      )
    )
      setKind('');
  }, [framework, kind, index.symbols, index.entrypoints]);
  useEffect(() => {
    if (
      entrypoint &&
      !index.entrypoints.some(
        (entry) =>
          entry.id === entrypoint &&
          matchesApiFramework(entry.framework, framework)
      )
    )
      setEntrypoint('');
  }, [framework, entrypoint, index.entrypoints]);
  const changeFramework = (value: ApiScope) => {
    if (
      !index.entrypoints.some(
        (entry) =>
          entry.id === entrypoint && matchesApiFramework(entry.framework, value)
      )
    )
      setEntrypoint('');
    if (onScopeChange) onScopeChange(value);
    else setLocalScope(value);
  };
  const reset = () => {
    setQuery('');
    setEntrypoint(entrypointId ?? '');
    setKind('');
    searchRef.current?.focus();
    // Keep the chosen framework and package context when clearing a search.
  };
  const filterCount =
    Number(framework !== 'all') +
    Number(
      Boolean(effectiveEntrypoint && effectiveEntrypoint !== entrypointId)
    ) +
    Number(Boolean(effectiveKind));
  const symbols = filterApiSymbols(index.symbols, index.entrypoints, {
    query,
    framework,
    entrypoint: effectiveEntrypoint,
    kind: effectiveKind,
  });
  return (
    <div className="api-reference-index">
      <div className="api-reference-filters">
        <div className="api-reference-search-row">
          <label className="api-reference-query">
            Find an API
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name or import path…"
            />
          </label>
          <button
            type="button"
            className="api-reference-filter-toggle"
            aria-expanded={filtersOpen}
            aria-controls={filtersId}
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            <SlidersHorizontal size={16} aria-hidden="true" />
            Filters
            {filterCount ? (
              <span className="api-reference-filter-count">{filterCount}</span>
            ) : null}
          </button>
        </div>
        <div
          id={filtersId}
          className="api-reference-secondary-filters"
          data-open={filtersOpen}
        >
          <label>
            <span id={`${filtersId}-framework`}>Framework</span>
            <select
              aria-labelledby={`${filtersId}-framework`}
              value={framework}
              onChange={(event) =>
                changeFramework(event.target.value as ApiScope)
              }
            >
              {API_SCOPES.filter(
                (item) =>
                  item.value === 'all' ||
                  index.entrypoints.some(
                    (entry) => entry.framework === item.value
                  )
              ).map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span id={`${filtersId}-import`}>Import path</span>
            <select
              aria-labelledby={`${filtersId}-import`}
              value={effectiveEntrypoint}
              onChange={(event) => setEntrypoint(event.target.value)}
            >
              <option value="">All imports</option>
              {entries.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.importPath}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span id={`${filtersId}-kind`}>Kind</span>
            <select
              aria-labelledby={`${filtersId}-kind`}
              value={effectiveKind}
              onChange={(event) => setKind(event.target.value)}
            >
              <option value="">All kinds</option>
              {kinds.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <div className="api-reference-results-toolbar">
        <p
          className="api-reference-result-count"
          role="status"
          aria-live="polite"
        >
          {symbols.length} {symbols.length === 1 ? 'API' : 'APIs'}
          {framework !== 'all'
            ? ` · ${API_SCOPES.find((item) => item.value === framework)?.label}`
            : ''}
        </p>
        {query || kind || effectiveEntrypoint !== (entrypointId ?? '') ? (
          <button type="button" onClick={reset}>
            Clear filters
          </button>
        ) : null}
      </div>
      {symbols.length === 0 ? (
        <div className="api-reference-empty">
          <p>No APIs match these filters.</p>
          <p>Try another name or clear the search and filters.</p>
        </div>
      ) : null}
      {entries.map((entry) => {
        const items = symbols.filter(
          (symbol) => symbol.entrypointId === entry.id
        );
        if (items.length === 0) return null;
        return (
          <section className="api-reference-package" key={entry.id}>
            <header>
              <h2>
                <Link href={apiSymbolHref(entry.id)}>{entry.importPath}</Link>
              </h2>
              <span className="api-reference-badge">{entry.framework}</span>
              {entry.status === 'development' ? (
                <span className="api-reference-badge" data-status="development">
                  Unpublished
                </span>
              ) : (
                <span className="api-reference-version">v{entry.version}</span>
              )}
            </header>
            <ul className="api-reference-symbols">
              {items.map((symbol) => (
                <li key={symbol.href}>
                  <Link href={symbol.href}>{symbol.name}</Link>
                  <span className="api-reference-badge">{symbol.kind}</span>
                  {symbol.isDeprecated ? (
                    <span
                      className="api-reference-badge"
                      data-status="deprecated"
                    >
                      Deprecated
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
