'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  apiSymbolHref,
  filterApiSymbols,
  type ApiIndex,
} from '../../../lib/api-reference-model';

/** Searchable SDK index; deprecated and unpublished declarations stay visible. */
export function ApiIndexView({
  index,
  entrypointId,
}: {
  index: ApiIndex;
  entrypointId?: string;
}) {
  const [query, setQuery] = useState('');
  const [framework, setFramework] = useState('all');
  const [entrypoint, setEntrypoint] = useState(entrypointId ?? '');
  const [kind, setKind] = useState('');
  const symbols = filterApiSymbols(index.symbols, index.entrypoints, {
    query,
    framework,
    entrypoint,
    kind,
  });
  const kinds = [...new Set(index.symbols.map((symbol) => symbol.kind))].sort();
  return (
    <div className="api-reference-index">
      <div className="api-reference-filters">
        <label className="api-reference-query">
          Find an API
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name or import path…"
          />
        </label>
        <label>
          Framework
          <select
            value={framework}
            onChange={(event) => setFramework(event.target.value)}
          >
            <option value="all">All frameworks</option>
            <option value="angular">Angular</option>
            <option value="react">React</option>
            <option value="shared">Shared TypeScript</option>
            <option value="backend">Backend</option>
          </select>
        </label>
        <label>
          Import path
          <select
            value={entrypoint}
            onChange={(event) => setEntrypoint(event.target.value)}
          >
            <option value="">All imports</option>
            {index.entrypoints.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.importPath}
              </option>
            ))}
          </select>
        </label>
        <label>
          Kind
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value)}
          >
            <option value="">All kinds</option>
            {kinds.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="api-reference-result-count" role="status">
        {symbols.length} {symbols.length === 1 ? 'API' : 'APIs'}
      </p>
      {symbols.length === 0 ? <p>No APIs match these filters.</p> : null}
      {index.entrypoints.map((entry) => {
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
