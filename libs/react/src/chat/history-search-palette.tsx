'use client';
import {
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useIsomorphicLayoutEffect } from './internal/isomorphic-layout-effect.js';
import {
  availableDialogTarget,
  dialogPresentation,
} from './internal/dialog-presentation.js';

export interface HistorySearchResult {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
}

export interface HistorySearchPaletteProps {
  readonly open: boolean;
  readonly query: string;
  readonly results: readonly HistorySearchResult[];
  readonly onQueryChange: (query: string) => void;
  readonly onSelect: (id: string) => void;
  readonly onClose: () => void;
  readonly loading?: boolean;
  readonly label?: string;
  readonly description?: string;
  readonly placeholder?: string;
  readonly closeLabel?: string;
  readonly className?: string;
  readonly returnFocusTo?: HTMLElement | null;
}

/** Controlled search presentation. Callers own query/results, unique IDs and navigation. */
export function HistorySearchPalette({
  open,
  query,
  results,
  onQueryChange,
  onSelect,
  onClose,
  loading = false,
  label = 'Search conversations',
  description,
  placeholder = 'Search conversation titles…',
  closeLabel = 'Close search',
  className,
  returnFocusTo,
}: HistorySearchPaletteProps) {
  const id = useId();
  const marker = useRef<HTMLSpanElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const composing = useRef(false);
  const escapeHeld = useRef(false);
  const space = useRef<{ target: EventTarget | null; blocked: boolean } | null>(
    null
  );
  const [active, setActive] = useState<{ query: string; id: string | null }>({
    query,
    id: null,
  });
  const found =
    active.query === query
      ? results.findIndex((row) => row.id === active.id)
      : -1;
  const activeIndex = loading || results.length === 0 ? -1 : Math.max(0, found);
  const activeId = activeIndex < 0 ? null : results[activeIndex].id;
  const latest = useRef({
    query,
    results,
    loading,
    activeId,
    onQueryChange,
    onSelect,
    onClose,
    returnFocusTo,
  });
  const [portal, setPortal] = useState<{
    document: Document;
    style: CSSProperties;
    invoker: HTMLElement | null;
  } | null>(null);
  useIsomorphicLayoutEffect(() => {
    latest.current = {
      query,
      results,
      loading,
      activeId,
      onQueryChange,
      onSelect,
      onClose,
      returnFocusTo,
    };
  });
  useIsomorphicLayoutEffect(() => {
    // Persist fallback identity too: later reorders must not silently select
    // another row or resurrect a result that was removed from the list.
    if (active.query !== query)
      setActive({ query, id: results[0]?.id ?? null });
    else if (!loading && active.id !== activeId)
      setActive({ query, id: activeId });
  }, [active.query, active.id, activeId, loading, query, results]);
  useIsomorphicLayoutEffect(() => {
    const anchor = marker.current;
    if (!open || !anchor) {
      setPortal(null);
      return;
    }
    const doc = anchor.ownerDocument;
    const win = doc.defaultView;
    const candidate = latest.current.returnFocusTo ?? doc.activeElement;
    setActive({
      query: latest.current.query,
      id: latest.current.results[0]?.id ?? null,
    });
    setPortal({
      document: doc,
      style: dialogPresentation(anchor),
      invoker:
        win &&
        candidate instanceof win.HTMLElement &&
        availableDialogTarget(candidate, doc)
          ? candidate
          : null,
    });
  }, [open]);
  useIsomorphicLayoutEffect(() => {
    const panel = dialog.current;
    if (!portal || !panel) return;
    const doc = portal.document;
    const win = doc.defaultView;
    let ownedFocus = false;
    const focus = () => {
      ownedFocus = panel.contains(doc.activeElement);
    };
    const resetKeys = () => {
      escapeHeld.current = false;
      space.current = null;
      composing.current = false;
    };
    const visibility = () => {
      if (doc.visibilityState === 'hidden') resetKeys();
    };
    const cancel = (event: Event) => {
      const claimed = event.defaultPrevented;
      event.preventDefault();
      event.stopPropagation();
      if (!claimed && !escapeHeld.current && !composing.current)
        latest.current.onClose();
    };
    resetKeys();
    panel.addEventListener('cancel', cancel);
    doc.addEventListener('focusin', focus);
    doc.addEventListener('visibilitychange', visibility);
    win?.addEventListener('blur', resetKeys);
    panel.showModal();
    input.current?.focus();
    focus();
    return () => {
      const current = doc.activeElement;
      const restore =
        panel.contains(current) || (current === doc.body && ownedFocus);
      panel.removeEventListener('cancel', cancel);
      doc.removeEventListener('focusin', focus);
      doc.removeEventListener('visibilitychange', visibility);
      win?.removeEventListener('blur', resetKeys);
      resetKeys();
      if (panel.open) panel.close();
      if (
        restore &&
        portal.invoker &&
        availableDialogTarget(portal.invoker, doc)
      )
        portal.invoker.focus();
    };
  }, [portal]);
  useIsomorphicLayoutEffect(() => {
    if (activeIndex >= 0)
      dialog.current
        ?.querySelectorAll<HTMLElement>('[role="option"]')
        [activeIndex]?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, query, results, portal]);

  const choose = (selectedId: string) => {
    const current = latest.current;
    if (
      current.loading ||
      !current.results.some((row) => row.id === selectedId)
    )
      return;
    latest.current = { ...current, activeId: selectedId };
    setActive({ query: current.query, id: selectedId });
    current.onSelect(selectedId);
  };
  const keydown = (event: KeyboardEvent<HTMLDialogElement>) => {
    const claimed = event.defaultPrevented;
    event.stopPropagation();
    const plain =
      !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    const ime =
      composing.current ||
      event.nativeEvent.isComposing ||
      event.nativeEvent.keyCode === 229;
    const ignored = claimed || ime || event.repeat || !plain;
    const current = latest.current;
    if (event.key === 'Escape') {
      // Claim native cancel for this press even when IME/another handler owns it.
      escapeHeld.current = true;
      if (!ime) event.preventDefault();
      if (!ignored) current.onClose();
    } else if (event.key === 'Tab' && !claimed && !ime) {
      const doc = event.currentTarget.ownerDocument;
      if (
        doc.activeElement === event.currentTarget ||
        (event.shiftKey
          ? doc.activeElement === input.current
          : doc.activeElement === close.current)
      ) {
        event.preventDefault();
        (event.shiftKey ? close.current : input.current)?.focus();
      }
    } else if (event.key === ' ' && event.target !== input.current) {
      if (!event.repeat)
        space.current = { target: event.target, blocked: ignored };
      else
        space.current = {
          target: space.current?.target ?? event.target,
          blocked: true,
        };
      if (ignored || space.current?.blocked) event.preventDefault();
    } else if (event.key === 'Enter') {
      if (event.target === input.current) {
        if (ime) return;
        event.preventDefault();
        if (!ignored && current.activeId !== null) choose(current.activeId);
      } else if (ignored) event.preventDefault();
    } else if (
      (event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
      event.target === input.current &&
      plain &&
      !claimed &&
      !ime
    ) {
      event.preventDefault();
      if (current.loading || current.results.length === 0) return;
      const index = Math.max(
        0,
        current.results.findIndex((row) => row.id === current.activeId)
      );
      const next = Math.max(
        0,
        Math.min(
          current.results.length - 1,
          index + (event.key === 'ArrowDown' ? 1 : -1)
        )
      );
      const nextId = current.results[next].id;
      latest.current = { ...current, activeId: nextId };
      setActive({ query: current.query, id: nextId });
    }
  };
  return (
    <>
      <span ref={marker} hidden aria-hidden="true" />
      {portal &&
        createPortal(
          <dialog
            ref={dialog}
            aria-modal="true"
            aria-labelledby={`${id}-title`}
            aria-describedby={description ? `${id}-description` : undefined}
            dir={portal.style.direction === 'rtl' ? 'rtl' : 'ltr'}
            style={portal.style}
            className={['tp-history-search-palette', className]
              .filter(Boolean)
              .join(' ')}
            onKeyDown={keydown}
            onKeyUp={(event) => {
              event.stopPropagation();
              if (event.key === 'Escape') escapeHeld.current = false;
              if (event.key === ' ') {
                if (
                  (event.target !== input.current || space.current) &&
                  (!space.current ||
                    space.current.blocked ||
                    space.current.target !== event.target ||
                    event.defaultPrevented ||
                    event.repeat ||
                    composing.current ||
                    event.nativeEvent.isComposing ||
                    event.nativeEvent.keyCode === 229 ||
                    event.altKey ||
                    event.ctrlKey ||
                    event.metaKey ||
                    event.shiftKey)
                )
                  event.preventDefault();
                space.current = null;
              }
            }}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
            onClick={(event) => {
              event.stopPropagation();
              if (
                event.defaultPrevented ||
                event.target !== event.currentTarget
              )
                return;
              const rect = event.currentTarget.getBoundingClientRect();
              if (
                event.clientX < rect.left ||
                event.clientX > rect.right ||
                event.clientY < rect.top ||
                event.clientY > rect.bottom
              )
                latest.current.onClose();
            }}
          >
            <h2 id={`${id}-title`}>{label}</h2>
            {description && (
              <p
                id={`${id}-description`}
                className="tp-history-search-palette__description"
              >
                {description}
              </p>
            )}
            <div className="tp-history-search-palette__input-row">
              <input
                ref={input}
                role="combobox"
                aria-label={label}
                aria-expanded="true"
                aria-autocomplete="list"
                aria-controls={`${id}-results`}
                aria-activedescendant={
                  activeIndex < 0 ? undefined : `${id}-result-${activeIndex}`
                }
                autoComplete="off"
                placeholder={placeholder}
                value={query}
                onChange={(event) =>
                  latest.current.onQueryChange(event.currentTarget.value)
                }
              />
              <button
                ref={close}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  if (!event.defaultPrevented) latest.current.onClose();
                }}
              >
                {closeLabel}
              </button>
            </div>
            <ul
              id={`${id}-results`}
              role="listbox"
              aria-label={`${label} results`}
              aria-busy={loading || undefined}
            >
              {results.map((row, index) => (
                <li
                  key={row.id}
                  role="option"
                  tabIndex={-1}
                  id={`${id}-result-${index}`}
                  aria-selected={index === activeIndex}
                  aria-disabled={loading || undefined}
                  onMouseDown={(event) => {
                    if (event.button === 0) event.preventDefault();
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!event.defaultPrevented) choose(row.id);
                  }}
                >
                  <span className="tp-history-search-palette__title">
                    {row.title}
                  </span>
                  {row.subtitle && (
                    <span className="tp-history-search-palette__subtitle">
                      {row.subtitle}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <p className="tp-history-search-palette__status" role="status">
              {loading
                ? 'Loading results…'
                : results.length
                ? ''
                : query.length
                ? 'No conversations match.'
                : 'Type a conversation title.'}
            </p>
          </dialog>,
          portal.document.body
        )}
    </>
  );
}
