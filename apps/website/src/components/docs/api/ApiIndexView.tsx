'use client';

import Link from 'next/link';
import { Suspense, useEffect, useId, useRef, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { DocsSelect } from '../DocsSelect';
import { apiEntrypointDescription } from '../../../lib/api-entrypoint-descriptions';
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
  defaultView?: 'entrypoints' | 'symbols';
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
  defaultView = 'entrypoints',
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
  const showSymbols = Boolean(
    defaultView === 'symbols' ||
      entrypointId ||
      query.trim() ||
      effectiveEntrypoint ||
      effectiveKind
  );
  const resultCount = showSymbols ? symbols.length : entries.length;
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
          <DocsSelect
            label="Framework"
            value={framework}
            onChange={changeFramework}
            options={API_SCOPES.filter(
              (item) =>
                item.value === 'all' ||
                index.entrypoints.some(
                  (entry) => entry.framework === item.value
                )
            )}
          />
          <DocsSelect
            label="Import path"
            value={effectiveEntrypoint}
            onChange={setEntrypoint}
            options={[
              { value: '', label: 'All imports' },
              ...entries.map((entry) => ({
                value: entry.id,
                label: entry.importPath,
              })),
            ]}
          />
          <DocsSelect
            label="Kind"
            value={effectiveKind}
            onChange={setKind}
            options={[
              { value: '', label: 'All kinds' },
              ...kinds.map((item) => ({ value: item, label: item })),
            ]}
          />
        </div>
      </div>
      <div className="api-reference-results-toolbar">
        <p
          className="api-reference-result-count"
          role="status"
          aria-live="polite"
        >
          {resultCount}{' '}
          {showSymbols
            ? resultCount === 1
              ? 'API'
              : 'APIs'
            : resultCount === 1
            ? 'entrypoint'
            : 'entrypoints'}
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
      {showSymbols && symbols.length === 0 ? (
        <div className="api-reference-empty">
          <p>No APIs match these filters.</p>
          <p>Try another name or clear the search and filters.</p>
        </div>
      ) : null}
      {!showSymbols ? (
        <div className="api-reference-entrypoint-grid">
          {entries.map((entry) => {
            const count = index.symbols.filter(
              (symbol) => symbol.entrypointId === entry.id
            ).length;
            return (
              <section className="api-reference-entrypoint-card" key={entry.id}>
                <h2>
                  <Link href={apiSymbolHref(entry.id)}>{entry.importPath}</Link>
                </h2>
                <p>{apiEntrypointDescription(entry)}</p>
                <div className="api-reference-entrypoint-meta">
                  <span className="api-reference-badge">{entry.framework}</span>
                  {entry.status === 'development' ? (
                    <span
                      className="api-reference-badge"
                      data-status="development"
                    >
                      Unpublished
                    </span>
                  ) : (
                    <span className="api-reference-version">
                      v{entry.version}
                    </span>
                  )}
                  <span>
                    {count} {count === 1 ? 'export' : 'exports'}
                  </span>
                </div>
              </section>
            );
          })}
        </div>
      ) : null}
      {showSymbols &&
        entries.map((entry) => {
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
                  <span
                    className="api-reference-badge"
                    data-status="development"
                  >
                    Unpublished
                  </span>
                ) : (
                  <span className="api-reference-version">
                    v{entry.version}
                  </span>
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
