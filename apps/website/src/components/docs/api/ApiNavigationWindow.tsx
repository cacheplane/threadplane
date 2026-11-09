'use client';

import Link from 'next/link';
import { ArrowLeft, ChevronRight, Search, X } from 'lucide-react';
import {
  Fragment,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  apiSymbolHref,
  type ApiEntrypoint,
} from '../../../lib/api-reference-model';
import type { ApiNavigationProps } from './ApiNavigation';

interface Library {
  id: string;
  label: string;
  entries: ApiEntrypoint[];
}

type Panel =
  | { kind: 'libraries' }
  | { kind: 'imports'; library: Library }
  | {
      kind: 'exports';
      library: Library;
      entry: ApiEntrypoint;
    };

function panelKey(panel: Panel) {
  return panel.kind === 'libraries'
    ? 'libraries'
    : panel.kind === 'imports'
    ? `library:${panel.library.id}`
    : `entry:${panel.entry.id}`;
}

function ImportLabel({ path }: { path: string }) {
  return (
    <>
      {path.split('/').map((part, index, parts) => (
        <Fragment key={index}>
          {part}
          {index < parts.length - 1 && (
            <>
              /<wbr />
            </>
          )}
        </Fragment>
      ))}
    </>
  );
}

/** One mounted navigation level; branch changes never navigate or close the drawer. */
export function ApiNavigationWindow({
  libraries,
  symbols,
  activeEntryId,
  activeHref,
  resolveHref,
  onNavigate,
}: {
  libraries: Library[];
  symbols: ApiNavigationProps['symbols'];
  activeEntryId?: string;
  activeHref: string;
  resolveHref: (href: string) => string;
  onNavigate?: () => void;
}) {
  const [panel, setPanel] = useState<Panel>(() => {
    const library = libraries.find((item) =>
      item.entries.some((entry) => entry.id === activeEntryId)
    );
    const entry = library?.entries.find((item) => item.id === activeEntryId);
    return library && entry
      ? { kind: 'exports', library, entry }
      : { kind: 'libraries' };
  });
  const [query, setQuery] = useState('');
  const [direction, setDirection] = useState<'forward' | 'back' | 'none'>(
    'none'
  );
  const scroll = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const positions = useRef(new Map<string, number>());
  const focusTarget = useRef<string | 'heading' | null>(null);
  const key = panelKey(panel);
  const title =
    panel.kind === 'libraries'
      ? 'Libraries'
      : panel.kind === 'imports'
      ? panel.library.label
      : panel.entry.importPath;
  const backLabel =
    panel.kind === 'exports' && panel.library.entries.length > 1
      ? panel.library.label
      : 'libraries';
  const exports =
    panel.kind === 'exports'
      ? symbols
          .filter(
            (symbol) =>
              symbol.entrypointId === panel.entry.id &&
              symbol.name.toLowerCase().includes(query.trim().toLowerCase())
          )
          .sort((a, b) => a.name.localeCompare(b.name))
      : [];

  useLayoutEffect(() => {
    const list = scroll.current;
    if (!list) return;
    list.scrollTop = positions.current.get(key) ?? 0;
    const target = focusTarget.current;
    if (target === 'heading') heading.current?.focus({ preventScroll: true });
    else if (target)
      Array.from(list.querySelectorAll<HTMLElement>('[data-api-item]'))
        .find((item) => item.dataset.apiItem === target)
        ?.focus({ preventScroll: true });
    else {
      // Reveal deep links inside this window without moving the article or stealing focus.
      const active = list.querySelector<HTMLElement>('[aria-current="page"]');
      if (active) {
        const item = active.getBoundingClientRect();
        const viewport = list.getBoundingClientRect();
        if (item.bottom > viewport.bottom || item.top < viewport.top)
          list.scrollTop +=
            item.top - viewport.top - list.clientHeight / 2 + item.height / 2;
      }
    }
    focusTarget.current = null;
  }, [key]);

  function changePanel(next: Panel, backTo?: string) {
    positions.current.set(key, scroll.current?.scrollTop ?? 0);
    focusTarget.current = backTo ?? 'heading';
    setDirection(backTo ? 'back' : 'forward');
    setQuery('');
    setPanel(next);
  }

  function back() {
    if (panel.kind === 'libraries') return;
    if (panel.kind === 'exports' && panel.library.entries.length > 1)
      changePanel(
        { kind: 'imports', library: panel.library },
        `entry:${panel.entry.id}`
      );
    else changePanel({ kind: 'libraries' }, `library:${panel.library.id}`);
  }

  function navigateKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
      return;
    const target = event.target as HTMLElement;
    // Search and its clear button keep native text-editing keys.
    if (!target.matches('[data-api-item], [data-api-panel-title]')) return;
    if (event.key === 'ArrowLeft' && panel.kind !== 'libraries') {
      event.preventDefault();
      back();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = Array.from(
      scroll.current?.querySelectorAll<HTMLElement>('[data-api-item]') ?? []
    );
    if (!items.length) return;
    event.preventDefault();
    const index = items.indexOf(target);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
        ? items.length - 1
        : event.key === 'ArrowDown'
        ? Math.min(index + 1, items.length - 1)
        : Math.max(index - 1, 0);
    items[next].focus();
  }

  return (
    <div className="api-navigation-window" onKeyDown={navigateKeys}>
      <div
        key={key}
        className="api-navigation-panel"
        data-direction={direction}
        data-api-panel={panel.kind}
      >
        <header className="api-navigation-header">
          {panel.kind !== 'libraries' && (
            <button
              type="button"
              className="api-navigation-back"
              onClick={back}
              aria-label={`Back to ${backLabel}`}
            >
              <ArrowLeft size={16} aria-hidden="true" />
              <span>{backLabel === 'libraries' ? 'Libraries' : backLabel}</span>
            </button>
          )}
          <h3
            ref={heading}
            tabIndex={-1}
            data-api-panel-title=""
            className={
              panel.kind === 'exports' ? 'api-navigation-import' : undefined
            }
          >
            {panel.kind === 'exports' ? <ImportLabel path={title} /> : title}
          </h3>
          <p>
            {panel.kind === 'libraries'
              ? `${libraries.length} libraries`
              : panel.kind === 'imports'
              ? `${panel.library.entries.length} imports`
              : `${exports.length} exports`}
          </p>
        </header>
        {panel.kind === 'exports' && (
          <div className="api-navigation-search">
            <Search size={16} aria-hidden="true" />
            <input
              ref={search}
              type="search"
              aria-label="Filter exports"
              placeholder="Filter exports…"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                if (scroll.current) scroll.current.scrollTop = 0;
              }}
            />
            {query && (
              <button
                type="button"
                aria-label="Clear export search"
                onClick={() => {
                  setQuery('');
                  search.current?.focus();
                }}
              >
                <X size={16} aria-hidden="true" />
              </button>
            )}
          </div>
        )}
        <div ref={scroll} className="api-navigation-items">
          {panel.kind === 'libraries' &&
            libraries.map((library) => (
              <button
                type="button"
                key={library.id}
                data-api-item={`library:${library.id}`}
                onClick={() =>
                  changePanel(
                    library.entries.length === 1
                      ? { kind: 'exports', library, entry: library.entries[0] }
                      : { kind: 'imports', library }
                  )
                }
              >
                <span>{library.label}</span>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            ))}
          {panel.kind === 'imports' &&
            panel.library.entries.map((entry) => (
              <button
                type="button"
                key={entry.id}
                data-api-item={`entry:${entry.id}`}
                onClick={() =>
                  changePanel({
                    kind: 'exports',
                    library: panel.library,
                    entry,
                  })
                }
              >
                <span className="api-navigation-import">
                  <ImportLabel path={entry.importPath} />
                </span>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            ))}
          {panel.kind === 'exports' && (
            <>
              <Link
                data-api-item="overview"
                aria-label={panel.entry.importPath}
                href={resolveHref(apiSymbolHref(panel.entry.id))}
                onClick={onNavigate}
                aria-current={
                  activeHref === apiSymbolHref(panel.entry.id)
                    ? 'page'
                    : undefined
                }
              >
                Overview
              </Link>
              {exports.map((symbol) => (
                <Link
                  key={symbol.href}
                  data-api-item={symbol.href}
                  href={resolveHref(symbol.href)}
                  onClick={onNavigate}
                  aria-current={activeHref === symbol.href ? 'page' : undefined}
                  className="api-navigation-export"
                >
                  {symbol.name}
                  {symbol.isDeprecated ? ' (deprecated)' : ''}
                </Link>
              ))}
              {!exports.length && (
                <p className="api-navigation-empty" role="status">
                  {query ? 'No matching exports.' : 'No exported declarations.'}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
