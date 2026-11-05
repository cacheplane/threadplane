'use client';
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { Citation } from '@threadplane/core';
import { markdownUrl } from '@threadplane/content/markdown';
import { previewPosition } from './preview-position.js';

function available(target: HTMLElement) {
  const win = target.ownerDocument.defaultView;
  if (
    !win ||
    !target.isConnected ||
    target.closest('[hidden], [inert]') ||
    target.matches(':disabled')
  )
    return false;
  for (
    let ancestor: HTMLElement | null = target;
    ancestor;
    ancestor = ancestor.parentElement
  ) {
    const style = win.getComputedStyle(ancestor);
    if (
      ancestor.tagName === 'DETAILS' &&
      !ancestor.hasAttribute('open') &&
      !ancestor.querySelector(':scope > summary')?.contains(target)
    )
      return false;
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse'
    )
      return false;
  }
  return true;
}

/** Local presentation only: borrowed metadata is never fetched or observed. */
export function InlinePreview({
  citation,
  label,
}: {
  readonly citation: Citation;
  readonly label: string;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({ left: 8, top: 8 });
  const timers = useRef<{
    open?: ReturnType<typeof setTimeout>;
    close?: ReturnType<typeof setTimeout>;
  }>({});
  const suppressed = useRef(false);
  const spaceBlocked = useRef(false);
  const cancel = () => {
    clearTimeout(timers.current.open);
    clearTimeout(timers.current.close);
  };
  const ownsFocus = () => {
    const active = trigger.current?.ownerDocument.activeElement;
    return (
      active === trigger.current || !!panel.current?.contains(active ?? null)
    );
  };
  const dismiss = (restore = false) => {
    cancel();
    suppressed.current = true;
    const button = trigger.current;
    const restoreFocus =
      restore &&
      !!panel.current?.contains(button?.ownerDocument.activeElement ?? null);
    setOpen(false);
    if (restoreFocus && button && available(button)) button.focus();
  };
  const activate = () => {
    cancel();
    suppressed.current = false;
    setOpen(true);
  };
  const leave = () => {
    clearTimeout(timers.current.open);
    clearTimeout(timers.current.close);
    timers.current.close = setTimeout(() => {
      if (!ownsFocus()) setOpen(false);
    }, 200);
  };
  useEffect(
    () => () => {
      clearTimeout(timers.current.open);
      clearTimeout(timers.current.close);
    },
    []
  );
  useEffect(() => {
    const button = trigger.current;
    if (!button) return;
    const doc = button.ownerDocument;
    const win = doc.defaultView;
    const retire = () => {
      cancel();
      spaceBlocked.current = false;
    };
    const visibility = () => {
      if (doc.visibilityState === 'hidden') retire();
    };
    const focus = () => {
      if (!ownsFocus()) {
        cancel();
        suppressed.current = false;
        setOpen(false);
      }
    };
    const pointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!button.contains(target) && !panel.current?.contains(target)) {
        if (panel.current) dismiss();
        else cancel();
      }
    };
    doc.addEventListener('focusin', focus);
    doc.addEventListener('pointerdown', pointer);
    doc.addEventListener('visibilitychange', visibility);
    win?.addEventListener('blur', retire);
    return () => {
      doc.removeEventListener('focusin', focus);
      doc.removeEventListener('pointerdown', pointer);
      doc.removeEventListener('visibilitychange', visibility);
      win?.removeEventListener('blur', retire);
    };
  }, []);
  useEffect(() => {
    if (!open || !trigger.current || !panel.current) return;
    const button = trigger.current;
    const card = panel.current;
    const win = button.ownerDocument.defaultView;
    if (!win) return;
    const position = () => {
      const viewport = win.visualViewport;
      const inherited = win.getComputedStyle(button);
      setStyle({
        ...previewPosition(
          button.getBoundingClientRect(),
          card.getBoundingClientRect(),
          {
            width: viewport?.width ?? win.innerWidth,
            height: viewport?.height ?? win.innerHeight,
            left: viewport?.offsetLeft,
            top: viewport?.offsetTop,
          },
          inherited.direction === 'rtl'
        ),
        direction: inherited.direction as 'rtl' | 'ltr',
        maxWidth: Math.max(0, (viewport?.width ?? win.innerWidth) - 16),
        maxHeight: Math.max(0, (viewport?.height ?? win.innerHeight) - 16),
        fontFamily: inherited.fontFamily,
        fontSize: inherited.fontSize,
        lineHeight: inherited.lineHeight,
        background:
          inherited.getPropertyValue('--ds-surface').trim() || 'white',
        color: inherited.color,
      });
    };
    position();
    const observer = win.ResizeObserver
      ? new win.ResizeObserver(position)
      : undefined;
    observer?.observe(card);
    observer?.observe(button);
    win.addEventListener('scroll', position, true);
    win.addEventListener('resize', position);
    win.visualViewport?.addEventListener('resize', position);
    win.visualViewport?.addEventListener('scroll', position);
    return () => {
      observer?.disconnect();
      win.removeEventListener('scroll', position, true);
      win.removeEventListener('resize', position);
      win.visualViewport?.removeEventListener('resize', position);
      win.visualViewport?.removeEventListener('scroll', position);
    };
  }, [open, citation]);
  const href =
    citation.url === undefined ? undefined : markdownUrl(citation.url, 'link');
  const keyup = (event: React.KeyboardEvent<HTMLElement>) => {
    event.stopPropagation();
    if (
      event.key === ' ' &&
      (spaceBlocked.current ||
        event.defaultPrevented ||
        event.repeat ||
        event.nativeEvent.isComposing ||
        event.keyCode === 229 ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey)
    )
      event.preventDefault();
    spaceBlocked.current = false;
  };
  const keydown = (event: React.KeyboardEvent<HTMLElement>) => {
    event.stopPropagation();
    const ignored =
      event.defaultPrevented ||
      event.repeat ||
      event.nativeEvent.isComposing ||
      event.keyCode === 229 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!ignored) dismiss(true);
    } else if (event.key === 'Tab' && !ignored && open) {
      const controls = Array.from(
        panel.current?.querySelectorAll<HTMLElement>('button,a[href]') ?? []
      ).filter(available);
      if (event.target === trigger.current && !event.shiftKey) {
        event.preventDefault();
        controls[0]?.focus();
      } else if (event.target === controls[0] && event.shiftKey) {
        event.preventDefault();
        trigger.current?.focus();
      } else if (event.target === controls.at(-1) && !event.shiftKey) {
        event.preventDefault();
        const button = trigger.current;
        if (button) {
          const targets = Array.from(
            button.ownerDocument.querySelectorAll<HTMLElement>(
              'button,a[href],input,textarea,select,[tabindex],[contenteditable]:not([contenteditable="false"]),summary,iframe,area[href],audio[controls],video[controls]'
            )
          )
            .filter(
              (target) =>
                (target.tabIndex >= 0 ||
                  (!target.hasAttribute('tabindex') &&
                    target.hasAttribute('contenteditable') &&
                    !target.parentElement?.closest(
                      '[contenteditable]:not([contenteditable="false"])'
                    ))) &&
                available(target) &&
                !panel.current?.contains(target)
            )
            .sort(
              (a, b) =>
                (a.tabIndex > 0 ? a.tabIndex : Infinity) -
                (b.tabIndex > 0 ? b.tabIndex : Infinity)
            );
          const next = targets[targets.indexOf(button) + 1];
          dismiss();
          next?.focus();
        }
      }
    } else if (event.key === ' ') {
      spaceBlocked.current = ignored || event.shiftKey;
      if (spaceBlocked.current) event.preventDefault();
    } else if (event.key === 'Enter' && (ignored || event.shiftKey))
      event.preventDefault();
  };
  return (
    <>
      <sup>
        <button
          ref={trigger}
          type="button"
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          style={{ font: 'inherit', color: 'inherit', cursor: 'pointer' }}
          onFocus={() => {
            cancel();
            if (!suppressed.current) setOpen(true);
          }}
          onBlur={(event) => {
            if (!event.relatedTarget) {
              cancel();
              setOpen(false);
              suppressed.current = false;
            }
          }}
          onPointerEnter={(event) => {
            clearTimeout(timers.current.close);
            if (
              event.pointerType !== 'touch' &&
              event.currentTarget.ownerDocument.defaultView?.matchMedia?.(
                '(hover: hover) and (pointer: fine)'
              ).matches
            ) {
              clearTimeout(timers.current.open);
              timers.current.open = setTimeout(activate, 120);
            }
          }}
          onPointerLeave={leave}
          onKeyDown={keydown}
          onKeyUp={keyup}
          onClick={(event) => {
            event.stopPropagation();
            if (
              !event.defaultPrevented &&
              !event.altKey &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.shiftKey
            )
              activate();
          }}
        >
          [{citation.index}]
        </button>
      </sup>
      {open &&
        trigger.current &&
        createPortal(
          <div
            ref={panel}
            id={id}
            role="dialog"
            aria-label={`Source ${citation.index}`}
            onKeyDown={keydown}
            onKeyUp={keyup}
            onBlur={(event) => {
              if (!event.relatedTarget) {
                cancel();
                suppressed.current = false;
                setOpen(false);
              }
            }}
            onPointerEnter={cancel}
            onPointerLeave={leave}
            style={{
              position: 'fixed',
              zIndex: 1000,
              boxSizing: 'border-box',
              width: 360,
              maxWidth: 'calc(100vw - 16px)',
              maxHeight: 'calc(100dvh - 16px)',
              overflow: 'auto',
              overflowWrap: 'anywhere',
              whiteSpace: 'pre-wrap',
              padding: 16,
              border: '1px solid #9ba9b8',
              borderRadius: 8,
              background: 'var(--ds-surface, white)',
              color: 'var(--ds-text-primary, #142435)',
              boxShadow: '0 6px 24px #0003',
              ...style,
            }}
          >
            <button
              type="button"
              style={{ minHeight: 44, minWidth: 44 }}
              onClick={(event) => {
                event.stopPropagation();
                if (
                  !event.defaultPrevented &&
                  !event.altKey &&
                  !event.ctrlKey &&
                  !event.metaKey &&
                  !event.shiftKey
                )
                  dismiss(true);
              }}
            >
              Close
            </button>
            <h2>
              {citation.title ?? citation.url ?? `Source ${citation.index}`}
            </h2>
            <dl>
              <dt>Index</dt>
              <dd>{citation.index}</dd>
              {(['snippet', 'sourceType', 'publishedAt', 'url'] as const).map(
                (field) =>
                  citation[field] !== undefined && (
                    <div key={field}>
                      <dt>
                        {
                          {
                            snippet: 'Snippet',
                            sourceType: 'Source type',
                            publishedAt: 'Published at',
                            url: 'URL',
                          }[field]
                        }
                      </dt>
                      <dd style={{ marginInlineStart: 0 }}>
                        {citation[field]}
                      </dd>
                    </div>
                  )
              )}
            </dl>
            {href !== undefined && (
              <a href={href} target="_blank" rel="noopener noreferrer">
                Open source
              </a>
            )}
          </div>,
          trigger.current.ownerDocument.body
        )}
    </>
  );
}
