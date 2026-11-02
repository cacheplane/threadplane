'use client';

import Link from 'next/link';
import {
  apiSymbolHref,
  type ApiEntrypoint,
  type ApiSymbolSummary,
} from '../../../lib/api-reference-model';

export interface ApiNavigationProps {
  entrypoints: ApiEntrypoint[];
  symbols: ApiSymbolSummary[];
  activeHref: string;
}

/** Generated import-path tree shared by desktop and mobile docs navigation. */
export function ApiNavigation({
  entrypoints,
  symbols,
  activeHref,
  onNavigate,
  resolveHref = (href) => href,
}: ApiNavigationProps & {
  onNavigate?: () => void;
  resolveHref?: (href: string) => string;
}) {
  return (
    <nav className="api-reference-navigation" aria-label="API reference">
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
      {entrypoints.map((entry) => {
        const href = apiSymbolHref(entry.id);
        const active =
          activeHref === href ||
          symbols.some(
            (symbol) =>
              symbol.entrypointId === entry.id && symbol.href === activeHref
          );
        const children = symbols.filter(
          (symbol) => symbol.entrypointId === entry.id
        );
        if (children.length === 0)
          return (
            <Link
              key={entry.id}
              href={resolveHref(href)}
              onClick={onNavigate}
              aria-current={activeHref === href ? 'page' : undefined}
            >
              {entry.importPath}
            </Link>
          );
        return (
          <details key={entry.id} open={active}>
            <summary>
              <span>{entry.importPath}</span>
            </summary>
            <Link
              aria-label={entry.importPath}
              href={resolveHref(href)}
              onClick={onNavigate}
              aria-current={activeHref === href ? 'page' : undefined}
            >
              Overview
            </Link>
            {children.map((symbol) => (
              <Link
                key={symbol.href}
                href={resolveHref(symbol.href)}
                onClick={onNavigate}
                aria-current={activeHref === symbol.href ? 'page' : undefined}
              >
                {symbol.name}
                {symbol.isDeprecated ? ' (deprecated)' : ''}
              </Link>
            ))}
          </details>
        );
      })}
    </nav>
  );
}
