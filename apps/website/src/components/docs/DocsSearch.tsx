'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { docsConfig, specialDocsPages, type LibraryId } from '../../lib/docs-config';
import { analyticsEvents } from '../../lib/analytics/events';
import { track } from '../../lib/analytics/client';
import { searchTokens } from '../../lib/docs-search-tokens';
import type { DocsSearchHit } from '../../lib/docs-search-types';

interface SearchablePage {
  title: string;
  description?: string;
  href: string;
  slug?: string;
  section?: string;
  library?: LibraryId;
  libraryTitle: string;
}

function searchableText(page: SearchablePage): string {
  return [page.title, page.description, page.slug, page.section, page.libraryTitle].filter(Boolean).join(' ');
}

function matchesQuery(page: SearchablePage, query: string): boolean {
  const queryTokens = searchTokens(query);
  if (queryTokens.length === 0) return false;

  const pageText = searchableText(page).toLowerCase();
  return queryTokens.every((token) => pageText.includes(token));
}

const allSearchablePages: SearchablePage[] = [
  ...specialDocsPages.map((page) => ({
    title: page.title,
    description: page.description,
    href: page.path,
    libraryTitle: 'Start here',
  })),
  ...docsConfig.flatMap((lib) =>
    lib.sections.flatMap((s) =>
      s.pages.map((p) => ({
        ...p,
        href: p.href ?? `/docs/${lib.id}/${p.section}/${p.slug}`,
        library: lib.id,
        libraryTitle: lib.title,
      }))
    )
  ),
];

/**
 * Wrap the matched ranges from server-supplied offsets.
 *
 * The server sends text plus offsets rather than HTML, so nothing it
 * produces is ever rendered as markup — React escapes the text nodes below
 * by construction. Ranges are clamped defensively: an out-of-range or
 * out-of-order mark from a future server change must never throw or drop
 * the remainder of the snippet.
 */
function renderSnippet(snippet: string, marks: [number, number][]): ReactNode[] {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const [rawStart, rawEnd] of marks) {
    const start = Math.max(0, Math.min(rawStart, snippet.length));
    const end = Math.max(start, Math.min(rawEnd, snippet.length));
    if (start < cursor) continue;
    if (start > cursor) parts.push(snippet.slice(cursor, start));
    if (end > start) parts.push(<mark key={start}>{snippet.slice(start, end)}</mark>);
    cursor = end;
  }
  parts.push(snippet.slice(cursor));
  return parts;
}

/** A single item in the combined, continuously-navigable options list. */
type NavItem =
  | { kind: 'page'; page: SearchablePage }
  | { kind: 'hit'; hit: DocsSearchHit };

export function DocsSearch({ library }: { library?: LibraryId }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const listboxId = 'docs-search-listbox';
  const router = useRouter();

  const results = query.length > 0
    ? allSearchablePages.filter((p) => matchesQuery(p, query)).slice(0, 8)
    : allSearchablePages.filter((p) => !library || !p.library || p.library === library).slice(0, 6);

  const [contentHits, setContentHits] = useState<DocsSearchHit[]>([]);

  // The instant client matcher above renders as you type. These arrive after
  // a round trip and merge in below it, so the fast path stays fast and a
  // slow, failed or offline request degrades to exactly today's behaviour.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setContentHits([]);
      return undefined;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/docs-search?q=${encodeURIComponent(trimmed)}`, {
        signal: controller.signal,
      })
        .then((response) => (response.ok ? response.json() : { results: [] }))
        .then((payload: { results?: DocsSearchHit[] }) => {
          // A newer query's effect already aborted this controller by the
          // time a stale response lands (our own abort() flips `.aborted`
          // synchronously even when the fetch itself ignores the signal, as
          // test doubles and some browsers do). Without this check a slow
          // response for an old query could clobber a newer query's state.
          if (controller.signal.aborted) return;
          setContentHits(payload.results ?? []);
        })
        .catch(() => {
          // An aborted request means a newer one is already in flight, so
          // clearing here would blank results the new request is about to
          // replace. Only a genuine failure falls back to the instant layer,
          // and it does so silently — search never shows an error state.
          if (!controller.signal.aborted) setContentHits([]);
        });
    }, 150);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  // A deeper link wins over a page-level one the instant layer already
  // listed; an identical page-level hit is dropped.
  const titleHrefs = new Set(results.map((page) => page.href));
  const mergedContentHits = contentHits.filter(
    (hit) => hit.href.includes('#') || !titleHrefs.has(hit.href)
  );

  // One continuous, keyboard-navigable list: title matches first, then
  // content hits. Arrow keys, Enter and aria-activedescendant all drive off
  // this single array so every option is reachable and selectable.
  const navItems: NavItem[] = [
    ...results.map((page): NavItem => ({ kind: 'page', page })),
    ...mergedContentHits.map((hit): NavItem => ({ kind: 'hit', hit })),
  ];

  // Results can shrink or grow out from under a previously-set index (a
  // narrower query, or a content response landing after arrow-key
  // navigation) — clamp rather than let `selected` dangle past the end.
  useEffect(() => {
    setSelected((s) => Math.min(s, Math.max(navItems.length - 1, 0)));
  }, [navItems.length]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      setOpen((o) => !o);
    }
    if (e.key === 'Escape') setOpen(false);
  }, []);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (!open) return undefined;
    // Dialog pattern: remember where focus came from, restore it on close.
    restoreRef.current = document.activeElement as HTMLElement | null;
    setQuery('');
    setSelected(0);
    setTimeout(() => inputRef.current?.focus(), 50);
    return () => restoreRef.current?.focus();
  }, [open]);

  // Keep the keyboard-selected option in view (findings §7 — it scrolled
  // out of the 320px results box).
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, selected]);

  const navigate = (page: SearchablePage) => {
    track(analyticsEvents.docsSearchResultClick, {
      surface: 'docs',
      destination_url: page.href,
      library: page.library === 'langgraph' || page.library === 'render' || page.library === 'chat' ? page.library : 'unknown',
      query_length: query.length,
      result_count: navItems.length,
    });
    router.push(page.href);
    setOpen(false);
  };

  const navigateHit = (hit: DocsSearchHit) => {
    track(analyticsEvents.docsSearchResultClick, {
      surface: 'docs',
      destination_url: hit.href,
      library: 'unknown',
      query_length: query.length,
      result_count: navItems.length,
    });
    router.push(hit.href);
    setOpen(false);
  };

  const activate = (item: NavItem) => {
    if (item.kind === 'page') navigate(item.page);
    else navigateHit(item.hit);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => Math.min(s + 1, navItems.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); }
    if (e.key === 'Enter' && navItems[selected]) { activate(navItems[selected]); }
    // Focus trap: the combobox input is the dialog's only tab stop (options
    // are reached with the arrow keys), so Tab must not escape to the page
    // behind the modal.
    if (e.key === 'Tab') e.preventDefault();
  };

  if (!open) return null;

  return (
    <div className="docs-search-overlay" onClick={() => setOpen(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search documentation"
        onClick={(e) => e.stopPropagation()}
        className="docs-search-modal">
        <div className="docs-search-input-wrap">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              const nextQuery = e.target.value;
              setQuery(nextQuery);
              setSelected(0);
              if (nextQuery.length === 1) {
                track(analyticsEvents.docsSearchSubmit, {
                  surface: 'docs',
                  library: library === 'langgraph' || library === 'render' || library === 'chat' ? library : 'unknown',
                });
              }
            }}
            onKeyDown={handleInputKeyDown}
            placeholder="Search documentation..."
            role="combobox"
            aria-expanded={navItems.length > 0}
            aria-controls={listboxId}
            aria-activedescendant={navItems[selected] ? `docs-search-opt-${selected}` : undefined}
            className="docs-search-input"
          />
        </div>
        <div className="docs-search-results" ref={listRef} id={listboxId} role="listbox" aria-label="Search results">
          {results.map((page, i) => (
            <button
              key={page.href}
              id={`docs-search-opt-${i}`}
              role="option"
              aria-selected={i === selected}
              tabIndex={-1}
              onClick={() => navigate(page)}
              className="w-full text-left docs-search-result"
              data-selected={i === selected || undefined}>
              <span className="docs-search-result-title">{page.title}</span>
              <span className="docs-search-result-lib">{page.libraryTitle}</span>
            </button>
          ))}
          {mergedContentHits.length > 0 && (
            <div className="docs-search-group-label" role="presentation">
              In page content
            </div>
          )}
          {mergedContentHits.map((hit, j) => {
            const i = results.length + j;
            return (
              <button
                key={hit.href}
                id={`docs-search-opt-${i}`}
                role="option"
                aria-selected={i === selected}
                tabIndex={-1}
                onClick={() => navigateHit(hit)}
                className="w-full text-left docs-search-result"
                data-selected={i === selected || undefined}>
                <span className="docs-search-result-title">{hit.heading ?? hit.title}</span>
                <span className="docs-search-result-lib">{hit.libraryTitle} · {hit.title}</span>
                <span className="docs-search-result-snippet">
                  {renderSnippet(hit.snippet, hit.marks)}
                </span>
              </button>
            );
          })}
          {navItems.length === 0 && (
            <div className="docs-search-empty">
              No results found
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
